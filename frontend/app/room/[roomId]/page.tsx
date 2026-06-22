'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  ScreenShareOff,
  Circle,
  Square,
  PhoneOff,
  MessageSquare,
  X,
  Send,
  Smile,
  Paperclip,
  Image as ImageIcon,
  LayoutGrid,
  Hand,
  MoreHorizontal,
  Users,
  UserX,
  Crown,
  Pencil,
  Check,
  Link2,
  Lock,
  Unlock,
  SmilePlus,
  MoreVertical,
  ShieldCheck,
  SwitchCamera,
  MicOff as MicOffIcon,
  Video as VideoIcon,
  VideoOff as VideoOffIcon,
} from 'lucide-react';
import { RoomClient, type MediaSource } from '@/lib/mediasoupClient';
import { uploadFile, api, type UploadedAttachment } from '@/lib/api';
import {
  createCompositeStream,
  type Composite,
} from '@/lib/recordingComposer';
import VideoTile from '@/components/VideoTile';
import IconButton from '@/components/IconButton';
import ChatMessage from '@/components/ChatMessage';
import LayoutSettingsPanel from '@/components/LayoutSettingsPanel';
import { useRecorder } from '@/hooks/useRecorder';
import { useLayoutSettings } from '@/hooks/useLayoutSettings';
import { useVirtualBackground } from '@/hooks/useVirtualBackground';

// emoji-picker-react has a large dep tree — load only when needed
const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '😮', '🙌', '🔥'];

interface RemoteEntry {
  peerId: string;
  username: string;
  cameraStream?: MediaStream;
  screenStream?: MediaStream;
  producers: Map<string, MediaSource>;
}

interface ChatMsg {
  id: string;
  username: string;
  content: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  attachmentSize?: number | null;
  createdAt: string;
}

