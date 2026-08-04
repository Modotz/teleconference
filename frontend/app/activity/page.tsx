'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  MessageSquare,
  Video,
  CalendarClock,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import AppRail from '@/components/AppRail';

interface Room {
  id: string;
  name: string;
  scheduledAt: string | null;
  durationMinutes?: number | null;
  createdAt: string;
}
interface Conversation {
  id: string;
  name: string | null;
  isGroup: boolean;
  updatedAt: string;
  lastReadAt?: string | null;
  members: { user: { id: string; username: string } }[];
  lastMessage?: {
    content: string | null;
    attachmentUrl?: string | null;
    createdAt: string;
    sender?: { id: string; username: string } | null;
  } | null;
}

type Item = {
  key: string;
  kind: 'meeting' | 'message';
  time: number; // ms epoch
  title: string;
  text: string;
  unread?: boolean;
  onClick: () => void;
};

type Filter = 'all' | 'meetings' | 'chats';

export default function ActivityPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; username: string } | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const now = useMemo(() => Date.now(), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (!token) {
      router.replace('/login');
      return;
    }
    if (userStr) setMe(JSON.parse(userStr));
    (async () => {
      try {
        const [r, c] = await Promise.all([
          api.listRooms(),
          api.listConversations().catch(() => ({ conversations: [] })),
        ]);
        setRooms(r.rooms || []);
        setConvos((c as any).conversations || []);
      } catch (err: any) {
        if (err?.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          router.replace('/login');
          return;
        }
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  function convoTitle(c: Conversation) {
    if (c.isGroup) return c.name || 'Group';
    const other = c.members.find((m) => m.user.id !== me?.id);
    return other?.user.username || 'Unknown';
  }

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];

    // Scheduled meetings (upcoming, or ended within the last 2 days).
    for (const r of rooms) {
      if (!r.scheduledAt) continue;
      const t = new Date(r.scheduledAt).getTime();
      if (t < now - 2 * 86400000) continue;
      out.push({
        key: `room-${r.id}`,
        kind: 'meeting',
        time: t,
        title: r.name,
        text: t >= now ? 'Upcoming meeting' : 'Scheduled meeting',
        onClick: () => router.push(`/room/${r.id}`),
      });
    }

    // Latest message per conversation.
    for (const c of convos) {
      if (!c.lastMessage) continue;
      const t = new Date(c.lastMessage.createdAt).getTime();
      const fromMe = c.lastMessage.sender?.id === me?.id;
      const unread =
        !fromMe &&
        (!c.lastReadAt || new Date(c.lastReadAt).getTime() < t);
      const who = c.lastMessage.sender?.username || '?';
      const preview =
        c.lastMessage.content ||
        (c.lastMessage.attachmentUrl ? '📎 Attachment' : '');
      out.push({
        key: `conv-${c.id}`,
        kind: 'message',
        time: t,
        title: convoTitle(c),
        text: `${fromMe ? 'You' : who}: ${preview}`,
        unread,
        onClick: () => router.push('/chat'),
      });
    }

    out.sort((a, b) => b.time - a.time);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, convos, me, now]);

  const shown = items.filter((i) =>
    filter === 'all'
      ? true
      : filter === 'meetings'
      ? i.kind === 'meeting'
      : i.kind === 'message'
  );
  const unreadCount = items.filter((i) => i.unread).length;

  return (
    <div className="min-h-screen flex bg-gray-100 dark:bg-slate-950 text-gray-900 dark:text-slate-100">
      <AppRail active="activity" username={me?.username} />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 h-14 border-b border-gray-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/50 backdrop-blur">
          <h1 className="text-lg font-semibold leading-tight truncate flex items-center gap-2">
            Activity
            {unreadCount > 0 && (
              <span className="bg-brand-600 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {unreadCount}
              </span>
            )}
          </h1>
          <div className="flex rounded-md overflow-hidden border border-gray-300 dark:border-slate-700 text-sm shrink-0">
            {(['all', 'meetings', 'chats'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 capitalize ${
                  filter === f
                    ? 'bg-brand-600 text-white'
                    : 'hover:bg-gray-100 dark:hover:bg-slate-800'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-2xl mx-auto">
            {loading ? (
              <div className="text-sm text-gray-500 dark:text-slate-400">Loading…</div>
            ) : shown.length === 0 ? (
              <div className="text-center text-gray-500 dark:text-slate-400 py-16">
                <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <div className="text-sm">No activity yet.</div>
              </div>
            ) : (
              <ul className="space-y-2">
                {shown.map((it) => (
                  <li key={it.key}>
                    <button
                      onClick={it.onClick}
                      className={`w-full flex items-center gap-3 text-left px-3 py-3 rounded-lg border transition-colors ${
                        it.unread
                          ? 'bg-brand-50 dark:bg-brand-600/10 border-brand-200 dark:border-brand-600/40'
                          : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 hover:border-brand-300 dark:hover:border-brand-600/50'
                      }`}
                    >
                      <span
                        className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                          it.kind === 'meeting'
                            ? 'bg-brand-100 text-brand-700 dark:bg-brand-600/20 dark:text-brand-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {it.kind === 'meeting' ? (
                          <Video className="w-5 h-5" />
                        ) : (
                          <MessageSquare className="w-5 h-5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{it.title}</span>
                          {it.unread && (
                            <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />
                          )}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-slate-400 truncate">
                          {it.text}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-gray-400 dark:text-slate-500 flex items-center gap-1">
                        {it.kind === 'meeting' && it.time >= now && (
                          <CalendarClock className="w-3 h-3" />
                        )}
                        {relTime(it.time, now)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {error && <div className="text-red-500 text-sm mt-4">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function relTime(t: number, now: number): string {
  const diff = t - now; // >0 = future
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3600000);
  const d = Math.round(abs / 86400000);
  let s: string;
  if (m < 1) return 'now';
  else if (m < 60) s = `${m}m`;
  else if (h < 24) s = `${h}h`;
  else if (d < 7) s = `${d}d`;
  else return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}
