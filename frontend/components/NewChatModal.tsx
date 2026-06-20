'use client';

import { useEffect, useState } from 'react';
import { X, Search, Users, User } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (conversation: any) => void;
}

interface UserItem {
  id: string;
  username: string;
  email: string;
}

export default function NewChatModal({ open, onClose, onCreated }: Props) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isGroup, setIsGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setIsGroup(false);
    setGroupName('');
    setError('');
    setQuery('');
    load('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(query), 250);
    return () => clearTimeout(t);
  }, [query, open]);

  async function load(q: string) {
    try {
      const { users } = await api.listUsers(q);
      setUsers(users);
    } catch (err: any) {
      setError(err.message);
    }
  }

  function toggleUser(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Auto-switch to group mode when 2+ users picked
  useEffect(() => {
    if (selected.size >= 2 && !isGroup) setIsGroup(true);
    if (selected.size <= 1 && isGroup) setIsGroup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.size]);

  async function create() {
    if (selected.size === 0) return;
    if (isGroup && !groupName.trim()) {
      setError('Group name required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { conversation } = await api.createConversation({
        userIds: Array.from(selected),
        name: isGroup ? groupName.trim() : undefined,
        isGroup,
      });
      onCreated(conversation);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/60 z-40" aria-hidden />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(480px,calc(100vw-2rem))] max-h-[85vh] bg-slate-900 border border-slate-800 rounded-lg z-50 shadow-2xl flex flex-col">
        <header className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            {isGroup ? <Users className="w-5 h-5" /> : <User className="w-5 h-5" />}
            {isGroup ? 'New group' : 'New chat'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="px-5 py-3 space-y-3">
          {isGroup && (
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              className="w-full px-3 py-2 bg-slate-800 rounded outline-none focus:ring-1 focus:ring-blue-500"
            />
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users..."
              className="w-full pl-9 pr-3 py-2 bg-slate-800 rounded outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {selected.size > 0 && (
            <div className="text-xs text-slate-400">
              {selected.size} selected{selected.size >= 2 ? ' • will create group' : ''}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          {users.length === 0 ? (
            <div className="text-center text-slate-500 py-8 text-sm">No users found</div>
          ) : (
            <ul>
              {users.map((u) => {
                const isSelected = selected.has(u.id);
                return (
                  <li key={u.id}>
                    <button
                      onClick={() => toggleUser(u.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-slate-800 ${
                        isSelected ? 'bg-slate-800' : ''
                      }`}
                    >
                      <div className="w-9 h-9 bg-slate-700 rounded-full flex items-center justify-center text-sm font-medium">
                        {u.username[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="text-sm font-medium truncate">{u.username}</div>
                        <div className="text-xs text-slate-500 truncate">{u.email}</div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-600'
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="w-3 h-3 text-white"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={3}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-800 flex items-center justify-between gap-3">
          {error ? (
            <div className="text-red-400 text-xs flex-1">{error}</div>
          ) : (
            <div className="flex-1" />
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-slate-300 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={create}
            disabled={loading || selected.size === 0}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm disabled:opacity-50"
          >
            {loading ? 'Creating...' : isGroup ? 'Create group' : 'Start chat'}
          </button>
        </footer>
      </div>
    </>
  );
}
