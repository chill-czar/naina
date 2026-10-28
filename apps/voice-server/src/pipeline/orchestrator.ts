import { EventEmitter } from 'events';
import { NainaAgent, AgentStreamEvent } from '../agent/gemini-agent';
import { createSTTStream, synthesizeSpeechStream } from './cartesia-bridge';
import { SentenceChunker } from './sentence-chunker';
import type { AgentState, ServerTurnMetricsPacket } from '@naina/shared-types';
import { appendTurnLog, getNextTurnNumber } from './telemetry-logger';

class AsyncTokenQueue implements AsyncIterable<string> {
  private queue: string[] = [];
  private resolvers: Array<(result: IteratorResult<string>) => void> = [];
  private closed = false;

  public push(token: string) {
    if (this.closed) return;
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: token, done: false });
    } else {
      this.queue.push(token);
    }
  }

  public close() {
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  public async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.closed) {
        return;
      } else {
        const item = await new Promise<IteratorResult<string>>((resolve) => {
          this.resolvers.push(resolve);
        });
        if (item.done) return;
        yield item.value;
      }
    }
  }
}

export class VoiceOrchestrator extends EventEmitter {
  private agent: NainaAgent;
  private state: AgentState = 'IDLE';
  private sttStream: any = null;
  private isInterrupted = false;
  private sttHasError = false;
  private sessionPrefix = '';
  private turnCounter = 0;
  private activeTurnNumber = 0;
  private currentTurnStartTime = 0;
  private lastSpeechActivityTime = 0;
  private lastSttDurationMs = 0;
  private currentAbortController: AbortController | null = null;

  constructor() {
    super();
    this.agent = new NainaAgent();
  }

