import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { appendTurnLog, PersistedTurnLog } from './pipeline/telemetry-logger';
import type { ServerTurnMetricsPacket, TurnTelemetry } from '@naina/shared-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFile = path.resolve(__dirname, '../logs/turns-telemetry.jsonl');

async function runTelemetryTests() {
  console.log('🧪 Starting Telemetry & Latency Calculation Verification Suite...\n');

  // Test 1: Math Verification of End-to-End Latency and Network Flight Span
  console.log('1️⃣ Testing Latency Mathematical Invariants...');
  const mockServerMetrics: ServerTurnMetricsPacket = {
    type: 'turn_telemetry',
    turnId: 'turn_001',
    sttLatencyMs: 140,
    toolExecutionMs: 85,
    toolName: 'checkAvailability',
    llmTtftMs: 290,
    llmTotalMs: 510,
    ttsTtfbMs: 95,
  };

  const clientMeasuredE2E = 760; // ms between speech end and audio playout
  const serverPipelineTotal =
    mockServerMetrics.sttLatencyMs +
    mockServerMetrics.toolExecutionMs +
    mockServerMetrics.llmTtftMs +
    mockServerMetrics.ttsTtfbMs;

  const networkAndPlayoutMs = Math.max(0, clientMeasuredE2E - serverPipelineTotal);

  assert.strictEqual(serverPipelineTotal, 140 + 85 + 290 + 95, 'Server milestone sum must be exact');
  assert.strictEqual(networkAndPlayoutMs, 150, 'Derived network flight time must equal E2E minus server pipeline');
  assert.ok(clientMeasuredE2E >= serverPipelineTotal, 'Authentic client E2E latency must be >= server pipeline time');
  console.log('  ✅ Invariants satisfied: totalE2E (760ms) = serverSpans (610ms) + network/buffer (150ms)');

  // Test 2: KPI Quantile Calculations (Avg, P50, P90)
  console.log('\n2️⃣ Testing KPI Quantile Aggregations (Avg, P50, P90)...');
  const sampleLatencies = [420, 510, 630, 710, 820, 890, 940, 1020, 1150, 1450]; // 10 samples
  sampleLatencies.sort((a, b) => a - b);

  const avg = Math.round(sampleLatencies.reduce((sum, val) => sum + val, 0) / sampleLatencies.length);
  const p50 = sampleLatencies[Math.floor(sampleLatencies.length * 0.5)]; // index 5 -> 890
  const p90 = sampleLatencies[Math.min(sampleLatencies.length - 1, Math.floor(sampleLatencies.length * 0.9))]; // index 9 -> 1450

  assert.strictEqual(avg, 854, 'Average latency calculation should match');
  assert.strictEqual(p50, 890, 'P50 median calculation should match');
  assert.strictEqual(p90, 1450, 'P90 90th-percentile calculation should match');
  console.log(`  ✅ Quantiles verified: Avg=${avg}ms, P50=${p50}ms, P90=${p90}ms`);

  // Test 3: Structured JSONL Telemetry File Logging
  console.log('\n3️⃣ Testing Persistent JSONL Telemetry Logger...');
  const testTurnLog: PersistedTurnLog = {
    turnId: 'turn_test_999',
    sessionId: 'session_unit_test',
    timestamp: new Date().toISOString(),
    userTranscript: 'Do you have a deluxe ocean suite available for next weekend?',
    agentTranscript: 'Yes, we have 2 deluxe ocean suites available for those dates.',
    toolCalls: [
      {
        name: 'checkAvailability',
        args: { roomType: 'deluxe_ocean_suite', checkIn: '2026-11-01', checkOut: '2026-11-03' },
        durationMs: 78,
      },
    ],
    metrics: mockServerMetrics,
  };

  appendTurnLog(testTurnLog);

  // Give fs write callback a moment to flush
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.ok(fs.existsSync(logFile), 'Telemetry log file must exist at logs/turns-telemetry.jsonl');
  const fileContents = fs.readFileSync(logFile, 'utf-8');
  const lines = fileContents.trim().split('\n');
  const lastLine = lines[lines.length - 1];
  const parsed = JSON.parse(lastLine) as PersistedTurnLog;

  assert.strictEqual(parsed.turnId, testTurnLog.turnId, 'Persisted turnId must match');
  assert.strictEqual(parsed.metrics.sttLatencyMs, 140, 'Persisted STT latency must match');
  assert.strictEqual(parsed.toolCalls?.[0]?.name, 'checkAvailability', 'Persisted tool name must match');
  console.log('  ✅ Telemetry successfully appended and verified in JSONL storage file.');

  // Test 4: Schema Completeness of Client TurnTelemetry
  console.log('\n4️⃣ Testing Unified TurnTelemetry Schema Format...');
  const clientTurnRecord: TurnTelemetry = {
    turnId: mockServerMetrics.turnId,
    timestamp: new Date().toISOString(),
    userTranscript: testTurnLog.userTranscript,
    agentTranscript: testTurnLog.agentTranscript,
    toolCalls: testTurnLog.toolCalls,
    metrics: {
      vadEndpointingMs: 250,
      sttLatencyMs: mockServerMetrics.sttLatencyMs,
      toolExecutionMs: mockServerMetrics.toolExecutionMs,
      llmTtftMs: mockServerMetrics.llmTtftMs,
      ttsTtfbMs: mockServerMetrics.ttsTtfbMs,
      networkAndPlayoutMs,
      totalE2EMs: clientMeasuredE2E,
    },
  };

  const serialized = JSON.stringify(clientTurnRecord);
  const reParsed = JSON.parse(serialized) as TurnTelemetry;
  assert.strictEqual(reParsed.metrics.totalE2EMs, 760);
  assert.strictEqual(reParsed.metrics.vadEndpointingMs, 250);
  assert.strictEqual(reParsed.toolCalls?.length, 1);
  console.log('  ✅ TurnTelemetry serialization and schema structure verified.');

  console.log('\n🎉 ALL TELEMETRY AND LATENCY TESTS PASSED SUCCESSFULLY!\n');
}

runTelemetryTests().catch((err) => {
  console.error('❌ Telemetry test failed:', err);
  process.exit(1);
});
