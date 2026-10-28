'use client';

import React, { useState } from 'react';
import type { TurnTelemetry } from '@naina/shared-types';
import {
  Zap,
  X,
  Download,
  Trash2,
  ChevronDown,
  ChevronUp,
  Database,
  Cpu,
  Radio,
  Volume2,
  Clock,
  TrendingDown,
  TrendingUp,
  Activity,
} from 'lucide-react';

interface LatencyHUDDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  turns: TurnTelemetry[];
  latestLatency: number | null;
  onClear: () => void;
  onExport: () => void;
}

export function LatencyHUDDrawer({
  isOpen,
  onClose,
  turns,
  latestLatency,
  onClear,
  onExport,
}: LatencyHUDDrawerProps) {
  const [expandedTurnId, setExpandedTurnId] = useState<string | null>(null);
  const [hoveredTurnIndex, setHoveredTurnIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  // Compute summary stats (Avg, P50, P90)
  const latencies = turns
    .map((t) => t.metrics.totalE2EMs)
    .filter((n) => typeof n === 'number' && n > 0)
    .sort((a, b) => a - b);

  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((acc, curr) => acc + curr, 0) / latencies.length)
      : null;

  const p50 =
    latencies.length > 0
      ? latencies[Math.floor(latencies.length * 0.5)]
      : null;

  const p90 =
    latencies.length > 0
      ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.9))]
      : null;

  const getLatencyColor = (ms: number) => {
    if (ms <= 800) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (ms <= 1200) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-rose-600 bg-rose-50 border-rose-200';
  };

  const getDotColor = (ms: number) => {
    if (ms <= 800) return '#10b981'; // emerald
    if (ms <= 1200) return '#f59e0b'; // amber
    return '#f43f5e'; // rose
  };

  // Chronological order (oldest to newest) for trend graph
  const chronologicalTurns = [...turns].reverse();

  // Graph geometry
  const chartWidth = 520;
  const chartHeight = 150;
  const padLeft = 45;
  const padRight = 30;
  const padTop = 20;
  const padBottom = 25;
  const plotWidth = chartWidth - padLeft - padRight;
  const plotHeight = chartHeight - padTop - padBottom;

  const rawMax = Math.max(
    1200,
    ...chronologicalTurns.map((t) => t.metrics.totalE2EMs || 0)
  );
  // Round up to nearest 500ms
  const maxAxisLatency = Math.ceil(rawMax / 500) * 500;

  // Compute (x, y) coordinates for each turn in chronological order
  const points = chronologicalTurns.map((t, idx) => {
    const lat = Math.max(0, t.metrics.totalE2EMs || 0);
    const x =
      chronologicalTurns.length === 1
        ? padLeft + plotWidth / 2
        : padLeft + (idx / (chronologicalTurns.length - 1)) * plotWidth;
    const y = padTop + plotHeight - (lat / maxAxisLatency) * plotHeight;
    return { x, y, latency: lat, turn: t, idx };
  });

  // Target reference line (800ms)
  const target800Y =
    padTop + plotHeight - (800 / maxAxisLatency) * plotHeight;

  // Build SVG polyline and area path
  let pathD = '';
  let areaD = '';
  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      pathD += ` L ${points[i].x} ${points[i].y}`;
    }
    const bottomY = padTop + plotHeight;
    areaD = `${pathD} L ${points[points.length - 1].x} ${bottomY} L ${points[0].x} ${bottomY} Z`;
  }

  // Latency improvement calculation
  const firstTurnLat = chronologicalTurns[0]?.metrics?.totalE2EMs;
  const latestTurnLat = chronologicalTurns[chronologicalTurns.length - 1]?.metrics?.totalE2EMs;
  const latencyDelta =
    firstTurnLat && latestTurnLat && chronologicalTurns.length >= 2
      ? latestTurnLat - firstTurnLat
      : null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white/95 backdrop-blur-2xl border-l border-[#e2def0] shadow-2xl flex flex-col select-none animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[#e2def0] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-violet-100 text-violet-700">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#1e1b2b]">Latency Telemetry HUD</h2>
            <p className="text-xs text-[#8a8699]">True user-perceived voice turnaround</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {turns.length > 0 && (
            <>
              <button
                type="button"
                onClick={onExport}
                className="p-2 rounded-lg border border-[#e2def0] text-[#8a8699] hover:text-[#1e1b2b] hover:bg-black/5 transition-colors cursor-pointer"
                title="Export telemetry JSON"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onClear}
                className="p-2 rounded-lg border border-[#e2def0] text-[#8a8699] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                title="Clear history"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg border border-[#e2def0] text-[#8a8699] hover:text-[#1e1b2b] hover:bg-black/5 transition-colors cursor-pointer"
            title="Close drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="px-6 py-3.5 bg-[#fbfafd] border-b border-[#e2def0] grid grid-cols-4 gap-2.5">
        <div className="p-2.5 bg-white border border-[#e2def0] rounded-xl shadow-xs flex flex-col">
          <span className="text-[10px] uppercase font-semibold tracking-wider text-[#8a8699]">
            Latest E2E
          </span>
          <span className="text-base font-bold text-[#1e1b2b] mt-0.5">
            {latestLatency ? `${latestLatency}ms` : '—'}
          </span>
        </div>

        <div className="p-2.5 bg-white border border-[#e2def0] rounded-xl shadow-xs flex flex-col">
          <span className="text-[10px] uppercase font-semibold tracking-wider text-[#8a8699]">
            P50 (Median)
          </span>
          <span className="text-base font-bold text-[#1e1b2b] mt-0.5">
            {p50 ? `${p50}ms` : '—'}
          </span>
        </div>

        <div className="p-2.5 bg-white border border-[#e2def0] rounded-xl shadow-xs flex flex-col">
          <span className="text-[10px] uppercase font-semibold tracking-wider text-[#8a8699]">
            P90 (Worst)
          </span>
          <span className="text-base font-bold text-[#1e1b2b] mt-0.5">
            {p90 ? `${p90}ms` : '—'}
          </span>
        </div>

        <div className="p-2.5 bg-white border border-[#e2def0] rounded-xl shadow-xs flex flex-col">
          <span className="text-[10px] uppercase font-semibold tracking-wider text-[#8a8699]">
            Avg E2E
          </span>
          <span className="text-base font-bold text-[#1e1b2b] mt-0.5">
            {avgLatency ? `${avgLatency}ms` : '—'}
          </span>
        </div>
      </div>

      {/* Historical Latency Line Graph */}
      {chronologicalTurns.length > 0 && (
        <div className="px-6 py-3.5 bg-white border-b border-[#e2def0]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-violet-600" />
              <span className="text-xs font-semibold text-[#1e1b2b]">
                Latency Progression Over Time
              </span>
              <span className="text-[10px] text-[#8a8699] ml-1">
                ({chronologicalTurns.length} turns)
              </span>
            </div>

            {latencyDelta !== null && (
              <span
                className={`text-[11px] font-semibold flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                  latencyDelta <= 0
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : 'text-amber-700 bg-amber-50 border-amber-200'
                }`}
              >
                {latencyDelta <= 0 ? (
                  <>
                    <TrendingDown className="w-3 h-3" />
                    <span>
                      {Math.abs(latencyDelta)}ms (
                      {firstTurnLat ? Math.round((Math.abs(latencyDelta) / firstTurnLat) * 100) : 0}%) faster
                    </span>
                  </>
                ) : (
                  <>
                    <TrendingUp className="w-3 h-3" />
                    <span>+{latencyDelta}ms higher</span>
                  </>
                )}
              </span>
            )}
          </div>

          {/* SVG Line Chart */}
          <div className="relative w-full bg-[#faf9fd] rounded-xl p-2 border border-[#ebe7f5]">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-36 overflow-visible"
            >
              <defs>
                <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid lines */}
              <line
                x1={padLeft}
                y1={padTop}
                x2={chartWidth - padRight}
                y2={padTop}
                stroke="#e2def0"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 6}
                y={padTop + 3}
                textAnchor="end"
                className="text-[9px] fill-[#8a8699] font-mono"
              >
                {maxAxisLatency}ms
              </text>

              <line
                x1={padLeft}
                y1={padTop + plotHeight / 2}
                x2={chartWidth - padRight}
                y2={padTop + plotHeight / 2}
                stroke="#e2def0"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 6}
                y={padTop + plotHeight / 2 + 3}
                textAnchor="end"
                className="text-[9px] fill-[#8a8699] font-mono"
              >
                {Math.round(maxAxisLatency / 2)}ms
              </text>

              {/* Target 800ms dashed line */}
              <line
                x1={padLeft}
                y1={target800Y}
                x2={chartWidth - padRight}
                y2={target800Y}
                stroke="#10b981"
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <text
                x={chartWidth - padRight + 4}
                y={target800Y + 3}
                className="text-[8px] fill-emerald-600 font-semibold"
              >
                800ms Target
              </text>

              {/* Bottom baseline */}
              <line
                x1={padLeft}
                y1={padTop + plotHeight}
                x2={chartWidth - padRight}
                y2={padTop + plotHeight}
                stroke="#d4cfe5"
                strokeWidth="1.5"
              />
              <text
                x={padLeft - 6}
                y={padTop + plotHeight + 3}
                textAnchor="end"
                className="text-[9px] fill-[#8a8699] font-mono"
              >
                0ms
              </text>

              {/* Area fill */}
              {areaD && <path d={areaD} fill="url(#latencyGradient)" />}

              {/* Smooth Trend Line */}
              {pathD && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="#7c3aed"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Data points */}
              {points.map((pt, i) => {
                const isHovered = hoveredTurnIndex === i;
                const dotColor = getDotColor(pt.latency);
                return (
                  <g key={pt.turn.turnId || i}>
                    {/* Hover vertical guide */}
                    {isHovered && (
                      <line
                        x1={pt.x}
                        y1={padTop}
                        x2={pt.x}
                        y2={padTop + plotHeight}
                        stroke="#7c3aed"
                        strokeWidth="1"
                        strokeDasharray="2 2"
                      />
                    )}

                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 6 : 4}
                      fill={dotColor}
                      stroke="#ffffff"
                      strokeWidth="2"
                      className="cursor-pointer transition-all duration-150"
                      onMouseEnter={() => setHoveredTurnIndex(i)}
                      onMouseLeave={() => setHoveredTurnIndex(null)}
                      onClick={() =>
                        setExpandedTurnId((prev) =>
                          prev === pt.turn.turnId ? null : pt.turn.turnId
                        )
                      }
                    />

                    {/* X axis turn label */}
                    <text
                      x={pt.x}
                      y={padTop + plotHeight + 15}
                      textAnchor="middle"
                      className={`text-[8.5px] font-mono ${
                        isHovered ? 'fill-[#1e1b2b] font-bold' : 'fill-[#8a8699]'
                      }`}
                    >
                      {pt.turn.turnId ? '#' + pt.turn.turnId.split('_').pop() : `#${i + 1}`}
                    </text>

                    {/* Tooltip on hover */}
                    {isHovered && (
                      <g>
                        <rect
                          x={Math.max(10, Math.min(chartWidth - 90, pt.x - 45))}
                          y={Math.max(4, pt.y - 30)}
                          width="90"
                          height="22"
                          rx="6"
                          fill="#1e1b2b"
                          className="shadow-md"
                        />
                        <text
                          x={Math.max(55, Math.min(chartWidth - 45, pt.x))}
                          y={Math.max(19, pt.y - 15)}
                          textAnchor="middle"
                          className="text-[10px] fill-white font-semibold"
                        >
                          {pt.turn.turnId}: {pt.latency}ms
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* Pipeline Segment Legend */}
      <div className="px-6 py-2 bg-white border-b border-[#e2def0] flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#6b677a]">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span>STT Finalize</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
          <span>PMS DB Tool</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span>LLM TTFT</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span>TTS TTFB</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
          <span>WebRTC / Playout</span>
        </span>
      </div>

      {/* Turn Waterfall List */}
      <div className="flex-1 overflow-y-auto px-6 py-3.5 space-y-3 custom-scrollbar">
        {turns.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-[#8a8699] text-center">
            <Clock className="w-8 h-8 stroke-1 text-[#bebee5] mb-2" />
            <p className="text-sm font-medium text-[#1e1b2b]">No conversation turns yet</p>
            <p className="text-xs max-w-xs mt-1">
              Start a call and speak to Naina. Each turn will automatically graph its live latency
              waterfall here.
            </p>
          </div>
        ) : (
          turns.map((turn, index) => {
            const isExpanded = expandedTurnId === turn.turnId;
            const m = turn.metrics;

            // Normalized segment widths guaranteeing 100% total
            const partsSum =
              (m.sttLatencyMs || 0) +
              (m.toolExecutionMs || 0) +
              (m.llmTtftMs || 0) +
              (m.ttsTtfbMs || 0) +
              (m.networkAndPlayoutMs || 0) || 1;

            const sttPct = Math.max(3, ((m.sttLatencyMs || 0) / partsSum) * 100);
            const toolPct = m.toolExecutionMs
              ? Math.max(3, ((m.toolExecutionMs || 0) / partsSum) * 100)
              : 0;
            const llmPct = Math.max(5, ((m.llmTtftMs || 0) / partsSum) * 100);
            const ttsPct = Math.max(4, ((m.ttsTtfbMs || 0) / partsSum) * 100);
            const netPct = Math.max(2, ((m.networkAndPlayoutMs || 0) / partsSum) * 100);

            return (
              <div
                key={turn.turnId || index}
                className={`bg-white border rounded-xl p-3.5 shadow-xs transition-all ${
                  isExpanded ? 'border-violet-300 ring-2 ring-violet-100' : 'border-[#e2def0] hover:border-[#bebee5]'
                }`}
              >
                {/* Turn Header */}
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#f2eff8]">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-[#f2eff8] text-[#1e1b2b] text-[11px] font-semibold">
                      {turn.turnId}
                    </span>
                    <span className="text-[11px] text-[#8a8699]">
                      {new Date(turn.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full border text-xs font-bold ${getLatencyColor(
                        m.totalE2EMs
                      )}`}
                    >
                      ⚡ {m.totalE2EMs}ms
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTurnId(isExpanded ? null : turn.turnId)
                      }
                      className="p-1 rounded text-[#8a8699] hover:text-[#1e1b2b] cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Waterfall Gantt Bar */}
                <div className="w-full h-3 rounded-full overflow-hidden bg-[#e2def0]/40 flex mb-2.5">
                  <div
                    style={{ width: `${sttPct}%` }}
                    className="h-full bg-blue-500 transition-all"
                    title={`STT: ${m.sttLatencyMs}ms`}
                  />
                  {toolPct > 0 && (
                    <div
                      style={{ width: `${toolPct}%` }}
                      className="h-full bg-purple-500 transition-all"
                      title={`PMS Tool: ${m.toolExecutionMs}ms`}
                    />
                  )}
                  <div
                    style={{ width: `${llmPct}%` }}
                    className="h-full bg-amber-500 transition-all"
                    title={`LLM TTFT: ${m.llmTtftMs}ms`}
                  />
                  <div
                    style={{ width: `${ttsPct}%` }}
                    className="h-full bg-emerald-500 transition-all"
                    title={`TTS TTFB: ${m.ttsTtfbMs}ms`}
                  />
                  <div
                    style={{ width: `${netPct}%` }}
                    className="h-full bg-slate-400 transition-all"
                    title={`Playout/Net: ${m.networkAndPlayoutMs}ms`}
                  />
                </div>

                {/* Quick Milestone Badges */}
                <div className="flex items-center justify-between text-[11px] text-[#6b677a] mb-2 px-0.5">
                  <span className="flex items-center gap-1 font-mono">
                    <Radio className="w-3 h-3 text-blue-500" />
                    <span>STT {m.sttLatencyMs}ms</span>
                  </span>
                  {m.toolExecutionMs > 0 && (
                    <span className="flex items-center gap-1 font-mono">
                      <Database className="w-3 h-3 text-purple-500" />
                      <span>DB {m.toolExecutionMs}ms</span>
                    </span>
                  )}
                  <span className="flex items-center gap-1 font-mono">
                    <Cpu className="w-3 h-3 text-amber-500" />
                    <span>LLM {m.llmTtftMs}ms</span>
                  </span>
                  <span className="flex items-center gap-1 font-mono">
                    <Volume2 className="w-3 h-3 text-emerald-500" />
                    <span>TTS {m.ttsTtfbMs}ms</span>
                  </span>
                  <span className="flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>Net {m.networkAndPlayoutMs}ms</span>
                  </span>
                </div>

                {/* Turn Transcripts Summary */}
                <div className="text-xs space-y-1 text-[#4a4659]">
                  <p className="line-clamp-1">
                    <span className="font-semibold text-[#1e1b2b]">User:</span> “
                    {turn.userTranscript}”
                  </p>
                  <p className="line-clamp-1">
                    <span className="font-semibold text-[#1e1b2b]">Naina:</span> “
                    {turn.agentTranscript}”
                  </p>
                </div>

                {/* Expanded Turn Inspector */}
                {isExpanded && (
                  <div className="mt-3.5 pt-3 border-t border-[#f2eff8] space-y-3 animate-in fade-in duration-200">
                    {/* Tool Calls if any */}
                    {turn.toolCalls && turn.toolCalls.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-purple-50/60 border border-purple-100 text-xs">
                        <div className="flex items-center gap-1.5 font-semibold text-purple-900 mb-1">
                          <Database className="w-3.5 h-3.5" />
                          <span>PMS Function Executed: {turn.toolCalls[0].name}</span>
                          <span className="ml-auto font-mono text-[10px] text-purple-700">
                            {turn.toolCalls[0].durationMs}ms
                          </span>
                        </div>
                        <pre className="text-[10px] text-purple-800 bg-white/70 p-2 rounded border border-purple-100 overflow-x-auto">
                          {JSON.stringify(turn.toolCalls[0].args, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Itemized Millisecond Breakdown */}
                    <div className="bg-[#faf9fd] rounded-lg p-2.5 border border-[#e2def0] space-y-1.5 text-xs">
                      <div className="flex justify-between text-[#6b677a]">
                        <span>VAD Silence Endpointing:</span>
                        <span className="font-mono text-[#1e1b2b]">
                          {m.vadEndpointingMs}ms
                        </span>
                      </div>
                      <div className="flex justify-between text-[#6b677a]">
                        <span>Cartesia STT Finalization:</span>
                        <span className="font-mono text-[#1e1b2b]">
                          {m.sttLatencyMs}ms
                        </span>
                      </div>
                      {m.toolExecutionMs > 0 && (
                        <div className="flex justify-between text-[#6b677a]">
                          <span>PMS Core DB Query:</span>
                          <span className="font-mono text-[#1e1b2b]">
                            {m.toolExecutionMs}ms
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between text-[#6b677a]">
                        <span>Gemini Flash Time-To-First-Token:</span>
                        <span className="font-mono text-[#1e1b2b]">
                          {m.llmTtftMs}ms
                        </span>
                      </div>
                      <div className="flex justify-between text-[#6b677a]">
                        <span>Cartesia Sonic Time-To-First-Byte:</span>
                        <span className="font-mono text-[#1e1b2b]">
                          {m.ttsTtfbMs}ms
                        </span>
                      </div>
                      <div className="flex justify-between text-[#6b677a]">
                        <span>WebRTC Flight & Audio Playout:</span>
                        <span className="font-mono text-[#1e1b2b]">
                          {m.networkAndPlayoutMs}ms
                        </span>
                      </div>
                      <div className="flex justify-between font-bold pt-1.5 border-t border-[#e2def0] text-[#1e1b2b]">
                        <span>True User-Perceived E2E:</span>
                        <span className="font-mono text-violet-700">
                          {m.totalE2EMs}ms
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
