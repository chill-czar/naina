'use client';

import React from 'react';
import type { AgentState } from '@naina/shared-types';
import type { TranscriptMessage } from '../hooks/use-voice-session';

interface CaptionsProps {
  state: AgentState;
  isConnected: boolean;
  isConnecting: boolean;
  transcripts: TranscriptMessage[];
}

export function Captions({
  state,
  isConnected,
  isConnecting,
  transcripts,
}: CaptionsProps) {
  const lastUserMsg = [...transcripts].reverse().find((m) => m.role === 'user');
  const lastAgentMsg = [...transcripts].reverse().find((m) => m.role === 'agent');

  let guestText: string | null = null;
  let nainaText = 'Hello, I am Naina';
  let hintText: string | null = 'Touch the orb to start talking';

  if (isConnecting) {
    nainaText = 'Connecting...';
    hintText = 'One moment please';
  } else if (isConnected) {
    hintText = null;

    if (lastUserMsg?.text) {
      guestText = lastUserMsg.text;
    }

    if (state === 'THINKING') {
      nainaText = 'Thinking...';
    } else if (lastAgentMsg?.text) {
      nainaText = lastAgentMsg.text;
    } else if (state === 'LISTENING') {
      nainaText = 'I am listening';
    }
  }

  return (
    <div className="flex flex-col items-center justify-center text-center px-6 min-h-[90px] select-none">
      {isConnected && guestText && (
        <p className="text-sm text-[#8a8699] max-w-xl truncate mb-1 transition-opacity duration-300">
          {guestText}
        </p>
      )}

      <h2 className="font-serif italic text-[30px] leading-tight text-[#1e1b2b] max-w-2xl transition-all duration-300">
        {nainaText}
      </h2>

      {hintText && (
        <small className="mt-2 text-[13px] text-[#8a8699] font-normal tracking-normal block transition-opacity duration-300">
          {hintText}
        </small>
      )}
    </div>
  );
}

