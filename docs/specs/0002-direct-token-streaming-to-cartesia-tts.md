# Spec: Direct Token Streaming from Gemini to Cartesia TTS with Clause/Sentence Buffering

## Problem Statement

When guests converse with Naina, the conversational turnaround delay currently sits between 1.8 seconds and 3.5 seconds. Although Cartesia STT finalizes in ~150ms and Cartesia TTS synthesizes audio in ~180ms, the entire pipeline is currently blocked by sequential, non-streaming LLM generation.

Specifically, the voice orchestrator waits for Google Gemini to generate the entire multi-sentence conversational response in a single blocking call (`chatSession.sendMessage`) before feeding a single word to Cartesia TTS. 

Because LLM generation takes approximately 30ms to 50ms per token, generating a 50-word response takes 1.5 to 2.5 seconds of dead silence. Guests perceive this as an unnatural, mechanical pause before Naina begins speaking.

---

## Solution

A pipelined token-to-speech streaming architecture that overlaps Gemini generation with Cartesia speech synthesis and WebRTC audio playout:

1. **Streaming Token Generation**: The hotel concierge agent requests token streams (`chatSession.sendMessageStream`) from Google Gemini 2.5 Flash. When tools/functions are required (e.g. checking room availability or creating a booking), the agent executes the tool, feeds the response back to the model, and immediately streams the resulting conversational text.
2. **Clause and Sentence-Boundary Buffering**: An intelligent, low-latency text chunker buffers incoming tokens until a natural cadence boundary is reached (e.g. punctuation marks `.`, `!`, `?`, or `,`/`:` with minimum syllable/word threshold).
3. **Pipelined Concurrent Speech Synthesis**: As soon as the first sentence (often as short as "Certainly!" or "I would be delighted to check that for you.") is completed, it is immediately dispatched to Cartesia Sonic TTS. 
4. **Gapless WebRTC Audio Queueing**: Audio chunks from the first sentence begin playing to the guest's speakers within 500ms – 750ms of user speech ending, while Gemini and Cartesia continue synthesizing subsequent sentences seamlessly in the background.
5. **Telemetry Alignment**: The telemetry system tracks Time-to-First-Token (TTFT) when token #1 arrives (~250ms), Time-to-First-Byte (TTFB) when sentence #1 yields audio (~180ms), and plots the dramatic drop in True End-to-End Latency on the HUD Line Graph.

---

## User Stories

1. As a hotel guest, I want Naina to begin speaking within 600ms to 800ms after I finish asking a question, so that the conversation feels like speaking to a real human concierge.
2. As a hotel guest, I want Naina's voice to sound continuous and natural across sentence transitions without unnatural audio gaps or stuttering, so that the voice stream feels professional and luxurious.
3. As a hotel guest, I want to interrupt or barge in at any moment while Naina is speaking, so that I can correct myself or change my question without waiting for her to finish speaking.
4. As a hotel guest, I want Naina to execute PMS database tools (like checking room availability) seamlessly while still responding immediately with conversational acknowledgment, so that booking inquiries are fast and accurate.
5. As a developer, I want the Gemini agent module to expose an asynchronous stream generator that yields tokens in real time, so that downstream consumers can process text incrementally.
6. As a developer, I want the agent to handle tool calls and function returns within the streaming loop, so that tool execution does not break the streaming paradigm.
7. As a developer, I want a sentence chunker that splits on natural punctuation boundaries (`.`, `?`, `!`, `,`, `;`), so that Cartesia TTS receives grammatically coherent phrases with proper prosody and intonation.
8. As a developer, I want the sentence chunker to enforce minimum word thresholds before comma splits, so that Cartesia does not receive micro-fragments like "Yes," in isolation with unnatural pauses.
9. As a developer, I want the sentence chunker to flush any trailing incomplete text upon stream completion, so that the last words of Naina's reply are never dropped.
10. As a developer, I want the voice orchestrator to pipelined-stream sentence audio chunks into LiveKit's audio frame queue, so that audio playback is continuous.
11. As a developer, I want an interruption event (barge-in) to immediately abort the ongoing Gemini token stream and clear the Cartesia TTS synthesis queue, so that no stale audio is played.
12. As a developer, I want the Latency Telemetry HUD to accurately record `llmTtftMs` as the arrival of token #1, so that the telemetry reflects real token turnaround.
13. As a developer, I want the Latency Telemetry HUD line graph to show the latency drop across turns, so that I have quantitative proof of performance improvement.
14. As a developer, I want the system to handle Cartesia rate limits or API credit exhaustion gracefully with clear error events, so that the UI does not hang.
15. As a developer, I want clean type contracts between the streaming agent, sentence buffer, and speech synthesizer, so that the codebase remains maintainable and testable.

