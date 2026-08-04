'use client';

import { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  /** When true, button is in a "dangerous" state (e.g. muted, cam off) — red */
  warningState?: boolean;
  disabled?: boolean;
  className?: string;
}

export default function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
  danger,
  warningState,
  disabled,
  className = '',
}: Props) {
  // Teams-style control button: icon on top, small label below (label hidden on
  // very small screens). Rounded rectangle, flat by default with hover fill.
  const base =
    'flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors disabled:opacity-50';
  const size = 'w-12 h-12 sm:w-16 sm:h-14';

  const color = danger
    ? 'bg-red-600 hover:bg-red-500 text-white'
    : warningState
      ? 'bg-red-600 hover:bg-red-500 text-white'
      : active
        ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
        : 'bg-slate-800/60 hover:bg-slate-700 text-slate-200';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`${base} ${size} ${color} ${className}`}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <span className="hidden sm:block text-[11px] leading-tight">{label}</span>
    </button>
  );
}
