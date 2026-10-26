'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { AgentState } from '@naina/shared-types';
import { Orb } from 'orb-ui';

export interface VoiceOrbProps {
  state: AgentState;
  isConnected: boolean;
  isConnecting: boolean;
  audioLevel: number;
  onOrbClick: () => void;
}

export function VoiceOrb({
  state,
  isConnected,
  isConnecting,
  audioLevel,
  onOrbClick,
}: VoiceOrbProps) {
  const orbRef = useRef<HTMLDivElement | null>(null);
  const faceRef = useRef<HTMLDivElement | null>(null);
  const leftEyeRef = useRef<HTMLDivElement | null>(null);
  const rightEyeRef = useRef<HTMLDivElement | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);

  const pointerTarget = useRef({ x: 0, y: 0 });

  const stateRef = useRef({ state, audioLevel, isConnected });
  useEffect(() => {
    stateRef.current = { state, audioLevel, isConnected };
  }, [state, audioLevel, isConnected]);

  // Dynamic animated volume signal for lively voice response
  const [liveVolume, setLiveVolume] = useState({ input: 0, output: 0 });

  useEffect(() => {
    let animId: number;
    let t = 0;

    const updateVolume = () => {
      t += 0.15;
      const { state: curState, audioLevel: curLevel } = stateRef.current;

      if (curState === 'SPEAKING') {
        const syllableRhythm = 0.35 * Math.abs(Math.sin(t * 1.8) * Math.sin(t * 0.9 + 0.5));
        const boosted = curLevel > 0.02
          ? Math.min(1.0, 0.35 + curLevel * 3.5)
          : 0.45 + syllableRhythm;
        setLiveVolume({ input: 0, output: boosted });
      } else if (curState === 'LISTENING') {
        const boosted = curLevel > 0.02 ? Math.min(1.0, 0.3 + curLevel * 4.0) : 0.18;
        setLiveVolume({ input: boosted, output: 0 });
      } else {
        setLiveVolume({ input: 0, output: 0 });
      }

      animId = requestAnimationFrame(updateVolume);
    };

    animId = requestAnimationFrame(updateVolume);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Track cursor position for gaze following in IDLE / THINKING
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const orbEl = orbRef.current;
      if (!orbEl) return;
      const rect = orbEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = (e.clientX - centerX) / (window.innerWidth / 2);
      const dy = (e.clientY - centerY) / (window.innerHeight / 2);
      pointerTarget.current.x = Math.max(-1, Math.min(1, dx));
      pointerTarget.current.y = Math.max(-1, Math.min(1, dy));
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  // Natural blinking
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let isBlinking = false;

    const scheduleBlink = () => {
      const delay = (state === 'LISTENING' ? 4000 : 2800) + Math.random() * 2000;
      timeoutId = setTimeout(() => {
        if (!isBlinking && leftEyeRef.current && rightEyeRef.current) {
          isBlinking = true;
          leftEyeRef.current.style.transform = 'scaleY(0.08)';
          rightEyeRef.current.style.transform = 'scaleY(0.08)';

          setTimeout(() => {
            if (leftEyeRef.current && rightEyeRef.current) {
              const eyeScaleY = state === 'LISTENING' ? '1.12' : state === 'THINKING' ? '0.92' : '1.0';
              leftEyeRef.current.style.transform = `scaleY(${eyeScaleY})`;
              rightEyeRef.current.style.transform = `scaleY(${eyeScaleY})`;
            }
            isBlinking = false;
            scheduleBlink();
          }, 130);
        } else {
          scheduleBlink();
        }
      }, delay);
    };

    scheduleBlink();
    return () => clearTimeout(timeoutId);
  }, [state]);

  // Gaze tracking: direct eye contact during conversation vs cursor following during idle
  useEffect(() => {
    let animId: number;
    let currentGazeX = 0;
    let currentGazeY = 0;

    const tick = () => {
      const { state: curState, audioLevel: curLevel } = stateRef.current;

      const isSpeakingOrListening = curState === 'SPEAKING' || curState === 'LISTENING';
      let targetGazeX = 0;
      let targetGazeY = 0;

      if (!isSpeakingOrListening) {
        const maxTravel = 26;
        targetGazeX = pointerTarget.current.x * maxTravel;
        targetGazeY = pointerTarget.current.y * maxTravel;

        if (curState === 'THINKING' && Math.abs(pointerTarget.current.x) < 0.1 && Math.abs(pointerTarget.current.y) < 0.1) {
          targetGazeX = 6;
          targetGazeY = -8;
        }
      } else {
        targetGazeX = 0;
        targetGazeY = 0;
      }

      currentGazeX += (targetGazeX - currentGazeX) * 0.14;
      currentGazeY += (targetGazeY - currentGazeY) * 0.14;

      if (faceRef.current) {
        faceRef.current.style.transform = `translate3d(${currentGazeX.toFixed(2)}px, ${currentGazeY.toFixed(2)}px, 0)`;
      }

      if (haloRef.current && curState === 'LISTENING') {
        const pulse = 1.0 + Math.min(0.35, curLevel * 1.5);
        haloRef.current.style.transform = `scale(${pulse})`;
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOrbClick();
    }
  };



  const orbUiState: 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' = isConnecting
    ? 'connecting'
    : state === 'LISTENING'
    ? 'listening'
    : state === 'THINKING'
    ? 'thinking'
    : state === 'SPEAKING'
    ? 'speaking'
    : 'idle';

  return (
    <div className="relative flex flex-col items-center justify-center select-none">
      {/* Interactive Custom Orb */}
      <div
        ref={orbRef}
        role="button"
        tabIndex={0}
        onClick={onOrbClick}
        onKeyDown={handleKeyDown}
        aria-label={
          !isConnected
            ? 'Touch Naina to talk'
            : state === 'SPEAKING'
            ? 'Naina is speaking. Tap to interrupt'
            : `Naina is ${state.toLowerCase()}`
        }
        className="relative cursor-pointer outline-none focus-visible:ring-4 focus-visible:ring-[#7C5CFF]/30 rounded-full transition-transform active:scale-[0.98] flex items-center justify-center"
        style={{
          width: 'clamp(260px, 38vmin, 340px)',
          height: 'clamp(260px, 38vmin, 340px)',
        }}
      >
        {/* Stage Glow Halo */}
        <div
          ref={haloRef}
          className={`absolute inset-[-10%] rounded-full blur-2xl pointer-events-none transition-all duration-700 ${
            state === 'SPEAKING'
              ? 'bg-[#7C5CFF]/40 scale-105'
              : state === 'LISTENING'
              ? 'bg-emerald-400/40 scale-105'
              : state === 'THINKING' || isConnecting
              ? 'bg-violet-400/35 animate-pulse scale-100'
              : 'bg-[#7C5CFF]/25 scale-95'
          }`}
        />

        {/* Custom Purple Orb Character Body */}
        <div
          className="relative w-full h-full rounded-full overflow-hidden shadow-2xl flex items-center justify-center transition-transform duration-300"
          style={{
            backgroundColor: '#7C5CFF',
            boxShadow: '0 20px 48px -10px rgba(124, 92, 255, 0.45)',
          }}
        >
          {/* Face: Exact reference eyes + orb-ui Bars Mouth */}
          <div
            ref={faceRef}
            className="absolute inset-0 pointer-events-none will-change-transform"
          >
            {/* Left Eye: Exact proportions from reference image */}
            <div
              ref={leftEyeRef}
              className="absolute rounded-full bg-[#FFFFFF] shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition-transform duration-100 origin-center"
              style={{
                width: '5.8%',
                height: '20%',
                left: '30.1%',
                top: '35.5%',
              }}
            />

            {/* Right Eye: Exact proportions from reference image */}
            <div
              ref={rightEyeRef}
              className="absolute rounded-full bg-[#FFFFFF] shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition-transform duration-100 origin-center"
              style={{
                width: '5.8%',
                height: '20%',
                right: '30.1%',
                top: '35.5%',
              }}
            />

            {/* Speaking Mouth: orb-ui Bars UI centered below the eyes */}
            <div
              className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center overflow-visible"
              style={{
                top: '64%',
                width: '32%',
                height: '16%',
              }}
            >
              <Orb
                theme={{
                  name: 'bars',
                  appearance: {
                    colors: {
                      idle: '#FFFFFF',
                      speaking: '#FFFFFF',
                      listening: '#FFFFFF',
                      thinking: '#FFFFFF',
                      connecting: '#FFFFFF',
                      error: '#FFFFFF',
                    },
                  },
                  geometry: {
                    barWidthRatio: 0.055,
                    gapRatio: 0.035,
                    minHeightRatio: 0.07,
                    maxHeightRatio: 0.38,
                    borderRadiusRatio: 0.035,
                  },
                  motion: {
                    responseExponent: 0.6,
                    activityRiseMs: 40,
                    activityFallMs: 80,
                    waveFrequency: 1.6,
                    speakingTempo: 1.4,
                    listeningTempo: 0.8,
                    loadingTempo: 0.7,
                  },
                }}
                signal={{
                  state: orbUiState,
                  inputVolume: liveVolume.input,
                  outputVolume: liveVolume.output,
                }}
                size={110}
                interactive={false}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
