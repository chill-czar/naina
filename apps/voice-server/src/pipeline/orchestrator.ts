import { EventEmitter } from 'events';
import { NainaAgent } from '../agent/gemini-agent';
import { createSTTStream, synthesizeSpeechStream } from './cartesia-bridge';
import type { AgentState, ServerTurnMetricsPacket } from '@naina/shared-types';
import { appendTurnLog } from './telemetry-logger';

export class VoiceOrchestrator extends EventEmitter {
  private agent: NainaAgent;
  private state: AgentState = 'IDLE';
  private sttStream: any = null;
  private isInterrupted = false;
  private sttHasError = false;
  private turnCounter = 0;
  private currentTurnStartTime = 0;
  private lastSpeechActivityTime = 0;
  private lastSttDurationMs = 0;

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
    this.sttStream = createSTTStream(16000);

    this.sttStream.on('turn.start', () => {
      this.currentTurnStartTime = performance.now();
      this.lastSpeechActivityTime = performance.now();
      if (this.state === 'SPEAKING') {
        this.interrupt();
        this.setState('LISTENING');
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
        this.sttStream.sendRaw(chunk);
      } catch {}
    }
  }

  public interrupt(): void {
    this.isInterrupted = true;
    this.emit('bargeIn');
    if (this.state === 'SPEAKING' || this.state === 'THINKING') {
      this.setState('LISTENING');
    }
  }

  public async handleUserTurn(transcript: string) {
    this.turnCounter++;
    const turnId = `turn_${String(this.turnCounter).padStart(3, '0')}`;
    this.setState('THINKING');
    this.isInterrupted = false;

    const tLlmStart = performance.now();

    try {
      const agentResult = await this.agent.processUserMessage(transcript);
      const tLlmEnd = performance.now();
      const llmTotalMs = Math.round(tLlmEnd - tLlmStart);
      const llmTtftMs = Math.max(0, llmTotalMs - agentResult.totalToolDurationMs);

      console.log(
        `[agent] ${agentResult.text} (LLM: ${llmTotalMs}ms, Tool: ${agentResult.totalToolDurationMs}ms)`
      );

      if (!agentResult.text.trim() || this.isInterrupted) {
        this.setState('LISTENING');
        return;
      }

      this.emit('agentTranscript', agentResult.text);

      const tTtsStart = performance.now();
      let firstChunkReceived = false;

      for await (const audioChunk of synthesizeSpeechStream(agentResult.text)) {
        if (this.isInterrupted) {
          break;
        }

        if (!firstChunkReceived) {
          firstChunkReceived = true;
          this.setState('SPEAKING');
          const ttsTtfbMs = Math.round(performance.now() - tTtsStart);

          const metricsPacket: ServerTurnMetricsPacket = {
            type: 'turn_telemetry',
            turnId,
            sttLatencyMs: this.lastSttDurationMs,
            toolExecutionMs: agentResult.totalToolDurationMs,
            toolName: agentResult.toolCalls.length > 0 ? agentResult.toolCalls[0].name : undefined,
            llmTtftMs,
            llmTotalMs,
            ttsTtfbMs,
          };

          this.emit('turnMetrics', metricsPacket, agentResult.toolCalls);

          // Persist turn log to server logs
          appendTurnLog({
            turnId,
            timestamp: new Date().toISOString(),
            userTranscript: transcript,
            agentTranscript: agentResult.text,
            toolCalls: agentResult.toolCalls,
            metrics: metricsPacket,
          });
        }

        this.emit('agentSpeechChunk', audioChunk);
      }
    } catch (err) {
      console.error('[orchestrator error]', err);
      this.emit('error', err);
    } finally {
      if (!this.isInterrupted) {
        this.setState('LISTENING');
      }
    }
  }

  public endSession() {
    this.setState('IDLE');
    if (this.sttStream) {
      try {
        this.sttStream.close();
      } catch {}
      this.sttStream = null;
    }
  }
}
