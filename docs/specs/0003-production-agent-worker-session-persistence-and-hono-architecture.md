# Spec: Production Voice Agent Architecture — LiveKit Agent Worker, Hono Framework, Session Persistence, and Conversational Fillers

## Problem Statement

When guests interact with Naina, the voice concierge system currently faces critical production scalability and reliability vulnerabilities:

1. **Catastrophic State Loss on Disconnection**: Session history and dialogue state live strictly in Node.js process memory. If a caller's mobile connection drops or cellular towers handover mid-call, the active session is destroyed. Reconnecting forces the guest to start over from turn 0, forgetting dates, guest counts, and selected rooms.
2. **Monolithic Server Bottlenecks (`http.createServer` + `ws`)**: The voice server combines REST endpoints, legacy binary PCM WebSockets, and database operations into a single Node.js `http` process. High-frequency audio packets allocate millions of short-lived buffers in the V8 heap, causing Garbage Collection (GC) pauses (50–200ms) that manifest as audible voice stutter and latency jitter.
3. **Dead-Air Silence During Database Tool Calls**: While PMS tools (e.g. `checkAvailability`) query PostgreSQL over the network (2–3 seconds), guests experience prolonged dead silence (7–14 seconds total when factoring in unconstrained LLM thinking loops), breaking conversational immersion.
4. **Unbounded Concurrency & Deployment Risks**: The monolithic server cannot autoscale on active call volume. Redeploying code abruptly drops active conversations without a drain mechanism.

---

## Solution

A resilient, scalable production architecture combining the **LiveKit Media Server + Agent Worker** pattern, the **Hono Web Framework**, **Session State Persistence (Durable Objects / PostgreSQL)**, and **Concurrent Conversational Fillers**:

```
[Caller (WebRTC / Phone via SIP)]
              │
              ▼
    [LiveKit Cloud SFU] ◄───► [LiveKit Job Dispatch Queue]
                                         │
                                         ▼
                            [Agent Worker Pool (Hono / Node.js)]
                            (1 Call = 1 Worker, Horizontal Autoscaling)
                                         │
               ┌─────────────────────────┼─────────────────────────┐
               ▼                         ▼                         ▼
    [Durable Object / Redis]      [Cartesia STT & TTS]     [Gemini 3.8 Flash]
    (Session State & Holds)      (Bi-directional Streams)  (thinkingBudget: 0)
               │                                                   │
               └─────────────────────────┬─────────────────────────┘
                                         ▼
                           [PostgreSQL Hotel PMS & Database]
                           (Drizzle ORM / 5-min Atomic Room Holds)
```

1. **Hono Web Framework**: Replace the raw `http.createServer` with **Hono**, delivering 5x–8x higher throughput, Web Standard `Request`/`Response` architecture, OpenAPI typing, and direct portability to Cloudflare Workers / Edge runtimes.
2. **Media Server + Agent Worker Separation**: LiveKit Media Server handles WebRTC media, ICE, and TURN. Dedicated, stateless **Agent Workers** claim jobs from LiveKit (1 call = 1 worker). Workers autoscale on active queue depth and support **Drain Mode** on deployment (completing active calls before graceful shutdown).
3. **Stateful Session Persistence & Resumption**:
   - Active dialogue turns and entities are committed to a fast persistence layer (Cloudflare Durable Object Actor or PostgreSQL `call_sessions` table with JSONB).
   - Temporary room reservations are protected by a **5-minute atomic Room Hold**.
   - If a caller disconnects and reconnects within 15 minutes, the worker re-hydrates conversation history instantly: *"Welcome back, John! I still have your hold on the Deluxe King for Oct 29. Shall we finalize your reservation?"*
4. **Conversational Fillers & Zero-Budget Thinking**:
   - `thinkingBudget: 0` is enforced on Gemini 3.8 Flash, dropping TTFT by more than 50% by eliminating internal reasoning loops.
   - When a PMS tool is invoked, the agent immediately emits a natural conversational filler (*"Let me check available rooms for those dates right away."*), synthesizing audio in <180ms. The caller hears smooth speech while the database executes in parallel, eliminating dead air.
