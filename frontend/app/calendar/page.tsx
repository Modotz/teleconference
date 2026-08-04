'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Video,
  Plus,
  Link as LinkIcon,
  Check,
  Clock,
  CalendarClock,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import AppRail from '@/components/AppRail';

interface Room {
  id: string;
  name: string;
  description: string | null;
  scheduledAt: string | null;
  durationMinutes?: number | null;
  owner: { id: string; username: string };
  _count: { participants: number };
  createdAt: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const HOUR_PX = 48; // height of one hour row in the week view

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const pad = (n: number) => String(n).padStart(2, '0');
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function startOfWeek(d: Date) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - s.getDay());
  return s;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function CalendarPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ username: string } | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [view, setView] = useState<'month' | 'week'>('month');
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [selected, setSelected] = useState<Date>(() => new Date());

  // New-meeting modal, pre-filled with the clicked date/time.
  const [scheduleAt, setScheduleAt] = useState<Date | null>(null);

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
        const { rooms } = await api.listRooms();
        setRooms(rooms);
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

  const byDay = useMemo(() => {
    const map = new Map<string, Room[]>();
    for (const r of rooms) {
      if (!r.scheduledAt) continue;
      const d = new Date(r.scheduledAt);
      const k = dayKey(d);
      const list = map.get(k) || [];
      list.push(r);
      map.set(k, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()
      );
    }
    return map;
  }, [rooms]);

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(year, month, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  const weekStart = useMemo(() => startOfWeek(selected), [selected]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const selectedMeetings = byDay.get(dayKey(selected)) || [];

  const upcoming = useMemo(
    () =>
      rooms
        .filter((r) => r.scheduledAt && new Date(r.scheduledAt).getTime() >= Date.now())
        .sort(
          (a, b) =>
            new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()
        ),
    [rooms]
  );

  function prev() {
    if (view === 'month')
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
    else setSelected(addDays(selected, -7));
  }
  function next() {
    if (view === 'month')
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
    else setSelected(addDays(selected, 7));
  }
  function goToday() {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelected(now);
  }

  function openSchedule(day: Date, hour?: number) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour ?? 9, 0, 0);
    setScheduleAt(d);
  }

  async function copyLink(id: string) {
    const url = `${window.location.origin}/room/${id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
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

  const title =
    view === 'month'
      ? `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`
      : `${weekDays[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString(
          [],
          { month: 'short', day: 'numeric', year: 'numeric' }
        )}`;

  return (
    <div className="min-h-screen flex bg-gray-100 dark:bg-slate-950 text-gray-900 dark:text-slate-100">
      <AppRail active="calendar" username={me?.username} />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 h-14 border-b border-gray-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/50 backdrop-blur">
          <h1 className="text-lg font-semibold leading-tight truncate">Calendar</h1>
          <div className="flex items-center gap-2 shrink-0">
            {/* Month / Week toggle */}
            <div className="flex rounded-md overflow-hidden border border-gray-300 dark:border-slate-700 text-sm">
              {(['month', 'week'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 capitalize ${
                    view === v
                      ? 'bg-brand-600 text-white'
                      : 'hover:bg-gray-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <button
              onClick={() => openSchedule(selected, new Date().getHours())}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-md text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New meeting</span>
            </button>
          </div>
        </header>

        {/* Sub bar: navigation */}
        <div className="flex items-center gap-2 px-4 sm:px-6 py-2 border-b border-gray-200 dark:border-slate-800">
          <button
            onClick={prev}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label="Previous"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goToday}
            className="px-2.5 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-700"
          >
            Today
          </button>
          <button
            onClick={next}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label="Next"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <h2 className="font-semibold ml-1">{title}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {view === 'month' ? (
            <div className="max-w-5xl mx-auto grid gap-6 lg:grid-cols-[1fr_320px]">
              {/* Month grid */}
              <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
                <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 dark:text-slate-400 mb-1">
                  {WEEKDAYS.map((w) => (
                    <div key={w} className="py-1">
                      {w}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((d, i) => {
                    if (!d) return <div key={i} className="aspect-square" />;
                    const meetings = byDay.get(dayKey(d)) || [];
                    const isToday = sameDay(d, today);
                    const isSelected = sameDay(d, selected);
                    return (
                      <button
                        key={i}
                        onClick={() => setSelected(d)}
                        onDoubleClick={() => openSchedule(d, 9)}
                        title="Click to view · double-click to schedule"
                        className={`group relative aspect-square rounded-lg p-1 flex flex-col items-center text-sm transition-colors ${
                          isSelected
                            ? 'bg-brand-600 text-white'
                            : 'hover:bg-gray-100 dark:hover:bg-slate-800'
                        } ${isToday && !isSelected ? 'ring-1 ring-brand-500' : ''}`}
                      >
                        <span
                          className={`mt-0.5 ${
                            isToday && !isSelected
                              ? 'text-brand-600 dark:text-brand-300 font-semibold'
                              : ''
                          }`}
                        >
                          {d.getDate()}
                        </span>
                        {meetings.length > 0 && (
                          <span className="mt-auto mb-1 flex gap-0.5">
                            {meetings.slice(0, 3).map((_, j) => (
                              <span
                                key={j}
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isSelected ? 'bg-white' : 'bg-brand-500'
                                }`}
                              />
                            ))}
                          </span>
                        )}
                        {/* Quick add on hover */}
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            openSchedule(d, 9);
                          }}
                          className={`absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center ${
                            isSelected
                              ? 'bg-white/20 hover:bg-white/30'
                              : 'bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600'
                          }`}
                        >
                          <Plus className="w-3 h-3" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Day / upcoming panel */}
              <aside className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium flex items-center gap-2">
                      <CalendarClock className="w-4 h-4 text-brand-500" />
                      {selected.toLocaleDateString([], {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </h3>
                    <button
                      onClick={() => openSchedule(selected, 9)}
                      className="text-xs text-brand-600 dark:text-brand-300 hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> New
                    </button>
                  </div>
                  {loading ? (
                    <div className="text-sm text-gray-500 dark:text-slate-400">Loading…</div>
                  ) : selectedMeetings.length === 0 ? (
                    <div className="text-sm text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-4">
                      No meetings on this day.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {selectedMeetings.map((r) => (
                        <MeetingItem
                          key={r.id}
                          room={r}
                          copied={copiedId === r.id}
                          onCopy={() => copyLink(r.id)}
                          onJoin={() => router.push(`/room/${r.id}`)}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                {upcoming.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2 text-sm text-gray-500 dark:text-slate-400">
                      Upcoming
                    </h3>
                    <ul className="space-y-2">
                      {upcoming.slice(0, 5).map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            const d = new Date(r.scheduledAt!);
                            setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
                            setSelected(d);
                          }}
                          className="w-full text-left bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg px-3 py-2 hover:border-brand-400 dark:hover:border-brand-500"
                        >
                          <div className="text-sm font-medium truncate">{r.name}</div>
                          <div className="text-xs text-brand-600 dark:text-brand-300 flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3" />
                            {formatWhen(r.scheduledAt!)}
                          </div>
                        </button>
                      ))}
                    </ul>
                  </div>
                )}
              </aside>
            </div>
          ) : (
            <WeekView
              weekDays={weekDays}
              today={today}
              byDay={byDay}
              onSlot={(day, hour) => openSchedule(day, hour)}
              onJoin={(id) => router.push(`/room/${id}`)}
            />
          )}

          {error && (
            <div className="max-w-5xl mx-auto text-red-500 text-sm mt-4">{error}</div>
          )}
        </div>
      </div>

      {scheduleAt && (
        <ScheduleModal
          initial={scheduleAt}
          onClose={() => setScheduleAt(null)}
          onCreated={(room) => {
            setRooms((prev) => [room, ...prev]);
            if (room.scheduledAt) {
              const d = new Date(room.scheduledAt);
              setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
              setSelected(d);
            }
            setScheduleAt(null);
          }}
        />
      )}
    </div>
  );
}

