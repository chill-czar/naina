# Spec: Real User-Perceived Latency Telemetry, Live HUD & Historical Turn Storage

## Problem Statement

When using Voice AI agents like Naina, the single most critical quality indicator is the user-perceived response time: the conversational turnaround delay between when the user finishes speaking their last syllable and when they hear the first sound wave of Naina's reply.

Currently, the application provides no quantitative measurement of this delay. Engineers and users have no visibility into:
1. What the actual, real-world latency (in milliseconds) felt by the user is.
2. Where that latency is being spent across the pipeline (silence detection, speech-to-text, LLM prompt processing, database queries, speech synthesis, or WebRTC audio buffer playout).
3. How latency evolves and improves over time across system updates, model tuning, and prompt optimizations.

Without real-time measurement and historical tracking, performance optimizations are blind guesswork.

---

## Solution

A client-authoritative, distributed turn-latency measurement and visualization system that:
1. **Captures True User-Perceived Latency**: The client browser marks the exact millisecond when the user's voice stops (`t_user_speech_end`), and marks the exact millisecond when the audio element plays the first sound wave to the user's speakers (`t_client_audio_playout`). The difference ($T_{\text{playout}} - T_{\text{speech\_end}}$) is the authentic End-to-End Latency.
2. **Instruments the Server-Side Pipeline**: The voice server captures high-resolution monotonic timestamps (`performance.now()`) for each intermediate milestone:
   - Speech-to-text finalization
   - Database/tool execution (e.g. check room availability, booking query)
   - LLM Time-to-First-Token (TTFT)
   - Speech synthesizer Time-to-First-Byte (TTFB)
3. **Synchronizes Millisecond Spans via LiveKit Data Channel**: The server sends the relative duration spans over WebRTC Data Channel alongside the first audio frame, avoiding clock-skew inaccuracies between client and server devices.
4. **Interactive Real-Time HUD (Heads-Up Display)**:
   - A live, color-coded header badge showing the authentic end-to-end latency (e.g. `⚡ 680ms` in green, amber, or red).
   - An expandable Latency Waterfall Drawer featuring summary KPIs ($P_{50}$, $P_{90}$, Average Latency), an interactive horizontal Gantt waterfall chart for every turn, and a turn-by-turn inspector showing the transcript, tools invoked, and timestamp breakdown.
5. **Persistent Turn Log Storage & JSON Export**:
   - Client stores recent turns in an in-memory ring buffer and persists sessions in `localStorage`.
   - Server appends structured JSONL logs to disk for automated auditing and historical regression testing.
   - Users can download the full session log with a single click.

---

## User Stories

1. As a caller, I want to see a live latency indicator showing how fast Naina responds to my voice in real time, so that I can immediately judge the responsiveness of the concierge.
2. As a caller, I want the latency number to reflect the authentic time from when I stopped speaking to when I hear the first sound wave in my speakers, so that the metric matches what I actually experienced.
3. As a developer, I want to click on the live latency badge to open an expandable waterfall drawer, so that I can inspect the exact breakdown of each turn without leaving the call.
4. As a developer, I want to see a visual horizontal Gantt chart of each conversational turn, so that I can spot whether STT, the LLM, the database query, or TTS is the primary bottleneck.
5. As a developer, I want to see summary KPI cards ($P_{50}$ median latency, $P_{90}$ worst-case latency, average turnaround, and total turn count), so that I can quantify the performance across an entire conversation.
6. As a developer, I want to filter or scroll through historical turns within a session, so that I can compare multi-step booking turns against simple greetings.
7. As a developer, I want to inspect any past turn to view its user transcript, hotel tool calls with arguments and execution durations, and the synthesized response text, so that I can debug slow database queries or long LLM prompts.
8. As a developer, I want to click an "Export Logs" button to download a JSON file containing all turn metrics, so that I can compare latency benchmarks before and after architectural improvements.
9. As a developer, I want the voice server to append every completed turn into a structured log file, so that I can run automated analysis and evaluate historical trends across multiple test sessions.
10. As a developer, I want the latency calculation to remain accurate regardless of client and server clock drift, so that time measurements are reliable across different machines and time zones.
11. As a developer, I want the telemetry data model to be decoupled from sequential LLM processing, so that when token-to-speech streaming is introduced in the next phase, the waterfall chart seamlessly displays overlapping TTFT and TTFB without breaking.
12. As a mobile caller, I want the latency HUD drawer to be responsive and touch-friendly, so that I can test voice calls on phones and tablets.
13. As a caller, I want the latency pill to change color dynamically (green under 800ms, amber between 800ms and 1200ms, red above 1200ms), so that I can instantly identify latency spikes.
14. As a caller, I want to clear or reset the session latency history when I start a new call, so that previous conversation metrics do not skew the current test.

---

## Implementation Decisions

### 1. Client-Side Speech Endpointing & Playout Detection
- The client Silero VAD module will be enhanced to emit a high-resolution monotonic timestamp `t_user_speech_end = performance.now()` upon detecting the speech-to-silence transition.
- The voice session hook will track this timestamp and listen for the first audio sample rendered through the WebRTC audio element or Web Audio context.
- Upon first audio playout, the client records `t_client_audio_playout = performance.now()` and computes:
  $$\text{totalE2EMs} = \text{round}(t_{\text{client\_audio\_playout}} - t_{\text{user\_speech\_end}})$$
