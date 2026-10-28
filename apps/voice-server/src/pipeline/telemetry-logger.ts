import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ServerTurnMetricsPacket } from '@naina/shared-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.resolve(__dirname, '../../logs');
const logFilePath = path.join(logsDir, 'turns-telemetry.jsonl');

export interface PersistedTurnLog {
  turnId: string;
  sessionId?: string;
  timestamp: string;
  userTranscript: string;
  agentTranscript: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, any>;
    durationMs: number;
  }>;
  metrics: ServerTurnMetricsPacket;
}

export function appendTurnLog(log: PersistedTurnLog): void {
  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const line = JSON.stringify(log) + '\n';
    fs.appendFile(logFilePath, line, (err) => {
      if (err) {
        console.warn('[telemetry-logger] Failed to append turn log:', err);
      }
    });
  } catch (e) {
    console.warn('[telemetry-logger] Error writing turn log:', e);
  }
}
