export type AgentState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

export interface ServerTurnMetricsPacket {
  type: 'turn_telemetry';
  turnId: string;
  sttLatencyMs: number;
  toolExecutionMs: number;
  toolName?: string;
  llmTtftMs: number;
  llmTotalMs: number;
  ttsTtfbMs: number;
}

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
    vadEndpointingMs?: number;
    sttLatencyMs: number;
    toolExecutionMs: number;
    llmTtftMs: number;
    ttsTtfbMs: number;
    networkAndPlayoutMs: number;
    totalE2EMs: number;
  };
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

export type CallSessionState = 'ACTIVE' | 'HOLD_PENDING' | 'COMPLETED' | 'DROPPED';

export interface CallSession {
  id: string;
  guestPhone?: string;
  state: CallSessionState;
  activeHoldId?: string;
  collectedEntities: Record<string, any>;
  turnsHistory: Array<{
    role: 'user' | 'model';
    parts: Array<any>;
  }>;
  turnCount: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}
