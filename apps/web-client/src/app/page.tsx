'use client';

import React, { useState } from 'react';
import { useVoiceSession } from '../hooks/use-voice-session';
import { VoiceOrb } from '../components/voice-orb';
import { Captions } from '../components/captions';
import { TranscriptDrawer } from '../components/transcript-drawer';
import { LatencyHUDDrawer } from '../components/latency-hud-drawer';
import { DebugOverlay } from '../components/debug-overlay';
import { MessageSquare, FileText, Send, X, PhoneOff, Zap } from 'lucide-react';

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
    latestLatency,
    turnHistory,
    clearTurnHistory,
    exportTurnHistory,
  } = useVoiceSession();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLatencyDrawerOpen, setIsLatencyDrawerOpen] = useState(false);
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
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsLatencyDrawerOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold shadow-xs transition-all cursor-pointer ${
              latestLatency
                ? latestLatency <= 800
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : latestLatency <= 1200
                  ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                : 'bg-white/80 text-[#8a8699] border-[#e2def0] hover:text-[#1e1b2b]'
            }`}
            title="Inspect Latency & Pipeline Telemetry"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>{latestLatency ? `${latestLatency}ms` : 'Latency HUD'}</span>
          </button>
        </div>

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

      <main className="flex-1 relative flex items-center justify-center -mt-6">
        <div className="relative flex flex-col items-center">
          <VoiceOrb
            state={agentState}
            isConnected={isConnected}
            isConnecting={isConnecting}
            audioLevel={audioLevel}
            onOrbClick={handleOrbClick}
          />

          <div className="absolute top-full mt-5 left-1/2 -translate-x-1/2 w-[min(90vw,640px)] pointer-events-none">
            <Captions
              state={agentState}
              isConnected={isConnected}
              isConnecting={isConnecting}
              transcripts={transcripts}
            />
          </div>
        </div>
      </main>

      <footer className="relative z-10 w-full pb-8 px-8 flex items-end justify-between">
        <div className="w-24" />

        <div className="flex-1 max-w-2xl flex flex-col items-center justify-center">
          {showTypeInput ? (
            <div className="w-full max-w-md flex flex-col items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <form
                onSubmit={handleInputSubmit}
                className="w-full flex items-center bg-white/95 backdrop-blur-md border border-[#e2def0] rounded-full px-4 py-2 shadow-sm focus-within:border-[#bebee5] focus-within:shadow-md transition-all"
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

              {isConnected && (
                <button
                  type="button"
                  onClick={endCall}
                  className="group inline-flex items-center gap-2 px-5 py-2 rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-medium text-xs shadow-md shadow-red-600/30 active:scale-95 transition-all duration-200 cursor-pointer"
                  title="End call"
                  aria-label="End call"
                >
                  <PhoneOff className="w-3.5 h-3.5 transition-transform group-hover:scale-110" />
                  <span>End call</span>
                </button>
              )}
            </div>
          ) : isConnected ? (
            <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
              <button
                type="button"
                onClick={endCall}
                className="group relative inline-flex items-center gap-2.5 px-6 py-2.5 rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-medium text-sm shadow-[0_8px_22px_-2px_rgba(220,38,38,0.42)] hover:shadow-[0_10px_26px_-2px_rgba(220,38,38,0.52)] active:scale-95 transition-all duration-200 cursor-pointer"
                title="End call"
                aria-label="End call"
              >
                <PhoneOff className="w-4 h-4 transition-transform group-hover:scale-110" />
                <span className="tracking-wide">End call</span>
              </button>
            </div>
          ) : (
            <div
              className={`flex flex-wrap items-center justify-center gap-x-6 gap-y-2 transition-all duration-500 ${
                !isConnecting
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

      <LatencyHUDDrawer
        isOpen={isLatencyDrawerOpen}
        onClose={() => setIsLatencyDrawerOpen(false)}
        turns={turnHistory}
        latestLatency={latestLatency}
        onClear={clearTurnHistory}
        onExport={exportTurnHistory}
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