- This guarantees that true acoustic turnaround—including browser audio buffering, WebRTC packet arrival, and OS playout—is measured.

### 2. Monotonic Server Milestone Instrumentation
- The voice orchestrator will assign a unique, incremental `turnId` (`turn_001`, `turn_002`, ...) to each conversational exchange.
- Monotonic timestamps (`performance.now()`) will be recorded at:
  - Turn start (when STT detects speech boundary or incoming audio starts)
  - STT finalization (when transcript is parsed and verified)
  - Database tool invocation start and finish (e.g. `checkAvailability`, `createReservation`)
  - LLM first token emission (TTFT)
  - Speech synthesis first audio chunk generation (TTFB)
- Relative durations ($\Delta t_{\text{stt}}$, $\Delta t_{\text{tool}}$, $\Delta t_{\text{llm\_ttft}}$, $\Delta t_{\text{tts\_ttfb}}$) will be computed locally on the server.

### 3. Bi-Directional WebRTC Data Channel Protocol
- Instead of relying on absolute timestamps that are vulnerable to wall-clock skew, the server will transmit a structured telemetry packet over the existing LiveKit Data Channel:
  ```ts
  interface ServerTurnMetricsPacket {
    type: 'turn_telemetry';
    turnId: string;
    sttLatencyMs: number;
    toolExecutionMs: number;
    toolName?: string;
    llmTtftMs: number;
    llmTotalMs: number;
    ttsTtfbMs: number;
  }
  ```
- The client receives this packet, pairs it with its local $T_{\text{speech\_end}}$ and $T_{\text{playout}}$, derives the network flight time, and builds the unified turn record.

### 4. Unified Turn Telemetry Schema

```ts
export interface TurnTelemetry {
  turnId: string;
  timestamp: string;
  userTranscript: string;
  agentTranscript: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, any>;
    durationMs: number;
  }>;
  metrics: {
    vadEndpointingMs: number;
    sttLatencyMs: number;
    toolExecutionMs: number;
    llmTtftMs: number;
    ttsTtfbMs: number;
    networkAndPlayoutMs: number;
    totalE2EMs: number;
  };
}
```

### 5. Interactive HUD & Waterfall Drawer UI
- **Header Latency Pill**: Placed in the web client header next to the connection status indicator. Displays `⚡ <totalE2EMs>ms`.
- **Waterfall Drawer**: A sliding modal or side drawer rendered with smooth animations:
  - **KPI Cards**: Summary grid displaying Avg Latency, $P_{50}$, $P_{90}$, and Total Turns.
  - **Waterfall Timeline**: Each turn displays stacked, colored bar segments proportionally representing VAD, STT, Database Tool, LLM, TTS, and Network.
  - **Turn Inspector**: Expanding a turn displays raw prompt/reply text, tool inputs/outputs, and an itemized millisecond tally.
  - **Action Toolbar**: "Export JSON" button to download session logs and "Clear History" button to reset.

### 6. Storage & Logging Architecture
- **Client Storage**: Managed by a React context / hook backed by an in-memory ring buffer (up to 50 turns) and serialized to `localStorage` under `naina_session_telemetry`.
- **Server Storage**: The server writes structured JSON Lines to `apps/voice-server/logs/turns-telemetry.jsonl` using asynchronous, non-blocking file appending.

---

## Testing Decisions

### Good Test Criteria
- Tests must verify external behavior and accurate calculation of latency spans rather than internal timing mocks.
- Mathematical verification: Assert that $\text{totalE2E} \ge \text{stt} + \text{tool} + \text{llm} + \text{tts}$.
- Network transport verification: Assert that DataChannel telemetry packets are decoded and parsed cleanly into the UI state.
- Data export verification: Assert that exported JSON adheres to the documented `TurnTelemetry` schema.

### Modules Under Test
- `use-silero-vad.ts`: Verify `onSpeechEnd` passes valid millisecond timestamps.
- `orchestrator.ts`: Verify milestone tracking and telemetry event emissions.
- `livekit-agent.ts`: Verify DataChannel broadcast of telemetry packets.
- `use-voice-session.ts`: Verify turn aggregation and client playout latency math.
- `LatencyHUD` component: Verify rendering of waterfall bars, summary stats, and download triggers.

### Prior Art
- Existing unit and integration tests in `apps/voice-server` (`test:agent`, `test:tts`, `test:orchestrator`).
- End-to-end LiveKit Cloud connection and DataChannel validation scripts.

---

## Out of Scope

- Direct token streaming from Gemini to Cartesia TTS (this is explicitly scheduled as Problem 2 for the subsequent phase, though the telemetry schema is designed to support it without changes).
- External third-party APM integrations (Datadog, Prometheus, OpenTelemetry Collector).
- Audio recording storage or WAV upload to cloud buckets.

---

## Further Notes

- The system uses monotonic clocks (`performance.now()`), avoiding daylight savings, NTP drift, and system clock adjustments.
- Color coding thresholds:
  - 🟢 **Green (Optimal)**: $\le 800\text{ms}$
  - 🟡 **Amber (Acceptable)**: $801\text{ms} - 1200\text{ms}$
  - 🔴 **Red (High Latency)**: $> 1200\text{ms}$