5. **Strict Session Lifecycles & Guardrails**: Enforce a 12-minute max duration cutoff, 15-second silence prompts, and payment security (credit cards masked at STT level; payment links sent via SMS).

---

## User Stories

1. As a hotel guest, I want Naina to acknowledge my requests instantly with natural filler phrases, so that I never experience awkward dead silence while the system checks room availability.
2. As a hotel guest, I want my reservation details and room hold to be preserved if my call drops, so that when I call back I don't have to repeat my dates, party size, and room choice.
3. As a hotel guest, I want to interrupt Naina at any point during her speech, so that I can correct my dates or ask a new question without waiting.
4. As a hotel guest, I want my voice call to be crystal clear without audio stutter or lag, even during peak booking hours when hundreds of callers are active.
5. As a hotel guest, I want to receive a secure SMS payment link for finalizing my room deposit, so that I never have to speak sensitive credit card numbers over an insecure voice line.
6. As a hotel guest, I want Naina to politely ask if I am still on the line after prolonged silence, so that I am given time to think before the call ends.
7. As a developer, I want the voice server HTTP routes to be powered by Hono, so that route dispatch is ultra-fast, type-safe, and compatible with modern edge runtimes.
8. As a developer, I want legacy prototype WebSocket endpoints (`/ws/voice`) removed, so that all client voice traffic flows uniformly through LiveKit WebRTC.
9. As a developer, I want Gemini 3.8 Flash configured with `thinkingBudget: 0`, so that the LLM does not waste seconds in hidden reasoning loops before speaking.
10. As a developer, I want each PMS database tool to map to a contextual conversational filler phrase, so that audio playback begins concurrently with database execution.
11. As a developer, I want a standardized `call_sessions` table with JSONB turn history, so that sessions can be hydrated in any worker without tight coupling to server RAM.
12. As a developer, I want room holds to be backed by database transactions with a 5-minute TTL, so that double bookings are physically impossible.
13. As a DevOps engineer, I want agent workers to operate as stateless job consumers (1 call = 1 job), so that I can autoscale worker pods on Kubernetes using KEDA or Cloud Run.
14. As a DevOps engineer, I want agent workers to support deployment drain mode, so that rolling updates never terminate active guest conversations mid-sentence.
15. As a front-desk manager, I want all call transcripts, tool execution times, and turn latencies logged to PostgreSQL, so that I can audit guest reservations and service quality.
16. As a security compliance officer, I want payment card data filtered and masked before it reaches the LLM context, so that the voice platform remains PCI-DSS compliant.

---

## Implementation Decisions

### 1. Framework Migration: Hono on Node.js
- Replace `http.createServer` in `apps/voice-server/src/index.ts` with `Hono` using `@hono/node-server`.
- Standardize all REST endpoints:
  - `GET /health` / `GET /api/health`: Health status and model configs.
  - `POST /api/token`: Issues LiveKit room access tokens and triggers worker dispatch.
  - `GET /api/telemetry`: Exposes historical turn telemetry.
  - `GET /api/rooms`: Direct room availability queries.
- Remove legacy `/ws/voice` raw WebSocket handler, as the web client and telephony layers connect exclusively via LiveKit WebRTC.

### 2. LiveKit Agent Worker Architecture
- Structure agent workers as standalone job consumers subscribing to LiveKit room events.
- Implement explicit worker lifecycle states:
  - `IDLE`: Registered with LiveKit dispatch queue, ready to accept call.
  - `ASSIGNED`: Bound to a specific room, connecting to audio tracks.
  - `ACTIVE`: Streaming audio between guest, Cartesia, and Gemini.
  - `DRAINING`: Completing active conversation during shutdown, refusing new jobs.
  - `DISCONNECTED`: Cleaning up audio buffers and committing final transcript.

