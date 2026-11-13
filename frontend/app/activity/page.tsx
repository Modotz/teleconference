'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  MessageSquare,
  Video,
  CalendarClock,
  ChevronRight,
  Clock,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { jakarta } from '@/lib/fonts';
import AppRail from '@/components/AppRail';
import Avatar from '@/components/Avatar';

interface Room {
  id: string;
  name: string;
  scheduledAt: string | null;
  durationMinutes?: number | null;
  createdAt: string;
}
interface PastMeeting {
  id: string;
  name: string;
  isActive: boolean;
  endedAt: string | null;
  owner: { id: string; username: string } | null;
  lastJoinedAt: string;
  participantCount: number;
}
interface Conversation {
  id: string;
  name: string | null;
  isGroup: boolean;
  updatedAt: string;
  type?: string;
  official?: boolean;
  unreadCount?: number;
  mutedUntil?: string | null;
  members: { user: { id: string; username: string; fullName?: string | null } }[];
  lastMessage?: {
    content: string | null;
    type?: string;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
    createdAt: string;
    senderId?: string;
    sender?: { id: string; username: string; fullName?: string | null } | null;
  } | null;
}

type Status = { label: string; tone: 'live' | 'upcoming' | 'ended' | 'open' };

type Item = {
  key: string;
  kind: 'meeting' | 'scheduled' | 'message';
  time: number; // ms epoch
  title: string;
  text: string;
  unread: number;
  status?: Status;
  avatar?: { seed: string; label: string; group: boolean };
  action?: { label: string; href: string };
  href: string;
};

type Filter = 'all' | 'meetings' | 'chats';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'meetings', label: 'Rapat' },
  { key: 'chats', label: 'Chat' },
];

const DAY = 86400000;

