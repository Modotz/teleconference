import prisma from '../config/prisma.js';
import { open, seal } from './contentCrypto.js';
import { appEvents } from '../events.js';

/** Prisma `include` for a chat message as clients see it. */
export const messageInclude = {
  sender: { select: { id: true, username: true, fullName: true, title: true } },
  reactions: { select: { userId: true, emoji: true } },
  replyTo: {
    select: {
      id: true,
      senderId: true,
      content: true,
      type: true,
      attachmentName: true,
      deletedAt: true,
      sender: { select: { id: true, username: true } },
    },
  },
};

const SNIPPET = 200;

/**
 * Stored row → wire shape. Decrypts the body, and for "deleted for everyone"
 * drops content and attachment so the original never leaves the server again
 * (it stays sealed in the row for the audit trail).
 */
export function serializeMessage(m) {
  if (!m) return m;
  const deleted = !!m.deletedAt;
  const reply = m.replyTo;
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    sender: m.sender ?? null,
    clientId: m.clientId ?? null,
    type: deleted ? 'deleted' : m.type || 'text',
    content: deleted ? '' : open(m.content),
    data: deleted ? null : m.data ?? null,
    attachmentUrl: deleted ? null : m.attachmentUrl,
    attachmentName: deleted ? null : m.attachmentName,
    attachmentType: deleted ? null : m.attachmentType,
    attachmentSize: deleted ? null : m.attachmentSize,
    replyTo: reply
      ? {
          id: reply.id,
          senderId: reply.senderId,
          senderName: reply.sender?.username ?? null,
          type: reply.deletedAt ? 'deleted' : reply.type,
          content: reply.deletedAt ? '' : String(open(reply.content) ?? '').slice(0, SNIPPET),
          attachmentName: reply.deletedAt ? null : reply.attachmentName,
        }
      : null,
    forwarded: !!m.forwarded,
    mentions: deleted ? [] : m.mentions ?? [],
    reactions: m.reactions ?? [],
    editedAt: m.editedAt ?? null,
    deletedAt: m.deletedAt ?? null,
    createdAt: m.createdAt,
  };
}

/** Member row with the caller's permission flags. */
export async function getMembership(conversationId, userId) {
  return prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: { conversation: true },
  });
}

export const isAdminRole = (role) => role === 'owner' || role === 'admin';

/**
 * Push an event to every member's personal socket room (all their devices,
 * subscribed to the conversation or not). The socket layer delivers it.
 */
export function emitToMembers(conversationId, event, payload, opts = {}) {
  appEvents.emit('toMembers', { conversationId, event, payload, exceptUserId: opts.exceptUserId });
}

/**
 * Store and broadcast a system line ("Andi added Rina") in the conversation
 * history (PS-16). `data.event` is machine-readable for clients to localise.
 */
export async function postSystemMessage(conversationId, actorId, text, data) {
  const msg = await prisma.directMessage.create({
    data: { conversationId, senderId: actorId, content: seal(text), type: 'system', data },
    include: messageInclude,
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  const wire = serializeMessage(msg);
  appEvents.emit('toConversationRoom', { conversationId, event: 'chat:message', payload: { conversationId, message: wire } });
  return wire;
}