---

## Implementation Decisions

### 1. Agent Streaming Interface
- The concierge agent will expose an asynchronous generator method:
  ```ts
  processUserMessageStream(userTranscript: string): AsyncGenerator<StreamEvent>
  ```
  Where `StreamEvent` differentiates between:
  - `token`: An incremental text token from the model.
  - `tool_call`: A PMS database tool invocation with name, arguments, and execution duration.
  - `done`: Finalization event with cumulative transcript and overall metrics.

### 2. Multi-Turn Function Calling Loop
- When Gemini returns `functionCalls` instead of direct text, the agent will:
  1. Record tool execution start time.
  2. Await the core PMS function (`checkAvailability`, `createReservation`, etc.).
  3. Send the function response back to the chat session via `chatSession.sendMessageStream`.
  4. Stream the post-tool conversational reply tokens to the consumer.

### 3. Intelligent Sentence and Clause Boundary Chunker
- A dedicated pipeline utility `SentenceChunker` will ingest raw token strings and emit synthesized sentence units based on regex boundaries:
  - Terminal punctuation (`[.!?]`) followed by whitespace or end-of-stream triggers an immediate flush.
  - Secondary punctuation (`[,;:]`) triggers a flush only if the accumulated word count exceeds 4 words, preventing choppy synthesis.
  - Whitespace-safe token accumulation ensures words split across token boundaries (e.g., `"con"` and `"cierge"`) are correctly joined before evaluation.
  - A stream flush method guarantees any remaining buffer is emitted when the generator closes.

### 4. Concurrent TTS Synthesis and Gapless Queueing
- The voice orchestrator will iterate over the sentence chunk stream:
  - Sentence #1 is sent to `synthesizeSpeechStream(sentence1)` immediately.
  - The first audio chunk triggers the transition to `SPEAKING` state and emits `turnMetrics`.
  - Audio frames are fed into LiveKit's `AudioSource` queue, which maintains a 10-second buffer and consumes audio smoothly at 24kHz.
  - Sentence #2 and Sentence #3 are synthesized in parallel while Sentence #1 is playing, eliminating mid-turn pauses.

### 5. Instant Barge-In Cancellation
- When a user barge-in is detected:
  - An `AbortController` signal cancels the ongoing Gemini streaming request.
  - The sentence chunker buffer is purged.
  - The LiveKit audio queue is flushed with `audioSource.clearQueue()`.
  - The orchestrator resets to `LISTENING`.

---

## Testing Decisions

### Good Test Criteria
- Tests must verify external behavior and streaming timing rather than internal mocks.
- Sentence boundary tests: Ingest irregular token streams (e.g. `["Good ", "morn", "ing! ", "How ", "can ", "I ", "help?"]`) and assert that output sentences are exactly `["Good morning!", "How can I help?"]`.
- Concurrency test: Assert that Sentence #1 audio chunk is yielded before Sentence #2 text has finished generating.
- Barge-in test: Assert that calling `interrupt()` stops further token yields and emits zero additional audio chunks.

### Modules Under Test
- `SentenceChunker`: Unit tests for token buffering, punctuation splitting, and residual flushing.
- `NainaAgent`: Integration tests verifying `processUserMessageStream` yields text tokens and executes PMS tools.
- `VoiceOrchestrator`: End-to-end pipeline verification confirming reduced TTFA (Time to First Audio).

### Prior Art
- Existing test scripts: `test:telemetry` and `test:orchestrator` in `apps/voice-server`.

---

## Out of Scope

- Gemini Live Bi-directional WebSocket API (native audio-to-audio streaming via WebSocket); this spec uses Gemini Text Streaming + Cartesia Sonic TTS.
- Voice cloning or multi-speaker voice synthesis switching.
- Offline browser TTS fallback.

---

## Further Notes

- Target Latency Breakdown with Streaming:
  - VAD Endpointing: ~250ms
  - Cartesia STT: ~150ms
  - Gemini Flash TTFT (Token 1): ~280ms
  - Sentence 1 Chunking: ~50ms
  - Cartesia Sonic TTFB: ~180ms
  - WebRTC Playout: ~60ms
  - **Estimated True E2E Latency: ~650ms – 780ms** (down from ~2400ms – 3500ms!).
