'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '@/lib/api';
import { getServerBase } from '@/lib/config';

/**
 * Total unread chat messages, kept live while you are on another page
 * (Activity, Meet, Calendar) — for the badge on the Chat rail item.
 *
 * Counts come from the server (`unreadCount` per conversation), so they match
 * the chat list; muted chats are left out. Any chat event re-fetches them.
 */
export function useChatUnread(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const token = localStorage.getItem('token');
    let user: { id?: string; guest?: boolean } = {};
    try {
      user = JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      /* ignore */
    }
    if (!token || user.guest) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      try {
        const { conversations } = await api.listConversations();
        const now = Date.now();
        const total = conversations.reduce((sum: number, c: any) => {
          const muted = c.mutedUntil && new Date(c.mutedUntil).getTime() > now;
          return sum + (muted ? 0 : c.unreadCount || 0);
        }, 0);
        if (alive) setCount(total);
      } catch {
        /* offline / signed out — keep the last count */
      }
    };
    // Bursts of messages → one request.
    const refreshSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    };

    refresh();
    const socket = io(getServerBase(), { auth: { token }, transports: ['websocket'] });
    socket.on('chat:notify', refreshSoon);
    // Read on another device (phone, other tab) lowers the count.
    socket.on('chat:read', (e: { userId: string }) => {
      if (e.userId === user.id) refreshSoon();
    });
    socket.on('chat:added', refreshSoon);
    socket.on('chat:removed', refreshSoon);
    socket.io.on('reconnect', refreshSoon);
    window.addEventListener('focus', refreshSoon);

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', refreshSoon);
      socket.disconnect();
    };
  }, [enabled]);

  return enabled ? count : 0;
}
