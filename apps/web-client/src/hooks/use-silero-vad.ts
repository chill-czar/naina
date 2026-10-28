'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { MicVAD as MicVADType } from '@ricky0123/vad-web';

export interface UseSileroVADOptions {
  enabled?: boolean;
  stream?: MediaStream | null;
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  onVADMisfire?: () => void;
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  minSpeechFrames?: number;
}

export function useSileroVAD({
  enabled = false,
  stream = null,
  onSpeechStart,
  onSpeechEnd,
  onVADMisfire,
  positiveSpeechThreshold = 0.6,
  negativeSpeechThreshold = 0.4,
  minSpeechFrames = 3,
}: UseSileroVADOptions) {
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vadRef = useRef<MicVADType | null>(null);
  const callbacksRef = useRef({ onSpeechStart, onSpeechEnd, onVADMisfire });

  useEffect(() => {
    callbacksRef.current = { onSpeechStart, onSpeechEnd, onVADMisfire };
  }, [onSpeechStart, onSpeechEnd, onVADMisfire]);

  useEffect(() => {
    let isCancelled = false;

    if (!enabled) {
      if (vadRef.current) {
        vadRef.current.pause().catch(() => {});
      }
      setIsSpeechActive(false);
      return;
    }

    async function initVAD() {
      if (typeof window === 'undefined') return;

      try {
        const { MicVAD } = await import('@ricky0123/vad-web');
        if (isCancelled) return;

        if (!vadRef.current) {
          const vadOptions: any = {
            model: 'v5',
            baseAssetPath: '/vad/',
            onnxWASMBasePath: '/vad/',
            positiveSpeechThreshold,
            negativeSpeechThreshold,
            minSpeechFrames,
            onSpeechStart: () => {
              setIsSpeechActive(true);
              callbacksRef.current.onSpeechStart?.();
            },
            onSpeechEnd: (audio: Float32Array) => {
              setIsSpeechActive(false);
              callbacksRef.current.onSpeechEnd?.(audio);
            },
            onVADMisfire: () => {
              setIsSpeechActive(false);
              callbacksRef.current.onVADMisfire?.();
            },
            ortConfig: (ort: any) => {
              ort.env.logLevel = 'error';
              if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
                ort.env.wasm.numThreads = 1;
              }
            },
          };

          if (stream) {
            vadOptions.getStream = async () => stream;
            vadOptions.pauseStream = async () => {};
            vadOptions.resumeStream = async () => stream;
          }

          const vadInstance = await MicVAD.new(vadOptions);

          if (isCancelled) {
            vadInstance.destroy().catch(() => {});
            return;
          }

          vadRef.current = vadInstance;
          setIsLoaded(true);
        }

        await vadRef.current.start();
      } catch (err: any) {
        console.warn('[Silero VAD] Initialization error:', err);
        setError(err?.message || 'Failed to initialize Silero VAD');
      }
    }

    initVAD();

    return () => {
      isCancelled = true;
      if (vadRef.current) {
        vadRef.current.pause().catch(() => {});
      }
    };
  }, [enabled, stream, positiveSpeechThreshold, negativeSpeechThreshold, minSpeechFrames]);

  const pause = useCallback(async () => {
    if (vadRef.current) {
      await vadRef.current.pause().catch(() => {});
      setIsSpeechActive(false);
    }
  }, []);

  const resume = useCallback(async () => {
    if (vadRef.current && enabled) {
      await vadRef.current.start().catch(() => {});
    }
  }, [enabled]);

  const destroy = useCallback(async () => {
    if (vadRef.current) {
      await vadRef.current.destroy().catch(() => {});
      vadRef.current = null;
      setIsLoaded(false);
      setIsSpeechActive(false);
    }
  }, []);

  return {
    isSpeechActive,
    isLoaded,
    error,
    pause,
    resume,
    destroy,
  };
}
