'use client';

import React, { useEffect, useRef } from 'react';
import type { TranscriptMessage } from '../hooks/use-voice-session';
import { X } from 'lucide-react';

interface TranscriptDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: TranscriptMessage[];
}

export function TranscriptDrawer({ isOpen, onClose, messages }: TranscriptDrawerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/5 backdrop-blur-[2px] z-30 transition-opacity"
        />
      )}

      <aside
        aria-label="Conversation transcript drawer"
        className={`fixed top-0 right-0 h-full w-[360px] bg-white/85 backdrop-blur-xl border-l border-[#e2def0] shadow-2xl z-40 flex flex-col transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e2def0]/80 bg-white/40">
          <h3 className="text-base font-semibold text-[#1e1b2b] tracking-tight">Conversation</h3>
          <button
            onClick={onClose}
            aria-label="Close transcript drawer"
            className="p-1.5 rounded-full hover:bg-black/5 text-[#8a8699] hover:text-[#1e1b2b] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 py-6 space-y-6 scroll-smooth custom-scrollbar"
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#8a8699]">
              <p className="text-sm">No messages yet.</p>
              <p className="text-xs text-[#8a8699]/80 mt-1">
                Your live voice conversation with Naina will be transcribed here.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isAgent = msg.role === 'agent';
              return (
                <div key={msg.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#8a8699]">
                      {isAgent ? 'Naina' : 'You'}
                    </span>
                    <span className="text-[10px] text-[#8a8699]/70">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p
                    className={`text-sm leading-relaxed ${
                      isAgent
                        ? 'text-[#1e1b2b] font-normal'
                        : 'text-[#8a8699]'
                    }`}
                  >
                    {msg.text}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}

