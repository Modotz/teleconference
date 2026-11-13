import prisma from '../config/prisma.js';
import { appEvents } from '../events.js';
import { seal } from '../lib/contentCrypto.js';
import { isAdminRole, messageInclude, serializeMessage } from '../lib/messages.js';

const userSockets = new Map(); // userId -> Set<socketId>
let ioRef = null;

/** Online = at least one connected socket (KH-1). */
export function isOnline(userId) {
  return userSockets.has(userId);
}

/** Everyone who shares a conversation with `userId`. */
async function contactsOf(userId) {
  const rows = await prisma.conversationMember.findMany({
    where: { conversation: { members: { some: { userId } } }, NOT: { userId } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return rows.map((r) => r.userId);
}

function broadcastPresence(userId, online) {
  contactsOf(userId)
    .then((ids) => {
      for (const id of ids) ioRef?.to(`user:${id}`).emit('presence', { userId, online });
    })
    .catch((err) => console.error('presence broadcast failed', err.message));
}

export function registerUserSocket(socket, userId) {
  let set = userSockets.get(userId);
  if (!set) {
    set = new Set();
    userSockets.set(userId, set);
  }
  const cameOnline = set.size === 0;
  set.add(socket.id);
  if (cameOnline) broadcastPresence(userId, true);

  socket.join(`user:${userId}`);

  socket.on('disconnect', () => {
    const s = userSockets.get(userId);
    if (s) {
      s.delete(socket.id);
      if (s.size === 0) {
        userSockets.delete(userId);
        broadcastPresence(userId, false);
      }
    }
  });
}

async function memberIds(conversationId) {
  const rows = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Wire up `io` to listen for cross-module events. Call once at startup. */
export function bindAppEvents(io) {
  ioRef = io;

  // A group was created: every other member must see it now, not at the
  // first message (finding A8).
  appEvents.on('conversationCreated', ({ conversation, createdBy }) => {
    for (const m of conversation.members) {
      if (m.userId === createdBy) continue;
      io.to(`user:${m.userId}`).emit('chat:added', { conversation });
    }
  });

  appEvents.on('toMembers', async ({ conversationId, event, payload, exceptUserId }) => {
    try {
      for (const id of await memberIds(conversationId)) {
        if (id !== exceptUserId) io.to(`user:${id}`).emit(event, payload);
      }
    } catch (err) {
      console.error('toMembers failed', event, err.message);
    }
  });

  // A message created outside chat:send (e.g. forwarded over REST).
  appEvents.on('deliverMessage', ({ message, senderId, mentions }) => {
    deliver(io, message, senderId, mentions || []).catch((err) =>
      console.error('deliverMessage failed', err.message)
    );
  });

  appEvents.on('toUser', ({ userId, event, payload }) => {
    io.to(`user:${userId}`).emit(event, payload);
  });

  appEvents.on('toConversationRoom', ({ conversationId, event, payload }) => {
    io.to(`conv:${conversationId}`).emit(event, payload);
  });

  appEvents.on('memberAdded', ({ conversation, userId, addedBy }) => {
    // Notify the new member to refresh their conversation list
    io.to(`user:${userId}`).emit('chat:added', { conversation });

    // Notify existing members of the new participant
    const memberIds = conversation.members.map((m) => m.userId);
    for (const mid of memberIds) {
      io.to(`user:${mid}`).emit('chat:memberAdded', {
        conversationId: conversation.id,
        member: conversation.members.find((m) => m.userId === userId),
        addedBy: { id: addedBy.id, username: addedBy.username },
      });
    }
  });

  appEvents.on('memberRemoved', ({ conversation, removedUserId, removedBy, previousMemberIds }) => {
    // Tell the removed user they're out (so they can drop the conversation
    // from their sidebar). previousMemberIds includes them.
    io.to(`user:${removedUserId}`).emit('chat:removed', {
      conversationId: conversation.id,
      removedBy: { id: removedBy.id, username: removedBy.username },
    });

    // Tell everyone else that this user is no longer in the group
    for (const mid of previousMemberIds) {
      if (mid === removedUserId) continue;
      io.to(`user:${mid}`).emit('chat:memberRemoved', {
        conversationId: conversation.id,
        removedUserId,
        removedBy: { id: removedBy.id, username: removedBy.username },
      });
    }
  });
}

/**
 * Broadcast a stored message: to subscribers of the conversation, and as a
 * notify to every other member's devices — with what they need to decide
 * whether to make a sound (NT-2).
 */
async function deliver(io, msg, senderId, mentionList) {
  const { conversationId } = msg;
  io.to(`conv:${conversationId}`).emit('chat:message', { conversationId, message: msg });

  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true, mutedUntil: true },
  });
  const now = new Date();
  for (const m of members) {
    if (m.userId === senderId) continue;
    io.to(`user:${m.userId}`).emit('chat:notify', {
      conversationId,
      message: msg,
      muted: !!(m.mutedUntil && m.mutedUntil > now),
      mentioned: mentionList.includes(m.userId) || mentionList.includes('all'),
    });
  }
}

const CLIENT_TYPES_FORBIDDEN = new Set(['system', 'deleted']);
const MAX_DATA_BYTES = 16 * 1024;

export function registerChat(io, socket) {
  const user = socket.data.user;

  /** Subscribe to a conversation room so message broadcasts reach this socket. */
  socket.on('chat:join', async ({ conversationId }, cb) => {
    try {
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId: user.id } },
      });
      if (!member) return cb?.({ error: 'Not a member' });
      socket.join(`conv:${conversationId}`);
      cb?.({ ok: true });
    } catch (err) {
      cb?.({ error: err.message });
    }
  });

  socket.on('chat:leave', ({ conversationId }, cb) => {
    socket.leave(`conv:${conversationId}`);
    cb?.({ ok: true });
  });

  /**
   * Send a message. Optional: clientId (idempotent resend, PS-1), replyToId
   * (PS-5), mentions (PS-13), type + data (PS-4).
   */
  socket.on('chat:send', async (payload, cb) => {
    try {
      const { conversationId, content, attachment, clientId, replyToId, mentions, type, data } = payload || {};
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId: user.id } },
        include: { conversation: true },
      });
      if (!member) return cb?.({ error: 'Not a member' });
      const conv = member.conversation;

      // A resend of something we already stored: hand back the original.
      if (clientId) {
        const existing = await prisma.directMessage.findUnique({
          where: { senderId_clientId: { senderId: user.id, clientId: String(clientId) } },
          include: messageInclude,
        });
        if (existing) return cb?.({ ok: true, duplicate: true, message: serializeMessage(existing) });
      }

      if (conv.type === 'system') return cb?.({ error: 'Read-only conversation', code: 'read_only' });
      const admin = isAdminRole(member.role);
      if ((conv.onlyAdminsCanSend || conv.type === 'announcement') && !admin) {
        return cb?.({ error: 'Only admins can send messages here', code: 'admins_only' });
      }
      if (member.mutedByAdminUntil && member.mutedByAdminUntil > new Date()) {
        return cb?.({ error: 'An admin has muted you in this group', code: 'muted_by_admin' });
      }

      const msgType = type && !CLIENT_TYPES_FORBIDDEN.has(type) ? String(type).slice(0, 32) : 'text';
      if (data !== undefined && JSON.stringify(data).length > MAX_DATA_BYTES) {
        return cb?.({ error: 'Message data too large' });
      }
      const hasContent = content && content.trim().length > 0;
      const hasAttachment = attachment && attachment.url;
      if (!hasContent && !hasAttachment && (msgType === 'text' || data === undefined)) {
        return cb?.({ error: 'Empty' });
      }

      if (replyToId) {
        const original = await prisma.directMessage.findUnique({
          where: { id: replyToId },
          select: { conversationId: true },
        });
        if (original?.conversationId !== conversationId) return cb?.({ error: 'Reply target not found' });
      }

      // @all only for admins in groups; individual mentions must be members.
      let mentionList = Array.isArray(mentions) ? mentions.map(String).slice(0, 50) : [];
      if (mentionList.length) {
        const ids = new Set(await memberIds(conversationId));
        mentionList = mentionList.filter((m) => (m === 'all' ? admin || !conv.isGroup : ids.has(m)));
      }

      let stored;
      try {
        stored = await prisma.directMessage.create({
          data: {
            conversationId,
            senderId: user.id,
            content: seal(content || ''),
            attachmentUrl: attachment?.url ?? null,
            attachmentName: attachment?.name ?? null,
            attachmentType: attachment?.type ?? null,
            attachmentSize: attachment?.size ?? null,
            clientId: clientId ? String(clientId) : null,
            type: msgType,
            data: data ?? undefined,
            replyToId: replyToId || null,
            mentions: mentionList,
          },
          include: messageInclude,
        });
      } catch (err) {
        // Two resends racing: the unique (senderId, clientId) caught it.
        if (err.code === 'P2002' && clientId) {
          const existing = await prisma.directMessage.findUnique({
            where: { senderId_clientId: { senderId: user.id, clientId: String(clientId) } },
            include: messageInclude,
          });
          return cb?.({ ok: true, duplicate: true, message: serializeMessage(existing) });
        }
        throw err;
      }

      // The row is sealed; what goes over the wire is not. Clients hold no key
      // — the ciphertext exists to protect the database, not the socket, which
      // is already TLS.
      const msg = serializeMessage(stored);

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      await deliver(io, msg, user.id, mentionList);

      cb?.({ ok: true, message: msg });
    } catch (err) {
      console.error('chat:send error', err);
      cb?.({ error: err.message });
    }
  });

  /**
   * Typing indicator. Broadcast to other subscribed clients, no DB.
   * Client should debounce: emit true on keystrokes (1/sec), and false when
   * user stops typing for ~3s or on send.
   */
  socket.on('chat:typing', ({ conversationId, isTyping }) => {
    socket.to(`conv:${conversationId}`).emit('chat:typing', {
      conversationId,
      userId: user.id,
      username: user.username,
      isTyping: !!isTyping,
    });
  });

  /**
   * Delivery receipt (PS-2): this device has received messages up to `at`.
   * Only ever moves forward.
   */
  socket.on('chat:delivered', async ({ conversationId, at }, cb) => {
    try {
      const when = at ? new Date(at) : new Date();
      if (isNaN(when.getTime())) return cb?.({ error: 'Invalid time' });
      const updated = await prisma.conversationMember.updateMany({
        where: {
          conversationId,
          userId: user.id,
          OR: [{ lastDeliveredAt: null }, { lastDeliveredAt: { lt: when } }],
        },
        data: { lastDeliveredAt: when },
      });
      if (updated.count) {
        for (const id of await memberIds(conversationId)) {
          if (id === user.id) continue;
          io.to(`user:${id}`).emit('chat:delivered', {
            conversationId,
            userId: user.id,
            at: when.toISOString(),
          });
        }
      }
      cb?.({ ok: true });
    } catch (err) {
      cb?.({ error: err.message });
    }
  });

  /**
   * Mark conversation as read up to "now". Updates lastReadAt and broadcasts
   * so other clients can render read receipts. Read implies delivered, and
   * clears a manual "mark as unread".
   */
  socket.on('chat:markRead', async ({ conversationId, lastReadAt }, cb) => {
    try {
      const readAt = lastReadAt ? new Date(lastReadAt) : new Date();
      await prisma.conversationMember.updateMany({
        where: { conversationId, userId: user.id },
        data: { lastReadAt: readAt, markedUnread: false },
      });
      await prisma.conversationMember.updateMany({
        where: {
          conversationId,
          userId: user.id,
          OR: [{ lastDeliveredAt: null }, { lastDeliveredAt: { lt: readAt } }],
        },
        data: { lastDeliveredAt: readAt },
      });
      io.to(`conv:${conversationId}`).emit('chat:read', {
        conversationId,
        userId: user.id,
        lastReadAt: readAt.toISOString(),
      });
      // Also notify user-rooms in case other members aren't subscribed — and
      // our own other devices, so their unread badges clear too.
      for (const id of await memberIds(conversationId)) {
        const target = id === user.id ? io.to(`user:${id}`).except(socket.id) : io.to(`user:${id}`);
        target.emit('chat:read', {
          conversationId,
          userId: user.id,
          lastReadAt: readAt.toISOString(),
        });
      }
      cb?.({ ok: true });
    } catch (err) {
      cb?.({ error: err.message });
    }
  });
}
