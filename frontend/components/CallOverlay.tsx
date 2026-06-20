'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Phone, X } from 'lucide-react';
import { CallClient, type RemoteCallPeer } from '@/lib/callClient';
import type { Socket } from 'socket.io-client';

interface Props {
  socket: Socket;
  conversationId: string;
  conversationName: string;
  /** Members in this conversation excluding self */
  members: { id: string; username: string }[];
  /** Whether this is an incoming call (we received an invite) */
  incoming?: boolean;
  /** From username when incoming */
  fromUsername?: string;
  onClose: () => void;
}

type Phase = 'incoming' | 'calling' | 'in-call';

export default function CallOverlay({
  socket,
  conversationId,
  conversationName,
  members,
  incoming,
  fromUsername,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>(incoming ? 'incoming' : 'calling');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Map<string, RemoteCallPeer>>(new Map());
  const [micOn, setMicOn] = useState(true);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const callRef = useRef<CallClient | null>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const callStartRef = useRef<number | null>(null);

  // Timer once in-call
  useEffect(() => {
    if (phase !== 'in-call') return;
    callStartRef.current = Date.now();
    const t = setInterval(() => {
      if (callStartRef.current) {
        setElapsed(Math.floor((Date.now() - callStartRef.current) / 1000));
      }
    }, 500);
    return () => clearInterval(t);
  }, [phase]);

  async function accept() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setLocalStream(stream);

      const client = new CallClient(socket, conversationId, {
        onPeerLeft: (peerId) => {
          setRemotes((prev) => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
        },
        onRemoteTrack: (peer) => {
          setRemotes((prev) => {
            const next = new Map(prev);
            next.set(peer.peerId, peer);
            return next;
          });
        },
        onActiveSpeaker: setActiveSpeakerId,
      });

      callRef.current = client;
      await client.join(stream);
      setPhase('in-call');
    } catch (err: any) {
      setError(err.message);
      setTimeout(onClose, 2000);
    }
  }

  async function decline() {
    socket.emit('call:decline', { conversationId });
    onClose();
  }

  function cancel() {
    socket.emit('call:cancel', { conversationId });
    onClose();
  }

  function hangup() {
    callRef.current?.leave();
    localStream?.getTracks().forEach((t) => t.stop());
    onClose();
  }

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    callRef.current?.toggleMic(next);
    localStream?.getAudioTracks().forEach((t) => (t.enabled = next));
  }

  // If outbound call: immediately try to join (server has already broadcast invite)
  useEffect(() => {
    if (!incoming && phase === 'calling') {
      accept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      callRef.current?.leave();
      localStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const otherCount = members.length;

  return (
    <>
      {/* Hidden audio elements for each remote stream */}
      <div ref={audioContainerRef} className="hidden">
        {Array.from(remotes.values()).map((r) => (
          <RemoteAudio key={r.peerId} stream={r.stream} />
        ))}
      </div>

      <div className="fixed inset-0 bg-slate-950/95 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 rounded-2xl border border-slate-800 p-6 flex flex-col items-center gap-5">
          <div className="text-center">
            <div className="text-sm text-slate-400">
              {phase === 'incoming'
                ? `Incoming call from ${fromUsername}`
                : phase === 'calling'
                  ? 'Calling...'
                  : 'In call'}
            </div>
            <div className="text-xl font-semibold mt-1">{conversationName}</div>
            {phase === 'in-call' && (
              <div className="text-sm text-slate-400 mt-1">{formatTime(elapsed)}</div>
            )}
          </div>

          <div className="flex -space-x-2">
            {members.slice(0, 4).map((m) => {
              const isSpeaking = activeSpeakerId
                ? Array.from(remotes.values()).some(
                    (r) => r.peerId === activeSpeakerId && r.username === m.username
                  )
                : false;
              return (
                <div
                  key={m.id}
                  title={m.username}
                  className={`w-16 h-16 rounded-full bg-slate-700 border-2 ${
                    isSpeaking ? 'border-green-400' : 'border-slate-900'
                  } flex items-center justify-center text-2xl font-medium`}
                >
                  {m.username[0]?.toUpperCase()}
                </div>
              );
            })}
            {otherCount > 4 && (
              <div className="w-16 h-16 rounded-full bg-slate-700 border-2 border-slate-900 flex items-center justify-center text-sm">
                +{otherCount - 4}
              </div>
            )}
          </div>

          {error && <div className="text-red-400 text-sm">{error}</div>}

          <div className="flex gap-3">
            {phase === 'incoming' && (
              <>
                <button
                  onClick={decline}
                  className="w-14 h-14 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center"
                  aria-label="Decline"
                >
                  <PhoneOff className="w-6 h-6" />
                </button>
                <button
                  onClick={accept}
                  className="w-14 h-14 bg-green-600 hover:bg-green-700 rounded-full flex items-center justify-center"
                  aria-label="Accept"
                >
                  <Phone className="w-6 h-6" />
                </button>
              </>
            )}

            {phase === 'calling' && (
              <button
                onClick={cancel}
                className="w-14 h-14 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center"
                aria-label="Cancel"
              >
                <X className="w-6 h-6" />
              </button>
            )}

            {phase === 'in-call' && (
              <>
                <button
                  onClick={toggleMic}
                  className={`w-14 h-14 rounded-full flex items-center justify-center ${
                    micOn ? 'bg-slate-700' : 'bg-red-600'
                  }`}
                  aria-label={micOn ? 'Mute' : 'Unmute'}
                >
                  {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>
                <button
                  onClick={hangup}
                  className="w-14 h-14 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center"
                  aria-label="Hang up"
                >
                  <PhoneOff className="w-6 h-6" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