export default function ActivityPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; username: string } | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [history, setHistory] = useState<PastMeeting[]>([]);
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
        const [r, h, c] = await Promise.all([
          api.listRooms(),
          api.roomHistory().catch(() => ({ meetings: [] })),
          api.listConversations().catch(() => ({ conversations: [] })),
        ]);
        setRooms(r.rooms || []);
        setHistory(h.meetings || []);
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
    if (c.isGroup) return c.name || 'Grup';
    const other = c.members.find((m) => m.user.id !== me?.id)?.user;
    return other?.fullName || other?.username || 'Tidak dikenal';
  }

  const { items, upcoming, stats } = useMemo(() => {
    const out: Item[] = [];
    const soon: (Item & { start: number; end: number })[] = [];

    // Meetings the user joined (instant or scheduled).
    const joined = new Set<string>();
    for (const m of history) {
      joined.add(m.id);
      const host = m.owner?.id === me?.id ? 'Anda host' : `Host: ${m.owner?.username || '?'}`;
      out.push({
        key: `hist-${m.id}`,
        kind: 'meeting',
        time: new Date(m.lastJoinedAt).getTime(),
        title: m.name,
        text: `${host} · ${m.participantCount} peserta`,
        unread: 0,
        status: m.isActive ? { label: 'Ruang aktif', tone: 'open' } : { label: 'Selesai', tone: 'ended' },
        action: m.isActive ? { label: 'Gabung lagi', href: `/room/${m.id}` } : undefined,
        href: `/room/${m.id}`,
      });
    }

    // Scheduled meetings: upcoming ones go to "Mendatang"; recent ones into the
    // timeline unless the history entry above already covers them.
    for (const r of rooms) {
      if (!r.scheduledAt) continue;
      const start = new Date(r.scheduledAt).getTime();
      const end = start + (r.durationMinutes || 60) * 60000;
      if (end >= now) {
        const live = start <= now;
        soon.push({
          key: `soon-${r.id}`,
          kind: 'scheduled',
          time: start,
          start,
          end,
          title: r.name,
          text: `${formatTime(start)} – ${formatTime(end)}`,
          unread: 0,
          status: live ? { label: 'Sedang berlangsung', tone: 'live' } : { label: relDay(start, now), tone: 'upcoming' },
          action: { label: 'Gabung', href: `/room/${r.id}` },
          href: `/room/${r.id}`,
        });
        continue;
      }
      if (start < now - 2 * DAY || joined.has(r.id)) continue;
      out.push({
        key: `room-${r.id}`,
        kind: 'scheduled',
        time: start,
        title: r.name,
        text: 'Rapat terjadwal',
        unread: 0,
        status: { label: 'Selesai', tone: 'ended' },
        href: `/room/${r.id}`,
      });
    }

    // Latest message per conversation.
    let unreadTotal = 0;
    for (const c of convos) {
      const last = c.lastMessage;
      const unread = c.unreadCount || 0;
      const muted = c.mutedUntil && new Date(c.mutedUntil).getTime() > now;
      if (!muted) unreadTotal += unread;
      if (!last) continue;
      const fromMe = (last.sender?.id || last.senderId) === me?.id;
      const who = fromMe ? 'Anda' : last.sender?.fullName || last.sender?.username || '?';
      const body =
        last.type === 'deleted'
          ? 'Pesan ini telah dihapus'
          : last.content || (last.attachmentUrl ? `📎 ${last.attachmentName || 'Lampiran'}` : '');
      const other = c.members.find((m) => m.user.id !== me?.id)?.user;
      out.push({
        key: `conv-${c.id}`,
        kind: 'message',
        time: new Date(last.createdAt).getTime(),
        title: convoTitle(c),
        text: c.isGroup || fromMe ? `${who}: ${body}` : body,
        unread,
        avatar: { seed: c.isGroup ? c.id : other?.id || c.id, label: convoTitle(c), group: c.isGroup },
        action: { label: 'Buka chat', href: '/chat' },
        href: '/chat',
      });
    }

    out.sort((a, b) => b.time - a.time);
    soon.sort((a, b) => a.start - b.start);
    return {
      items: out,
      upcoming: soon,
      stats: {
        unread: unreadTotal,
        upcoming: soon.length,
        week: history.filter((m) => new Date(m.lastJoinedAt).getTime() > now - 7 * DAY).length,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, history, convos, me, now]);

  const shown = items.filter((i) =>
    filter === 'all' ? true : filter === 'meetings' ? i.kind !== 'message' : i.kind === 'message'
  );
  const groups = groupByDay(shown, now);
  const showUpcoming = filter !== 'chats' && upcoming.length > 0;

  return (
    <div className={`${jakarta.className} min-h-screen flex bg-[#f4f5f9] dark:bg-slate-950 text-gray-900 dark:text-slate-100`}>
      <AppRail active="activity" username={me?.username} />

      <div className="flex-1 min-w-0 flex flex-col h-screen">
        <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-5 sm:px-8 py-4 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Aktivitas</h1>
            <p className="text-[13px] text-gray-500 dark:text-slate-400">Rapat dan pesan terbaru Anda</p>
          </div>
          <div className="flex p-1 rounded-full bg-gray-100 dark:bg-slate-800">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`h-8 px-4 rounded-full text-[13px] font-semibold transition-colors ${
                  filter === f.key
                    ? 'bg-white dark:bg-slate-950 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 space-y-8">
            {/* Summary */}
            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard
                icon={MessageSquare}
                label="Pesan belum dibaca"
                value={stats.unread}
                tone="indigo"
                onClick={() => router.push('/chat')}
              />
              <StatCard
                icon={CalendarClock}
                label="Rapat mendatang"
                value={stats.upcoming}
                tone="emerald"
                onClick={() => router.push('/calendar')}
              />
              <StatCard
                icon={Video}
                label="Rapat 7 hari terakhir"
                value={stats.week}
                tone="amber"
                onClick={() => setFilter('meetings')}
              />
            </section>

            {loading ? (
              <Skeleton />
            ) : (
              <>
                {showUpcoming && (
                  <section>
                    <SectionTitle>Mendatang</SectionTitle>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {upcoming.slice(0, 4).map((u) => (
                        <div
                          key={u.key}
                          className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200/80 dark:border-slate-800 flex flex-col gap-3"
                        >
                          <div className="flex items-start gap-3">
                            <DateTile ms={u.start} />
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold truncate">{u.title}</div>
                              <div className="flex items-center gap-1.5 text-[13px] text-gray-500 dark:text-slate-400 mt-0.5">
                                <Clock className="w-3.5 h-3.5" />
                                {u.text}
                              </div>
                            </div>
                            {u.status && <StatusPill status={u.status} />}
                          </div>
                          <button
                            onClick={() => router.push(u.href)}
                            className={`self-end h-9 px-4 rounded-full text-sm font-semibold ${
                              u.status?.tone === 'live'
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'bg-indigo-700 hover:bg-indigo-800 text-white'
                            }`}
                          >
                            Gabung
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {groups.length === 0 ? (
                  <EmptyState filter={filter} />
                ) : (
                  groups.map((g) => (
                    <section key={g.label}>
                      <SectionTitle>{g.label}</SectionTitle>
                      <ul className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-200/80 dark:border-slate-800 divide-y divide-gray-100 dark:divide-slate-800 overflow-hidden">
                        {g.items.map((it) => (
                          <ActivityRow key={it.key} item={it} onOpen={(href) => router.push(href)} />
                        ))}
                      </ul>
                    </section>
                  ))
                )}
              </>
            )}

            {error && <div className="text-red-500 text-sm">{error}</div>}
          </div>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function ActivityRow({ item: it, onOpen }: { item: Item; onOpen: (href: string) => void }) {
  const isMeeting = it.kind !== 'message';
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(it.href)}
        onKeyDown={(e) => e.key === 'Enter' && onOpen(it.href)}
        className={`group flex items-center gap-4 px-4 sm:px-5 py-3.5 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/60 ${
          it.unread ? 'bg-indigo-50/40 dark:bg-indigo-500/[0.06]' : ''
        }`}
      >
        {isMeeting ? (
          <div className="w-11 h-11 rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0">
            <Video className="w-5 h-5" />
          </div>
        ) : (
          <Avatar seed={it.avatar!.seed} label={it.avatar!.label} group={it.avatar!.group} />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`truncate ${it.unread ? 'font-bold' : 'font-semibold'}`}>{it.title}</span>
            {it.status && <StatusPill status={it.status} />}
          </div>
          <div
            className={`text-[13px] truncate mt-0.5 ${
              it.unread ? 'text-gray-800 dark:text-slate-200' : 'text-gray-500 dark:text-slate-400'
            }`}
          >
            {isMeeting && <Users className="inline w-3.5 h-3.5 mr-1 -mt-0.5 opacity-70" />}
            {it.text}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className="text-xs text-gray-400 dark:text-slate-500">{formatWhen(it.time)}</span>
          {it.unread > 0 ? (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-700 text-white text-[11px] font-bold flex items-center justify-center">
              {it.unread > 99 ? '99+' : it.unread}
            </span>
          ) : it.action ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpen(it.action!.href);
              }}
              className="h-7 px-3 rounded-full text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            >
              {it.action.label}
            </button>
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-300 dark:text-slate-600" />
          )}
        </div>
      </div>
    </li>
  );
}

const TONES = {
  indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: keyof typeof TONES;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200/80 dark:border-slate-800 text-left hover:border-indigo-200 dark:hover:border-indigo-500/40 transition-colors"
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${TONES[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-2xl font-bold leading-none">{value}</div>
        <div className="text-[13px] text-gray-500 dark:text-slate-400 mt-1">{label}</div>
      </div>
    </button>
  );
}

function StatusPill({ status }: { status: Status }) {
  const cls = {
    live: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    upcoming: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    open: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    ended: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400',
  }[status.tone];
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-semibold ${cls}`}>
      {status.tone === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
      {status.label}
    </span>
  );
}

function DateTile({ ms }: { ms: number }) {
  const d = new Date(ms);
  return (
    <div className="w-12 shrink-0 rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 text-center">
      <div className="bg-indigo-700 text-white text-[10px] font-bold uppercase py-0.5">
        {d.toLocaleDateString('id-ID', { month: 'short' })}
      </div>
      <div className="text-lg font-bold py-0.5">{d.getDate()}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-2.5 px-1">
      {children}
    </h2>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  return (
    <div className="text-center py-16 rounded-2xl border border-dashed border-gray-300 dark:border-slate-700">
      <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 flex items-center justify-center">
        <Bell className="w-6 h-6" />
      </div>
      <div className="font-semibold">Belum ada aktivitas</div>
      <div className="text-sm text-gray-500 dark:text-slate-400 mt-1">
        {filter === 'chats'
          ? 'Pesan baru akan muncul di sini.'
          : filter === 'meetings'
            ? 'Rapat yang Anda ikuti akan muncul di sini.'
            : 'Rapat dan pesan terbaru akan muncul di sini.'}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-200/80 dark:border-slate-800 divide-y divide-gray-100 dark:divide-slate-800">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
          <div className="w-11 h-11 rounded-full bg-gray-200 dark:bg-slate-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 rounded bg-gray-200 dark:bg-slate-800" />
            <div className="h-3 w-2/3 rounded bg-gray-100 dark:bg-slate-800/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- time

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Hari ini / Kemarin / Minggu ini / Lebih lama. */
function groupByDay(items: Item[], now: number) {
  const today = startOfDay(now);
  const buckets: { label: string; items: Item[] }[] = [
    { label: 'Hari ini', items: [] },
    { label: 'Kemarin', items: [] },
    { label: 'Minggu ini', items: [] },
    { label: 'Lebih lama', items: [] },
  ];
  for (const it of items) {
    const d = startOfDay(it.time);
    const idx = d >= today ? 0 : d >= today - DAY ? 1 : d >= today - 6 * DAY ? 2 : 3;
    buckets[idx].items.push(it);
  }
  return buckets.filter((b) => b.items.length);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function formatTime(ms: number) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Today: "14:05"; this week: "Sen 14:05"; older: "6 Nov". */
function formatWhen(ms: number) {
  const today = startOfDay(Date.now());
  const d = new Date(ms);
  if (ms >= today) return formatTime(ms);
  if (ms >= today - 6 * DAY) return `${d.toLocaleDateString('id-ID', { weekday: 'short' })} ${formatTime(ms)}`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

/** "Hari ini 14:00", "Besok 09:00", "Sen, 17 Nov". */
function relDay(ms: number, now: number) {
  const diff = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  if (diff === 0) return `Hari ini ${formatTime(ms)}`;
  if (diff === 1) return `Besok ${formatTime(ms)}`;
  return new Date(ms).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
}
