'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { AgentState } from '@naina/shared-types';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isFinal: boolean;
  timestamp: Date;
}

export interface UseVoiceSessionOptions {
  serverUrl?: string;
}

export type MicPermissionStatus = 'checking' | 'prompt' | 'granted' | 'denied';

function getAudioContextClass(): typeof AudioContext {
  const customWindow = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctx = customWindow.AudioContext || customWindow.webkitAudioContext;
  if (!Ctx) {
    throw new Error('Web Audio API is not supported in this browser.');
  }
  return Ctx;
}

export function useVoiceSession(options: UseVoiceSessionOptions = {}) {
  const serverUrl =
    options.serverUrl ||
    (typeof window !== 'undefined'
      ? process.env.NEXT_PUBLIC_VOICE_SERVER_WS || `ws://${window.location.hostname}:4000/ws/voice`
      : 'ws://localhost:4000/ws/voice');

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>('IDLE');
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasMic, setHasMic] = useState(false);
  const [micPermission, setMicPermission] = useState<MicPermissionStatus>('checking');

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const pendingStateRef = useRef<AgentState | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const leftoverPlaybackByteRef = useRef<Uint8Array | null>(null);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Microphone is not supported in this browser environment.');
      setMicPermission('denied');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermission('granted');
      setError(null);
      return true;
    } catch (err: unknown) {
      const errorObj = err as { name?: string; message?: string };
      console.warn('Microphone permission request failed:', err);
      if (errorObj.name === 'NotAllowedError' || errorObj.name === 'PermissionDeniedError') {
        setMicPermission('denied');
        setError('Microphone permission is blocked. Please allow microphone access in your browser.');
      } else {
        setMicPermission('prompt');
        setError(`Microphone error: ${errorObj.message || 'Unknown error'}`);
      }
      return false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function checkAndPromptMic() {
      if (typeof window === 'undefined') return;

      if (navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          if (!mounted) return;
          setMicPermission(status.state as MicPermissionStatus);

          status.onchange = () => {
            if (mounted) {
              setMicPermission(status.state as MicPermissionStatus);
            }
          };

          if (status.state === 'prompt') {
            await requestMicPermission();
          }
          return;
        } catch {}
      }

      await requestMicPermission();
    }

    checkAndPromptMic();

    return () => {
      mounted = false;
    };
  }, [requestMicPermission]);

  const stopAllPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    activeSourcesRef.current = [];
    pendingStateRef.current = null;
    leftoverPlaybackByteRef.current = null;
    if (playbackContextRef.current) {
      nextPlayTimeRef.current = playbackContextRef.current.currentTime;
    }
  }, []);

  const processMicAudio = useCallback((inputData: Float32Array, inputSampleRate: number): ArrayBuffer => {
    const targetSampleRate = 16000;
    let pcm16: Int16Array;

    if (inputSampleRate === targetSampleRate) {
      pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    } else {
      const ratio = inputSampleRate / targetSampleRate;
      const newLength = Math.round(inputData.length / ratio);
      pcm16 = new Int16Array(newLength);
      let offsetResult = 0;
      let offsetBuffer = 0;

      while (offsetResult < pcm16.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0;
        let count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputData.length; i++) {
          accum += inputData[i];
          count++;
        }
        const s = count > 0 ? accum / count : 0;
        const clamped = Math.max(-1, Math.min(1, s));
        pcm16[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
      }
    }

    return pcm16.buffer as ArrayBuffer;
  }, []);

  const queueAudioChunk = useCallback((arrayBuffer: ArrayBuffer) => {
    try {
      if (!playbackContextRef.current) {
        const AudioCtx = getAudioContextClass();
        playbackContextRef.current = new AudioCtx();
      }
      const ctx = playbackContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      let rawBytes = new Uint8Array(arrayBuffer);
      if (leftoverPlaybackByteRef.current && leftoverPlaybackByteRef.current.length > 0) {
        const merged = new Uint8Array(leftoverPlaybackByteRef.current.length + rawBytes.length);
        merged.set(leftoverPlaybackByteRef.current, 0);
        merged.set(rawBytes, leftoverPlaybackByteRef.current.length);
        rawBytes = merged;
        leftoverPlaybackByteRef.current = null;
      }

      // 16-bit PCM sample alignment
      const odd = rawBytes.length % 2;
      if (odd !== 0) {
        leftoverPlaybackByteRef.current = rawBytes.slice(rawBytes.length - odd);
        rawBytes = rawBytes.subarray(0, rawBytes.length - odd);
      }

      if (rawBytes.length === 0) return;

      const int16View = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.length / 2);
      const float32Samples = new Float32Array(int16View.length);
      let sumSq = 0;

      for (let i = 0; i < int16View.length; i++) {
        const s = int16View[i] / 32768.0;
        float32Samples[i] = s;
        sumSq += s * s;
      }

      const rms = Math.sqrt(sumSq / (int16View.length || 1));
      setAudioLevel((prev) => Math.max(prev * 0.7, Math.min(1, rms * 4)));

      const audioBuffer = ctx.createBuffer(1, float32Samples.length, 24000);
      audioBuffer.getChannelData(0).set(float32Samples);

      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      if (nextPlayTimeRef.current < currentTime) {
        nextPlayTimeRef.current = currentTime + 0.02;
      }

      sourceNode.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuffer.duration;

      activeSourcesRef.current.push(sourceNode);

      sourceNode.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== sourceNode);
        if (activeSourcesRef.current.length === 0 && pendingStateRef.current) {
          setAgentState(pendingStateRef.current);
          pendingStateRef.current = null;
        }
      };
    } catch (err) {
      console.error('Error playing audio chunk:', err);
    }
  }, []);

  const startCall = useCallback(async () => {
    try {
      setError(null);
      setIsConnecting(true);

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (micErr: unknown) {
        const errorObj = micErr as { name?: string; message?: string };
        console.warn('Microphone access blocked:', micErr);
        setIsConnecting(false);
        if (errorObj.name === 'NotAllowedError' || errorObj.name === 'PermissionDeniedError') {
          setMicPermission('denied');
          setError('Microphone permission is required. Please click the lock icon in your browser URL bar to allow microphone access.');
        } else {
          setMicPermission('prompt');
          setError(`Microphone access required: ${errorObj.message || 'Unknown error'}`);
        }
        return;
      }

      mediaStreamRef.current = stream;
      setMicPermission('granted');
      setHasMic(true);

      const AudioCtx = getAudioContextClass();
      const outputCtx = new AudioCtx();
      playbackContextRef.current = outputCtx;
      if (outputCtx.state === 'suspended') {
        await outputCtx.resume();
      }
      nextPlayTimeRef.current = outputCtx.currentTime;

      const inputCtx = new AudioCtx();
      audioContextRef.current = inputCtx;
      if (inputCtx.state === 'suspended') {
        await inputCtx.resume();
      }

      const ws = new WebSocket(serverUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[voice-session] connected');
        setIsConnected(true);
        setIsConnecting(false);
        setAgentState('LISTENING');

        const sourceNode = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(2048, 1, 1);
        scriptProcessorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (isMutedRef.current) return;

          const inputChannel = e.inputBuffer.getChannelData(0);
          let sumSq = 0;
          for (let i = 0; i < inputChannel.length; i++) {
            sumSq += inputChannel[i] * inputChannel[i];
          }
          const rms = Math.sqrt(sumSq / inputChannel.length);
          if (rms > 0.01) {
            setAudioLevel((prev) => Math.max(prev * 0.7, Math.min(1, rms * 5)));
          }

          const pcmBuffer = processMicAudio(inputChannel, inputCtx.sampleRate);
          ws.send(pcmBuffer);
        };

        sourceNode.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'state') {
              if (data.state === 'LISTENING' && activeSourcesRef.current.length > 0) {
                pendingStateRef.current = 'LISTENING';
              } else {
                pendingStateRef.current = null;
                setAgentState(data.state);
              }
            } else if (data.type === 'barge_in') {
              stopAllPlayback();
              setAgentState('LISTENING');
            } else if (data.type === 'transcript') {
              setTranscripts((prev) => {
                if (data.role === 'user' && !data.isFinal) {
                  const lastIdx = prev.length - 1;
                  if (lastIdx >= 0 && prev[lastIdx].role === 'user' && !prev[lastIdx].isFinal) {
                    const updated = [...prev];
                    updated[lastIdx] = { ...updated[lastIdx], text: data.text };
                    return updated;
                  }
                  return [
                    ...prev,
                    {
                      id: `user-${Date.now()}`,
                      role: 'user',
                      text: data.text,
                      isFinal: false,
                      timestamp: new Date(),
                    },
                  ];
                } else if (data.role === 'user' && data.isFinal) {
                  const filtered = prev.filter((m) => !(m.role === 'user' && !m.isFinal));
                  return [
                    ...filtered,
                    {
                      id: `user-${Date.now()}`,
                      role: 'user',
                      text: data.text,
                      isFinal: true,
                      timestamp: new Date(),
                    },
                  ];
                } else if (data.role === 'agent') {
                  return [
                    ...prev,
                    {
                      id: `agent-${Date.now()}`,
                      role: 'agent',
                      text: data.text,
                      isFinal: true,
                      timestamp: new Date(),
                    },
                  ];
                }
                return prev;
              });
            } else if (data.type === 'error') {
              console.error('Server error:', data.message);
              setError(data.message);
            }
          } catch (e) {
            console.error('Failed to parse WS text message:', e);
          }
        } else if (event.data instanceof ArrayBuffer) {
          setAgentState('SPEAKING');
          queueAudioChunk(event.data);
        }
      };

      ws.onerror = (e) => {
        console.error('WebSocket connection error:', e);
        setError('Connection failed. Make sure voice-server is running.');
        setIsConnecting(false);
      };

      ws.onclose = () => {
        console.log('[voice-session] disconnected');
        setIsConnected(false);
        setIsConnecting(false);
        setAgentState('IDLE');
        stopAllPlayback();
      };
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      console.error('Failed to start call:', err);
      setError(errorObj.message || 'Microphone access denied or connection error');
      setIsConnecting(false);
    }
  }, [serverUrl, processMicAudio, queueAudioChunk, stopAllPlayback]);

  const endCall = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect();
      } catch {}
      scriptProcessorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    stopAllPlayback();

    if (playbackContextRef.current) {
      playbackContextRef.current.close().catch(() => {});
      playbackContextRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setAgentState('IDLE');
    setAudioLevel(0);
    setHasMic(false);
  }, [stopAllPlayback]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const interrupt = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    stopAllPlayback();
    setAgentState('LISTENING');
  }, [stopAllPlayback]);

  const sendTextMessage = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && text.trim()) {
      wsRef.current.send(JSON.stringify({ type: 'text_input', text: text.trim() }));
    }
  }, []);

  useEffect(() => {
    return () => {
      endCall();
    };
  }, [endCall]);

  return {
    isConnected,
    isConnecting,
    isMuted,
    hasMic,
    micPermission,
    requestMicPermission,
    agentState,
    transcripts,
    audioLevel,
    error,
    startCall,
    endCall,
    toggleMute,
    interrupt,
    sendTextMessage,
  };
}

