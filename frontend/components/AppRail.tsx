'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  MessageSquare,
  Video,
  Calendar,
  LogOut,
  Sun,
  Moon,
  type LucideIcon,
} from 'lucide-react';

type RailKey = 'activity' | 'chat' | 'meet' | 'calendar';

export default function AppRail({
  active,
  username,
  onCalendar,
}: {
  active: RailKey;
  username?: string;
  onCalendar?: () => void;
}) {
  const router = useRouter();
  const initial = (username?.[0] || '?').toUpperCase();

  // Reflect the current theme (set pre-paint by the layout script).
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggleTheme() {
    const el = document.documentElement;
    const next = !el.classList.contains('dark');
    el.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    setDark(next);
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.replace('/login');
  }

  return (
    <nav className="w-16 sm:w-[76px] shrink-0 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col items-center py-3">
      <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-indigo-900/40">
        <Video className="w-5 h-5 text-white" />
      </div>
      <div className="flex flex-col items-center gap-1 w-full">
        <RailItem icon={Bell} label="Activity" disabled />
        <RailItem
          icon={MessageSquare}
          label="Chat"
          active={active === 'chat'}
          onClick={() => router.push('/chat')}
        />
        <RailItem
          icon={Video}
          label="Meet"
          active={active === 'meet'}
          onClick={() => router.push('/dashboard')}
        />
        <RailItem
          icon={Calendar}
          label="Calendar"
          active={active === 'calendar'}
          onClick={onCalendar ?? (() => router.push('/dashboard'))}
        />
      </div>
      <div className="mt-auto flex flex-col items-center gap-1 w-full">
        <RailItem
          icon={dark ? Sun : Moon}
          label={dark ? 'Light' : 'Dark'}
          onClick={toggleTheme}
        />
        <RailItem icon={LogOut} label="Sign out" onClick={logout} />
        <div
          title={username}
          className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-semibold mt-1 text-white"
        >
          {initial}
        </div>
      </div>
    </nav>
  );
}

function RailItem({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`relative w-full flex flex-col items-center gap-1 py-2 rounded-lg transition-colors ${
        active
          ? 'text-white'
          : disabled
          ? 'text-gray-400 dark:text-slate-600 cursor-default'
          : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-200 dark:hover:bg-slate-800'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-indigo-500" />
      )}
      <Icon className={`w-5 h-5 ${active ? 'text-indigo-400' : ''}`} />
      <span className="text-[10px] leading-none">{label}</span>
    </button>
  );
}
