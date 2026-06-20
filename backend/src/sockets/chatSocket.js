import prisma from '../config/prisma.js';
import { appEvents } from '../events.js';

const userSockets = new Map(); // userId -> Set<socketId>

export function registerUserSocket(socket, userId) {
  let set = userSockets.get(userId);
  if (!set) {
    set = new Set();
    userSockets.set(userId, set);
  }
  set.add(socket.id);

  socket.join(`user:${userId}`);

  socket.on('disconnect', () => {
    const s = userSockets.get(userId);
    if (s) {
      s.delete(socket.id);
      if (s.size === 0) userSockets.delete(userId);
    }
  });
}

/** Wire up `io` to listen for cross-module events. Call once at startup. */
export function bindAppEvents(io) {
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

  socket.on('chat:send', async ({ conversationId, content, attachment }, cb) => {
    try {
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId: user.id } },
      });
      if (!member) return cb?.({ error: 'Not a member' });

      const hasContent = content && content.trim().length > 0;
      const hasAttachment = attachment && attachment.url;
      if (!hasContent && !hasAttachment) return cb?.({ error: 'Empty' });

      const msg = await prisma.directMessage.create({
        data: {
          conversationId,
          senderId: user.id,
          content: content || '',
          attachmentUrl: attachment?.url ?? null,
          attachmentName: attachment?.name ?? null,
          attachmentType: attachment?.type ?? null,
          attachmentSize: attachment?.size ?? null,
        },
        include: { sender: { select: { id: true, username: true } } },
      });

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      // Broadcast to everyone subscribed to this conversation
      io.to(`conv:${conversationId}`).emit('chat:message', {
        conversationId,
        message: msg,
      });

      // Push notify to user-rooms of all members (for unread badge updates)
      const members = await prisma.conversationMember.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      for (const m of members) {
        if (m.userId === user.id) continue;
        io.to(`user:${m.userId}`).emit('chat:notify', {
          conversationId,
          message: msg,
        });
      }

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
   * Mark conversation as read up to "now". Updates lastReadAt and broadcasts
   * so other clients can render read receipts.
   */
  socket.on('chat:markRead', async ({ conversationId, lastReadAt }, cb) => {
    try {
      const readAt = lastReadAt ? new Date(lastReadAt) : new Date();
      await prisma.conversationMember.updateMany({
        where: { conversationId, userId: user.id },
        data: { lastReadAt: readAt },
      });
      io.to(`conv:${conversationId}`).emit('chat:read', {
        conversationId,
        userId: user.id,
        lastReadAt: readAt.toISOString(),
      });
      // Also notify user-rooms in case other members aren't subscribed
      const members = await prisma.conversationMember.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      for (const m of members) {
        if (m.userId === user.id) continue;
        io.to(`user:${m.userId}`).emit('chat:read', {
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
