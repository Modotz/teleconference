'use client';

import { useEffect, useState } from 'react';
import { Check, CheckCheck, X } from 'lucide-react';
import { api } from '@/lib/api';

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-bold text-lg">{title}</h2>
          <button onClick={onClose} aria-label="Tutup" className="text-gray-400 hover:text-gray-900 dark:hover:text-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

const primaryBtn =
  'px-4 h-10 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white text-sm font-semibold disabled:opacity-50';
const ghostBtn =
  'px-4 h-10 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-sm font-medium';

/** Pick up to 5 chats to forward a message to. */
export function ForwardDialog({
  conversations,
  onForward,
  onClose,
}: {
  conversations: { id: string; title: string }[];
  onForward: (ids: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const list = conversations.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 5 ? [...p, id] : p));

  return (
    <Dialog title="Teruskan ke…" onClose={onClose}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari chat"
        autoFocus
        className="w-full h-10 px-3 mb-2 rounded-xl !border-0 bg-gray-100 dark:bg-slate-800 text-sm outline-none"
      />
      <div className="max-h-72 overflow-y-auto -mx-1">
        {list.map((c) => (
          <label key={c.id} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
            <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} className="w-4 h-4 accent-indigo-700" />
            <span className="truncate">{c.title}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-gray-500 dark:text-slate-400">{picked.length}/5 dipilih</span>
        <button
          disabled={!picked.length || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onForward(picked);
            } finally {
              setBusy(false);
            }
          }}
          className={primaryBtn}
        >
          {busy ? 'Meneruskan…' : 'Teruskan'}
        </button>
      </div>
    </Dialog>
  );
}

/** Confirm a delete-for-everyone. */
export function DeleteDialog({
  forEveryone,
  onConfirm,
  onClose,
}: {
  forEveryone: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={forEveryone ? 'Hapus untuk semua?' : 'Hapus untuk saya?'} onClose={onClose}>
      <p className="text-sm text-gray-600 dark:text-slate-300">
        {forEveryone
          ? 'Pesan akan diganti dengan "Pesan ini telah dihapus" untuk semua anggota chat.'
          : 'Pesan hanya hilang dari perangkat Anda. Anggota lain masih bisa melihatnya.'}
      </p>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className={ghostBtn}>
          Batal
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
          className="px-4 h-10 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
        >
          Hapus
        </button>
      </div>
    </Dialog>
  );
}

/** Who received / read one of my messages. */
export function ReceiptsDialog({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.messageReceipts>>['receipts'] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .messageReceipts(messageId)
      .then((r) => setRows(r.receipts))
      .catch((e) => setError(e.message));
  }, [messageId]);

  const when = (s: string | null) =>
    s ? new Date(s).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <Dialog title="Info pesan" onClose={onClose}>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!rows && !error && <p className="text-sm text-gray-500">Memuat…</p>}
      <ul className="space-y-2">
        {rows?.map((r) => (
          <li key={r.user.id} className="flex items-center gap-3">
            {r.status === 'read' ? (
              <CheckCheck className="w-4 h-4 text-indigo-600" />
            ) : r.status === 'delivered' ? (
              <CheckCheck className="w-4 h-4 text-gray-400" />
            ) : (
              <Check className="w-4 h-4 text-gray-400" />
            )}
            <span className="flex-1 truncate">{r.user.fullName || r.user.username}</span>
            <span className="text-xs text-gray-500 dark:text-slate-400 text-right">
              {r.status === 'read'
                ? `Dibaca ${when(r.readAt)}`
                : r.status === 'delivered'
                  ? `Diterima ${when(r.deliveredAt)}`
                  : 'Belum diterima'}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** Report a message to admins / HR with a reason. */
export function ReportDialog({ onSubmit, onClose }: { onSubmit: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Laporkan ke admin/HR" onClose={onClose}>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoFocus
        rows={4}
        placeholder="Jelaskan alasan laporan"
        className="w-full p-3 rounded-xl !border-0 bg-gray-100 dark:bg-slate-800 text-sm outline-none resize-none"
      />
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className={ghostBtn}>
          Batal
        </button>
        <button
          disabled={!reason.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(reason.trim());
            } finally {
              setBusy(false);
            }
          }}
          className={primaryBtn}
        >
          Kirim laporan
        </button>
      </div>
    </Dialog>
  );
}