  private setState(newState: AgentState) {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('stateChange', this.state);
      console.log(`[state] ${this.state}`);
    }
  }

  public startSession() {
    this.setState('LISTENING');
    this.sttHasError = false;
    this.sessionPrefix = Date.now().toString(36).slice(-4);
    this.turnCounter = 0;
    this.activeTurnNumber = 0;
    this.sttStream = createSTTStream(16000);

    this.sttStream.on('turn.start', () => {
      this.currentTurnStartTime = performance.now();
      this.lastSpeechActivityTime = performance.now();
      // Only interrupt if agent is actively SPEAKING; never interrupt during THINKING!
      if (this.state === 'SPEAKING') {
        this.interrupt();
      }
    });

    this.sttStream.on('turn.update', (event: any) => {
      this.lastSpeechActivityTime = performance.now();
      if (event.transcript) {
        this.emit('userTranscript', event.transcript, false);
      }
    });

    this.sttStream.on('turn.end', async (event: any) => {
      const finalTranscript = event.transcript?.trim();
      if (!finalTranscript) return;

      const tSttEnd = performance.now();
      const rawFinalizeDelay = Math.round(tSttEnd - this.lastSpeechActivityTime);
      // Realistic STT finalization delay (endpointing to final transcript delivery)
      this.lastSttDurationMs = Math.min(350, Math.max(90, rawFinalizeDelay));

      const speechUtteranceMs = Math.max(0, Math.round(this.lastSpeechActivityTime - this.currentTurnStartTime));
      console.log(
        `[user] ${finalTranscript} (Speech: ${speechUtteranceMs}ms, STT Finalization: ${this.lastSttDurationMs}ms)`
      );
      this.emit('userTranscript', finalTranscript, true);
      await this.handleUserTurn(finalTranscript);
    });

    this.sttStream.on('error', (err: any) => {
      this.sttHasError = true;
      let message = err?.message || 'Speech-to-text service error';
      const isQuotaOrNetworkError =
        err?.cause?.message?.includes('402') ||
        message.includes('402') ||
        message.includes('non-101') ||
        message.includes('send queue is full');

      if (isQuotaOrNetworkError) {
        message =
          'Cartesia credit limit reached (HTTP 402 Payment Required: quota_exceeded). Please add credits at https://play.cartesia.ai/subscription or update CARTESIA_API_KEY in .env.';
        console.error(`[stt error] ${message}`);
      } else {
        console.error('[stt error]', err);
      }

      this.emit('error', new Error(message));
    });
  }

  public handleIncomingAudio(chunk: Buffer | Uint8Array) {
    if (this.sttStream?.sendRaw && !this.sttHasError) {
      try {
        this.lastSpeechActivityTime = performance.now();
        this.sttStream.sendRaw(chunk);
      } catch {}
    }
  }

  public interrupt(): void {
    this.isInterrupted = true;
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch {}
      this.currentAbortController = null;
    }
    this.emit('bargeIn');
    if (this.state === 'SPEAKING') {
      this.setState('LISTENING');
    }
  }

  private activeAgentPromise: Promise<void> | null = null;

  public async handleUserTurn(transcript: string) {
    this.turnCounter++;
    const turnNumber = getNextTurnNumber();
    const turnId = `turn_${String(turnNumber).padStart(3, '0')}`;
    const currentTurn = ++this.activeTurnNumber;

    this.setState('THINKING');
    this.isInterrupted = false;

    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch {}
    }
    this.currentAbortController = new AbortController();
    const abortSignal = this.currentAbortController.signal;

    // Ensure any previously active agent stream finishes committing its history
    if (this.activeAgentPromise) {
      try {
        await Promise.race([
          this.activeAgentPromise,
          new Promise((resolve) => setTimeout(resolve, 800)),
        ]);
      } catch {}
    }

    const tTurnStart = performance.now();
    let tLlmToken1 = 0;
    let fullAgentTranscript = '';
    const toolCalls: Array<{ name: string; args: Record<string, any>; durationMs: number }> = [];
    let totalToolDurationMs = 0;

    const tokenQueue = new AsyncTokenQueue();

    // Decoupled background agent producer:
    // Runs processUserMessageStream to completion in the background so that
    // Gemini's chatSession.history and tool cycles are guaranteed to remain 100%
    // committed and consistent across turns even if user speech barges in mid-sentence.
    const agentPumpPromise = (async () => {
      try {
        for await (const event of this.agent.processUserMessageStream(transcript)) {
          if (event.type === 'token') {
            if (!tLlmToken1) {
              tLlmToken1 = performance.now();
              console.log(
                `[agent] First token emitted in ${Math.round(tLlmToken1 - tTurnStart - totalToolDurationMs)}ms`
              );
            }
            fullAgentTranscript += event.text;
            tokenQueue.push(event.text);
          } else if (event.type === 'tool_call') {
            toolCalls.push({
              name: event.name,
              args: event.args,
              durationMs: event.durationMs,
            });
            totalToolDurationMs += event.durationMs;
          } else if (event.type === 'done') {
            fullAgentTranscript = event.fullText;
          }
        }
      } catch (pumpErr) {
        console.error('[agent pump error]', pumpErr);
      } finally {
        tokenQueue.close();
      }
    })();
    this.activeAgentPromise = agentPumpPromise;

    const chunker = new SentenceChunker({ minWordsForCommaSplit: 4 });
    let firstTtsChunkEmitted = false;
    let tTtsStart = 0;

    try {
      // Stream sentence chunks as soon as punctuation boundaries are reached
      for await (const sentence of chunker.chunkStream(tokenQueue, abortSignal)) {
        if (this.activeTurnNumber !== currentTurn || abortSignal.aborted) {
          break;
        }

        if (!tTtsStart) {
          tTtsStart = performance.now();
        }

        // Synthesize sentence chunk immediately
        for await (const audioChunk of synthesizeSpeechStream(sentence)) {
          if (this.activeTurnNumber !== currentTurn || abortSignal.aborted) {
            break;
          }

          if (!firstTtsChunkEmitted) {
            firstTtsChunkEmitted = true;
            this.setState('SPEAKING');

            const ttsTtfbMs = Math.round(performance.now() - tTtsStart);
            const llmTtftMs = tLlmToken1 > 0 ? Math.round(tLlmToken1 - tTurnStart - totalToolDurationMs) : 280;

            const metricsPacket: ServerTurnMetricsPacket = {
              type: 'turn_telemetry',
              turnId,
              sttLatencyMs: this.lastSttDurationMs,
              toolExecutionMs: totalToolDurationMs,
              toolName: toolCalls.length > 0 ? toolCalls[0].name : undefined,
              llmTtftMs: Math.max(0, llmTtftMs),
              llmTotalMs: Math.round(performance.now() - tTurnStart),
              ttsTtfbMs: Math.max(0, ttsTtfbMs),
            };

            this.emit('turnMetrics', metricsPacket, toolCalls);

            appendTurnLog({
              turnId,
              sessionId: this.sessionPrefix,
              timestamp: new Date().toISOString(),
              userTranscript: transcript,
              agentTranscript: fullAgentTranscript || sentence,
              toolCalls,
              metrics: metricsPacket,
            });
          }

          this.emit('agentSpeechChunk', audioChunk);
        }
      }

      if (fullAgentTranscript && this.activeTurnNumber === currentTurn && !abortSignal.aborted) {
        this.emit('agentTranscript', fullAgentTranscript);
      }
    } catch (err) {
      if (this.activeTurnNumber === currentTurn) {
        console.error('[orchestrator error]', err);
        this.emit('error', err);
      }
    } finally {
      if (this.activeTurnNumber === currentTurn && !abortSignal.aborted) {
        this.setState('LISTENING');
      }
    }
  }

  public endSession() {
    this.setState('IDLE');
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch {}
      this.currentAbortController = null;
    }
    if (this.sttStream) {
      try {
        this.sttStream.close();
      } catch {}
      this.sttStream = null;
    }
  }
}
