import { Users } from 'lucide-react';

const AVATAR_COLORS = ['#a3264b', '#3b3fa8', '#3d7f6e', '#46505b', '#7c3a9e', '#b45309', '#1f6f9e'];

/** Initials on a colour that stays the same for the same person/chat. */
export default function Avatar({
  seed,
  label,
  group,
  size = 44,
}: {
  seed: string;
  label: string;
  group?: boolean;
  size?: number;
}) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const color = AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <div
      className="rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
      style={{ background: color, width: size, height: size }}
    >
      {group ? <Users className="w-5 h-5" /> : initials || '?'}
    </div>
  );
}
