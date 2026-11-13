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
import { useChatUnread } from '@/hooks/useChatUnread';

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
  // On the chat page itself the list shows per-chat counts instead.
  const chatUnread = useChatUnread(active !== 'chat');

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
      <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center mb-4 shadow-lg shadow-brand-900/40">
        <Video className="w-5 h-5 text-white" />
      </div>
      <div className="flex flex-col items-center gap-1 w-full">
        <RailItem
          icon={Bell}
          label="Activity"
          active={active === 'activity'}
          onClick={() => router.push('/activity')}
        />
        <RailItem
          icon={MessageSquare}
          label="Chat"
          badge={chatUnread}
          active={active === 'chat'}
          onClick={() => router.push('/chat')}
        />
        <RailItem
          icon={Video}
          label="Meet"
          active={active === 'meet'}
          onClick={() => router.push('/meet')}
        />
        <RailItem
          icon={Calendar}
          label="Calendar"
          active={active === 'calendar'}
          onClick={onCalendar ?? (() => router.push('/calendar'))}
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
          className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-sm font-semibold mt-1 text-white"
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
  badge,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  badge?: number;
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
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand-500" />
      )}
      <span className="relative">
        <Icon className={`w-5 h-5 ${active ? 'text-brand-400' : ''}`} />
        {!!badge && badge > 0 && (
          <span
            aria-label={`${badge} pesan belum dibaca`}
            className="absolute -top-2 -right-3 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center ring-2 ring-white dark:ring-slate-900"
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="text-[10px] leading-none">{label}</span>
    </button>
  );
}