export default function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);
  const router = useRouter();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Map<string, RemoteEntry>>(new Map());
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [me, setMe] = useState<{ username: string } | null>(null);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  /** The stream actually sent to mediasoup (may be processed via virtual bg) */
  const [outboundStream, setOutboundStream] = useState<MediaStream | null>(null);
  const { settings, update: updateLayout, togglePin, reset: resetLayout } =
    useLayoutSettings();

  const vbg = useVirtualBackground(localStream, {
    onStreamChange: async (next) => {
      setOutboundStream(next);
      const videoTrack = next.getVideoTracks()[0];
      if (videoTrack && clientRef.current) {
        try {
          await clientRef.current.replaceCameraTrack(videoTrack);
        } catch (e) {
          console.warn('replaceCameraTrack failed', e);
        }
      }
    },
  });

  const [customBg, setCustomBg] = useState<string | null>(null);
  const customBgRef = useRef<string | null>(null);

  // Remote participants' mic/camera state, keyed by peerId (true = on).
  const [peerMic, setPeerMic] = useState<Map<string, boolean>>(new Map());
  const [peerCam, setPeerCam] = useState<Map<string, boolean>>(new Map());
  // Full roster of remote peers (everyone, even before their tracks arrive).
  const [roster, setRoster] = useState<
    Map<string, { username: string; isHost: boolean; isCoHost: boolean }>
  >(new Map());
  const [amHost, setAmHost] = useState(false);
  const [amCoHost, setAmCoHost] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  // Lobby: people waiting for a moderator to admit them (moderator view).
  const [waitingPeers, setWaitingPeers] = useState<
    Map<string, { username: string }>
  >(new Map());
  // True while WE are waiting in the lobby to be admitted.
  const [lobby, setLobby] = useState(false);
  // Pre-join screen (preview + name + mic/cam) shown before requesting to join.
  const [prejoin, setPrejoin] = useState(true);
  const [joining, setJoining] = useState(false);
  // False until we've checked whether we're the host (avoids a pre-join flash).
  const [checkedOwner, setCheckedOwner] = useState(false);
  // True while the socket is dropped and we're trying to reconnect.
  const [reconnecting, setReconnecting] = useState(false);

  // Device selection (mic / camera / speaker).
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState('');
  const [camId, setCamId] = useState('');
  const [speakerId, setSpeakerId] = useState('');
  const [flipping, setFlipping] = useState(false);
  const facingRef = useRef<'user' | 'environment'>('user');
  // Display name shown to others (editable in the lobby and in-meeting).
  const [displayName, setDisplayName] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  // Reactions, lock, and per-peer connection quality.
  const [reactions, setReactions] = useState<
    Array<{ id: number; emoji: string; name: string; left: number }>
  >([]);
  const reactionIdRef = useRef(0);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [peerQuality, setPeerQuality] = useState<Map<string, string>>(new Map());
  const [myQuality, setMyQuality] = useState('good');

  // Meeting duration, PIN, and noise suppression.
  const [meetingStart, setMeetingStart] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [meetingPin, setMeetingPin] = useState(''); // host's current PIN
  const [pinDraft, setPinDraft] = useState('');
  const [hasPin, setHasPin] = useState(false);
  const [joinPin, setJoinPin] = useState(''); // pre-join PIN entry
  const [pinError, setPinError] = useState('');
  const [noiseSuppress, setNoiseSuppress] = useState(true);
  const noiseRef = useRef(true);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const isModerator = amHost || amCoHost;

  const clientRef = useRef<RoomClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // Mirror mic/cam state in refs so the join effect reads the latest lobby choice.
  const micOnRef = useRef(true);
  const camOnRef = useRef(true);
  // Guards against joining twice (auto host-join + manual click / StrictMode).
  const joinStartedRef = useRef(false);
  // Composite recording handle + a live mirror of state for its source getters.
  const compositeRef = useRef<Composite | null>(null);
  const recSrcRef = useRef<any>(null);
  // True when WE (the host) initiated ending the meeting (suppresses our alert).
  const endingRef = useRef(false);
  const chatListRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const recorder = useRecorder();

  const spotlight = useMemo(() => {
    for (const r of remotes.values()) {
      if (r.screenStream) {
        return {
          type: 'remote-screen' as const,
          username: r.username,
          stream: r.screenStream,
        };
      }
    }
    if (localScreenStream) {
      return {
        type: 'local-screen' as const,
        username: me?.username || 'you',
        stream: localScreenStream,
      };
    }
    return null;
  }, [remotes, localScreenStream, me]);

  // Auto-scroll chat when new messages arrive
  useEffect(() => {
    if (chatListRef.current) {
      chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
    }
  }, [messages, chatOpen]);

  // Clear unread when chat opens
  useEffect(() => {
    if (chatOpen) setUnread(0);
  }, [chatOpen]);

  // On mount: auth + acquire camera/mic so the pre-join screen can preview them.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (!token || !userStr) {
      router.replace('/login');
      return;
    }
    const user = JSON.parse(userStr);
    setMe(user);
    setDisplayName((prev) => prev || user.username);

    // Restore saved device choices.
    const savedMic = localStorage.getItem('dev:mic') || '';
    const savedCam = localStorage.getItem('dev:cam') || '';
    setSpeakerId(localStorage.getItem('dev:speaker') || '');
    const ns = localStorage.getItem('dev:noise') !== '0';
    setNoiseSuppress(ns);
    noiseRef.current = ns;

    let mounted = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: savedCam
            ? { deviceId: { ideal: savedCam }, width: 640, height: 360 }
            : { width: 640, height: 360 },
          audio: {
            ...(savedMic ? { deviceId: { ideal: savedMic } } : {}),
            noiseSuppression: ns,
            echoCancellation: true,
            autoGainControl: true,
          },
        });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setLocalStream(stream);
        localStreamRef.current = stream;
        // Reflect the actual devices in use, then enumerate the full list.
        setMicId(stream.getAudioTracks()[0]?.getSettings().deviceId || '');
        setCamId(stream.getVideoTracks()[0]?.getSettings().deviceId || '');
        refreshDevices();

        // The host (room owner) skips the pre-join screen and enters directly.
        try {
          const { room } = await api.getRoom(roomId);
          if (!mounted) return;
          // Host, or a guest already admitted this session (reconnect/reload),
          // skips the pre-join screen and enters directly.
          const wasAdmitted = sessionStorage.getItem(`admitted:${roomId}`);
          if (room?.ownerId === user.id || wasAdmitted) {
            setPrejoin(false);
            handleJoin();
          } else {
            setCheckedOwner(true);
          }
        } catch {
          // Couldn't check ownership — fall back to the pre-join screen.
          if (mounted) setCheckedOwner(true);
        }
      } catch (err: any) {
        setError(err.message || 'Cannot access camera/microphone');
      }
    })();

    // Keep the device list fresh when peripherals are plugged/unplugged.
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);

    return () => {
      mounted = false;
      joinStartedRef.current = false;
      compositeRef.current?.stop();
      compositeRef.current = null;
      navigator.mediaDevices?.removeEventListener?.(
        'devicechange',
        refreshDevices
      );
      clientRef.current?.leave();
      clientRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setMics(list.filter((d) => d.kind === 'audioinput'));
      setCams(list.filter((d) => d.kind === 'videoinput'));
      setSpeakers(list.filter((d) => d.kind === 'audiooutput'));
    } catch {
      /* ignore */
    }
  }

  // Switch microphone input device.
  async function switchMic(deviceId: string) {
    const stream = localStreamRef.current;
    if (!stream) return;
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          noiseSuppression: noiseRef.current,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
      const newTrack = tmp.getAudioTracks()[0];
      newTrack.enabled = micOnRef.current;
      const old = stream.getAudioTracks()[0];
      if (old) {
        stream.removeTrack(old);
        old.stop();
      }
      stream.addTrack(newTrack);
      await clientRef.current?.replaceMicTrack(newTrack);
      setMicId(deviceId);
      localStorage.setItem('dev:mic', deviceId);
      refreshDevices();
    } catch (err: any) {
      setError(err.message || 'Failed to switch microphone');
    }
  }

  // Switch camera input device. Works whether or not virtual background is on:
  // we swap the track inside the same stream, which both the preview and the
  // background processor read from; the producer track is replaced only when
  // there's no processor in between.
  async function switchCamera(deviceId: string) {
    const stream = localStreamRef.current;
    if (!stream) return;
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: 640, height: 360 },
      });
      const newTrack = tmp.getVideoTracks()[0];
      newTrack.enabled = camOnRef.current;
      const old = stream.getVideoTracks()[0];
      if (old) {
        stream.removeTrack(old);
        old.stop();
      }
      stream.addTrack(newTrack);
      if (vbg.mode.kind === 'none') {
        await clientRef.current?.replaceCameraTrack(newTrack);
      }
      setCamId(deviceId);
      localStorage.setItem('dev:cam', deviceId);
      refreshDevices();
    } catch (err: any) {
      setError(err.message || 'Failed to switch camera');
    }
  }

  function selectSpeaker(deviceId: string) {
    setSpeakerId(deviceId);
    localStorage.setItem('dev:speaker', deviceId);
  }

  // Flip between front (user) and back (environment) camera — mobile.
  async function flipCamera() {
    const stream = localStreamRef.current;
    if (!stream || flipping) return;
    const next = facingRef.current === 'environment' ? 'user' : 'environment';
    setFlipping(true);
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: next }, width: 640, height: 360 },
      });
      const newTrack = tmp.getVideoTracks()[0];
      newTrack.enabled = camOnRef.current;
      const old = stream.getVideoTracks()[0];
      if (old) {
        stream.removeTrack(old);
        old.stop();
      }
      stream.addTrack(newTrack);
      if (vbg.mode.kind === 'none') {
        await clientRef.current?.replaceCameraTrack(newTrack);
      }
      facingRef.current = next;
      setCamId(newTrack.getSettings().deviceId || '');
      refreshDevices();
    } catch (err: any) {
      setError(err.message || 'Failed to switch camera');
    } finally {
      setFlipping(false);
    }
  }

  function toggleNoiseSuppress(on: boolean) {
    setNoiseSuppress(on);
    noiseRef.current = on;
    localStorage.setItem('dev:noise', on ? '1' : '0');
    // Apply to the live mic track without re-acquiring it.
    localStreamRef.current
      ?.getAudioTracks()[0]
      ?.applyConstraints({
        noiseSuppression: on,
        echoCancellation: true,
        autoGainControl: true,
      })
      .catch(() => {});
  }

  async function savePin() {
    const res = await clientRef.current?.setPin(pinDraft.trim());
    if (res?.ok) {
      setMeetingPin(res.pin || '');
      setHasPin(!!res.pin);
    }
  }

  function makeHost(peerId: string, name: string) {
    if (confirm(`Make ${name} the host? You will no longer be host.`)) {
      clientRef.current?.transferHost(peerId);
    }
  }

  // Tick the meeting-duration clock once per second.
  useEffect(() => {
    if (!meetingStart) return;
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - meetingStart) / 1000)),
      1000
    );
    setElapsed(Math.floor((Date.now() - meetingStart) / 1000));
    return () => clearInterval(id);
  }, [meetingStart]);

  // Play a short ding (used to alert the host of a lobby request).
  function playDing() {
    try {
      const Ctx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      osc.onended = () => ctx.close();
    } catch {
      /* ignore */
    }
  }

  // Build the room client and request to join. Called from the pre-join screen.
  async function handleJoin() {
    const stream = localStreamRef.current;
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (!stream || !token || !userStr || joinStartedRef.current) return;
    joinStartedRef.current = true;
    const user = JSON.parse(userStr);
    const name = displayName || user.username;
    setJoining(true);

    {
      const client = new RoomClient(token, {
          onPeerLeft: (peerId) => {
            setRemotes((prev) => {
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
            setPeerMic((prev) => {
              if (!prev.has(peerId)) return prev;
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
            setRoster((prev) => {
              if (!prev.has(peerId)) return prev;
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
          },
          onPeerJoined: ({ peerId, username, isHost, isCoHost }) => {
            setRoster((prev) =>
              new Map(prev).set(peerId, {
                username,
                isHost: !!isHost,
                isCoHost: !!isCoHost,
              })
            );
          },
          onMicState: ({ peerId, enabled }) => {
            setPeerMic((prev) => new Map(prev).set(peerId, enabled));
          },
          onCamState: ({ peerId, enabled }) => {
            setPeerCam((prev) => new Map(prev).set(peerId, enabled));
          },
          onForceMic: (enabled) => applyMic(enabled),
          onForceCam: (enabled) => applyCam(enabled),
          onKicked: () => {
            clientRef.current?.markLeaving();
            sessionStorage.removeItem(`admitted:${roomId}`);
            alert('You were removed from the room by the host.');
            router.replace('/dashboard');
          },
          onReaction: ({ emoji, username }) => {
            const id = ++reactionIdRef.current;
            const left = 10 + Math.floor(Math.random() * 80);
            setReactions((prev) => [...prev, { id, emoji, name: username, left }]);
            setTimeout(
              () => setReactions((prev) => prev.filter((r) => r.id !== id)),
              4000
            );
          },
          onLockState: (isLocked) => setLocked(isLocked),
          onPeerQuality: ({ peerId, level }) => {
            setPeerQuality((prev) => new Map(prev).set(peerId, level));
          },
          onPinState: (has) => {
            setHasPin(has);
            if (!has) setMeetingPin('');
          },
          onHostChanged: ({ hostPeerId }) => {
            const myId = clientRef.current?.socket.id;
            setAmHost(hostPeerId === myId);
            if (hostPeerId === myId) setAmCoHost(false);
            // Reflect the new/old host in the roster.
            setRoster((prev) => {
              const next = new Map(prev);
              next.forEach((info, pid) => {
                next.set(pid, {
                  ...info,
                  isHost: pid === hostPeerId,
                  isCoHost: pid === hostPeerId ? false : info.isCoHost,
                });
              });
              return next;
            });
          },
          onMeetingEnded: () => {
            sessionStorage.removeItem(`admitted:${roomId}`);
            if (!endingRef.current) {
              alert('The meeting has been ended by the host.');
            }
            router.replace('/dashboard');
          },
          onDisconnected: () => setReconnecting(true),
          onReconnected: () => {
            // mediasoup state is gone server-side after a drop; reload to rebuild
            // cleanly. We auto-rejoin (host via ownership, guest via the admitted
            // flag), skipping the pre-join screen and the lobby.
            window.location.reload();
          },
          onWaiting: () => {
            setPrejoin(false);
            setLobby(true);
          },
          onCoHostState: ({ peerId, value }) => {
            setRoster((prev) => {
              const entry = prev.get(peerId);
              if (!entry) return prev;
              return new Map(prev).set(peerId, { ...entry, isCoHost: value });
            });
            if (peerId === clientRef.current?.socket.id) {
              setAmCoHost(value);
              if (
                value &&
                typeof Notification !== 'undefined' &&
                Notification.permission === 'default'
              ) {
                Notification.requestPermission().catch(() => {});
              }
            }
          },
          onWaitingPeer: ({ peerId, username }) => {
            setWaitingPeers((prev) => new Map(prev).set(peerId, { username }));
            playDing();
            // Browser notification when the tab isn't focused.
            if (
              typeof Notification !== 'undefined' &&
              Notification.permission === 'granted' &&
              document.hidden
            ) {
              try {
                const n = new Notification('Someone is waiting to join', {
                  body: username,
                });
                n.onclick = () => {
                  window.focus();
                  n.close();
                };
              } catch {
                /* ignore */
              }
            }
          },
          onWaitingPeerLeft: (peerId) => {
            setWaitingPeers((prev) => {
              if (!prev.has(peerId)) return prev;
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
          },
          onWaitingList: (list) => {
            setWaitingPeers(
              new Map(list.map((p) => [p.peerId, { username: p.username }]))
            );
          },
          onNameChange: ({ peerId, name }) => {
            // Panel uses `roster`; video tiles use `remotes` — update both.
            setRoster((prev) => {
              const entry = prev.get(peerId);
              if (!entry) return prev;
              return new Map(prev).set(peerId, { ...entry, username: name });
            });
            setRemotes((prev) => {
              const entry = prev.get(peerId);
              if (!entry) return prev;
              const next = new Map(prev);
              next.set(peerId, { ...entry, username: name });
              return next;
            });
          },
          onRemoteTrack: ({ peerId, username, source, producerId, track }) => {
            setRemotes((prev) => {
              const next = new Map(prev);
              const entry = next.get(peerId) || {
                peerId,
                username,
                producers: new Map<string, MediaSource>(),
              };
              entry.producers.set(producerId, source);

              const isScreen = source === 'screen-video' || source === 'screen-audio';
              const key = isScreen ? 'screenStream' : 'cameraStream';
              const existing = entry[key];
              if (existing) {
                existing.addTrack(track);
              } else {
                entry[key] = new MediaStream([track]);
              }
              next.set(peerId, entry);
              return next;
            });
          },
          onProducerClosed: (producerId, peerId) => {
            setRemotes((prev) => {
              const next = new Map(prev);
              const entry = next.get(peerId);
              if (!entry) return prev;
              const source = entry.producers.get(producerId);
              entry.producers.delete(producerId);

              if (source === 'screen-video' || source === 'screen-audio') {
                entry.screenStream?.getTracks().forEach((t) => t.stop());
                entry.screenStream = undefined;
              }
              next.set(peerId, entry);
              return next;
            });
          },
          onChatMessage: (msg) => {
            setMessages((prev) => [...prev, msg]);
            // Don't increment unread for own messages
            setUnread((u) => (msg.username !== user.username && !chatOpen ? u + 1 : u));
          },
          onHandState: ({ peerId, raised }) => {
            setRaisedHands((prev) => {
              const next = new Set(prev);
              if (raised) next.add(peerId);
              else next.delete(peerId);
              return next;
            });
          },
          onActiveSpeaker: (peerId) => setActiveSpeakerId(peerId),
        });

      clientRef.current = client;
      try {
        const {
          messages: history,
          raisedHands: initialHands,
          peers,
          isHost,
          isCoHost,
          locked: lockedState,
          hasPin: hasPinState,
          pin: pinState,
          startedAt,
          waitingList,
        } = await client.join(roomId, name, joinPin);
        // join() resolves once we're actually in (lobby cleared).
        setPrejoin(false);
        setLobby(false);
        setReconnecting(false);
        setMessages(history || []);
        setAmHost(!!isHost);
        setAmCoHost(!!isCoHost);
        setLocked(!!lockedState);
        setHasPin(!!hasPinState);
        setMeetingPin(pinState || '');
        setPinDraft(pinState || '');
        setMeetingStart(startedAt || Date.now());
        setPinError('');
        // Moderators get desktop notifications for lobby requests.
        if (
          isHost &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'default'
        ) {
          Notification.requestPermission().catch(() => {});
        }
        // Remember admission so a reconnect/reload skips the pre-join + lobby.
        if (!isHost) sessionStorage.setItem(`admitted:${roomId}`, '1');
        if (initialHands?.length) {
          setRaisedHands(new Set(initialHands.map((h: any) => h.peerId)));
        }
        if (waitingList?.length) {
          setWaitingPeers(
            new Map(waitingList.map((p: any) => [p.peerId, { username: p.username }]))
          );
        }
        if (peers?.length) {
          setPeerMic(
            new Map(peers.map((p: any) => [p.peerId, p.micEnabled !== false] as const))
          );
          setPeerCam(
            new Map(peers.map((p: any) => [p.peerId, p.camEnabled !== false] as const))
          );
          setRoster(
            new Map(
              peers.map(
                (p: any) =>
                  [
                    p.peerId,
                    {
                      username: p.username,
                      isHost: !!p.isHost,
                      isCoHost: !!p.isCoHost,
                    },
                  ] as const
              )
            )
          );
        }
        await client.publishCamera(stream);
        // Honor mic/camera choices made on the pre-join screen.
        client.toggleProducer('mic', micOnRef.current);
        client.toggleProducer('camera', camOnRef.current);
      } catch (err: any) {
        clientRef.current = null;
        joinStartedRef.current = false;
        if (err?.message === 'denied') {
          sessionStorage.removeItem(`admitted:${roomId}`);
          alert('The host declined your request to join.');
          router.replace('/dashboard');
          return;
        }
        if (err?.message === 'locked') {
          alert('This meeting is locked by the host.');
          router.replace('/dashboard');
          return;
        }
        if (err?.message === 'pin') {
          setPinError('This meeting requires a PIN. Please enter it to join.');
          setPrejoin(true);
          return;
        }
        console.error(err);
        setError(err.message);
        setLobby(false);
        setPrejoin(true);
      } finally {
        setJoining(false);
      }
    }
  }

  function handleUploadBackground(file: File) {
    if (!file.type.startsWith('image/')) return;
    // Revoke the previous uploaded image so we don't leak object URLs.
    if (customBgRef.current) URL.revokeObjectURL(customBgRef.current);
    const url = URL.createObjectURL(file);
    customBgRef.current = url;
    setCustomBg(url);
    vbg.apply({ kind: 'image', src: url });
  }

  // Release the uploaded background URL when leaving the room.
  useEffect(() => {
    return () => {
      if (customBgRef.current) URL.revokeObjectURL(customBgRef.current);
    };
  }, []);

  function toggleHand() {
    const next = !handRaised;
    setHandRaised(next);
    clientRef.current?.raiseHand(next);
  }

  function applyMic(enabled: boolean) {
    setMicOn(enabled);
    micOnRef.current = enabled;
    clientRef.current?.toggleProducer('mic', enabled);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  function toggleMic() {
    applyMic(!micOn);
  }

  function applyCam(enabled: boolean) {
    setCamOn(enabled);
    camOnRef.current = enabled;
    clientRef.current?.toggleProducer('camera', enabled);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = enabled));
  }

  function toggleCam() {
    applyCam(!camOn);
  }

  function saveName() {
    const n = nameDraft.trim();
    if (n) {
      setDisplayName(n);
      clientRef.current?.setName(n);
    }
    setEditingName(false);
  }

  function sendReaction(emoji: string) {
    clientRef.current?.sendReaction(emoji);
    setReactionsOpen(false);
  }

  function toggleLock() {
    clientRef.current?.setLock(!locked);
  }

  // Poll our send-transport stats and report a coarse connection quality.
  useEffect(() => {
    const id = setInterval(async () => {
      const tp = clientRef.current?.sendTransport;
      if (!tp) return;
      try {
        const stats = await tp.getStats();
        let rtt = 0;
        let loss = 0;
        stats.forEach((r: any) => {
          if (
            r.type === 'candidate-pair' &&
            r.nominated &&
            r.currentRoundTripTime != null
          ) {
            rtt = r.currentRoundTripTime;
          }
          if (r.type === 'remote-inbound-rtp' && r.fractionLost != null) {
            loss = Math.max(loss, r.fractionLost);
          }
        });
        const level =
          loss >= 0.08 || rtt >= 0.5
            ? 'poor'
            : loss >= 0.03 || rtt >= 0.25
              ? 'ok'
              : 'good';
        setMyQuality((prev) => {
          if (prev !== level) clientRef.current?.sendQuality(level);
          return level;
        });
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => clearInterval(id);
  }, []);

  async function copyMeetingLink() {
    const url = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard API blocked (e.g. non-HTTPS) — show the link to copy manually.
      window.prompt('Copy this meeting link:', url);
    }
  }

  async function toggleScreenShare() {
    if (!clientRef.current) return;
    try {
      if (sharingScreen) {
        await clientRef.current.stopScreenShare();
        localScreenStream?.getTracks().forEach((t) => t.stop());
        setLocalScreenStream(null);
        setSharingScreen(false);
      } else {
        const stream = await clientRef.current.startScreenShare();
        setLocalScreenStream(stream);
        setSharingScreen(true);
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          setLocalScreenStream(null);
          setSharingScreen(false);
        });
      }
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        setError(err.message);
      }
    }
  }

  function leave() {
    // Host leaving ends the meeting for everyone; others just leave themselves.
    if (amHost) {
      if (!confirm('End the meeting for everyone?')) return;
      endingRef.current = true;
      clientRef.current?.endMeeting();
    }
    recorder.stop();
    compositeRef.current?.stop();
    compositeRef.current = null;
    // Intentional leave: forget admission so next time we go through the lobby.
    sessionStorage.removeItem(`admitted:${roomId}`);
    clientRef.current?.leave();
    localStream?.getTracks().forEach((t) => t.stop());
    localScreenStream?.getTracks().forEach((t) => t.stop());
    router.push('/dashboard');
  }

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text && !pendingFile) return;
    if (uploading) return;

    let attachment: UploadedAttachment | undefined;
    if (pendingFile) {
      try {
        setUploading(true);
        setUploadProgress(0);
        attachment = await uploadFile(pendingFile, (p) => setUploadProgress(p));
      } catch (err: any) {
        setError(err.message || 'Upload failed');
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    clientRef.current?.sendChat(text, attachment);
    setChatInput('');
    setPendingFile(null);
    setUploadProgress(0);
    setEmojiOpen(false);
  }

  useEffect(() => {
    const el = chatInputRef.current;
    if (!el) return;
    const resize = () => {
      el.style.height = 'auto';
      const full = el.scrollHeight;
      el.style.height = Math.min(full, 128) + 'px';
      // Only show a scrollbar once we actually hit the max height — otherwise
      // sub-pixel rounding makes one line overflow and a scrollbar flickers in.
      el.style.overflowY = full > 128 ? 'auto' : 'hidden';
    };
    resize();
    const raf = requestAnimationFrame(resize);
    // The chat panel animates its width open from 0 (md:w-0 -> md:w-80). A one-off
    // measurement taken while it's collapsed/animating gets the wrong scrollHeight
    // and sticks. A ResizeObserver re-measures throughout the animation until the
    // panel reaches its final width, so the height is always correct.
    const ro = new ResizeObserver(() => {
      ro.disconnect(); // avoid observing our own height mutation
      resize();
      ro.observe(el);
    });
    ro.observe(el);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [chatInput]);

  function insertEmoji(emoji: string) {
    const el = chatInputRef.current;
    if (!el) {
      setChatInput((v) => v + emoji);
      return;
    }
    const start = el.selectionStart ?? chatInput.length;
    const end = el.selectionEnd ?? chatInput.length;
    const next = chatInput.slice(0, start) + emoji + chatInput.slice(end);
    setChatInput(next);
    // restore cursor after the inserted emoji on next tick
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const MAX = 25 * 1024 * 1024;
    if (file.size > MAX) {
      setError(`File too large (max ${MAX / 1024 / 1024} MB)`);
      return;
    }
    setPendingFile(file);
    setEmojiOpen(false);
  }

  // Keep a live snapshot of state for the recording composer's getters.
  useEffect(() => {
    recSrcRef.current = {
      localStream,
      outboundStream,
      localScreenStream,
      remotes,
      me,
      displayName,
    };
  });

  function toggleRecording() {
    if (recorder.recording) {
      recorder.stop();
      compositeRef.current?.stop();
      compositeRef.current = null;
      return;
    }
    if (!localStreamRef.current) {
      setError('No stream available to record');
      return;
    }
    // Composite everyone (cameras + screen share) + mixed audio.
    const composite = createCompositeStream({
      getVideoSources: () => {
        const r = recSrcRef.current;
        if (!r) return [];
        const sources: any[] = [];
        const myName = r.displayName || r.me?.username || 'You';
        if (r.localScreenStream)
          sources.push({
            stream: r.localScreenStream,
            isScreen: true,
            label: `${myName} (screen)`,
          });
        for (const p of r.remotes.values())
          if (p.screenStream)
            sources.push({
              stream: p.screenStream,
              isScreen: true,
              label: `${p.username} (screen)`,
            });
        sources.push({
          stream: r.outboundStream || r.localStream,
          label: `${myName} (you)`,
        });
        for (const p of r.remotes.values())
          if (p.cameraStream)
            sources.push({ stream: p.cameraStream, label: p.username });
        return sources;
      },
      getAudioStreams: () => {
        const r = recSrcRef.current;
        if (!r) return [];
        const arr: MediaStream[] = [];
        if (r.localStream) arr.push(r.localStream);
        for (const p of r.remotes.values()) {
          if (p.cameraStream) arr.push(p.cameraStream);
          if (p.screenStream) arr.push(p.screenStream);
        }
        return arr;
      },
    });
    compositeRef.current = composite;
    recorder.start(composite.stream, `room-${roomId.slice(0, 8)}.webm`);
  }

  const remoteList = Array.from(remotes.values());

  // Build list of camera tiles (self + remotes), respecting showSelf setting
  const cameraTiles = useMemo(() => {
    const tiles: Array<{
      key: string;
      stream: MediaStream | null;
      username: string;
      isLocal: boolean;
      peerId: string | null;
    }> = [];
    if (settings.showSelf && me) {
      tiles.push({
        key: 'self',
        stream: outboundStream || localStream,
        username: displayName || me.username,
        isLocal: true,
        peerId: null,
      });
    }
    for (const r of remoteList) {
      tiles.push({
        key: r.peerId,
        stream: r.cameraStream || null,
        username: r.username,
        isLocal: false,
        peerId: r.peerId,
      });
    }
    return tiles;
  }, [settings.showSelf, me, displayName, localStream, outboundStream, remoteList]);

  // Determine main tile (used by spotlight/sidebar modes)
  // Priority: pinned > active speaker (remote) > first remote > self
  const mainTile = useMemo(() => {
    if (settings.mode === 'grid') return null;
    if (settings.pinnedPeerId) {
      const pinned = cameraTiles.find((t) => t.peerId === settings.pinnedPeerId);
      if (pinned) return pinned;
    }
    if (activeSpeakerId) {
      const speaker = cameraTiles.find((t) => t.peerId === activeSpeakerId);
      if (speaker) return speaker;
    }
    const firstRemote = cameraTiles.find((t) => !t.isLocal);
    return firstRemote || cameraTiles[0] || null;
  }, [settings.mode, settings.pinnedPeerId, activeSpeakerId, cameraTiles]);

  const thumbnailTiles = useMemo(() => {
    if (!mainTile) return cameraTiles;
    return cameraTiles.filter((t) => t.key !== mainTile.key);
  }, [cameraTiles, mainTile]);

  function renderTile(
    t: (typeof cameraTiles)[number],
    opts: { thumb?: boolean } = {}
  ) {
    const isHandRaised = t.isLocal
      ? handRaised
      : !!(t.peerId && raisedHands.has(t.peerId));
    const isSpeaking = !!(t.peerId && activeSpeakerId === t.peerId);
    const tileMicOn = t.isLocal
      ? micOn
      : t.peerId
        ? peerMic.get(t.peerId) ?? true
        : undefined;
    const tileCamOn = t.isLocal
      ? camOn
      : t.peerId
        ? peerCam.get(t.peerId) ?? true
        : undefined;
    return (
      <VideoTile
        key={t.key}
        stream={t.stream}
        username={t.username}
        isLocal={t.isLocal}
        mirror={t.isLocal && settings.mirrorSelf}
        showName={settings.showNames}
        pinned={!!t.peerId && settings.pinnedPeerId === t.peerId}
        handRaised={isHandRaised}
        isSpeaking={isSpeaking}
        micOn={tileMicOn}
        camOn={tileCamOn}
        speakerId={speakerId}
        quality={
          t.isLocal ? myQuality : t.peerId ? peerQuality.get(t.peerId) : undefined
        }
        onFlipCamera={
          t.isLocal && cams.length > 1 ? flipCamera : undefined
        }
        onTogglePin={t.peerId ? () => togglePin(t.peerId!) : undefined}
        thumb={opts.thumb}
      />
    );
  }

  // Brief neutral loading while we check ownership (host skips pre-join entirely).
  if (prejoin && !checkedOwner) {
    return (
      <main className="h-screen flex flex-col items-center justify-center gap-3 bg-slate-950 text-slate-400">
        <span className="w-6 h-6 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-sm">Connecting…</span>
      </main>
    );
  }

  // Pre-join screen (preview + controls + Join), then the waiting screen.
  if (prejoin || lobby) {
    return (
      <main className="h-screen flex flex-col items-center justify-center gap-5 bg-slate-950 p-6 text-center">
        <div className="relative w-full max-w-sm aspect-video bg-black rounded-lg overflow-hidden">
          <VideoTile
            stream={localStream}
            username={displayName || 'You'}
            isLocal
            mirror={settings.mirrorSelf}
            showName={false}
          />
          {!camOn && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-slate-400 text-sm">
              Camera is off
            </div>
          )}
          {/* Mic / camera toggles over the preview */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2">
            <button
              onClick={toggleMic}
              title={micOn ? 'Mute' : 'Unmute'}
              className={`p-2.5 rounded-full ${
                micOn ? 'bg-slate-700/80 hover:bg-slate-600' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>
            <button
              onClick={toggleCam}
              title={camOn ? 'Turn camera off' : 'Turn camera on'}
              className={`p-2.5 rounded-full ${
                camOn ? 'bg-slate-700/80 hover:bg-slate-600' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Editable display name */}
        <div className="w-full max-w-sm text-left">
          <label className="block text-xs text-slate-400 mb-1">Your name</label>
          <input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              if (lobby) clientRef.current?.setLobbyName(e.target.value);
            }}
            maxLength={40}
            placeholder="Your name"
            className="w-full px-3 py-2 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Device pickers */}
        <div className="w-full max-w-sm space-y-2 text-left">
          <PreJoinDevice
            label="Microphone"
            value={micId}
            options={mics}
            onChange={switchMic}
          />
          <PreJoinDevice
            label="Camera"
            value={camId}
            options={cams}
            onChange={switchCamera}
          />
          {typeof window !== 'undefined' &&
            'setSinkId' in HTMLMediaElement.prototype &&
            speakers.length > 0 && (
              <PreJoinDevice
                label="Speaker"
                value={speakerId}
                options={speakers}
                onChange={selectSpeaker}
              />
            )}
        </div>

        {prejoin && (
          <div className="w-full max-w-sm text-left">
            <label className="block text-xs text-slate-400 mb-1">
              Meeting PIN (if required)
            </label>
            <input
              value={joinPin}
              onChange={(e) => {
                setJoinPin(e.target.value);
                setPinError('');
              }}
              placeholder="Enter PIN"
              maxLength={10}
              className="w-full px-3 py-2 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            {pinError && (
              <p className="text-amber-400 text-xs mt-1">{pinError}</p>
            )}
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm max-w-sm">{error}</p>
        )}

        {prejoin ? (
          <>
            <h1 className="text-lg font-semibold">Ready to join?</h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.replace('/dashboard')}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleJoin}
                disabled={!localStream || joining}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
              >
                {joining ? 'Joining…' : 'Join'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-lg font-semibold">Waiting to be admitted</h1>
              <p className="text-slate-400 text-sm mt-1">
                The host will let you in shortly…
              </p>
            </div>
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              Waiting for host
            </div>
            <button
              onClick={() => router.replace('/dashboard')}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm"
            >
              Cancel
            </button>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col bg-slate-950">
      {/* Floating emoji reactions */}
      <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
        {reactions.map((r) => (
          <div
            key={r.id}
            className="absolute bottom-24 flex flex-col items-center animate-[floatUp_4s_ease-out_forwards]"
            style={{ left: `${r.left}%` }}
          >
            <span className="text-4xl">{r.emoji}</span>
            <span className="text-[10px] text-white/90 bg-black/50 px-1.5 rounded mt-0.5 whitespace-nowrap">
              {r.name}
            </span>
          </div>
        ))}
      </div>

      {/* Reaction picker */}
      {reactionsOpen && (
        <>
          <div
            onClick={() => setReactionsOpen(false)}
            className="fixed inset-0 z-40"
            aria-hidden
          />
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex gap-1.5 bg-slate-800 border border-slate-700 rounded-full px-3 py-2 shadow-2xl">
            {REACTION_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => sendReaction(e)}
                className="text-2xl hover:scale-125 transition-transform"
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Reconnecting overlay when the network drops */}
      {reconnecting && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-slate-950/80 backdrop-blur-sm">
          <span className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
          <div className="text-slate-200 font-medium">Reconnecting…</div>
          <p className="text-slate-400 text-sm">Check your internet connection</p>
          <button
            onClick={leave}
            className="mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm"
          >
            Leave
          </button>
        </div>
      )}

      {/* Host popup: someone is waiting in the lobby (shown even if People is closed) */}
      {isModerator && !participantsOpen && waitingPeers.size > 0 && (
        <div className="fixed top-4 right-4 z-50 w-72 max-w-[calc(100vw-2rem)] bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
          <div className="px-3 py-2 text-sm font-medium border-b border-slate-700 flex items-center gap-2">
            <Users className="w-4 h-4" />
            <span className="flex-1">Waiting to join ({waitingPeers.size})</span>
            {waitingPeers.size > 1 && (
              <button
                onClick={() => clientRef.current?.admitAll()}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Admit all
              </button>
            )}
          </div>
          <div className="max-h-60 overflow-y-auto p-2 space-y-1">
            {Array.from(waitingPeers.entries()).map(([peerId, info]) => (
              <div key={peerId} className="flex items-center gap-2 px-1 py-1">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {info.username}
                </span>
                <button
                  onClick={() => clientRef.current?.admitPeer(peerId)}
                  className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
                >
                  Admit
                </button>
                <button
                  onClick={() => clientRef.current?.denyPeer(peerId)}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-red-600/40 rounded"
                >
                  Deny
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="px-3 sm:px-6 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="font-semibold text-sm sm:text-base truncate">
            Room {roomId.slice(0, 8)}
          </div>
          {locked && (
            <span
              className="flex items-center gap-1 text-xs text-amber-300 shrink-0"
              title="Meeting is locked"
            >
              <Lock className="w-3.5 h-3.5" />
            </span>
          )}
          {meetingStart > 0 && (
            <span
              className="text-xs text-slate-400 shrink-0 tabular-nums"
              title="Meeting duration"
            >
              {formatDuration(elapsed)}
            </span>
          )}
          {recorder.recording && (
            <span className="flex items-center gap-1.5 text-xs text-red-400 shrink-0">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              {formatTime(recorder.elapsed)}
            </span>
          )}
        </div>
        <div className="text-xs sm:text-sm text-slate-400 truncate ml-2">
          {me?.username}
        </div>
      </header>

      {error && (
        <div className="bg-red-900/40 text-red-200 px-4 py-2 text-sm shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {/* Video area */}
        <section className="flex-1 p-2 sm:p-4 overflow-y-auto">
          {/* Screen share always takes top spotlight when active */}
          {spotlight ? (
            <div className="flex flex-col gap-3 h-full">
              <div className="w-full">
                <VideoTile
                  stream={spotlight.stream}
                  username={spotlight.username}
                  isScreen
                  isLocal={spotlight.type === 'local-screen'}
                  label={`${spotlight.username} is presenting`}
                  speakerId={speakerId}
                  zoomable
                />
              </div>
              <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                {cameraTiles.map((t) => renderTile(t, { thumb: true }))}
              </div>
            </div>
          ) : settings.mode === 'grid' ? (
            <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {cameraTiles.map((t) => renderTile(t))}
            </div>
          ) : settings.mode === 'spotlight' ? (
            <div className="flex flex-col gap-3 h-full">
              {mainTile && (
                <div className="w-full flex-1 min-h-0">{renderTile(mainTile)}</div>
              )}
              {thumbnailTiles.length > 0 && (
                <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 shrink-0">
                  {thumbnailTiles.map((t) => renderTile(t, { thumb: true }))}
                </div>
              )}
            </div>
          ) : (
            // sidebar mode
            <div className="flex flex-col md:flex-row gap-3 h-full">
              {mainTile && (
                <div className="flex-1 min-w-0">{renderTile(mainTile)}</div>
              )}
              {thumbnailTiles.length > 0 && (
                <div className="md:w-48 lg:w-56 shrink-0 grid grid-cols-3 md:grid-cols-1 gap-2 overflow-y-auto">
                  {thumbnailTiles.map((t) => renderTile(t, { thumb: true }))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Chat: sidebar on desktop (collapsible), drawer on mobile */}
        <aside
          className={`
            bg-slate-900 border-slate-800 flex flex-col
            transition-all duration-200
            fixed inset-y-0 right-0 z-30 w-full max-w-sm
            md:static md:max-w-none md:inset-auto md:z-auto
            ${
              chatOpen
                ? 'translate-x-0 md:w-80 border-l'
                : 'translate-x-full md:translate-x-0 md:w-0 md:border-l-0 md:overflow-hidden'
            }
          `}
        >
          <div className="px-4 py-3 border-b border-slate-800 font-medium flex items-center justify-between">
            <span>Chat</span>
            <button
              onClick={() => setChatOpen(false)}
              className="text-slate-400 hover:text-slate-100"
              aria-label="Close chat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div
            ref={chatListRef}
            className="flex-1 overflow-y-auto p-3 space-y-3 text-sm"
          >
            {messages.length === 0 ? (
              <div className="text-slate-500 text-center py-8">No messages yet</div>
            ) : (
              messages.map((m) => <ChatMessage key={m.id} message={m} />)
            )}
          </div>

          {/* Attachment preview */}
          {pendingFile && (
            <div className="px-3 py-2 border-t border-slate-800 bg-slate-800/50">
              <div className="flex items-center gap-2">
                {pendingFile.type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={URL.createObjectURL(pendingFile)}
                    alt={pendingFile.name}
                    className="w-12 h-12 rounded object-cover"
                  />
                ) : (
                  <Paperclip className="w-5 h-5 text-slate-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-100 truncate">
                    {pendingFile.name}
                  </div>
                  <div className="text-xs text-slate-400">
                    {(pendingFile.size / 1024).toFixed(0)} KB
                    {uploading && ` • Uploading ${uploadProgress}%`}
                  </div>
                </div>
                {!uploading && (
                  <button
                    onClick={() => setPendingFile(null)}
                    aria-label="Remove attachment"
                    className="text-slate-400 hover:text-slate-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {uploading && (
                <div className="mt-1.5 h-1 bg-slate-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Emoji picker popover */}
          {emojiOpen && (
            <div className="border-t border-slate-800">
              <EmojiPicker
                width="100%"
                height={320}
                theme={'dark' as any}
                onEmojiClick={(e: any) => insertEmoji(e.emoji)}
                lazyLoadEmojis
              />
            </div>
          )}

          <form
            onSubmit={sendChat}
            className="p-2 border-t border-slate-800 flex items-end gap-1"
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={onPickFile}
              className="hidden"
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={onPickFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              aria-label="Send image"
              title="Send image"
              className="p-2 text-slate-400 hover:text-slate-100 rounded"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach file"
              title="Attach file"
              className="p-2 text-slate-400 hover:text-slate-100 rounded"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              aria-label="Emoji"
              title="Emoji"
              className={`p-2 rounded ${
                emojiOpen ? 'text-blue-400' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Smile className="w-5 h-5" />
            </button>
            <textarea
              ref={chatInputRef}
              placeholder="Type a message..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                // On touch devices (no Shift+Enter) let Enter insert a newline;
                // sending is done via the send button instead.
                const isTouch =
                  typeof window !== 'undefined' &&
                  window.matchMedia?.('(pointer: coarse)').matches;
                if (
                  !isTouch &&
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  sendChat(e as any);
                }
              }}
              rows={1}
              className="flex-1 min-w-0 px-3 py-2 bg-slate-800 rounded text-sm leading-5 outline-none focus:ring-1 focus:ring-blue-500 resize-none max-h-32"
            />
            <button
              type="submit"
              disabled={uploading || (!chatInput.trim() && !pendingFile)}
              aria-label="Send message"
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </aside>

        {/* Backdrop when drawer open on mobile */}
        {chatOpen && (
          <div
            onClick={() => setChatOpen(false)}
            className="md:hidden fixed inset-0 bg-black/50 z-20"
            aria-hidden
          />
        )}

        {/* Participants: sidebar on desktop (collapsible), drawer on mobile */}
        <aside
          className={`
            bg-slate-900 border-slate-800 flex flex-col
            transition-all duration-200
            fixed inset-y-0 right-0 z-30 w-full max-w-sm
            md:static md:max-w-none md:inset-auto md:z-auto
            ${
              participantsOpen
                ? 'translate-x-0 md:w-80 border-l'
                : 'translate-x-full md:translate-x-0 md:w-0 md:border-l-0 md:overflow-hidden'
            }
          `}
        >
          <div className="px-4 py-3 border-b border-slate-800 font-medium flex items-center justify-between">
            <span>Participants ({roster.size + 1})</span>
            <button
              onClick={() => setParticipantsOpen(false)}
              className="text-slate-400 hover:text-slate-100"
              aria-label="Close participants"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Lobby: people waiting for admission (moderators only) */}
          {isModerator && waitingPeers.size > 0 && (
            <div className="border-b border-slate-800">
              <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  Waiting to join ({waitingPeers.size})
                </span>
                {waitingPeers.size > 1 && (
                  <button
                    onClick={() => clientRef.current?.admitAll()}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Admit all
                  </button>
                )}
              </div>
              <div className="px-2 pb-2 space-y-1">
                {Array.from(waitingPeers.entries()).map(([peerId, info]) => (
                  <div
                    key={peerId}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-slate-800/50"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold uppercase shrink-0">
                      {info.username.charAt(0)}
                    </div>
                    <span className="min-w-0 flex-1 truncate">{info.username}</span>
                    <button
                      onClick={() => clientRef.current?.admitPeer(peerId)}
                      className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
                    >
                      Admit
                    </button>
                    <button
                      onClick={() => clientRef.current?.denyPeer(peerId)}
                      className="px-2 py-1 text-xs bg-slate-700 hover:bg-red-600/40 rounded"
                    >
                      Deny
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(isModerator || amHost) && (
            <div className="px-3 py-2 border-b border-slate-800 space-y-2">
              {isModerator && roster.size > 0 && (
                <button
                  onClick={() => clientRef.current?.hostMuteAll()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 rounded"
                >
                  <MicOffIcon className="w-4 h-4" /> Mute all
                </button>
              )}
              {amHost && (
                <button
                  onClick={toggleLock}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded ${
                    locked
                      ? 'bg-amber-600/30 text-amber-300 hover:bg-amber-600/40'
                      : 'bg-slate-800 hover:bg-slate-700'
                  }`}
                >
                  {locked ? (
                    <>
                      <Unlock className="w-4 h-4" /> Unlock meeting
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" /> Lock meeting
                    </>
                  )}
                </button>
              )}
              {amHost && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      value={pinDraft}
                      onChange={(e) => setPinDraft(e.target.value)}
                      placeholder="Meeting PIN (optional)"
                      maxLength={10}
                      className="flex-1 min-w-0 px-3 py-2 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={savePin}
                      className="px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 rounded shrink-0"
                    >
                      Save
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {hasPin
                      ? 'PIN active — guests with the PIN skip the lobby. Clear + Save to disable.'
                      : 'Set a PIN to let guests join directly (bypasses the lobby).'}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-1 text-sm">
            {/* Self (with inline rename) */}
            {editingName ? (
              <div className="flex items-center gap-1 px-2 py-1.5">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  autoFocus
                  maxLength={40}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  className="min-w-0 flex-1 px-2 py-1 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={saveName}
                  title="Save"
                  className="p-1.5 rounded bg-blue-600 hover:bg-blue-700 shrink-0"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  title="Cancel"
                  className="p-1.5 rounded hover:bg-slate-700 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <ParticipantRow
                name={`${displayName || me?.username || 'You'} (you)`}
                isHost={amHost}
                isCoHost={amCoHost}
                micOn={micOn}
                camOn={camOn}
                onRename={() => {
                  setNameDraft(displayName || me?.username || '');
                  setEditingName(true);
                }}
              />
            )}
            {/* Remote participants */}
            {Array.from(roster.entries()).map(([peerId, info]) => {
              const pMic = peerMic.get(peerId) ?? true;
              const pCam = peerCam.get(peerId) ?? true;
              return (
                <ParticipantRow
                  key={peerId}
                  name={info.username}
                  isHost={info.isHost}
                  isCoHost={info.isCoHost}
                  micOn={pMic}
                  camOn={pCam}
                  onToggleMute={
                    isModerator
                      ? () => clientRef.current?.hostMute(peerId, !pMic)
                      : undefined
                  }
                  onToggleCam={
                    isModerator
                      ? () => clientRef.current?.hostCam(peerId, !pCam)
                      : undefined
                  }
                  onToggleCoHost={
                    amHost && !info.isHost
                      ? () =>
                          clientRef.current?.hostSetCoHost(peerId, !info.isCoHost)
                      : undefined
                  }
                  onMakeHost={
                    amHost && !info.isHost
                      ? () => makeHost(peerId, info.username)
                      : undefined
                  }
                  onKick={
                    isModerator
                      ? () => {
                          if (confirm(`Remove ${info.username} from the room?`)) {
                            clientRef.current?.hostKick(peerId);
                          }
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>

          {/* Copy meeting link */}
          <div className="p-3 border-t border-slate-800">
            <button
              onClick={copyMeetingLink}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 rounded"
            >
              {linkCopied ? (
                <>
                  <Check className="w-4 h-4 text-green-400" /> Link copied
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4" /> Copy meeting link
                </>
              )}
            </button>
          </div>
        </aside>

        {participantsOpen && (
          <div
            onClick={() => setParticipantsOpen(false)}
            className="md:hidden fixed inset-0 bg-black/50 z-20"
            aria-hidden
          />
        )}
      </div>

      {/* Footer controls */}
      <footer className="px-2 sm:px-6 py-3 bg-slate-900 border-t border-slate-800 shrink-0">
        <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
          <IconButton
            icon={micOn ? Mic : MicOff}
            label={micOn ? 'Mute' : 'Unmute'}
            onClick={toggleMic}
            warningState={!micOn}
          />
          <IconButton
            icon={camOn ? Video : VideoOff}
            label={camOn ? 'Camera off' : 'Camera on'}
            onClick={toggleCam}
            warningState={!camOn}
          />
          <IconButton
            icon={Hand}
            label={handRaised ? 'Lower hand' : 'Raise hand'}
            onClick={toggleHand}
            active={handRaised}
          />

          {/* Desktop: show Share/Record/Chat/Layout inline */}
          <div className="hidden sm:contents">
            <IconButton
              icon={sharingScreen ? ScreenShareOff : ScreenShare}
              label={sharingScreen ? 'Stop share' : 'Share'}
              onClick={toggleScreenShare}
              active={sharingScreen}
            />
            <IconButton
              icon={recorder.recording ? Square : Circle}
              label={recorder.recording ? 'Stop rec' : 'Record'}
              onClick={toggleRecording}
              warningState={recorder.recording}
            />
            <div className="relative">
              <IconButton
                icon={MessageSquare}
                label="Chat"
                onClick={() => {
                  setChatOpen((v) => !v);
                  setParticipantsOpen(false);
                }}
                active={chatOpen}
              />
              {unread > 0 && !chatOpen && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center pointer-events-none">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </div>
            <IconButton
              icon={SmilePlus}
              label="React"
              onClick={() => setReactionsOpen((v) => !v)}
              active={reactionsOpen}
            />
            <IconButton
              icon={Users}
              label="People"
              onClick={() => {
                setParticipantsOpen((v) => !v);
                setChatOpen(false);
              }}
              active={participantsOpen}
            />
            <IconButton
              icon={LayoutGrid}
              label="Layout"
              onClick={() => setSettingsOpen(true)}
              active={settingsOpen}
            />
          </div>

          {/* Mobile: single "More" button opening a popover with the rest */}
          <div className="relative sm:hidden">
            <IconButton
              icon={MoreHorizontal}
              label="More"
              onClick={() => setMoreOpen((v) => !v)}
              active={moreOpen}
            />
            {unread > 0 && !chatOpen && !moreOpen && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center pointer-events-none">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
            {moreOpen && (
              <>
                <div
                  onClick={() => setMoreOpen(false)}
                  className="fixed inset-0 z-20"
                  aria-hidden
                />
                <div className="absolute bottom-full right-0 mb-2 z-30 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[180px]">
                  <MenuItem
                    icon={sharingScreen ? ScreenShareOff : ScreenShare}
                    label={sharingScreen ? 'Stop sharing' : 'Share screen'}
                    active={sharingScreen}
                    onClick={() => {
                      toggleScreenShare();
                      setMoreOpen(false);
                    }}
                  />
                  <MenuItem
                    icon={recorder.recording ? Square : Circle}
                    label={recorder.recording ? 'Stop recording' : 'Record'}
                    active={recorder.recording}
                    onClick={() => {
                      toggleRecording();
                      setMoreOpen(false);
                    }}
                  />
                  <MenuItem
                    icon={MessageSquare}
                    label="Chat"
                    active={chatOpen}
                    badge={unread > 0 && !chatOpen ? (unread > 9 ? '9+' : String(unread)) : undefined}
                    onClick={() => {
                      setChatOpen(true);
                      setParticipantsOpen(false);
                      setMoreOpen(false);
                    }}
                  />
                  <MenuItem
                    icon={SmilePlus}
                    label="React"
                    active={reactionsOpen}
                    onClick={() => {
                      setReactionsOpen(true);
                      setMoreOpen(false);
                    }}
                  />
                  {cams.length > 1 && (
                    <MenuItem
                      icon={SwitchCamera}
                      label="Flip camera"
                      onClick={() => {
                        flipCamera();
                        setMoreOpen(false);
                      }}
                    />
                  )}
                  <MenuItem
                    icon={Users}
                    label="Participants"
                    active={participantsOpen}
                    onClick={() => {
                      setParticipantsOpen(true);
                      setChatOpen(false);
                      setMoreOpen(false);
                    }}
                  />
                  <MenuItem
                    icon={LayoutGrid}
                    label="Layout"
                    active={settingsOpen}
                    onClick={() => {
                      setSettingsOpen(true);
                      setMoreOpen(false);
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <IconButton
            icon={PhoneOff}
            label="Leave"
            onClick={leave}
            danger
          />
        </div>
      </footer>

      <LayoutSettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={updateLayout}
        onReset={resetLayout}
        bgMode={vbg.mode}
        onBgChange={vbg.apply}
        bgLoading={vbg.loading}
        bgError={vbg.error}
        customBg={customBg}
        onUploadBackground={handleUploadBackground}
        devices={{
          mics,
          cams,
          speakers,
          micId,
          camId,
          speakerId,
          onMic: switchMic,
          onCam: switchCamera,
          onSpeaker: selectSpeaker,
          noiseSuppress,
          onNoise: toggleNoiseSuppress,
        }}
      />
    </main>
  );
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function formatDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function PreJoinDevice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: MediaDeviceInfo[];
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
      >
        {options.length === 0 && <option value="">{label}</option>}
        {options.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function ParticipantRow({
  name,
  isHost,
  isCoHost,
  micOn,
  camOn,
  onToggleMute,
  onToggleCam,
  onToggleCoHost,
  onMakeHost,
  onKick,
  onRename,
}: {
  name: string;
  isHost?: boolean;
  isCoHost?: boolean;
  micOn: boolean;
  camOn: boolean;
  onToggleMute?: () => void;
  onToggleCam?: () => void;
  onToggleCoHost?: () => void;
  onMakeHost?: () => void;
  onKick?: () => void;
  onRename?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-slate-800/60">
      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold uppercase shrink-0">
        {name.charAt(0)}
      </div>
      <div className="min-w-0 flex-1 flex items-center gap-1.5">
        <span className="truncate">{name}</span>
        {isHost ? (
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-600/30 text-blue-300 rounded shrink-0">
            Host
          </span>
        ) : isCoHost ? (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-600/30 text-amber-300 rounded shrink-0">
            Co-host
          </span>
        ) : null}
      </div>

      {/* Rename yourself */}
      {onRename && (
        <button
          onClick={onRename}
          title="Rename"
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 shrink-0"
        >
          <Pencil className="w-4 h-4" />
        </button>
      )}

      {/* Mic status — clickable toggle for moderators */}
      {onToggleMute ? (
        <button
          onClick={onToggleMute}
          title={micOn ? 'Mute participant' : 'Unmute participant'}
          className="p-1.5 rounded hover:bg-slate-700 shrink-0"
        >
          {micOn ? (
            <Mic className="w-4 h-4 text-slate-300" />
          ) : (
            <MicOffIcon className="w-4 h-4 text-red-400" />
          )}
        </button>
      ) : (
        <span className="p-1.5 shrink-0" title={micOn ? 'Unmuted' : 'Muted'}>
          {micOn ? (
            <Mic className="w-4 h-4 text-slate-400" />
          ) : (
            <MicOffIcon className="w-4 h-4 text-red-400" />
          )}
        </span>
      )}

      {/* Camera status — clickable toggle for moderators */}
      {onToggleCam ? (
        <button
          onClick={onToggleCam}
          title={camOn ? 'Turn off camera' : 'Turn on camera'}
          className="p-1.5 rounded hover:bg-slate-700 shrink-0"
        >
          {camOn ? (
            <VideoIcon className="w-4 h-4 text-slate-300" />
          ) : (
            <VideoOffIcon className="w-4 h-4 text-red-400" />
          )}
        </button>
      ) : (
        <span className="p-1.5 shrink-0" title={camOn ? 'Camera on' : 'Camera off'}>
          {camOn ? (
            <VideoIcon className="w-4 h-4 text-slate-400" />
          ) : (
            <VideoOffIcon className="w-4 h-4 text-red-400" />
          )}
        </span>
      )}

      {/* Role actions menu (host only): make host / co-host */}
      {(onToggleCoHost || onMakeHost) && (
        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="More actions"
            className="p-1.5 rounded hover:bg-slate-700 text-slate-400"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {menuOpen && (
            <>
              <div
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-30"
                aria-hidden
              />
              <div className="absolute right-0 top-full mt-1 z-40 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[160px]">
                {onMakeHost && (
                  <button
                    onClick={() => {
                      onMakeHost();
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-700"
                  >
                    <ShieldCheck className="w-4 h-4" /> Make host
                  </button>
                )}
                {onToggleCoHost && (
                  <button
                    onClick={() => {
                      onToggleCoHost();
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-700"
                  >
                    <Crown className="w-4 h-4" />
                    {isCoHost ? 'Remove co-host' : 'Make co-host'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {onKick && (
        <button
          onClick={onKick}
          title="Remove from room"
          className="p-1.5 rounded hover:bg-red-600/30 text-red-400 shrink-0"
        >
          <UserX className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  active,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  active?: boolean;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-700 transition-colors ${
        active ? 'text-blue-400' : 'text-slate-200'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 min-w-[20px] h-5 flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}
