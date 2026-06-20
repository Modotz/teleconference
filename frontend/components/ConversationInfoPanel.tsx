'use client';

import { useEffect, useState } from 'react';
import { X, UserPlus, Users, Search, UserMinus, LogOut } from 'lucide-react';
import { api } from '@/lib/api';

interface Member {
  id: string;
  userId: string;
  user: { id: string; username: string };
}

interface Conversation {
  id: string;
  name: string | null;
  isGroup: boolean;
  ownerId: string | null;
  members: Member[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  conversation: Conversation | null;
  currentUserId?: string;
  onUpdated: (conversation: Conversation) => void;
  /** Called when the current user leaves the group themselves */
  onLeft?: (conversationId: string) => void;
}

interface UserItem {
  id: string;
  username: string;
  email: string;
}

export default function ConversationInfoPanel({
  open,
  onClose,
  conversation,
  currentUserId,
  onUpdated,
  onLeft,
}: Props) {
  const [addMode, setAddMode] = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{
    userId: string;
    username: string;
    isSelf: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setAddMode(false);
      setQuery('');
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (!addMode) return;
    const t = setTimeout(() => loadUsers(query), 200);
    return () => clearTimeout(t);
  }, [query, addMode]);

  async function loadUsers(q: string) {
    try {
      const { users } = await api.listUsers(q);
      setUsers(users);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function addUser(userId: string) {
    if (!conversation) return;
    setAdding(userId);
    setError('');
    try {
      const { conversation: updated } = await api.addMember(conversation.id, userId);
      onUpdated(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(null);
    }
  }

  async function removeUser(userId: string) {
    if (!conversation) return;
    setRemoving(userId);
    setError('');
    try {
      const { conversation: updated } = await api.removeMember(conversation.id, userId);
      const isSelf = userId === currentUserId;
      setConfirmRemove(null);
      if (isSelf) {
        onLeft?.(conversation.id);
        onClose();
      } else {
        onUpdated(updated);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRemoving(null);
    }
  }

  if (!open || !conversation) return null;

  const existingIds = new Set(conversation.members.map((m) => m.userId));
  const addable = users.filter((u) => !existingIds.has(u.id));

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/60 z-40" aria-hidden />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,calc(100vw-2rem))] max-h-[85vh] bg-slate-900 border border-slate-800 rounded-lg z-50 shadow-2xl flex flex-col relative">
        <header className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" />
            {conversation.isGroup ? 'Group info' : 'Chat info'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="px-5 py-4 border-b border-slate-800">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            {conversation.isGroup ? 'Group name' : 'Contact'}
          </div>
          <div className="font-medium">{conversation.name || conversation.members.find((m) => m.userId !== currentUserId)?.user.username}</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-3 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              {conversation.members.length} member{conversation.members.length !== 1 ? 's' : ''}
            </div>
            {conversation.isGroup && (
              <button
                onClick={() => setAddMode((v) => !v)}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {addMode ? 'Cancel' : 'Add member'}
              </button>
            )}
          </div>

          {addMode ? (
            <div className="px-3 pb-3">
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search users..."
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 bg-slate-800 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              {addable.length === 0 ? (
                <div className="text-center text-slate-500 py-4 text-sm">
                  No users found
                </div>
              ) : (
                <ul>
                  {addable.map((u) => (
                    <li key={u.id}>
                      <button
                        onClick={() => addUser(u.id)}
                        disabled={adding === u.id}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-800 disabled:opacity-50"
                      >
                        <div className="w-9 h-9 bg-slate-700 rounded-full flex items-center justify-center text-sm font-medium">
                          {u.username[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <div className="text-sm font-medium truncate">{u.username}</div>
                          <div className="text-xs text-slate-500 truncate">{u.email}</div>
                        </div>
                        {adding === u.id ? (
                          <span className="text-xs text-slate-400">Adding...</span>
                        ) : (
                          <UserPlus className="w-4 h-4 text-blue-400" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <ul className="px-3 pb-3">
              {conversation.members.map((m) => {
                const isOwner = conversation.ownerId === m.userId;
                const isYou = m.userId === currentUserId;
                const iAmOwner = conversation.ownerId === currentUserId;
                // Show remove button when: I'm owner removing someone else, OR row is me (leave)
                const canRemove =
                  conversation.isGroup &&
                  ((iAmOwner && !isYou) || (isYou && !iAmOwner));
                return (
                  <li
                    key={m.userId}
                    className="group flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-800"
                  >
                    <div className="w-9 h-9 bg-slate-700 rounded-full flex items-center justify-center text-sm font-medium">
                      {m.user.username[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {m.user.username} {isYou && <span className="text-slate-500">(you)</span>}
                      </div>
                    </div>
                    {isOwner && (
                      <span className="text-xs text-blue-400 shrink-0">owner</span>
                    )}
                    {canRemove && (
                      <button
                        onClick={() =>
                          setConfirmRemove({
                            userId: m.userId,
                            username: m.user.username,
                            isSelf: isYou,
                          })
                        }
                        disabled={removing === m.userId}
                        title={isYou ? 'Leave group' : 'Remove from group'}
                        aria-label={isYou ? 'Leave group' : 'Remove'}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-red-400 hover:text-red-300 p-1 disabled:opacity-50 transition-opacity"
                      >
                        {isYou ? (
                          <LogOut className="w-4 h-4" />
                        ) : (
                          <UserMinus className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {confirmRemove && (
          <div className="absolute inset-0 bg-slate-900/95 rounded-lg flex items-center justify-center p-5 z-10">
            <div className="text-center max-w-sm">
              <div className="font-medium mb-2">
                {confirmRemove.isSelf
                  ? 'Leave this group?'
                  : `Remove ${confirmRemove.username}?`}
              </div>
              <div className="text-sm text-slate-400 mb-5">
                {confirmRemove.isSelf
                  ? "You won't receive messages from this group anymore."
                  : 'They will no longer be able to see new messages in this group.'}
              </div>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => setConfirmRemove(null)}
                  className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => removeUser(confirmRemove.userId)}
                  disabled={removing === confirmRemove.userId}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm disabled:opacity-50"
                >
                  {removing === confirmRemove.userId
                    ? 'Working...'
                    : confirmRemove.isSelf
                      ? 'Leave'
                      : 'Remove'}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="px-5 py-2 text-red-400 text-xs border-t border-slate-800">
            {error}
          </div>
        )}
      </div>
    </>
  );
}