### 3. Session Persistence & Reconnection Layer
- Add `call_sessions` schema in `packages/hotel-pms-core/src/schema/call-sessions.ts`:
  - `id`: Unique session UUID (or caller phone hash).
  - `guestPhone`: Guest contact number.
  - `state`: `ACTIVE`, `HOLD_PENDING`, `COMPLETED`, or `DROPPED`.
  - `activeHoldId`: UUID of temporary room hold.
  - `collectedEntities`: JSONB object holding `{ checkInDate, checkOutDate, guests, roomType, guestName }`.
  - `turnsHistory`: JSONB array of serialized Gemini dialogue turns.
  - `expiresAt`: Timestamp (sliding 15-minute window).
- When a caller joins, the worker queries `call_sessions`. If an active session exists, it pre-populates Gemini's chat history before the first greeting.

### 4. Conversational Fillers & Concurrent Tool Execution
- In `NainaAgent`, when `pendingFunctionCalls.length > 0`, immediately yield a contextual filler event:
  - `checkAvailability` $\rightarrow$ *"Let me check available rooms for those dates right away."*
  - `createReservation` $\rightarrow$ *"I am preparing your reservation confirmation now. One moment please."*
  - `getReservation` $\rightarrow$ *"Let me pull up your reservation details."*
  - `getFolioBalance` $\rightarrow$ *"Let me look up your current room charges and folio balance."*
- In `VoiceOrchestrator`, the filler sentence is pushed to `tokenQueue` instantly. Cartesia TTS synthesizes it in <180ms, so the caller hears speech while the tool query runs in the background.

### 5. Gemini 3.8 Flash Voice Optimization
- In `apps/voice-server/src/agent/gemini-agent.ts`, enforce:
  - `temperature: 0.3` (low jitter, fast deterministic responses).
  - `thinkingConfig: { thinkingBudget: 0 }` (prohibits multi-second internal reasoning delays).
  - System instructions prohibiting redundant filler repetition once tool results are available.

### 6. Session Guardrails & Limits
- **Max Call Length**: Hard timeout at 12 minutes (transfers to front-desk staff).
- **Turn Cap**: Max 30 turns per session.
- **Inactivity Timeout**: Prompt at 12 seconds of silence; graceful hangup after an additional 15 seconds.
- **PCI Guardrail**: Regex intercepting 15-16 digit numbers; dispatches SMS payment link instead.

---

## Testing Decisions

### 1. Behavior-Driven & External Seam Testing
- All tests must test observable external behavior (audio packet arrival, HTTP status, database persistence) rather than internal private variables.
- Verification must produce quantitative evidence before asserting completion.

### 2. Test Modules
- **Hono API Test Suite**: Verifies `/health`, `/api/token`, and `/api/telemetry` return proper HTTP status codes, CORS headers, and JSON schemas under load.
- **Conversational Filler Timing Suite**: Measures the exact delta between user speech end and filler TTS start ($\le 400$ms), confirming tool execution finishes during filler playout.
- **Session Resumption & Reconnect Suite**:
  - Simulates Turn 1 with room selection.
  - Simulates abrupt socket disconnect.
  - Connects Turn 2 under the same session ID.
  - Asserts that Gemini immediately references Turn 1 entities without re-asking dates.
- **Interruption Context Regression Suite**: Confirms barge-in halts audio playback in $<10$ms while preserving 100% of conversation history.

---

## Out of Scope

1. **Carrier SIP Trunk Commercial Contracts**: Direct peering with Twilio, Telnyx, or Tata Telephony is out of scope for this software design.
2. **Physical Call Center WebRTC Agent Transfer Dashboard**: Human transfer will trigger a LiveKit SIP forward / room transfer event, but the agent desktop software is separate.
3. **Multi-language Speech Translation**: Voice interactions will remain focused on Indian English, standard English, and hospitality phrasing; real-time Hindi/Hinglish acoustic models will follow in a subsequent phase.

---

## Further Notes

- **Cloudflare Durable Object Alternative**: When deploying to Cloudflare Workers, the `call_sessions` table logic maps directly into a `CallSessionActor` Durable Object class with zero architectural friction, as Hono runs natively on both runtimes.
- **Deployment Strategy**: Containerized via Docker using multi-stage builds. Kubernetes deployments should configure KEDA (Kubernetes Event-driven Autoscaling) scaled on LiveKit room counts.
