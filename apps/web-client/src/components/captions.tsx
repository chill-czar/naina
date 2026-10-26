'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { AgentState } from '@naina/shared-types';
import type { TranscriptMessage } from '../hooks/use-voice-session';

interface CaptionsProps {
  state: AgentState;
  isConnected: boolean;
  isConnecting: boolean;
  transcripts: TranscriptMessage[];
}

/**
 * Calculates human conversational speech duration for a word in milliseconds,
 * accounting for word length and grammatical pauses.
 */
function getWordCadenceMs(word: string | undefined): number {
  if (!word) return 300;
  let delay = 280;
  if (word.length <= 3) delay = 200;
  else if (word.length >= 8) delay = 380;

  if (word.endsWith(',') || word.endsWith(';') || word.endsWith(':')) {
    delay += 160;
  } else if (word.endsWith('.') || word.endsWith('!') || word.endsWith('?')) {
    delay += 280;
  }
  return delay;
}

export function Captions({
  state,
  isConnected,
  isConnecting,
  transcripts,
}: CaptionsProps) {
  const lastUserMsg = [...transcripts].reverse().find((m) => m.role === 'user');
  const lastAgentMsg = [...transcripts].reverse().find((m) => m.role === 'agent');

  const [revealedCount, setRevealedCount] = useState(0);
  const currentMsgIdRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Extract words from the last agent message
  const words = useMemo(() => {
    if (!lastAgentMsg?.text) return [];
    return lastAgentMsg.text.trim().split(/\s+/).filter(Boolean);
  }, [lastAgentMsg?.text]);

  // Handle new message arrival or connection state change
  useEffect(() => {
    if (!isConnected || !lastAgentMsg) {
      currentMsgIdRef.current = null;
      setRevealedCount(0);
      return;
    }

    // Detected a new agent message turn
    if (lastAgentMsg.id !== currentMsgIdRef.current) {
      currentMsgIdRef.current = lastAgentMsg.id;
      // Start with the first word
      setRevealedCount(1);

      // Reset horizontal scroll position to beginning for new message
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft = 0;
      }
    }
  }, [isConnected, lastAgentMsg?.id]);

  // Progressively stream words one by one in sync with speech
  useEffect(() => {
    if (!isConnected || words.length === 0) return;

    // Check if user has started talking after this agent message (barge-in / next turn)
    const isInterrupted =
      lastUserMsg &&
      lastAgentMsg &&
      lastUserMsg.timestamp > lastAgentMsg.timestamp;

    if (isInterrupted) return;

    if (revealedCount > 0 && revealedCount < words.length) {
      const nextWord = words[revealedCount];
      const delay = getWordCadenceMs(nextWord);

      const timer = setTimeout(() => {
        setRevealedCount((prev) => prev + 1);
      }, delay);

      return () => clearTimeout(timer);
    }
  }, [revealedCount, words, isConnected, lastUserMsg, lastAgentMsg]);

  // Horizontal auto-scroll to keep the latest word visible at the right edge
  useEffect(() => {
    if (scrollContainerRef.current && revealedCount > 0) {
      const el = scrollContainerRef.current;
      el.scrollTo({
        left: el.scrollWidth - el.clientWidth,
        behavior: 'smooth',
      });
    }
  }, [revealedCount]);

  // Array of revealed words increasing one by one
  const displayedWords = useMemo(() => {
    if (revealedCount === 0 || words.length === 0) return [];
    return words.slice(0, revealedCount);
  }, [words, revealedCount]);

  let guestText: string | null = null;
  let hintText: string | null = 'Touch the orb to start talking';
  let fallbackHeading: string | null = null;

  if (isConnecting) {
    fallbackHeading = 'Connecting...';
    hintText = 'One moment please';
  } else if (!isConnected) {
    fallbackHeading = 'Hello, I am Naina';
  } else {
    hintText = null;

    if (lastUserMsg?.text && state !== 'SPEAKING') {
      guestText = lastUserMsg.text;
    }

    if (state === 'THINKING') {
      fallbackHeading = 'Thinking...';
    } else if (displayedWords.length === 0) {
      if (state === 'LISTENING') {
        fallbackHeading = 'I am listening';
      }
    }
  }

  return (
    <div className="flex flex-col items-center justify-center text-center px-2 h-[84px] select-none pointer-events-none w-full">
      {isConnected && guestText && (
        <p className="text-xs text-[#8a8699] max-w-lg truncate mb-1 transition-opacity duration-300">
          {guestText}
        </p>
      )}

      {fallbackHeading ? (
        <h2 className="text-2xl md:text-[28px] font-medium tracking-tight text-[#1e1b2b] max-w-xl leading-snug transition-all duration-200">
          <span className="inline-block transition-opacity duration-200 animate-fade-in">
            {fallbackHeading}
          </span>
        </h2>
      ) : (
        <div
          ref={scrollContainerRef}
          className="w-full max-w-2xl overflow-x-auto overflow-y-hidden no-scrollbar scroll-smooth flex items-center py-1 pointer-events-auto"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            maskImage:
              'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
          }}
        >
          <div className="inline-flex items-center gap-x-2 mx-auto px-8 whitespace-nowrap">
            {displayedWords.map((word, idx) => {
              const isLatest = idx === displayedWords.length - 1;
              return (
                <span
                  key={idx}
                  className={`text-2xl md:text-[28px] tracking-tight inline-block transition-all duration-200 ease-out ${
                    isLatest
                      ? 'text-[#1e1b2b] font-semibold opacity-100 scale-100 animate-word-in'
                      : 'text-[#1e1b2b] font-medium opacity-85'
                  }`}
                >
                  {word}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {hintText && (
        <small className="mt-2 text-[13px] text-[#8a8699] font-normal tracking-normal block transition-opacity duration-300">
          {hintText}
        </small>
      )}
    </div>
  );
}

