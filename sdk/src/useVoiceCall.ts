import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VoiceCallClient,
  type VoiceCallStatus,
  type VoiceCallParticipant,
} from './VoiceCallClient';

export interface UseVoiceCallOptions {
  /** Base URL of the Teleconference backend */
  serverUrl: string;
}

export interface VoiceCallParticipantView {
  peerId: string;
  displayName: string;
  speaking: boolean;
}

export interface UseVoiceCallResult {
  status: VoiceCallStatus;
  /** Remote participants currently in the call */
  participants: VoiceCallParticipantView[];
  micEnabled: boolean;
  error: string | null;
  /** Join the call with an access token from your backend */
  join: (accessToken: string) => Promise<void>;
  leave: () => void;
  toggleMic: () => void;
}

/**
 * React hook that drives a voice call and auto-plays remote audio.
 *
 *   const call = useVoiceCall({ serverUrl: 'https://voice.example.com' });
 *   call.join(accessToken);
 */
export function useVoiceCall(opts: UseVoiceCallOptions): UseVoiceCallResult {
  const [status, setStatus] = useState<VoiceCallStatus>('idle');
  const [participants, setParticipants] = useState<VoiceCallParticipantView[]>([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<VoiceCallClient | null>(null);
  /** Hidden <audio> elements playing each remote stream, keyed by peerId */
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const detachAudio = useCallback((peerId: string) => {
    const el = audioElsRef.current.get(peerId);
    if (el) {
      el.srcObject = null;
      el.remove();
      audioElsRef.current.delete(peerId);
    }
  }, []);

  const join = useCallback(
    async (accessToken: string) => {
      if (clientRef.current) return;
      setError(null);

      const client = new VoiceCallClient({ serverUrl: opts.serverUrl });
      clientRef.current = client;

      client.on('status', setStatus);
      client.on('error', (e) => setError(e.message));

      client.on('participantJoined', ({ peerId, displayName }) => {
        setParticipants((prev) =>
          prev.some((p) => p.peerId === peerId)
            ? prev
            : [...prev, { peerId, displayName, speaking: false }]
        );
      });

      client.on('participantLeft', (peerId) => {
        setParticipants((prev) => prev.filter((p) => p.peerId !== peerId));
        detachAudio(peerId);
      });

      client.on('remoteStream', ({ peerId, displayName, stream }) => {
        // Auto-play remote audio via a hidden <audio> element
        let el = audioElsRef.current.get(peerId);
        if (!el) {
          el = document.createElement('audio');
          el.autoplay = true;
          (el as any).playsInline = true;
          el.style.display = 'none';
          document.body.appendChild(el);
          audioElsRef.current.set(peerId, el);
        }
        el.srcObject = stream;
        el.play().catch(() => {});
        setParticipants((prev) =>
          prev.some((p) => p.peerId === peerId)
            ? prev
            : [...prev, { peerId, displayName, speaking: false }]
        );
      });

      client.on('activeSpeaker', (peerId) => {
        setParticipants((prev) =>
          prev.map((p) => ({ ...p, speaking: p.peerId === peerId }))
        );
      });

      try {
        await client.join(accessToken);
        setMicEnabled(true);
      } catch {
        clientRef.current = null;
      }
    },
    [opts.serverUrl, detachAudio]
  );

  const leave = useCallback(() => {
    clientRef.current?.leave();
    clientRef.current = null;
    audioElsRef.current.forEach((el) => {
      el.srcObject = null;
      el.remove();
    });
    audioElsRef.current.clear();
    setParticipants([]);
  }, []);

  const toggleMic = useCallback(() => {
    setMicEnabled((prev) => {
      const next = !prev;
      clientRef.current?.setMicEnabled(next);
      return next;
    });
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.leave();
      clientRef.current = null;
      audioElsRef.current.forEach((el) => {
        el.srcObject = null;
        el.remove();
      });
      audioElsRef.current.clear();
    };
  }, []);

  return { status, participants, micEnabled, error, join, leave, toggleMic };
}
