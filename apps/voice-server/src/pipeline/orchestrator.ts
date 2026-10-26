import { EventEmitter } from 'events';
import { NainaAgent } from '../agent/gemini-agent';
import { createSTTStream, synthesizeSpeechStream } from './cartesia-bridge';
import type { AgentState } from '@naina/shared-types';

export class VoiceOrchestrator extends EventEmitter {
  private agent: NainaAgent;
  private state: AgentState = 'IDLE';
  private sttStream: any = null;
  private isInterrupted = false;

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
    this.sttStream = createSTTStream(16000);

    this.sttStream.on('turn.start', () => {
      if (this.state === 'SPEAKING') {
        this.interrupt();
        this.setState('LISTENING');
      }
    });

    this.sttStream.on('turn.update', (event: any) => {
      if (event.transcript) {
        this.emit('userTranscript', event.transcript, false);
      }
    });

    this.sttStream.on('turn.end', async (event: any) => {
      const finalTranscript = event.transcript?.trim();
      if (!finalTranscript) return;

      console.log(`[user] ${finalTranscript}`);
      this.emit('userTranscript', finalTranscript, true);
      await this.handleUserTurn(finalTranscript);
    });

    this.sttStream.on('error', (err: any) => {
      console.error('[stt error]', err);
      this.emit('error', err);
    });
  }

  public handleIncomingAudio(chunk: Buffer | Uint8Array) {
    if (this.sttStream?.sendRaw) {
      this.sttStream.sendRaw(chunk);
    }
  }

  public interrupt(): void {
    this.isInterrupted = true;
    this.emit('bargeIn');
  }

  public async handleUserTurn(transcript: string) {
    this.setState('THINKING');
    this.isInterrupted = false;

    try {
      const agentReplyText = await this.agent.processUserMessage(transcript);
      console.log(`[agent] ${agentReplyText}`);

      if (!agentReplyText.trim() || this.isInterrupted) {
        this.setState('LISTENING');
        return;
      }

      this.emit('agentTranscript', agentReplyText);
      this.setState('SPEAKING');

      for await (const audioChunk of synthesizeSpeechStream(agentReplyText)) {
        if (this.isInterrupted) {
          break;
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

