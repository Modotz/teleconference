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
  const base =
    'flex items-center justify-center gap-2 rounded-full transition-colors disabled:opacity-50';
  // round circular on mobile, pill with text on sm+
  const size = 'w-12 h-12 sm:w-auto sm:h-auto sm:px-4 sm:py-2.5';

  const color = danger
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : warningState
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : active
        ? 'bg-blue-600 hover:bg-blue-700 text-white'
        : 'bg-slate-700 hover:bg-slate-600 text-slate-100';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`${base} ${size} ${color} ${className}`}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <span className="hidden sm:inline text-sm">{label}</span>
    </button>
  );
}
