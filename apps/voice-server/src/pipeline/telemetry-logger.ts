import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ServerTurnMetricsPacket, TurnTelemetry } from '@naina/shared-types';

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

export function getHistoricalTurnLogs(): TurnTelemetry[] {
  try {
    if (!fs.existsSync(logFilePath)) {
      return [];
    }
    const content = fs.readFileSync(logFilePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const turns: TurnTelemetry[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as PersistedTurnLog;
        if (!parsed.turnId || parsed.turnId.includes('test')) {
          continue;
        }

        const m = parsed.metrics;
        const pipelineMs =
          (m.sttLatencyMs || 0) +
          (m.toolExecutionMs || 0) +
          (m.llmTtftMs || 0) +
          (m.ttsTtfbMs || 0);

        const networkAndPlayoutMs = 75;
        const totalE2EMs = pipelineMs + networkAndPlayoutMs;

        turns.push({
          turnId: parsed.turnId,
          timestamp: parsed.timestamp,
          userTranscript: parsed.userTranscript,
          agentTranscript: parsed.agentTranscript,
          toolCalls: parsed.toolCalls,
          metrics: {
            vadEndpointingMs: 250,
            sttLatencyMs: m.sttLatencyMs,
            toolExecutionMs: m.toolExecutionMs,
            llmTtftMs: m.llmTtftMs,
            ttsTtfbMs: m.ttsTtfbMs,
            networkAndPlayoutMs,
            totalE2EMs,
          },
        });
      } catch {}
    }

    return turns.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch (err) {
    console.warn('[telemetry-logger] Failed to read historical turn logs:', err);
    return [];
  }
}

export function getNextTurnNumber(): number {
  try {
    if (!fs.existsSync(logFilePath)) {
      return 1;
    }
    const content = fs.readFileSync(logFilePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    let maxNum = 0;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.turnId && !parsed.turnId.includes('test')) {
          const match = parsed.turnId.match(/(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) {
              maxNum = num;
            }
          }
        }
      } catch {}
    }

    return maxNum + 1;
  } catch {
    return 1;
  }
}
