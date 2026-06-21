'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LogOut,
  Plus,
  Users,
  Video,
  MessageSquare,
  CalendarClock,
  Link as LinkIcon,
  Check,
  Calendar,
} from 'lucide-react';
import { api } from '@/lib/api';

interface Room {
  id: string;
  name: string;
  description: string | null;
  scheduledAt: string | null;
  owner: { id: string; username: string };
  _count: { participants: number };
  createdAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [me, setMe] = useState<{ username: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (!token) {
      router.replace('/login');
      return;
    }
    if (userStr) setMe(JSON.parse(userStr));
    load();
  }, [router]);

  async function load() {
    setLoading(true);
    try {
      const { rooms } = await api.listRooms();
      setRooms(rooms);
    } catch (err: any) {
      // Expired / invalid session → clear it and send back to login.
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
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const { room } = await api.createRoom({
        name: name.trim(),
        description: description.trim() || undefined,
        scheduledAt: scheduled && scheduledAt
          ? new Date(scheduledAt).toISOString()
          : undefined,
      });
      setName('');
      setDescription('');
      setScheduledAt('');
      if (scheduled) {
        // Scheduled meeting → stay on dashboard, show in list
        setScheduled(false);
        await load();
      } else {
        // Instant room → jump straight in
        router.push(`/room/${room.id}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function roomUrl(id: string) {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/room/${id}`;
  }

  async function copyLink(id: string) {
    const url = roomUrl(id);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1800);
  }

  function joinByLink(e: React.FormEvent) {
    e.preventDefault();
    const raw = joinInput.trim();
    if (!raw) return;
    // Accept a full URL or a bare room id
    const match = raw.match(/\/room\/([0-9a-fA-F-]{36})/);
    const id = match ? match[1] : raw;
    router.push(`/room/${id}`);
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.replace('/login');
  }

  const now = Date.now();
  const { upcoming, instant } = useMemo(() => {
    const upcoming: Room[] = [];
    const instant: Room[] = [];
    for (const r of rooms) {
      if (r.scheduledAt && new Date(r.scheduledAt).getTime() > now) {
        upcoming.push(r);
      } else {
        instant.push(r);
      }
    }
    upcoming.sort(
      (a, b) =>
        new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()
    );
    return { upcoming, instant };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms]);

  return (
    <main className="min-h-screen p-4 sm:p-6 md:p-8 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold truncate">Dashboard</h1>
          {me && (
            <div className="text-xs sm:text-sm text-slate-400 mt-0.5">
              Signed in as {me.username}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => router.push('/chat')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Chat</span>
          </button>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Create / schedule */}
      <form onSubmit={onCreate} className="bg-slate-800/60 rounded-lg p-4 mb-4 space-y-3">
        <input
          type="text"
          placeholder="Meeting / room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2.5 bg-slate-900 rounded outline-none focus:ring-1 focus:ring-blue-500"
        />

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={scheduled}
            onChange={(e) => setScheduled(e.target.checked)}
            className="w-4 h-4 accent-blue-600"
          />
          <CalendarClock className="w-4 h-4 text-slate-400" />
          Schedule for later
        </label>

        {scheduled && (
          <div className="space-y-3 pl-1">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Date & time</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 rounded outline-none focus:ring-1 focus:ring-blue-500 [color-scheme:dark]"
              />
            </div>
            <textarea
              placeholder="Description / agenda (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-slate-900 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={creating || !name.trim() || (scheduled && !scheduledAt)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 rounded font-medium disabled:opacity-50"
        >
          {scheduled ? (
            <>
              <CalendarClock className="w-4 h-4" />
              {creating ? 'Scheduling...' : 'Schedule meeting'}
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              {creating ? 'Creating...' : 'Start instant meeting'}
            </>
          )}
        </button>
      </form>

      {/* Join by link */}
      <form onSubmit={joinByLink} className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="Paste a meeting link to join..."
          value={joinInput}
          onChange={(e) => setJoinInput(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={!joinInput.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm disabled:opacity-50"
        >
          <LinkIcon className="w-4 h-4" />
          Join
        </button>
      </form>

      {error && <div className="text-red-400 mb-4 text-sm">{error}</div>}

      {/* Upcoming scheduled meetings */}
      {upcoming.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-400" />
            Upcoming meetings
          </h2>
          <ul className="grid gap-3">
            {upcoming.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                copied={copiedId === room.id}
                onCopy={() => copyLink(room.id)}
                onJoin={() => router.push(`/room/${room.id}`)}
                scheduled
              />
            ))}
          </ul>
        </section>
      )}

      {/* Instant / active rooms */}
      <section>
        <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
          <Video className="w-5 h-5 text-slate-400" />
          My rooms
        </h2>
        {loading ? (
          <div className="text-slate-400">Loading...</div>
        ) : instant.length === 0 ? (
          <div className="text-slate-400 bg-slate-800/50 rounded p-6 text-center text-sm">
            No rooms yet. Start an instant meeting or schedule one above.
          </div>
        ) : (
          <ul className="grid gap-3">
            {instant.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                copied={copiedId === room.id}
                onCopy={() => copyLink(room.id)}
                onJoin={() => router.push(`/room/${room.id}`)}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function RoomCard({
  room,
  copied,
  onCopy,
  onJoin,
  scheduled,
}: {
  room: Room;
  copied: boolean;
  onCopy: () => void;
  onJoin: () => void;
  scheduled?: boolean;
}) {
  return (
    <li className="bg-slate-800 p-3 sm:p-4 rounded-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{room.name}</div>
          {scheduled && room.scheduledAt && (
            <div className="text-sm text-blue-300 flex items-center gap-1.5 mt-0.5">
              <CalendarClock className="w-3.5 h-3.5" />
              {formatSchedule(room.scheduledAt)}
            </div>
          )}
          {room.description && (
            <div className="text-xs text-slate-400 mt-1 line-clamp-2">
              {room.description}
            </div>
          )}
          {!scheduled && (
            <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
              <Users className="w-3.5 h-3.5" />
              {room._count.participants} joined
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
            title="Copy invite link"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-400" />
                <span className="hidden sm:inline">Copied</span>
              </>
            ) : (
              <>
                <LinkIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Copy link</span>
              </>
            )}
          </button>
          <button
            onClick={onJoin}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium"
          >
            <Video className="w-4 h-4" />
            <span className="hidden sm:inline">Join</span>
          </button>
        </div>
      </div>
    </li>
  );
}

function formatSchedule(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today at ${time}`;
  if (isTomorrow) return `Tomorrow at ${time}`;
  return d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }) + ` at ${time}`;
}
