'use client';

import React, { useState } from 'react';
import { useVoiceSession } from '../hooks/use-voice-session';
import { VoiceOrb } from '../components/voice-orb';
import { Captions } from '../components/captions';
import { TranscriptDrawer } from '../components/transcript-drawer';
import { DebugOverlay } from '../components/debug-overlay';
import { MessageSquare, FileText, Send, X } from 'lucide-react';

export default function Home() {
  const {
    isConnected,
    isConnecting,
    agentState,
    transcripts,
    audioLevel,
    micPermission,
    requestMicPermission,
    startCall,
    endCall,
    interrupt,
    sendTextMessage,
  } = useVoiceSession();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showTypeInput, setShowTypeInput] = useState(false);
  const [typedMessage, setTypedMessage] = useState('');

  const sampleQuestions = [
    'Do you have rooms available for next weekend?',
    'What is the rate for the Presidential Suite?',
    'Can you check my folio balance for room 101?',
  ];

  const handleOrbClick = async () => {
    if (!isConnected) {
      if (micPermission !== 'granted') {
        const granted = await requestMicPermission();
        if (!granted) return;
      }
      await startCall();
    } else if (agentState === 'SPEAKING') {
      interrupt();
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    if (!isConnected) {
      if (micPermission !== 'granted') {
        const granted = await requestMicPermission();
        if (!granted) return;
      }
      await startCall();
      setTimeout(() => {
        sendTextMessage(text.trim());
      }, 1000);
    } else {
      sendTextMessage(text.trim());
    }
  };

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedMessage.trim()) return;
    handleSendMessage(typedMessage.trim());
    setTypedMessage('');
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden pearl-background flex flex-col justify-between select-none">
      <header className="relative z-10 w-full pt-10 px-8 flex items-center justify-between pointer-events-none">
        <div className="w-6" />

        <h1 className="font-serif text-[28px] tracking-[0.02em] text-[#1e1b2b]">
          Naina
        </h1>

        <div className="flex items-center justify-end w-6">
          <div
            title={
              isConnected
                ? 'Microphone and connection active'
                : micPermission === 'denied'
                ? 'Microphone blocked'
                : 'Standby'
            }
            className={`w-2 h-2 rounded-full transition-colors duration-500 ${
              isConnected
                ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                : micPermission === 'denied'
                ? 'bg-red-400'
                : 'bg-[#8a8699]/40'
            }`}
          />
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center -mt-6">
        <VoiceOrb
          state={agentState}
          isConnected={isConnected}
          isConnecting={isConnecting}
          audioLevel={audioLevel}
          onOrbClick={handleOrbClick}
          onEndCall={endCall}
        />

        <div className="mt-4">
          <Captions
            state={agentState}
            isConnected={isConnected}
            isConnecting={isConnecting}
            transcripts={transcripts}
          />
        </div>
      </main>

      <footer className="relative z-10 w-full pb-8 px-8 flex items-end justify-between">
        <div className="w-24" />

        <div className="flex-1 max-w-2xl flex flex-col items-center justify-center">
          {showTypeInput ? (
            <form
              onSubmit={handleInputSubmit}
              className="w-full max-w-md flex items-center bg-white/90 backdrop-blur-md border border-[#e2def0] rounded-full px-4 py-2 shadow-sm focus-within:border-[#bebee5] focus-within:shadow-md transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
            >
              <input
                type="text"
                autoFocus
                value={typedMessage}
                onChange={(e) => setTypedMessage(e.target.value)}
                placeholder="Type a message to Naina..."
                className="flex-1 bg-transparent text-sm text-[#1e1b2b] placeholder-[#8a8699] focus:outline-none px-1"
              />
              <button
                type="submit"
                disabled={!typedMessage.trim()}
                aria-label="Send message"
                className="p-1 rounded-full text-[#8a8699] hover:text-[#1e1b2b] disabled:opacity-30 transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowTypeInput(false)}
                aria-label="Close text input"
                className="ml-1 p-1 rounded-full text-[#8a8699] hover:text-[#1e1b2b] transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <div
              className={`flex flex-wrap items-center justify-center gap-x-6 gap-y-2 transition-all duration-500 ${
                !isConnected && !isConnecting
                  ? 'opacity-100'
                  : 'opacity-0 pointer-events-none'
              }`}
            >
              {sampleQuestions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(q)}
                  className="text-xs text-[#8a8699] hover:text-[#1e1b2b] transition-colors cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTypeInput((prev) => !prev)}
            aria-label="Type message instead"
            title="Type instead"
            className={`p-2.5 rounded-full border transition-all cursor-pointer backdrop-blur-md ${
              showTypeInput
                ? 'bg-white border-[#bebee5] text-[#1e1b2b] shadow-sm'
                : 'bg-white/70 hover:bg-white border-[#e2def0] text-[#8a8699] hover:text-[#1e1b2b]'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsDrawerOpen((prev) => !prev)}
            aria-label="View conversation transcript"
            title="Conversation transcript"
            className={`p-2.5 rounded-full border transition-all cursor-pointer backdrop-blur-md ${
              isDrawerOpen
                ? 'bg-white border-[#bebee5] text-[#1e1b2b] shadow-sm'
                : 'bg-white/70 hover:bg-white border-[#e2def0] text-[#8a8699] hover:text-[#1e1b2b]'
            }`}
          >
            <FileText className="w-4 h-4" />
          </button>
        </div>
      </footer>

      <TranscriptDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        messages={transcripts}
      />

      <DebugOverlay
        state={agentState}
        isConnected={isConnected}
        isConnecting={isConnecting}
        audioLevel={audioLevel}
        micPermission={micPermission}
      />
    </div>
  );
}

