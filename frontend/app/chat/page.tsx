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
  Image as ImageIcon,
  Users,
  User as UserIcon,
  Mic,
  Trash2,
  Check,
  CheckCheck,
} from 'lucide-react';
import { api, uploadFile, type UploadedAttachment } from '@/lib/api';
import { ChatClient, type ChatMessage, type CallInvite } from '@/lib/chatClient';
import ChatMessageComponent from '@/components/ChatMessage';
import NewChatModal from '@/components/NewChatModal';
import CallOverlay from '@/components/CallOverlay';
import ConversationInfoPanel from '@/components/ConversationInfoPanel';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

interface Conversation {
  id: string;
  name: string | null;
  isGroup: boolean;
  ownerId: string | null;
  updatedAt: string;
  lastReadAt?: string | null;
  members: { id: string; user: { id: string; username: string } }[];
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
        // If conversation isn't currently open, increment unread
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
    } catch (err: any) {
      setError(err.message);
    }
  }

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

  function conversationTitle(c: Conversation): string {
    if (c.isGroup) return c.name || 'Group';
    const other = c.members.find((m) => m.user.id !== me?.id);
    return other?.user.username || 'Unknown';
  }

  function conversationSubtitle(c: Conversation): string {
    if (!c.lastMessage) {
      return c.isGroup ? `${c.members.length} members` : '';
    }
    const prefix = c.lastMessage.sender?.username === me?.username
      ? 'You: '
      : c.isGroup
        ? `${c.lastMessage.sender?.username || '?'}: `
        : '';
    return prefix + (c.lastMessage.content || (c.lastMessage.attachmentUrl ? '📎 attachment' : ''));
  }

  const filteredConversations = useMemo(() => {
    if (!filter.trim()) return conversations;
    const q = filter.toLowerCase();
    return conversations.filter((c) => conversationTitle(c).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, conversations, me]);

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

  return (
    <main className="h-screen flex bg-slate-950">
      {/* Sidebar */}
      <aside
        className={`${
          activeId ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 lg:w-96 border-r border-slate-800 flex-col`}
      >
        <header className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-slate-400 hover:text-slate-100"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="font-semibold">Chats</h1>
          <button
            onClick={() => setNewChatOpen(true)}
            className="text-slate-400 hover:text-slate-100"
            aria-label="New chat"
          >
            <Plus className="w-5 h-5" />
          </button>
        </header>

        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search chats..."
              className="w-full pl-9 pr-3 py-2 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <li className="text-center text-slate-500 py-8 text-sm px-4">
              No chats yet. Click + to start one.
            </li>
          ) : (
            filteredConversations.map((c) => {
              const isActive = c.id === activeId;
              const title = conversationTitle(c);
              const u = unread[c.id] || 0;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-800 transition-colors ${
                      isActive ? 'bg-slate-800' : ''
                    }`}
                  >
                    <div className="w-11 h-11 bg-slate-700 rounded-full flex items-center justify-center font-medium shrink-0">
                      {c.isGroup ? (
                        <Users className="w-5 h-5" />
                      ) : (
                        title[0]?.toUpperCase() || '?'
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium truncate">{title}</span>
                        {c.lastMessage && (
                          <span className="text-xs text-slate-500 shrink-0">
                            {formatTimestamp(c.lastMessage.createdAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs text-slate-400 truncate">
                          {conversationSubtitle(c)}
                        </span>
                        {u > 0 && (
                          <span className="bg-green-600 text-white text-xs font-bold rounded-full px-1.5 min-w-[20px] h-5 flex items-center justify-center shrink-0">
                            {u > 9 ? '9+' : u}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      {/* Content pane */}
      <section
        className={`${activeId ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-slate-950 min-w-0`}
      >
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <UserIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <div>Select a chat to start messaging</div>
            </div>
          </div>
        ) : (
          <>
            <header className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-3 shrink-0">
              <button
                onClick={() => setActiveId(null)}
                className="md:hidden text-slate-400 hover:text-slate-100"
                aria-label="Back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setInfoOpen(true)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80"
              >
                <div className="w-9 h-9 bg-slate-700 rounded-full flex items-center justify-center font-medium shrink-0">
                  {activeConv.isGroup ? (
                    <Users className="w-4 h-4" />
                  ) : (
                    conversationTitle(activeConv)[0]?.toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{conversationTitle(activeConv)}</div>
                  <div className="text-xs text-slate-400 truncate">
                    {(() => {
                      const typing = Array.from(
                        typingByConv.get(activeConv.id)?.values() || []
                      ).filter((t) => t.expiresAt > Date.now());
                      if (typing.length > 0) {
                        const names = typing.map((t) => t.username).join(', ');
                        return (
                          <span className="text-blue-400">
                            {names} {typing.length === 1 ? 'is' : 'are'} typing...
                          </span>
                        );
                      }
                      return activeConv.isGroup
                        ? activeConv.members.map((m) => m.user.username).join(', ')
                        : '';
                    })()}
                  </div>
                </div>
              </button>
              <button
                onClick={startCall}
                className="p-2 text-green-400 hover:bg-slate-800 rounded-full"
                aria-label="Voice call"
                title="Voice call"
              >
                <Phone className="w-5 h-5" />
              </button>
            </header>

            {error && (
              <div className="bg-red-900/40 text-red-200 px-4 py-1.5 text-sm shrink-0">
                {error}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-slate-950">
              {(messages[activeConv.id] || []).map((m) => {
                const isMe = m.sender?.id === me?.id || m.senderId === me?.id;
                const readInfo = isMe ? computeReadStatus(m, activeConv, me?.id, readByConv) : null;
                return (
                  <div
                    key={m.id}
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] sm:max-w-[70%] rounded-lg px-3 py-2 ${
                        isMe ? 'bg-blue-600' : 'bg-slate-800'
                      }`}
                    >
                      {activeConv.isGroup && !isMe && m.sender && (
                        <div className="text-xs font-medium text-blue-300 mb-0.5">
                          {m.sender.username}
                        </div>
                      )}
                      <ChatMessageComponent
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
                      {readInfo && (
                        <div className="flex justify-end mt-0.5">
                          {readInfo.allRead ? (
                            <CheckCheck
                              className="w-3.5 h-3.5 text-sky-300"
                              aria-label={`Read by ${readInfo.readCount}/${readInfo.total}`}
                            >
                              <title>
                                Read by {readInfo.readCount}/{readInfo.total}
                              </title>
                            </CheckCheck>
                          ) : readInfo.someRead ? (
                            <CheckCheck
                              className="w-3.5 h-3.5 text-slate-300/70"
                              aria-label={`Read by ${readInfo.readCount}/${readInfo.total}`}
                            >
                              <title>
                                Read by {readInfo.readCount}/{readInfo.total}
                              </title>
                            </CheckCheck>
                          ) : (
                            <Check className="w-3.5 h-3.5 text-slate-300/60" aria-label="Sent" />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {pendingFile && (
              <div className="px-3 py-2 border-t border-slate-800 bg-slate-900 flex items-center gap-2">
                {pendingFile.type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={URL.createObjectURL(pendingFile)}
                    className="w-10 h-10 rounded object-cover"
                    alt={pendingFile.name}
                  />
                ) : (
                  <Paperclip className="w-5 h-5 text-slate-400" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{pendingFile.name}</div>
                  <div className="text-xs text-slate-400">
                    {(pendingFile.size / 1024).toFixed(0)} KB
                    {uploading && ' • Uploading...'}
                  </div>
                </div>
                {!uploading && (
                  <button
                    onClick={() => setPendingFile(null)}
                    className="text-slate-400 hover:text-slate-100"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {emojiOpen && (
              <div className="border-t border-slate-800">
                <EmojiPicker
                  width="100%"
                  height={300}
                  theme={'dark' as any}
                  onEmojiClick={(e: any) => insertEmoji(e.emoji)}
                  lazyLoadEmojis
                />
              </div>
            )}

            {recorder.recording ? (
              <div className="p-2 border-t border-slate-800 flex items-center gap-2 shrink-0 bg-slate-900">
                <span className="flex items-center gap-2 text-red-400 text-sm flex-1">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  Recording {formatVoiceTime(recorder.elapsed)}
                </span>
                <button
                  type="button"
                  onClick={() => recorder.cancel()}
                  className="p-2 text-slate-400 hover:text-red-400"
                  aria-label="Cancel recording"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={sendVoiceMessage}
                  disabled={uploading}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded shrink-0"
                  aria-label="Send voice message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <form
                onSubmit={send}
                className="p-2 border-t border-slate-800 flex items-end gap-1 shrink-0"
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
                  className="p-2 text-slate-400 hover:text-slate-100 rounded"
                  aria-label="Send image"
                >
                  <ImageIcon className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-slate-400 hover:text-slate-100 rounded"
                  aria-label="Attach file"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEmojiOpen((v) => !v)}
                  className={`p-2 rounded ${
                    emojiOpen ? 'text-blue-400' : 'text-slate-400 hover:text-slate-100'
                  }`}
                  aria-label="Emoji"
                >
                  <Smile className="w-5 h-5" />
                </button>
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
                  placeholder="Type a message..."
                  className="flex-1 min-w-0 px-3 py-2 bg-slate-800 rounded text-sm leading-5 outline-none focus:ring-1 focus:ring-blue-500 resize-none max-h-32"
                />
                {text.trim() || pendingFile ? (
                  <button
                    type="submit"
                    disabled={uploading}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded shrink-0"
                    aria-label="Send"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => recorder.start()}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded shrink-0"
                    aria-label="Record voice message"
                    title="Hold or click to record"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                )}
              </form>
            )}
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
  );
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
    <div className="fixed top-4 right-4 z-40 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-4 w-80 flex flex-col gap-3">
      <div>
        <div className="text-sm text-slate-400">Incoming call</div>
        <div className="font-semibold">{invite.fromUsername}</div>
        {invite.conversation.isGroup && (
          <div className="text-xs text-slate-400">
            in {invite.conversation.name}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onDecline}
          className="flex-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm"
        >
          Decline
        </button>
        <button
          onClick={onAccept}
          className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm font-medium"
        >
          Accept
        </button>
      </div>
    </div>
  );
}

function formatTimestamp(s: string) {
  const d = new Date(s);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
