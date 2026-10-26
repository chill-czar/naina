'use client';

import React, { useRef, useEffect } from 'react';
import type { AgentState } from '@naina/shared-types';

interface VoiceOrbProps {
  state: AgentState;
  isConnected: boolean;
  isConnecting: boolean;
  audioLevel: number;
  onOrbClick: () => void;
  onEndCall?: () => void;
}

const BLOBS: [string, number, number, number, number, number][] = [
  ['170,184,255', 0.45, 0.35, 0.17, 0, 0.85],
  ['255,196,214', 0.5, 0.4, 0.21, 2.1, 0.8],
  ['186,238,222', 0.4, 0.5, 0.14, 4.2, 0.75],
  ['255,220,186', 0.45, 0.4, 0.19, 1.2, 0.7],
  ['206,190,255', 0.35, 0.35, 0.23, 5.3, 0.65],
];

export function VoiceOrb({
  state,
  isConnected,
  isConnecting,
  audioLevel,
  onOrbClick,
  onEndCall,
}: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ state, isConnecting, audioLevel });

  useEffect(() => {
    propsRef.current = { state, isConnecting, audioLevel };
  }, [state, isConnecting, audioLevel]);

  const ampRef = useRef(0.03);
  const phaseRef = useRef(0);
  const animIdRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let baseR = 0;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.round(rect.width) || Math.round(window.innerWidth * 0.532);
      height = Math.round(rect.height) || Math.round(window.innerHeight * 0.57);
      baseR = Math.min(window.innerWidth, window.innerHeight) * 0.19;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    updateSize();
    window.addEventListener('resize', updateSize);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startTime = performance.now();

    const render = (now: number) => {
      const elapsed = reduceMotion ? 0 : (now - startTime) / 1000;
      const t = elapsed;
      const { state: curState, isConnecting: curIsConnecting, audioLevel: curAudioLevel } = propsRef.current;

      let targetAmp = 0.03;
      if (curState === 'SPEAKING') {
        const voiceCadence = 0.2 + 0.25 * Math.abs(Math.sin(t * 2.4) * Math.sin(t * 1.1 + 0.8));
        targetAmp = 0.25 + (curAudioLevel > 0.05 ? curAudioLevel * 0.6 : voiceCadence);
      } else if (curState === 'LISTENING') {
        const listenCadence = 0.08 + 0.08 * Math.sin(t * 1.3) * Math.sin(t * 0.7);
        targetAmp = 0.12 + (curAudioLevel > 0.05 ? curAudioLevel * 0.5 : listenCadence);
      } else if (curState === 'THINKING' || curIsConnecting) {
        targetAmp = 0.09 + 0.04 * Math.sin(t * 2.0);
      } else {
        targetAmp = 0.03 + 0.012 * Math.sin(t * 0.8);
      }

      ampRef.current += (targetAmp - ampRef.current) * 0.03;
      const amp = ampRef.current;
      phaseRef.current += 0.004 + amp * 0.01;
      const phase = phaseRef.current;

      const cx = width / 2;
      const cy = height / 2 - 14;
      const R = baseR * (1 + 0.012 * Math.sin(t * 0.8) + amp * 0.05);

      ctx.clearRect(0, 0, width, height);

      const shY = cy + R * 1.42;
      const sh = ctx.createRadialGradient(cx, shY, 0, cx, shY, R * 1.1);
      sh.addColorStop(0, `rgba(120, 105, 190, ${0.2 + amp * 0.08})`);
      sh.addColorStop(1, 'rgba(120, 105, 190, 0)');

      ctx.save();
      ctx.translate(cx, shY);
      ctx.scale(1.6, 0.16);
      ctx.translate(-cx, -shY);
      ctx.fillStyle = sh;
      ctx.beginPath();
      ctx.arc(cx, shY, R * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      for (let h = 0; h < 4; h++) {
        const p = (t * 0.12 + h / 4) % 1;
        const rr = R * (1.08 + p * (0.8 + amp * 0.8));
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(140, 125, 205, ${(1 - p) * (0.14 + amp * 0.16)})`;
        ctx.stroke();
      }

      const buildOrbPath = (radius: number) => {
        ctx.beginPath();
        for (let j = 0; j <= 120; j++) {
          const a = (j / 120) * Math.PI * 2;
          const wobble =
            Math.sin(a * 3 + t * 0.9) * 0.006 * (1 + amp * 6) +
            Math.sin(a * 2 - t * 0.6) * 0.005 * (1 + amp * 6);
          const r = radius * (1 + wobble);
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      };

      ctx.save();
      buildOrbPath(R);
      ctx.clip();

      const baseGrad = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      baseGrad.addColorStop(0, '#ffffff');
      baseGrad.addColorStop(1, '#e9e3fa');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(cx - R * 1.5, cy - R * 1.5, R * 3, R * 3);

      for (let i = 0; i < BLOBS.length; i++) {
        const [rgb, ox, oy, speed, bPhase, bSize] = BLOBS[i];
        const sp = speed * (1 + amp * 1.4);
        const bx = cx + Math.cos(t * sp + bPhase + phase) * R * ox;
        const by = cy + Math.sin(t * sp * 1.3 + bPhase) * R * oy;
        const br = R * bSize * (1 + amp * 0.25);

        const blobGrad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        blobGrad.addColorStop(0, `rgba(${rgb}, 0.92)`);
        blobGrad.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = blobGrad;
        ctx.fillRect(cx - R * 1.5, cy - R * 1.5, R * 3, R * 3);
      }

      const hx = cx - R * 0.38;
      const hy = cy - R * 0.5;
      const hlGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, R * 0.8);
      hlGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      hlGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = hlGrad;
      ctx.fillRect(cx - R * 1.5, cy - R * 1.5, R * 3, R * 3);

      const sy = cy + R * 0.2;
      const shadeGrad = ctx.createRadialGradient(cx, sy, R * 0.5, cx, sy, R * 1.05);
      shadeGrad.addColorStop(0, 'rgba(120, 105, 190, 0)');
      shadeGrad.addColorStop(1, 'rgba(120, 105, 190, 0.26)');
      ctx.fillStyle = shadeGrad;
      ctx.fillRect(cx - R * 1.5, cy - R * 1.5, R * 3, R * 3);

      ctx.restore();

      buildOrbPath(R);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.stroke();

      buildOrbPath(R * 1.012);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(140, 125, 205, 0.18)';
      ctx.stroke();

      if (!reduceMotion) {
        animIdRef.current = requestAnimationFrame(render);
      }
    };

    animIdRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', updateSize);
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current);
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOrbClick();
    }
  };

  const getAriaLabel = () => {
    if (!isConnected) return 'Start call with Naina';
    if (state === 'SPEAKING') return 'Naina is speaking. Press to interrupt';
    if (state === 'LISTENING') return 'Naina is listening';
    if (state === 'THINKING') return 'Naina is thinking';
    return 'Voice orb';
  };

  return (
    <div className="relative flex flex-col items-center justify-center select-none">
      <div
        role="button"
        tabIndex={0}
        onClick={onOrbClick}
        onKeyDown={handleKeyDown}
        aria-label={getAriaLabel()}
        className="relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#bebee5] rounded-full transition-transform active:scale-[0.98]"
        style={{ width: '53.2vmin', height: '57vmin' }}
      >
        <canvas
          ref={canvasRef}
          className="block pointer-events-none w-full h-full"
        />
      </div>

      {isConnected && onEndCall && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEndCall();
          }}
          className="mt-1 text-xs text-[#8a8699] hover:text-[#1e1b2b] underline decoration-[#bebee5] underline-offset-4 transition-colors cursor-pointer"
        >
          End call
        </button>
      )}
    </div>
  );
}
