export type AgentState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

export interface TurnMetrics {
  turnId: string;
  userSpeechDurationMs?: number;
  sttLatencyMs?: number;
  llmTimeFirstTokenMs?: number;
  ttsTimeFirstByteMs?: number;
  totalTurnLatencyMs?: number;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isInterrupted?: boolean;
}

export interface LiveKitSessionTokenRequest {
  roomName: string;
  participantName: string;
}

export interface LiveKitSessionTokenResponse {
  token: string;
  url: string;
}
