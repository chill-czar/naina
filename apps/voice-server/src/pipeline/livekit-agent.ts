import {
  Room,
  RoomEvent,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  AudioFrame,
  AudioStream,
  TrackKind,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { config } from '../config';
import { VoiceOrchestrator } from './orchestrator';
import { getCallSession, saveCallSession } from '@naina/hotel-pms-core';

export class LiveKitVoiceAgent {
  public roomName: string;
  public room: Room | null = null;
  public orchestrator: VoiceOrchestrator | null = null;
  private audioSource: AudioSource | null = null;
  private audioTrack: LocalAudioTrack | null = null;
  public isActive = false;
  private cleanupTimeout: NodeJS.Timeout | null = null;
  private outboundAudioQueue: AudioFrame[] = [];
  private isCapturingAudio = false;

  constructor(roomName: string) {
    this.roomName = roomName;
  }

  public async start(): Promise<void> {
    if (this.isActive) return;

    console.log(`[livekit-agent] Starting agent for room: ${this.roomName}`);

    if (!config.livekit.apiKey || !config.livekit.apiSecret || !config.livekit.url) {
      throw new Error('LiveKit credentials missing in environment variables');
    }

    const agentIdentity = `naina-agent-${this.roomName}`;
    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: agentIdentity,
      name: 'Naina Concierge',
    });

    at.addGrant({
      roomJoin: true,
      room: this.roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    this.room = new Room();
    await this.room.connect(config.livekit.url, token);
    console.log(`[livekit-agent] Connected to room: ${this.roomName} as ${agentIdentity}`);

    // Create 24kHz mono audio source with 10s buffer for Cartesia TTS
    this.audioSource = new AudioSource(24000, 1, 10000);
    this.audioTrack = LocalAudioTrack.createAudioTrack('agent-audio', this.audioSource);
    const publishOptions = new TrackPublishOptions();
    await this.room.localParticipant!.publishTrack(this.audioTrack, publishOptions);
    console.log(`[livekit-agent] Published agent audio track to room: ${this.roomName}`);

    // Look up existing call session to seamlessly resume if room/caller reconnected
    let existingSession = null;
    try {
      existingSession = await getCallSession(this.roomName);
      if (existingSession && existingSession.turnsHistory && existingSession.turnsHistory.length > 0) {
        console.log(
          `[livekit-agent] Hydrating existing session for room: ${this.roomName} (${existingSession.turnsHistory.length} turns)`
        );
      }
    } catch (e) {
      console.warn(`[livekit-agent] Session lookup skipped:`, e);
    }

    // Initialize orchestrator with hydrated session
    this.orchestrator = new VoiceOrchestrator({
      sessionId: this.roomName,
      initialHistory: existingSession?.turnsHistory,
    });

    this.orchestrator.on('stateChange', (state) => {
      this.broadcastData({ type: 'state', state });
    });

    this.orchestrator.on('userTranscript', (text, isFinal) => {
      this.broadcastData({ type: 'transcript', role: 'user', text, isFinal });
    });

    this.orchestrator.on('agentTranscript', (text) => {
      this.broadcastData({ type: 'transcript', role: 'agent', text, isFinal: true });
    });

    this.orchestrator.on('agentSpeechChunk', (chunk: Uint8Array) => {
      this.enqueueAudioChunk(chunk);
    });

    this.orchestrator.on('bargeIn', () => {
      if (this.audioSource) {
        this.audioSource.clearQueue();
      }
      this.broadcastData({ type: 'barge_in' });
      this.broadcastData({ type: 'state', state: 'LISTENING' });
    });

    this.orchestrator.on('turnMetrics', (metricsPacket: any, toolCalls: any) => {
      this.broadcastData({
        ...metricsPacket,
        toolCalls,
      });
    });

    this.orchestrator.on('error', (err) => {
      this.broadcastData({ type: 'error', message: err.message || 'Pipeline error' });
    });

    this.orchestrator.startSession(this.roomName);
    this.isActive = true;

    // Listen for room events
    this.room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        console.log(
          `[livekit-agent] Track subscribed: ${track.kind} (${track.sid}) from ${participant.identity}`
        );
        if (track.kind === TrackKind.KIND_AUDIO) {
          this.subscribeToAudioTrack(track);
        }
      }
    );

    this.room.on(
      RoomEvent.DataReceived,
      (payload: Uint8Array, participant?: RemoteParticipant) => {
        try {
          const str = Buffer.from(payload).toString('utf-8');
          const data = JSON.parse(str);
          console.log(`[livekit-agent] DataChannel message from ${participant?.identity || 'unknown'}:`, data.type);

          if (data.type === 'barge_in' || data.type === 'interrupt') {
            this.handleBargeIn();
          } else if (data.type === 'client_speech_end') {
            this.orchestrator?.handleClientSpeechEndHint(data.timestamp);
          } else if (data.type === 'text_input' && data.text) {
            this.broadcastData({
              type: 'transcript',
              role: 'user',
              text: data.text,
              isFinal: true,
            });
            this.orchestrator?.handleUserTurn(data.text);
          }
        } catch (e) {
          console.error('[livekit-agent] Error processing DataChannel packet:', e);
        }
      }
    );

    this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      console.log(`[livekit-agent] Participant connected: ${participant.identity}`);
      if (this.cleanupTimeout) {
        clearTimeout(this.cleanupTimeout);
        this.cleanupTimeout = null;
      }
      // Send initial state to the newly joined participant
      this.broadcastData({ type: 'state', state: 'LISTENING' });
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      console.log(`[livekit-agent] Participant disconnected: ${participant.identity}`);
      const remainingHumanParticipants = Array.from(this.room?.remoteParticipants.values() || []).filter(
        (p) => !p.identity.startsWith('naina-agent-')
      );

      if (remainingHumanParticipants.length === 0) {
        console.log(`[livekit-agent] All participants left room ${this.roomName}. Scheduling cleanup...`);
        this.scheduleCleanup();
      }
    });

    // Check if participants already exist in room with audio tracks
    for (const participant of this.room.remoteParticipants.values()) {
      if (participant.identity.startsWith('naina-agent-')) continue;
      for (const pub of participant.trackPublications.values()) {
        if (pub.track && pub.track.kind === TrackKind.KIND_AUDIO) {
          this.subscribeToAudioTrack(pub.track as RemoteTrack);
        }
      }
    }
  }

  private async subscribeToAudioTrack(track: RemoteTrack): Promise<void> {
    try {
      console.log(`[livekit-agent] Subscribing to incoming 16kHz audio stream on track ${track.sid}`);
      const audioStream = new AudioStream(track, { sampleRate: 16000, numChannels: 1 });

      for await (const frame of audioStream) {
        if (!this.isActive || !this.orchestrator) break;
        // Int16Array from AudioFrame
        const buf = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
        this.orchestrator.handleIncomingAudio(buf);
      }
    } catch (err) {
      console.warn('[livekit-agent] Inbound audio stream ended:', err);
    }
  }

  public handleBargeIn(): void {
    console.log(`[livekit-agent] Executing barge-in cancellation for room ${this.roomName}`);
    this.outboundAudioQueue = [];
    if (this.audioSource) {
      this.audioSource.clearQueue();
    }
    if (this.orchestrator) {
      this.orchestrator.interrupt();
    }
    this.broadcastData({ type: 'barge_in' });
    this.broadcastData({ type: 'state', state: 'LISTENING' });
  }

  private enqueueAudioChunk(chunk: Uint8Array): void {
    if (!this.audioSource || !this.isActive) return;
    try {
      const slice = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
      const int16 = new Int16Array(slice);
      const frame = new AudioFrame(int16, 24000, 1, int16.length);
      this.outboundAudioQueue.push(frame);
      this.drainAudioQueue();
    } catch (err) {
      console.warn('[livekit-agent] Error enqueuing audio frame:', err);
    }
  }

  private async drainAudioQueue(): Promise<void> {
    if (this.isCapturingAudio) return;
    this.isCapturingAudio = true;

    while (this.outboundAudioQueue.length > 0 && this.isActive && this.audioSource) {
      const frame = this.outboundAudioQueue.shift();
      if (!frame) break;

      try {
        await this.audioSource.captureFrame(frame);
      } catch (err) {
        console.warn('[livekit-agent] Failed to capture audio frame:', err);
      }
    }

    this.isCapturingAudio = false;
  }

  public async broadcastData(msg: Record<string, any>): Promise<void> {
    if (!this.room || !this.room.localParticipant) return;
    try {
      const payload = Buffer.from(JSON.stringify(msg), 'utf-8');
      await this.room.localParticipant.publishData(payload, { reliable: true });
    } catch (err) {
      console.warn('[livekit-agent] broadcastData failed:', err);
    }
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimeout) return;
    this.cleanupTimeout = setTimeout(async () => {
      console.log(`[livekit-agent] Cleaning up inactive agent for room: ${this.roomName}`);
      await this.stop();
      liveKitAgentManager.removeAgent(this.roomName);
    }, 45000); // 45 seconds grace period
  }

  public async stop(): Promise<void> {
    if (!this.isActive) return;
    this.isActive = false;

    if (this.cleanupTimeout) {
      clearTimeout(this.cleanupTimeout);
      this.cleanupTimeout = null;
    }

    if (this.orchestrator) {
      this.orchestrator.endSession();
      this.orchestrator = null;
    }

    if (this.roomName) {
      saveCallSession({
        id: this.roomName,
        state: 'COMPLETED',
      }).catch(() => {});
    }

    if (this.audioSource) {
      try {
        this.audioSource.clearQueue();
        await this.audioSource.close();
      } catch {}
      this.audioSource = null;
    }

    if (this.audioTrack) {
      try {
        await this.audioTrack.close();
      } catch {}
      this.audioTrack = null;
    }

    if (this.room) {
      try {
        await this.room.disconnect();
      } catch {}
      this.room = null;
    }

    console.log(`[livekit-agent] Stopped agent for room: ${this.roomName}`);
  }
}

class LiveKitAgentManager {
  private agents = new Map<string, LiveKitVoiceAgent>();

  public async getOrCreateAgent(roomName: string): Promise<LiveKitVoiceAgent> {
    let agent = this.agents.get(roomName);
    if (!agent || !agent.isActive) {
      agent = new LiveKitVoiceAgent(roomName);
      this.agents.set(roomName, agent);
      await agent.start();
    }
    return agent;
  }

  public getAgent(roomName: string): LiveKitVoiceAgent | undefined {
    return this.agents.get(roomName);
  }

  public removeAgent(roomName: string): void {
    this.agents.delete(roomName);
  }
}

export const liveKitAgentManager = new LiveKitAgentManager();
