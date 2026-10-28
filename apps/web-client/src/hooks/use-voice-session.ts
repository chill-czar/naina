'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant } from 'livekit-client';
import type { AgentState } from '@naina/shared-types';
import { useSileroVAD } from './use-silero-vad';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isFinal: boolean;
  timestamp: Date;
}

export interface UseVoiceSessionOptions {
  serverUrl?: string;
  roomName?: string;
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
  const defaultRoomName = options.roomName || 'naina-concierge-room';

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>('IDLE');
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasMic, setHasMic] = useState(false);
  const [micPermission, setMicPermission] = useState<MicPermissionStatus>('checking');
  const [activeMediaStream, setActiveMediaStream] = useState<MediaStream | null>(null);

  const roomRef = useRef<Room | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const agentAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Handle instant local barge-in (<10ms) from Silero VAD
  const handleLocalBargeIn = useCallback(() => {
    console.log('[Silero VAD] Speech detected - executing instant sub-10ms local cutoff');

    // 1. Immediately mute and pause local playback of agent voice
    if (agentAudioElementRef.current) {
      agentAudioElementRef.current.muted = true;
      agentAudioElementRef.current.pause();
    }
    setAgentState('LISTENING');

    // 2. Transmit barge_in packet to LiveKit Voice Server over Data Channel
    if (roomRef.current?.localParticipant) {
      try {
        const payload = new TextEncoder().encode(JSON.stringify({ type: 'barge_in' }));
        roomRef.current.localParticipant.publishData(payload, { reliable: true }).catch(() => {});
      } catch (e) {
        console.warn('Failed to publish barge-in packet:', e);
      }
    }
  }, []);

  // Initialize Client-Side Silero VAD hook
  const { isSpeechActive } = useSileroVAD({
    enabled: isConnected && !isMuted,
    stream: activeMediaStream,
    positiveSpeechThreshold: 0.6,
    negativeSpeechThreshold: 0.4,
    minSpeechFrames: 3,
    onSpeechStart: handleLocalBargeIn,
  });

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

  // Audio level analyser loop for VoiceOrb mouth animations
  useEffect(() => {
    let animId: number;
    const dataArray = new Uint8Array(128);

    function checkLevel() {
      if (analyserRef.current && agentState === 'SPEAKING') {
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sumSq = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sumSq += val * val;
        }
        const rms = Math.sqrt(sumSq / dataArray.length);
        setAudioLevel((prev) => Math.max(prev * 0.7, Math.min(1, rms * 4)));
      } else {
        setAudioLevel((prev) => (prev > 0.01 ? prev * 0.8 : 0));
      }
      animId = requestAnimationFrame(checkLevel);
    }

    animId = requestAnimationFrame(checkLevel);
    return () => cancelAnimationFrame(animId);
  }, [agentState]);

  const startCall = useCallback(async () => {
    try {
      setError(null);
      setIsConnecting(true);

      // 1. Acquire microphone stream with WebRTC acoustic echo cancellation
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
      setActiveMediaStream(stream);
      setMicPermission('granted');
      setHasMic(true);

      // 2. Fetch LiveKit Room token from Voice Server
      const apiHost =
        typeof window !== 'undefined'
          ? (process.env.NEXT_PUBLIC_VOICE_SERVER_HTTP || `http://${window.location.hostname}:4000`)
          : 'http://localhost:4000';

      const tokenRes = await fetch(`${apiHost}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: defaultRoomName,
          participantName: `guest-${Math.floor(1000 + Math.random() * 9000)}`,
        }),
      });

      if (!tokenRes.ok) {
        const errJson = await tokenRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Voice Server token error: ${tokenRes.status}`);
      }

      const { token, url: liveKitUrl } = await tokenRes.json();
      console.log(`[useVoiceSession] Token received, connecting to LiveKit: ${liveKitUrl}`);

      // 3. Connect to LiveKit Room via WebRTC
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        console.log(`[useVoiceSession] Remote track subscribed: ${track.kind}`);
        if (track.kind === Track.Kind.Audio) {
          const audioElement = track.attach();
          audioElement.autoplay = true;
          agentAudioElementRef.current = audioElement;

          // Attach Web Audio Analyser for VoiceOrb mouth movement
          try {
            const AudioCtx = getAudioContextClass();
            if (!audioContextRef.current) {
              audioContextRef.current = new AudioCtx();
            }
            const ctx = audioContextRef.current;
            if (ctx.state === 'suspended') {
              ctx.resume();
            }

            if (track.mediaStreamTrack) {
              const ms = new MediaStream([track.mediaStreamTrack]);
              const source = ctx.createMediaStreamSource(ms);
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 256;
              source.connect(analyser);
              analyserRef.current = analyser;
            }
          } catch (e) {
            console.warn('[useVoiceSession] Could not setup analyser for agent audio track:', e);
          }
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        console.log(`[useVoiceSession] Remote track unsubscribed: ${track.kind}`);
        track.detach();
        if (agentAudioElementRef.current) {
          agentAudioElementRef.current = null;
        }
      });

      room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
        try {
          const str = new TextDecoder().decode(payload);
          const data = JSON.parse(str);

          if (data.type === 'state') {
            if (data.state === 'SPEAKING' && agentAudioElementRef.current) {
              agentAudioElementRef.current.muted = false;
              agentAudioElementRef.current.play().catch(() => {});
            }
            setAgentState(data.state);
          } else if (data.type === 'barge_in') {
            if (agentAudioElementRef.current) {
              agentAudioElementRef.current.muted = true;
              agentAudioElementRef.current.pause();
            }
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
          console.error('[useVoiceSession] Error decoding DataChannel message:', e);
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        console.log('[useVoiceSession] LiveKit Room disconnected');
        setIsConnected(false);
        setIsConnecting(false);
        setAgentState('IDLE');
        setAudioLevel(0);
      });

      await room.connect(liveKitUrl, token);
      console.log('[useVoiceSession] Connected to LiveKit Room');

      // 4. Publish microphone track to LiveKit Room
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });

      setIsConnected(true);
      setIsConnecting(false);
      setAgentState('LISTENING');
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      console.error('Failed to start call:', err);
      setError(errorObj.message || 'Failed to start LiveKit voice call');
      setIsConnecting(false);
      setIsConnected(false);
    }
  }, [defaultRoomName]);

  const endCall = useCallback(() => {
    if (roomRef.current) {
      try {
        roomRef.current.disconnect();
      } catch {}
      roomRef.current = null;
    }

    if (agentAudioElementRef.current) {
      try {
        agentAudioElementRef.current.pause();
        agentAudioElementRef.current.srcObject = null;
      } catch {}
      agentAudioElementRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setActiveMediaStream(null);

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    setIsConnected(false);
    setIsConnecting(false);
    setAgentState('IDLE');
    setAudioLevel(0);
    setHasMic(false);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (roomRef.current?.localParticipant) {
        roomRef.current.localParticipant.setMicrophoneEnabled(!next).catch(() => {});
      }
      return next;
    });
  }, []);

  const interrupt = useCallback(() => {
    handleLocalBargeIn();
  }, [handleLocalBargeIn]);

  const sendTextMessage = useCallback((text: string) => {
    if (roomRef.current?.localParticipant && text.trim()) {
      try {
        const payload = new TextEncoder().encode(
          JSON.stringify({ type: 'text_input', text: text.trim() })
        );
        roomRef.current.localParticipant.publishData(payload, { reliable: true }).catch(() => {});
      } catch (e) {
        console.error('Failed to send text input:', e);
      }
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
    isSpeechActive,
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