function WeekView({
  weekDays,
  today,
  byDay,
  onSlot,
  onJoin,
}: {
  weekDays: Date[];
  today: Date;
  byDay: Map<string, Room[]>;
  onSlot: (day: Date, hour: number) => void;
  onJoin: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Scroll to ~8am on mount.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * HOUR_PX - 12;
  }, []);

  return (
    <div className="max-w-5xl mx-auto bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-gray-200 dark:border-slate-800">
        <div className="border-r border-gray-200 dark:border-slate-800" />
        {weekDays.map((d, i) => {
          const isToday = sameDay(d, today);
          return (
            <div
              key={i}
              className="px-1 py-2 text-center border-r border-gray-200 dark:border-slate-800 last:border-r-0"
            >
              <div className="text-xs text-gray-500 dark:text-slate-400">
                {WEEKDAYS[d.getDay()]}
              </div>
              <div
                className={`text-sm font-medium mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full ${
                  isToday ? 'bg-brand-600 text-white' : ''
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="max-h-[60vh] overflow-y-auto">
        <div className="grid grid-cols-[56px_repeat(7,1fr)] relative">
          {/* Hour gutter */}
          <div className="border-r border-gray-200 dark:border-slate-800">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                style={{ height: HOUR_PX }}
                className="text-[10px] text-gray-400 dark:text-slate-500 text-right pr-1 -mt-1.5"
              >
                {h === 0 ? '' : `${pad(h)}:00`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day, di) => {
            const meetings = byDay.get(dayKey(day)) || [];
            return (
              <div
                key={di}
                className="relative border-r border-gray-200 dark:border-slate-800 last:border-r-0"
              >
                {/* Clickable hour slots */}
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    onClick={() => onSlot(day, h)}
                    style={{ height: HOUR_PX }}
                    title={`Schedule ${WEEKDAYS[day.getDay()]} ${pad(h)}:00`}
                    className="block w-full border-b border-gray-100 dark:border-slate-800/60 hover:bg-brand-50 dark:hover:bg-slate-800/60"
                  />
                ))}
                {/* Meeting blocks */}
                {meetings.map((r) => {
                  const d = new Date(r.scheduledAt!);
                  const top = (d.getHours() + d.getMinutes() / 60) * HOUR_PX;
                  const dur = r.durationMinutes || 60;
                  const height = Math.max(18, (dur / 60) * HOUR_PX - 4);
                  const end = new Date(d.getTime() + dur * 60000);
                  return (
                    <button
                      key={r.id}
                      onClick={() => onJoin(r.id)}
                      style={{ top, height }}
                      className="absolute left-0.5 right-0.5 z-10 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-left px-1.5 py-0.5 overflow-hidden shadow-sm"
                      title={`${r.name} · ${d.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}–${end.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })} · click to join`}
                    >
                      <div className="text-[10px] leading-tight opacity-90">
                        {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="text-xs font-medium truncate leading-tight">
                        {r.name}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ScheduleModal({
  initial,
  onClose,
  onCreated,
}: {
  initial: Date;
  onClose: () => void;
  onCreated: (room: Room) => void;
}) {
  const [name, setName] = useState('');
  const [when, setWhen] = useState(toLocalInput(initial));
  const [duration, setDuration] = useState(60);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !when) return;
    setSaving(true);
    setErr('');
    try {
      const { room } = await api.createRoom({
        name: name.trim(),
        description: description.trim() || undefined,
        scheduledAt: new Date(when).toISOString(),
        durationMinutes: duration,
      });
      onCreated(room);
    } catch (e: any) {
      setErr(e.message || 'Failed to schedule');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-6 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-brand-500" /> Schedule meeting
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">
            Meeting name
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekly sync"
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 rounded outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">
            Date &amp; time
          </label>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 rounded outline-none focus:ring-1 focus:ring-brand-500 dark:[color-scheme:dark]"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">
            Duration
          </label>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-brand-500 dark:[color-scheme:dark]"
          >
            {[15, 30, 45, 60, 90, 120, 180].map((m) => (
              <option key={m} value={m}>
                {m < 60
                  ? `${m} min`
                  : m % 60 === 0
                  ? `${m / 60} hour${m === 60 ? '' : 's'}`
                  : `${Math.floor(m / 60)}h ${m % 60}m`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-brand-500 resize-none"
          />
        </div>

        {err && <p className="text-red-500 text-xs">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim() || !when}
            className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </form>
    </div>
  );
}

function MeetingItem({
  room,
  copied,
  onCopy,
  onJoin,
}: {
  room: Room;
  copied: boolean;
  onCopy: () => void;
  onJoin: () => void;
}) {
  return (
    <li className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-3">
      <div className="text-xs text-brand-600 dark:text-brand-300 flex items-center gap-1 mb-0.5">
        <Clock className="w-3 h-3" />
        {(() => {
          const start = new Date(room.scheduledAt!);
          const end = new Date(
            start.getTime() + (room.durationMinutes || 60) * 60000
          );
          const t = (d: Date) =>
            d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return `${t(start)} – ${t(end)}`;
        })()}
      </div>
      <div className="font-medium truncate">{room.name}</div>
      {room.description && (
        <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">
          {room.description}
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <button
          onClick={onJoin}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded text-sm font-medium"
        >
          <Video className="w-4 h-4" />
          Join
        </button>
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 rounded text-sm"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-green-500" /> Copied
            </>
          ) : (
            <>
              <LinkIcon className="w-4 h-4" /> Copy link
            </>
          )}
        </button>
      </div>
    </li>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
    ` · ${time}`
  );
}
