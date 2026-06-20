import prisma from '../config/prisma.js';
import { appEvents } from '../events.js';

/** List conversations the current user is a member of, with last message + members. */
export async function listConversations(req, res) {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: req.user.id },
    include: {
      conversation: {
        include: {
          members: {
            include: { user: { select: { id: true, username: true } } },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { sender: { select: { id: true, username: true } } },
          },
        },
      },
    },
  });

  const conversations = memberships
    .map((m) => ({
      ...m.conversation,
      lastReadAt: m.lastReadAt,
      lastMessage: m.conversation.messages[0] || null,
      messages: undefined, // strip
    }))
    .sort((a, b) => {
      const aT = a.lastMessage?.createdAt || a.updatedAt;
      const bT = b.lastMessage?.createdAt || b.updatedAt;
      return new Date(bT).getTime() - new Date(aT).getTime();
    });

  res.json({ conversations });
}

/**
 * Create a conversation.
 * Body: { userIds: string[], name?: string, isGroup?: boolean }
 *
 * For 1-on-1 (isGroup=false, exactly one other userId) returns existing conv
 * between the two if it exists, otherwise creates new.
 */
export async function createConversation(req, res) {
  const { userIds = [], name, isGroup = false } = req.body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds required' });
  }

  const allIds = Array.from(new Set([req.user.id, ...userIds]));
  if (allIds.length < 2) {
    return res.status(400).json({ error: 'At least one other user required' });
  }

  // 1-on-1: try to find existing conversation between the two users
  if (!isGroup && allIds.length === 2) {
    const existing = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { members: { some: { userId: allIds[0] } } },
          { members: { some: { userId: allIds[1] } } },
        ],
      },
      include: {
        members: {
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });
    if (existing) return res.json({ conversation: existing });
  }

  if (isGroup && !name?.trim()) {
    return res.status(400).json({ error: 'Group name required' });
  }

  const conversation = await prisma.conversation.create({
    data: {
      name: isGroup ? name.trim() : null,
      isGroup,
      ownerId: req.user.id,
      members: {
        create: allIds.map((userId) => ({ userId })),
      },
    },
    include: {
      members: {
        include: { user: { select: { id: true, username: true } } },
      },
    },
  });

  res.status(201).json({ conversation });
}

export async function getConversation(req, res) {
  const conv = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: {
      members: { include: { user: { select: { id: true, username: true } } } },
    },
  });
  if (!conv) return res.status(404).json({ error: 'Not found' });
  const isMember = conv.members.some((m) => m.userId === req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Not a member' });
  res.json({ conversation: conv });
}

export async function listMessages(req, res) {
  const conv = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { members: { select: { userId: true } } },
  });
  if (!conv) return res.status(404).json({ error: 'Not found' });
  if (!conv.members.some((m) => m.userId === req.user.id)) {
    return res.status(403).json({ error: 'Not a member' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const before = req.query.before ? new Date(req.query.before) : null;

  const messages = await prisma.directMessage.findMany({
    where: {
      conversationId: conv.id,
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { sender: { select: { id: true, username: true } } },
  });

  res.json({ messages: messages.reverse() });
}

export async function addMember(req, res) {
  const conv = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { members: { select: { userId: true } } },
  });
  if (!conv) return res.status(404).json({ error: 'Not found' });
  if (!conv.isGroup) return res.status(400).json({ error: 'Not a group' });
  if (!conv.members.some((m) => m.userId === req.user.id)) {
    return res.status(403).json({ error: 'Not a member' });
  }

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  let created = false;
  try {
    await prisma.conversationMember.create({
      data: { conversationId: conv.id, userId },
    });
    created = true;
  } catch {
    // unique constraint — already a member
  }

  const updated = await prisma.conversation.findUnique({
    where: { id: conv.id },
    include: {
      members: { include: { user: { select: { id: true, username: true } } } },
    },
  });

  if (created) {
    appEvents.emit('memberAdded', {
      conversation: updated,
      userId,
      addedBy: req.user,
    });
  }

  res.json({ conversation: updated });
}

export async function removeMember(req, res) {
  const conv = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { members: { select: { userId: true } } },
  });
  if (!conv) return res.status(404).json({ error: 'Not found' });
  if (!conv.isGroup) return res.status(400).json({ error: 'Not a group' });

  const isMember = conv.members.some((m) => m.userId === req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Not a member' });

  const targetUserId = req.params.userId;
  const isSelf = targetUserId === req.user.id;
  const isOwner = conv.ownerId === req.user.id;

  // Only owner can remove others; anyone can remove themselves (leave)
  if (!isSelf && !isOwner) {
    return res.status(403).json({ error: 'Only the group owner can remove members' });
  }
  // Don't allow owner to remove themselves while group has other members
  // (would leave the group ownerless). For simplicity owner cannot leave —
  // they'd have to delete the group instead.
  if (isSelf && isOwner && conv.members.length > 1) {
    return res.status(400).json({ error: 'Owner cannot leave group' });
  }

  // Verify target is currently a member
  const target = conv.members.find((m) => m.userId === targetUserId);
  if (!target) return res.status(404).json({ error: 'User is not a member' });

  await prisma.conversationMember.delete({
    where: { conversationId_userId: { conversationId: conv.id, userId: targetUserId } },
  });

  const updated = await prisma.conversation.findUnique({
    where: { id: conv.id },
    include: {
      members: { include: { user: { select: { id: true, username: true } } } },
    },
  });

  appEvents.emit('memberRemoved', {
    conversation: updated,
    removedUserId: targetUserId,
    removedBy: req.user,
    /** List of previous member ids INCLUDING the one we just removed,
     *  so the socket layer can notify the removed user to update their UI. */
    previousMemberIds: conv.members.map((m) => m.userId),
  });

  res.json({ conversation: updated });
}

export async function markRead(req, res) {
  await prisma.conversationMember.updateMany({
    where: { conversationId: req.params.id, userId: req.user.id },
    data: { lastReadAt: new Date() },
  });
  res.json({ ok: true });
}
