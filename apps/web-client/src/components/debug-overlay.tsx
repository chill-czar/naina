'use client';

import React, { useEffect, useState } from 'react';
import type { AgentState } from '@naina/shared-types';
import { X, Activity } from 'lucide-react';

interface DebugOverlayProps {
  state: AgentState;
  isConnected: boolean;
  isConnecting: boolean;
  audioLevel: number;
  micPermission: string;
}

export function DebugOverlay({
  state,
  isConnected,
  isConnecting,
  audioLevel,
  micPermission,
}: DebugOverlayProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === 'd' || e.key === 'D') &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        setIsVisible((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isVisible) return null;

  return (
    <div className="fixed top-6 left-6 z-50 w-80 bg-white/90 backdrop-blur-xl border border-[#e2def0] rounded-2xl p-4 shadow-xl text-xs text-[#1e1b2b] select-none animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-[#e2def0]">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#8a8699]" />
          <span className="font-medium text-[#1e1b2b]">Pipeline debug</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#8a8699]">Press D to hide</span>
          <button
            onClick={() => setIsVisible(false)}
            className="p-1 rounded hover:bg-black/5 text-[#8a8699] hover:text-[#1e1b2b] cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="text-[#8a8699]">Agent state</span>
          <span className="font-medium">{state}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8a8699]">Connection</span>
          <span className="font-medium">
            {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Standby'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8a8699]">Microphone</span>
          <span className="font-medium">{micPermission}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8a8699]">Audio amplitude</span>
          <span className="font-medium">{(audioLevel * 100).toFixed(1)}%</span>
        </div>
        <div className="pt-2 border-t border-[#e2def0]/60 space-y-1 text-[11px] text-[#8a8699]">
          <p>STT: Cartesia Ink-2 (16kHz PCM)</p>
          <p>LLM: Gemini 2.5 Flash + PMS tools</p>
          <p>TTS: Cartesia Sonic-3.5 (24kHz PCM)</p>
        </div>
      </div>
    </div>
  );
}
