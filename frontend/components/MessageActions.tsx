'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Smile,
  MoreHorizontal,
  Reply,
  Forward,
  Copy,
  Pencil,
  Star,
  Pin,
  PinOff,
  Info,
  Trash2,
  Flag,
  type LucideIcon,
} from 'lucide-react';

/** Quick reactions, as in the PASTI design. */
export const QUICK_REACTIONS = ['👍', '✅', '❤️', '🙏', '😮'];

export type MessageAction =
  | 'reply'
  | 'forward'
  | 'copy'
  | 'edit'
  | 'star'
  | 'pin'
  | 'info'
  | 'deleteMe'
  | 'deleteAll'
  | 'report';

export interface ActionAvailability {
  canEdit: boolean;
  canPin: boolean;
  pinned: boolean;
  starred: boolean;
  canDeleteAll: boolean;
  isMine: boolean;
  hasText: boolean;
  myReaction: string | null;
}

/**
 * The 😊 / ⋯ buttons next to a bubble (shown on hover) and their popover:
 * quick reactions on top, actions below.
 */
export default function MessageActions({
  align,
  avail,
  onReact,
  onAction,
}: {
  /** Which side of the bubble the buttons sit on. */
  align: 'left' | 'right';
  avail: ActionAvailability;
  onReact: (emoji: string | null) => void;
  onAction: (a: MessageAction) => void;
}) {
  const [open, setOpen] = useState<null | 'react' | 'menu'>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={anchorRef}
      className={`flex items-center gap-1 self-start mt-1 ${
        open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
      } transition-opacity`}
    >
      <ToolbarButton label="Reaksi" onClick={() => setOpen(open === 'react' ? null : 'react')}>
        <Smile className="w-[18px] h-[18px]" />
      </ToolbarButton>
      <ToolbarButton label="Lainnya" onClick={() => setOpen(open === 'menu' ? null : 'menu')}>
        <MoreHorizontal className="w-[18px] h-[18px]" />
      </ToolbarButton>

      {open && (
        <Popover anchor={anchorRef} align={align} onClose={() => setOpen(null)}>
          <div className="flex items-center justify-between gap-1 px-2 py-1.5">
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  onReact(avail.myReaction === e ? null : e);
                  setOpen(null);
                }}
                className={`w-10 h-10 text-[22px] rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-slate-700 ${
                  avail.myReaction === e ? 'bg-indigo-50 dark:bg-indigo-500/20' : ''
                }`}
                aria-label={`Reaksi ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
          {open === 'menu' && (
            <div className="border-t border-gray-100 dark:border-slate-700 mt-1 pt-1">
              <Item icon={Reply} label="Balas" onClick={() => pick('reply')} />
              <Item icon={Forward} label="Teruskan" onClick={() => pick('forward')} />
              {avail.hasText && <Item icon={Copy} label="Salin" onClick={() => pick('copy')} />}
              {avail.canEdit && <Item icon={Pencil} label="Edit" onClick={() => pick('edit')} />}
              <Item
                icon={Star}
                label={avail.starred ? 'Hapus bintang' : 'Beri bintang'}
                onClick={() => pick('star')}
              />
              {avail.canPin && (
                <Item
                  icon={avail.pinned ? PinOff : Pin}
                  label={avail.pinned ? 'Lepas sematan' : 'Sematkan'}
                  onClick={() => pick('pin')}
                />
              )}
              {avail.isMine && <Item icon={Info} label="Info pesan" onClick={() => pick('info')} />}
              <Item icon={Trash2} label="Hapus untuk saya" danger onClick={() => pick('deleteMe')} />
              {avail.canDeleteAll && (
                <Item icon={Trash2} label="Hapus untuk semua" danger onClick={() => pick('deleteAll')} />
              )}
              {!avail.isMine && (
                <Item icon={Flag} label="Laporkan ke admin/HR" danger onClick={() => pick('report')} />
              )}
            </div>
          )}
        </Popover>
      )}
    </div>
  );

  function pick(a: MessageAction) {
    setOpen(null);
    onAction(a);
  }
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 dark:text-slate-400 bg-white/80 dark:bg-slate-800/80 hover:bg-white dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-slate-100 border border-gray-200/70 dark:border-slate-700"
    >
      {children}
    </button>
  );
}

function Item({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[15px] text-left hover:bg-gray-50 dark:hover:bg-slate-700/60 ${
        danger ? 'text-red-500 dark:text-red-400' : 'text-gray-800 dark:text-slate-100'
      }`}
    >
      <Icon className="w-[18px] h-[18px] shrink-0 opacity-80" />
      {label}
    </button>
  );
}

/**
 * Fixed-position popover next to the toolbar. Opens upward when there is no
 * room below; closes on outside click, Escape, scroll or resize.
 */
function Popover({
  anchor,
  align,
  onClose,
  children,
}: {
  anchor: React.RefObject<HTMLDivElement | null>;
  align: 'left' | 'right';
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!a || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margin = 8;
    let top = a.bottom + 6;
    if (top + h > window.innerHeight - margin) top = Math.max(margin, a.top - h - 6);
    let left = align === 'right' ? a.left : a.right - w;
    left = Math.min(Math.max(margin, left), window.innerWidth - w - margin);
    setPos({ top, left });
  }, [anchor, align]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className="fixed z-50 w-[300px] p-1.5 rounded-2xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 shadow-xl shadow-indigo-900/10"
    >
      {children}
    </div>
  );
}
