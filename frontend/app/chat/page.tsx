'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Phone,
  Send,
  Plus,
  Search,
  ArrowLeft,
  Smile,
  Paperclip,
  Users,
  User as UserIcon,
  Mic,
  Trash2,
  Check,
  CheckCheck,
  Video,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { api, uploadFile, type UploadedAttachment } from '@/lib/api';
import { ChatClient, type ChatMessage, type CallInvite } from '@/lib/chatClient';
import ChatMessageComponent from '@/components/ChatMessage';
import NewChatModal from '@/components/NewChatModal';
import CallOverlay from '@/components/CallOverlay';
import ConversationInfoPanel from '@/components/ConversationInfoPanel';
import AppRail from '@/components/AppRail';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'] });

type ListFilter = 'all' | 'unread' | 'direct' | 'group' | 'announcement';
const FILTERS: { key: ListFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'unread', label: 'Belum dibaca' },
  { key: 'direct', label: 'Pribadi' },
  { key: 'group', label: 'Grup' },
  { key: 'announcement', label: 'Pengumuman' },
];

interface Conversation {
  id: string;
  name: string | null;
  isGroup: boolean;
  ownerId: string | null;
  updatedAt: string;
  lastReadAt?: string | null;
  /** 'chat' | 'announcement' | 'system' */
  type?: string;
  /** HR-managed group */
  official?: boolean;
  unreadCount?: number;
  members: {
    id: string;
    user: { id: string; username: string; fullName?: string | null; title?: string | null };
  }[];
  lastMessage?: ChatMessage | null;
}

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; username: string } | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [searchHits, setSearchHits] = useState<ChatMessage[]>([]);

  const [infoOpen, setInfoOpen] = useState(false);
  /** Map<conversationId, Map<userId, { username, expiresAt }>> */
  const [typingByConv, setTypingByConv] = useState<
    Map<string, Map<string, { username: string; expiresAt: number }>>
  >(new Map());
  /** Map<conversationId, Map<userId, ISO lastReadAt>> */
  const [readByConv, setReadByConv] = useState<Map<string, Map<string, string>>>(new Map());

  const recorder = useVoiceRecorder();

  const [incomingCall, setIncomingCall] = useState<CallInvite | null>(null);
  const [activeCall, setActiveCall] = useState<{
    conversationId: string;
    name: string;
    members: { id: string; username: string }[];
    incoming?: boolean;
    fromUsername?: string;
  } | null>(null);

  const clientRef = useRef<ChatClient | null>(null);
  // The socket callbacks are created once; they read the open chat from here.
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Bootstrap
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (!token || !userStr) {
      router.replace('/login');
      return;
    }
    setMe(JSON.parse(userStr));

    const client = new ChatClient(token, {
      onMessage: (msg) => {
        setMessages((prev) => {
          const list = prev[msg.conversationId] || [];
          if (list.some((m) => m.id === msg.id)) return prev;
          return { ...prev, [msg.conversationId]: [...list, msg] };
        });
        // Bump conversation order
        setConversations((prev) =>
          [...prev]
            .map((c) =>
              c.id === msg.conversationId
                ? { ...c, lastMessage: msg, updatedAt: msg.createdAt }
                : c
            )
            .sort(
              (a, b) =>
                new Date(b.lastMessage?.createdAt || b.updatedAt).getTime() -
                new Date(a.lastMessage?.createdAt || a.updatedAt).getTime()
            )
        );
      },
      onNotify: (msg) => {
        // Open and on screen: it's being read right now — tell the sender
        // instead of counting it as unread.
        if (msg.conversationId === activeIdRef.current && document.visibilityState === 'visible') {
          clientRef.current?.markRead(msg.conversationId).catch(() => {});
          return;
        }
        setUnread((prev) => ({
          ...prev,
          [msg.conversationId]: (prev[msg.conversationId] || 0) + 1,
        }));
      },
      onTyping: ({ conversationId, userId, username, isTyping }) => {
        setTypingByConv((prev) => {
          const next = new Map(prev);
          const inner = new Map(next.get(conversationId) || new Map());
          if (isTyping) {
            inner.set(userId, { username, expiresAt: Date.now() + 5000 });
          } else {
            inner.delete(userId);
          }
          next.set(conversationId, inner);
          return next;
        });
      },
      onRead: ({ conversationId, userId, lastReadAt }) => {
        // Read on one of my other devices: the chat is no longer unread here.
        if (userId === JSON.parse(localStorage.getItem('user') || '{}').id) {
          setUnread((prev) => {
            if (!prev[conversationId]) return prev;
            const next = { ...prev };
            delete next[conversationId];
            return next;
          });
          return;
        }
        setReadByConv((prev) => {
          const next = new Map(prev);
          const inner = new Map(next.get(conversationId) || new Map());
          inner.set(userId, lastReadAt);
          next.set(conversationId, inner);
          return next;
        });
      },
      onMemberAdded: ({ conversationId, member }) => {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  members: [...c.members, { id: member.userId, user: member.user } as any],
                }
              : c
          )
        );
      },
      onMemberRemoved: ({ conversationId, removedUserId }) => {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  members: c.members.filter(
                    (m: any) => (m.userId || m.user.id) !== removedUserId
                  ),
                }
              : c
          )
        );
      },
      onAdded: ({ conversation }) => {
        setConversations((prev) => {
          if (prev.some((c) => c.id === conversation.id)) return prev;
          return [conversation, ...prev];
        });
      },
      onRemoved: ({ conversationId }) => {
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        setActiveId((curr) => (curr === conversationId ? null : curr));
      },
      onCallInvite: (invite) => {
        setIncomingCall(invite);
      },
      onCallCancelled: ({ conversationId }) => {
        setIncomingCall((curr) => (curr?.conversationId === conversationId ? null : curr));
      },
      onCallEnded: ({ conversationId }) => {
        setIncomingCall((curr) => (curr?.conversationId === conversationId ? null : curr));
        setActiveCall((curr) => (curr?.conversationId === conversationId ? null : curr));
      },
      onCallDeclined: ({ byUsername }) => {
        setError(`${byUsername} declined the call`);
        setTimeout(() => setError(''), 3000);
      },
    });

    clientRef.current = client;
    client.waitConnect().then(() => loadConversations());

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadConversations() {
    try {
      const { conversations } = await api.listConversations();
      setConversations(conversations);
      // Start from the server's counts so badges survive a reload.
      setUnread(
        Object.fromEntries(
          conversations
            .filter((c: Conversation) => (c.unreadCount ?? 0) > 0 && c.id !== activeIdRef.current)
            .map((c: Conversation) => [c.id, c.unreadCount as number])
        )
      );
    } catch (err: any) {
      setError(err.message);
    }
  }

  // Back to the tab: what arrived in the open chat while it was hidden is read now.
  useEffect(() => {
    const onVisible = () => {
      const id = activeIdRef.current;
      if (document.visibilityState !== 'visible' || !id) return;
      clientRef.current?.markRead(id).catch(() => {});
      setUnread((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // When activeId changes, fetch messages + join socket room
  useEffect(() => {
    if (!activeId || !clientRef.current) return;
    const client = clientRef.current;

    let cancelled = false;

    (async () => {
      try {
        await client.joinConversation(activeId);
        const { messages } = await api.listMessages(activeId);
        if (cancelled) return;
        setMessages((prev) => ({ ...prev, [activeId]: messages }));
        // Mark read via socket — also broadcasts to peers so they see receipt
        await client.markRead(activeId);
        setUnread((prev) => {
          const next = { ...prev };
          delete next[activeId];
          return next;
        });
        // Hydrate initial read state from members' lastReadAt
        const conv = conversations.find((c) => c.id === activeId);
        if (conv) {
          setReadByConv((prev) => {
            const next = new Map(prev);
            const inner = new Map(next.get(activeId) || new Map());
            for (const m of conv.members) {
              const lra = (m as any).lastReadAt;
              if (lra) inner.set((m as any).userId || m.user.id, lra);
            }
            next.set(activeId, inner);
            return next;
          });
        }
      } catch (err: any) {
        setError(err.message);
      }
    })();

    return () => {
      cancelled = true;
      client.leaveConversation(activeId).catch(() => {});
    };
  }, [activeId]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeId]);

  // Auto-resize textarea to fit content (up to max-height set in CSS)
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
    // Re-measure whenever the textarea's box changes size (e.g. a panel animating
    // open from width 0) so a measurement taken while collapsed never sticks.
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
  }, [text]);

  // Reap expired typing entries every second
  useEffect(() => {
    const t = setInterval(() => {
      setTypingByConv((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [convId, users] of next) {
          const filtered = new Map(users);
          for (const [uid, info] of users) {
            if (info.expiresAt < Date.now()) {
              filtered.delete(uid);
              changed = true;
            }
          }
          next.set(convId, filtered);
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );

  function otherMember(c: Conversation) {
    return c.members.find((m) => m.user.id !== me?.id)?.user;
  }

  /** Same colour for the same person everywhere: 1-on-1 chats use the other user's id. */
  function avatarSeed(c: Conversation): string {
    return c.isGroup ? c.id : otherMember(c)?.id || c.id;
  }

  function conversationTitle(c: Conversation): string {
    if (c.isGroup) return c.name || 'Grup';
    const other = otherMember(c);
    return other?.fullName || other?.username || 'Tidak dikenal';
  }

  function conversationSubtitle(c: Conversation): string {
    const last = c.lastMessage;
    if (!last) return c.isGroup ? `${c.members.length} anggota` : '';
    if (last.type === 'deleted') return 'Pesan ini telah dihapus';
    const mine = last.sender?.id === me?.id || last.senderId === me?.id;
    const prefix = c.isGroup && last.type !== 'system' ? `${mine ? 'Anda' : senderName(last)}: ` : '';
    return prefix + (last.content || (last.attachmentUrl ? `📎 ${last.attachmentName || 'Lampiran'}` : ''));
  }

  const filteredConversations = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return conversations.filter((c) => {
      const announcement = c.type === 'announcement';
      if (listFilter === 'unread' && !(unread[c.id] > 0)) return false;
      if (listFilter === 'direct' && c.isGroup) return false;
      if (listFilter === 'group' && (!c.isGroup || announcement)) return false;
      if (listFilter === 'announcement' && !announcement) return false;
      if (!q) return true;
      return (
        conversationTitle(c).toLowerCase().includes(q) ||
        (c.lastMessage?.content || '').toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, listFilter, conversations, unread, me]);

  // Message text search on the server (debounced) — 'Cari nama atau pesan'.
  useEffect(() => {
    const q = filter.trim();
    if (q.length < 2) {
      setSearchHits([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .searchMessages(q)
        .then(({ messages }) => setSearchHits(messages))
        .catch(() => setSearchHits([]));
    }, 350);
    return () => clearTimeout(t);
  }, [filter]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!activeId || !clientRef.current) return;
    const value = text.trim();
    if (!value && !pendingFile) return;
    if (uploading) return;

    let attachment: UploadedAttachment | undefined;
    if (pendingFile) {
      try {
        setUploading(true);
        attachment = await uploadFile(pendingFile);
      } catch (err: any) {
        setError(err.message || 'Upload failed');
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    try {
      // Stop typing indicator immediately on send
      clientRef.current.setTyping(activeId, false);
      stopTypingDebounce();
      await clientRef.current.send(activeId, value, attachment);
      setText('');
      setPendingFile(null);
      setEmojiOpen(false);
    } catch (err: any) {
      setError(err.message);
    }
  }

  // Debounced typing emit: send true on keystroke, false after 3s idle
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingEmitRef = useRef<number>(0);

  function stopTypingDebounce() {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    lastTypingEmitRef.current = 0;
  }

  function onTextChange(v: string) {
    setText(v);
    if (!activeId || !clientRef.current) return;
    const now = Date.now();
    // Throttle typing=true to once per 2s
    if (v && now - lastTypingEmitRef.current > 2000) {
      clientRef.current.setTyping(activeId, true);
      lastTypingEmitRef.current = now;
    }
    // Reset 3s timer to emit typing=false
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      clientRef.current?.setTyping(activeId, false);
      lastTypingEmitRef.current = 0;
    }, 3000);
  }

  async function sendVoiceMessage() {
    if (!activeId || !clientRef.current) return;
    const file = await recorder.stop();
    if (!file) return;
    try {
      setUploading(true);
      const attachment = await uploadFile(file);
      setUploading(false);
      await clientRef.current.send(activeId, '', attachment);
    } catch (err: any) {
      setUploading(false);
      setError(err.message || 'Voice message failed');
    }
  }

  function insertEmoji(emoji: string) {
    const el = chatInputRef.current;
    if (!el) return setText((v) => v + emoji);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setError('File too large (max 25 MB)');
      return;
    }
    setPendingFile(file);
  }

  async function startCall() {
    if (!activeId || !activeConv || !clientRef.current) return;
    try {
      await clientRef.current.startCall(activeId);
      setActiveCall({
        conversationId: activeId,
        name: conversationTitle(activeConv),
        members: activeConv.members
          .filter((m) => m.user.id !== me?.id)
          .map((m) => ({ id: m.user.id, username: m.user.username })),
      });
    } catch (err: any) {
      setError(err.message);
    }
  }

  /** Video call = an instant meeting room; the link goes into the chat. */
  async function startVideoCall() {
    if (!activeId || !activeConv || !clientRef.current) return;
    try {
      const { room } = await api.createRoom({ name: `Video call ${conversationTitle(activeConv)}` });
      const link = `${window.location.origin}/room/${room.id}`;
      await clientRef.current.send(activeId, `📹 Video call. Gabung: ${link}`);
      router.push(`/room/${room.id}`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  function acceptIncomingCall() {
    if (!incomingCall) return;
    setActiveCall({
      conversationId: incomingCall.conversationId,
      name:
        incomingCall.conversation.name ||
        incomingCall.conversation.members
          .filter((m) => m.id !== me?.id)
          .map((m) => m.username)
          .join(', '),
      members: incomingCall.conversation.members.filter((m) => m.id !== me?.id),
      incoming: true,
      fromUsername: incomingCall.fromUsername,
    });
    setIncomingCall(null);
  }

  const activeOther = activeConv && !activeConv.isGroup ? otherMember(activeConv) : null;
  const activeTyping = activeConv
    ? Array.from(typingByConv.get(activeConv.id)?.values() || []).filter((t) => t.expiresAt > Date.now())
    : [];

  return (
    <div className={`${jakarta.className} h-screen flex bg-[#f4f5f9] dark:bg-slate-950 text-gray-900 dark:text-slate-100`}>
      {/* Teams-style left rail (hidden on mobile when a chat is open) */}
      <div className={activeId ? 'hidden md:flex' : 'flex'}>
        <AppRail active="chat" username={me?.username} />
      </div>

      <main className="flex-1 flex min-w-0">
      {/* Sidebar */}
      <aside
        className={`${
          activeId ? 'hidden md:flex' : 'flex'
        } w-full md:w-[340px] lg:w-[400px] border-r border-gray-200 dark:border-slate-800 flex-col bg-white dark:bg-slate-900`}
      >
        <header className="px-5 pt-5 pb-3 flex items-center justify-between">
          <h1 className="font-bold text-2xl tracking-tight">Chat</h1>
          <button
            onClick={() => setNewChatOpen(true)}
            className="flex items-center gap-1.5 pl-3.5 pr-4 h-10 rounded-full bg-indigo-700 hover:bg-indigo-800 text-white text-sm font-semibold shadow-md shadow-indigo-700/25"
          >
            <Plus className="w-4 h-4" />
            Chat baru
          </button>
        </header>

        <div className="px-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Cari nama atau pesan"
              className="w-full h-11 pl-10 pr-3 !border-0 bg-gray-100 dark:bg-slate-800 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/40 placeholder:text-gray-500 dark:placeholder:text-slate-500"
            />
          </div>
          <div className="flex flex-wrap gap-2 py-3">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setListFilter(f.key)}
                className={`h-8 px-3.5 rounded-full text-[13px] font-medium transition-colors ${
                  listFilter === f.key
                    ? 'bg-indigo-700 text-white'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
          {filteredConversations.length === 0 && searchHits.length === 0 ? (
            <li className="text-center text-gray-400 dark:text-slate-500 py-10 text-sm px-4">
              {conversations.length === 0
                ? 'Belum ada chat. Tekan "Chat baru" untuk memulai.'
                : 'Tidak ada chat yang cocok.'}
            </li>
          ) : (
            filteredConversations.map((c) => {
              const isActive = c.id === activeId;
              const title = conversationTitle(c);
              const u = unread[c.id] || 0;
              const official = c.official || c.type === 'announcement' || c.type === 'system';
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={`w-full flex gap-3 p-3 rounded-2xl text-left border transition-colors ${
                      isActive
                        ? 'bg-indigo-50 border-indigo-100 dark:bg-indigo-500/15 dark:border-indigo-500/30'
                        : 'bg-white border-gray-100 hover:bg-gray-50 dark:bg-slate-900 dark:border-slate-800 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <Avatar seed={avatarSeed(c)} label={title} group={c.isGroup && !official} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold truncate">{title}</span>
                        {official && <OfficialBadge />}
                        {c.lastMessage && (
                          <span className="ml-auto text-xs text-gray-400 dark:text-slate-500 shrink-0">
                            {formatListTime(c.lastMessage.createdAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-start gap-2 mt-0.5">
                        <span
                          className={`text-[13px] leading-snug line-clamp-2 break-words flex-1 ${
                            u > 0 ? 'text-gray-900 dark:text-slate-100 font-medium' : 'text-gray-500 dark:text-slate-400'
                          }`}
                        >
                          {conversationSubtitle(c)}
                        </span>
                        {u > 0 && (
                          <span className="mt-0.5 bg-indigo-700 text-white text-[11px] font-bold rounded-full px-1.5 min-w-[20px] h-5 flex items-center justify-center shrink-0">
                            {u > 99 ? '99+' : u}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })
          )}

          {searchHits.length > 0 && (
            <>
              <li className="px-2 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                Pesan
              </li>
              {searchHits.map((m) => {
                const conv = conversations.find((c) => c.id === m.conversationId);
                if (!conv) return null;
                return (
                  <li key={`hit-${m.id}`}>
                    <button
                      onClick={() => setActiveId(conv.id)}
                      className="w-full text-left p-3 rounded-2xl border border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/70"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold truncate">{conversationTitle(conv)}</span>
                        <span className="ml-auto text-xs text-gray-400 dark:text-slate-500 shrink-0">
                          {formatListTime(m.createdAt)}
                        </span>
                      </div>
                      <div className="text-[13px] text-gray-500 dark:text-slate-400 line-clamp-2">
                        {m.sender ? `${senderName(m)}: ` : ''}
                        {m.content || m.attachmentName}
                      </div>
                    </button>
                  </li>
                );
              })}
            </>
          )}
        </ul>
      </aside>

      {/* Content pane */}
      <section
        className={`${activeId ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0 bg-[#f6f7fb] dark:bg-slate-950`}
      >
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-slate-500">
            <div className="text-center">
              <UserIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <div>Pilih chat untuk mulai mengobrol</div>
            </div>
          </div>
        ) : (
          <>
            <header className="px-4 sm:px-6 h-[76px] border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3 shrink-0">
              <button
                onClick={() => setActiveId(null)}
                className="md:hidden text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100"
                aria-label="Kembali"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setInfoOpen(true)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <Avatar seed={avatarSeed(activeConv)} label={conversationTitle(activeConv)} group={activeConv.isGroup} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[17px] truncate">{conversationTitle(activeConv)}</div>
                  <div className="text-[13px] text-gray-500 dark:text-slate-400 truncate">
                    {activeTyping.length > 0 ? (
                      <span className="text-indigo-600 dark:text-indigo-300">
                        {activeTyping.map((t) => t.username).join(', ')} sedang mengetik…
                      </span>
                    ) : activeConv.isGroup ? (
                      `${activeConv.members.length} anggota`
                    ) : (
                      activeOther?.title || ''
                    )}
                  </div>
                </div>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <HeaderIcon label="Telepon suara" onClick={startCall}>
                  <Phone className="w-5 h-5" />
                </HeaderIcon>
                <HeaderIcon label="Video call" onClick={startVideoCall}>
                  <Video className="w-5 h-5" />
                </HeaderIcon>
                <HeaderIcon label="Info chat" onClick={() => setInfoOpen(true)}>
                  <MoreHorizontal className="w-5 h-5" />
                </HeaderIcon>
              </div>
            </header>

            {error && (
              <div className="mx-4 sm:mx-6 mt-3 flex items-center gap-2 bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-100 dark:border-red-500/30 px-4 py-2 rounded-xl text-sm shrink-0">
                <span className="flex-1">{error}</span>
                <button onClick={() => setError('')} aria-label="Tutup">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5">
              {buildRows(messages[activeConv.id] || [], me?.id).map((row) => {
                if (row.kind === 'date') {
                  return (
                    <div key={row.key} className="flex justify-center my-4">
                      <span className="text-[13px] font-medium text-gray-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full px-3.5 py-1">
                        {row.label}
                      </span>
                    </div>
                  );
                }
                const m = row.message;
                // "Andi added Rina", renames etc. — a note, not a bubble.
                if (m.type === 'system') {
                  return (
                    <div key={m.id} className="text-center text-[13px] text-gray-500 dark:text-slate-400 my-3">
                      {m.content}
                    </div>
                  );
                }
                const isMe = row.isMe;
                const readInfo = isMe ? computeReadStatus(m, activeConv, me?.id, readByConv) : null;
                const url = firstUrl(m.content);
                const bubble = (
                  <div
                    className={`relative inline-block max-w-full rounded-2xl px-3.5 pt-2.5 pb-2 ${
                      isMe
                        ? 'bg-[#e4e6f8] dark:bg-indigo-600/40 text-gray-900 dark:text-slate-100 shadow-sm'
                        : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700'
                    }`}
                  >
                    {m.type === 'deleted' ? (
                      <div className="italic text-sm text-gray-500 dark:text-slate-400">Pesan ini telah dihapus</div>
                    ) : (
                      <>
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block mb-2 rounded-lg bg-gray-100 dark:bg-slate-900/60 px-3 py-2 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300 truncate hover:underline"
                          >
                            {hostOf(url)}
                          </a>
                        )}
                        {m.content && (
                          <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
                            <Linkified text={m.content} />
                          </div>
                        )}
                        <ChatMessageComponent
                          bare
                          message={{
                            id: m.id,
                            username: m.sender?.username || '',
                            content: m.content,
                            attachmentUrl: m.attachmentUrl,
                            attachmentName: m.attachmentName,
                            attachmentType: m.attachmentType,
                            attachmentSize: m.attachmentSize,
                            createdAt: m.createdAt,
                          }}
                        />
                      </>
                    )}
                    <div className="flex items-center justify-end gap-1 mt-1 text-[11px] text-gray-400 dark:text-slate-400">
                      {formatClock(m.createdAt)}
                      {readInfo &&
                        (readInfo.allRead ? (
                          <CheckCheck className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300" aria-label="Dibaca">
                            <title>Dibaca {readInfo.readCount}/{readInfo.total}</title>
                          </CheckCheck>
                        ) : readInfo.someRead ? (
                          <CheckCheck className="w-3.5 h-3.5 text-gray-400" aria-label="Dibaca sebagian">
                            <title>Dibaca {readInfo.readCount}/{readInfo.total}</title>
                          </CheckCheck>
                        ) : (
                          <Check className="w-3.5 h-3.5 text-gray-400" aria-label="Terkirim" />
                        ))}
                    </div>
                  </div>
                );

                if (isMe) {
                  return (
                    <div key={m.id} className={`flex justify-end ${row.groupStart ? 'mt-4' : 'mt-1.5'}`}>
                      <div className="max-w-[80%] sm:max-w-[65%] flex justify-end">{bubble}</div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={`flex gap-3 ${row.groupStart ? 'mt-4' : 'mt-1.5'}`}>
                    <div className="w-11 shrink-0">
                      {row.groupStart && (
                        <Avatar
                          seed={m.sender?.id || m.senderId || m.id}
                          label={senderName(m)}
                        />
                      )}
                    </div>
                    <div className="min-w-0 max-w-[80%] sm:max-w-[65%]">
                      {row.groupStart && (
                        <div className="font-semibold text-[15px] mb-1">{senderName(m)}</div>
                      )}
                      {bubble}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {pendingFile && (
              <div className="mx-4 sm:mx-6 mb-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center gap-2">
                {pendingFile.type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={URL.createObjectURL(pendingFile)}
                    className="w-10 h-10 rounded-lg object-cover"
                    alt={pendingFile.name}
                  />
                ) : (
                  <Paperclip className="w-5 h-5 text-gray-500 dark:text-slate-400" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{pendingFile.name}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400">
                    {(pendingFile.size / 1024).toFixed(0)} KB
                    {uploading && ' • Mengunggah…'}
                  </div>
                </div>
                {!uploading && (
                  <button
                    onClick={() => setPendingFile(null)}
                    className="text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100"
                    aria-label="Batalkan lampiran"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {emojiOpen && (
              <div className="mx-4 sm:mx-6 mb-2 rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700">
                <EmojiPicker
                  width="100%"
                  height={300}
                  theme={'auto' as any}
                  onEmojiClick={(e: any) => insertEmoji(e.emoji)}
                  lazyLoadEmojis
                />
              </div>
            )}

            <div className="px-4 sm:px-6 pb-4 pt-1 shrink-0">
              {recorder.recording ? (
                <div className="flex items-center gap-2 min-h-[56px] px-4 rounded-2xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
                  <span className="flex items-center gap-2 text-red-500 text-sm flex-1">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    Merekam {formatVoiceTime(recorder.elapsed)}
                  </span>
                  <button
                    type="button"
                    onClick={() => recorder.cancel()}
                    className="p-2 text-gray-500 dark:text-slate-400 hover:text-red-500"
                    aria-label="Batalkan rekaman"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={sendVoiceMessage}
                    disabled={uploading}
                    className="p-2 text-indigo-700 dark:text-indigo-300 disabled:opacity-50"
                    aria-label="Kirim pesan suara"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={send}
                  className="flex items-end gap-1 min-h-[56px] px-2 py-1.5 rounded-2xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-sm"
                >
                  <input ref={fileInputRef} type="file" onChange={onPickFile} className="hidden" />
                  <ComposerIcon
                    label="Emoji"
                    active={emojiOpen}
                    onClick={() => setEmojiOpen((v) => !v)}
                  >
                    <Smile className="w-5 h-5" />
                  </ComposerIcon>
                  <textarea
                    ref={chatInputRef}
                    value={text}
                    onChange={(e) => onTextChange(e.target.value)}
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
                        send(e as any);
                      }
                    }}
                    rows={1}
                    placeholder="Tulis pesan..."
                    className="flex-1 min-w-0 px-2 py-2.5 !border-0 bg-transparent text-[15px] leading-5 outline-none resize-none max-h-32 placeholder:text-gray-400 dark:placeholder:text-slate-500"
                  />
                  <ComposerIcon label="Lampirkan berkas" onClick={() => fileInputRef.current?.click()}>
                    <Paperclip className="w-5 h-5" />
                  </ComposerIcon>
                  <ComposerIcon label="Rekam pesan suara" onClick={() => recorder.start()}>
                    <Mic className="w-5 h-5" />
                  </ComposerIcon>
                  <button
                    type="submit"
                    disabled={uploading || (!text.trim() && !pendingFile)}
                    className="w-10 h-10 flex items-center justify-center rounded-xl text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 disabled:text-gray-300 dark:disabled:text-slate-600 disabled:hover:bg-transparent shrink-0"
                    aria-label="Kirim"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </section>

      <NewChatModal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onCreated={(conv) => {
          setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
          setActiveId(conv.id);
        }}
      />

      {incomingCall && clientRef.current && (
        <IncomingCallToast
          invite={incomingCall}
          onAccept={acceptIncomingCall}
          onDecline={() => {
            clientRef.current?.declineCall(incomingCall.conversationId);
            setIncomingCall(null);
          }}
        />
      )}

      {activeCall && clientRef.current && (
        <CallOverlay
          socket={clientRef.current.socket}
          conversationId={activeCall.conversationId}
          conversationName={activeCall.name}
          members={activeCall.members}
          incoming={activeCall.incoming}
          fromUsername={activeCall.fromUsername}
          onClose={() => setActiveCall(null)}
        />
      )}

      <ConversationInfoPanel
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        conversation={
          activeConv
            ? {
                id: activeConv.id,
                name: activeConv.name,
                isGroup: activeConv.isGroup,
                ownerId: activeConv.ownerId,
                members: activeConv.members.map((m: any) => ({
                  id: m.id,
                  userId: m.userId || m.user.id,
                  user: m.user,
                })),
              }
            : null
        }
        currentUserId={me?.id}
        onUpdated={(updated) => {
          setConversations((prev) =>
            prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
          );
        }}
        onLeft={(conversationId) => {
          setConversations((prev) => prev.filter((c) => c.id !== conversationId));
          setActiveId((curr) => (curr === conversationId ? null : curr));
        }}
      />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

/** Full name from HR data when known, else the username. */
function senderName(m: ChatMessage): string {
  return m.sender?.fullName || m.sender?.username || '?';
}

const AVATAR_COLORS = ['#a3264b', '#3b3fa8', '#3d7f6e', '#46505b', '#7c3a9e', '#b45309', '#1f6f9e'];

/** Initials on a colour that stays the same for the same person/chat. */
function Avatar({ seed, label, group }: { seed: string; label: string; group?: boolean }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const color = AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <div
      className="w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
      style={{ background: color }}
    >
      {group ? <Users className="w-5 h-5" /> : initials || '?'}
    </div>
  );
}

function OfficialBadge() {
  return (
    <span className="text-[10px] font-bold tracking-wide text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-500/20 rounded px-1.5 py-0.5 shrink-0">
      RESMI
    </span>
  );
}

function HeaderIcon({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-10 h-10 flex items-center justify-center rounded-xl text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  );
}

function ComposerIcon({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-10 h-10 flex items-center justify-center rounded-xl shrink-0 ${
        active
          ? 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15'
          : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

function firstUrl(text: string | null | undefined): string | null {
  return text?.match(URL_RE)?.[0] ?? null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Plain text with clickable links. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="text-indigo-700 dark:text-indigo-300 hover:underline break-all">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

type Row =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'message'; message: ChatMessage; isMe: boolean; groupStart: boolean };

const GROUP_GAP_MS = 5 * 60 * 1000;

/** Day separators + consecutive messages from one sender grouped together. */
function buildRows(list: ChatMessage[], myId: string | undefined): Row[] {
  const rows: Row[] = [];
  let lastDay = '';
  let prev: ChatMessage | null = null;
  for (const m of list) {
    const d = new Date(m.createdAt);
    const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (day !== lastDay) {
      rows.push({ kind: 'date', key: `d-${day}`, label: dayLabel(d) });
      lastDay = day;
      prev = null;
    }
    const sender = m.sender?.id || m.senderId;
    const groupStart =
      !prev ||
      prev.type === 'system' ||
      (prev.sender?.id || prev.senderId) !== sender ||
      d.getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
    rows.push({ kind: 'message', message: m, isMe: sender === myId, groupStart });
    prev = m;
  }
  return rows;
}

function dayLabel(d: Date): string {
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Kemarin';
  return d.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 24-hour "13:15". */
function formatClock(s: string): string {
  const d = new Date(s);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Today: "13:15", earlier: "6 Nov 2026". */
function formatListTime(s: string): string {
  const d = new Date(s);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return formatClock(s);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function computeReadStatus(
  msg: ChatMessage,
  conv: { isGroup: boolean; members: any[] },
  myId: string | undefined,
  readByConv: Map<string, Map<string, string>>
) {
  const inner = readByConv.get(msg.conversationId);
  const others = conv.members.filter(
    (m: any) => (m.userId || m.user.id) !== myId
  );
  const total = others.length;
  if (total === 0) return null;

  const msgTime = new Date(msg.createdAt).getTime();
  let readCount = 0;
  for (const m of others) {
    const uid = m.userId || m.user.id;
    const lra = inner?.get(uid);
    if (lra && new Date(lra).getTime() >= msgTime) readCount++;
  }
  return {
    total,
    readCount,
    someRead: readCount > 0,
    allRead: readCount === total,
  };
}

function formatVoiceTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function IncomingCallToast({
  invite,
  onAccept,
  onDecline,
}: {
  invite: CallInvite;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-40 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-xl p-4 w-80 flex flex-col gap-3">
      <div>
        <div className="text-sm text-gray-500 dark:text-slate-400">Panggilan masuk</div>
        <div className="font-semibold">{invite.fromUsername}</div>
        {invite.conversation.isGroup && (
          <div className="text-xs text-gray-500 dark:text-slate-400">di {invite.conversation.name}</div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onDecline}
          className="flex-1 px-3 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-xl text-sm font-medium"
        >
          Tolak
        </button>
        <button
          onClick={onAccept}
          className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold"
        >
          Terima
        </button>
      </div>
    </div>
  );
}
