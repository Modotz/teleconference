import prisma from '../config/prisma.js';
import { appEvents } from '../events.js';
import { audit } from '../lib/audit.js';
import {
  emitToMembers,
  getMembership,
  isAdminRole,
  messageInclude,
  postSystemMessage,
  serializeMessage,
} from '../lib/messages.js';

const memberInclude = {
  members: {
    include: { user: { select: { id: true, username: true, fullName: true, title: true } } },
  },
};

function bad(res, status, error, code) {
  return res.status(status).json({ error, ...(code ? { code } : {}) });
}

/** Messages this user hid with "delete for me" never come back. */
const visibleTo = (userId) => ({ hiddenFor: { none: { userId } } });

/** Unread counts per conversation for one user, in one query (PS-3). */
async function unreadCounts(userId) {
  const rows = await prisma.$queryRaw`
    SELECT m."conversationId" AS id, COUNT(*)::int AS n
    FROM "DirectMessage" m
    JOIN "ConversationMember" cm
      ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}
    WHERE m."senderId" <> ${userId}
      AND m."deletedAt" IS NULL
      AND m."type" <> 'system'
      AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
      AND NOT EXISTS (
        SELECT 1 FROM "MessageHidden" h WHERE h."messageId" = m."id" AND h."userId" = ${userId}
      )
    GROUP BY m."conversationId"`;
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** List conversations the current user is a member of, with last message + members. */
export async function listConversations(req, res) {
  const userId = req.user.id;
  const [memberships, counts] = await Promise.all([
    prisma.conversationMember.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            ...memberInclude,
            messages: {
              where: visibleTo(userId),
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: messageInclude,
            },
          },
        },
      },
    }),
    unreadCounts(userId),
  ]);

  const conversations = memberships
    .map((m) => ({
      ...m.conversation,
      messages: undefined, // strip
      lastReadAt: m.lastReadAt,
      lastMessage: serializeMessage(m.conversation.messages[0]) || null,
      unreadCount: counts.get(m.conversationId) || 0,
      myRole: m.role,
      pinned: m.pinned,
      mutedUntil: m.mutedUntil,
      archived: m.archived,
      markedUnread: m.markedUnread,
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
 * Body: { userIds: string[], name?: string, isGroup?: boolean, description?: string }
 *
 * For 1-on-1 (isGroup=false, exactly one other userId) returns existing conv
 * between the two if it exists, otherwise creates new. The creator of a group
 * is its owner; every other member is told at once (finding A8).
 */
export async function createConversation(req, res) {
  const { userIds = [], name, isGroup = false, description } = req.body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return bad(res, 400, 'userIds required');
  }

  const allIds = Array.from(new Set([req.user.id, ...userIds]));
  if (allIds.length < 2) {
    return bad(res, 400, 'At least one other user required');
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
      include: memberInclude,
    });
    if (existing) return res.json({ conversation: existing });
  }

  if (isGroup && !name?.trim()) {
    return bad(res, 400, 'Group name required');
  }

  const conversation = await prisma.conversation.create({
    data: {
      name: isGroup ? name.trim() : null,
      description: isGroup ? description?.trim() || null : null,
      isGroup,
      ownerId: req.user.id,
      members: {
        create: allIds.map((userId) => ({
          userId,
          role: isGroup && userId === req.user.id ? 'owner' : 'member',
        })),
      },
    },
    include: memberInclude,
  });

  appEvents.emit('conversationCreated', { conversation, createdBy: req.user.id });
  res.status(201).json({ conversation });
}

export async function getConversation(req, res) {
  const conv = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: memberInclude,
  });
  if (!conv) return bad(res, 404, 'Not found');
  const isMember = conv.members.some((m) => m.userId === req.user.id);
  if (!isMember) return bad(res, 403, 'Not a member');
  res.json({ conversation: conv });
}

export async function listMessages(req, res) {
  const membership = await getMembership(req.params.id, req.user.id);
  if (!membership) {
    const exists = await prisma.conversation.findUnique({ where: { id: req.params.id }, select: { id: true } });
    return exists ? bad(res, 403, 'Not a member') : bad(res, 404, 'Not found');
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const before = req.query.before ? new Date(req.query.before) : null;

  const messages = await prisma.directMessage.findMany({
    where: {
      conversationId: req.params.id,
      ...visibleTo(req.user.id),
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: messageInclude,
  });

  res.json({
    messages: messages.reverse().map(serializeMessage),
    pinnedMessageId: membership.conversation.pinnedMessageId,
  });
}

/** Load the group + the caller's membership; responds and returns null on failure. */
async function groupFor(req, res, { admin = false } = {}) {
  const membership = await getMembership(req.params.id, req.user.id);
  if (!membership) {
    const exists = await prisma.conversation.findUnique({ where: { id: req.params.id }, select: { id: true } });
    bad(res, exists ? 403 : 404, exists ? 'Not a member' : 'Not found');
    return null;
  }
  if (!membership.conversation.isGroup) {
    bad(res, 400, 'Not a group');
    return null;
  }
  if (admin && !isAdminRole(membership.role)) {
    bad(res, 403, 'Only group admins can do this', 'admins_only');
    return null;
  }
  return membership;
}

const reload = (id) => prisma.conversation.findUnique({ where: { id }, include: memberInclude });
const nameOf = (user) => user.username;

/** Group admins add members (GRP-03). HR-managed groups are not editable. */
export async function addMember(req, res) {
  const me = await groupFor(req, res, { admin: true });
  if (!me) return;
  if (me.conversation.official) return bad(res, 403, 'Membership is managed by HR', 'official_group');

  const { userId } = req.body;
  if (!userId) return bad(res, 400, 'userId required');
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
  if (!target) return bad(res, 404, 'User not found');

  let created = false;
  try {
    await prisma.conversationMember.create({
      data: { conversationId: me.conversationId, userId },
    });
    created = true;
  } catch {
    // unique constraint — already a member
  }

  const updated = await reload(me.conversationId);

  if (created) {
    appEvents.emit('memberAdded', {
      conversation: updated,
      userId,
      addedBy: req.user,
    });
    await audit(req.user.id, 'group.member.add', 'conversation', me.conversationId, { userId });
    await postSystemMessage(me.conversationId, req.user.id, `${nameOf(req.user)} added ${target.username}`, {
      event: 'member_added',
      userId,
    });
  }

  res.json({ conversation: updated });
}

/**
 * Remove a member, or leave (target = self). Admins remove members; only the
 * owner removes admins. Anyone may leave except from an HR-managed group; an
 * owner who leaves hands ownership to the longest-serving admin (or member).
 */
export async function removeMember(req, res) {
  const me = await groupFor(req, res);
  if (!me) return;
  const conv = me.conversation;

  const targetUserId = req.params.userId;
  const isSelf = targetUserId === req.user.id;
  const target = await getMembership(conv.id, targetUserId);
  if (!target) return bad(res, 404, 'User is not a member');

  if (conv.official) return bad(res, 403, 'Membership is managed by HR', 'official_group');
  if (!isSelf) {
    if (!isAdminRole(me.role)) return bad(res, 403, 'Only group admins can remove members', 'admins_only');
    if (target.role === 'owner') return bad(res, 403, 'The owner cannot be removed');
    if (target.role === 'admin' && me.role !== 'owner') {
      return bad(res, 403, 'Only the owner can remove an admin');
    }
  }

  const previous = await prisma.conversationMember.findMany({
    where: { conversationId: conv.id },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true, role: true },
  });

  await prisma.conversationMember.delete({
    where: { conversationId_userId: { conversationId: conv.id, userId: targetUserId } },
  });

  // Owner left: the group keeps an owner (prefer an admin, else the oldest member).
  if (target.role === 'owner') {
    const rest = previous.filter((m) => m.userId !== targetUserId);
    const heir = rest.find((m) => m.role === 'admin') || rest[0];
    if (heir) {
      await prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId: conv.id, userId: heir.userId } },
        data: { role: 'owner' },
      });
      await prisma.conversation.update({ where: { id: conv.id }, data: { ownerId: heir.userId } });
    }
  }

  const updated = await reload(conv.id);

  appEvents.emit('memberRemoved', {
    conversation: updated,
    removedUserId: targetUserId,
    removedBy: req.user,
    /** List of previous member ids INCLUDING the one we just removed,
     *  so the socket layer can notify the removed user to update their UI. */
    previousMemberIds: previous.map((m) => m.userId),
  });
  await audit(req.user.id, isSelf ? 'group.member.leave' : 'group.member.remove', 'conversation', conv.id, {
    userId: targetUserId,
  });
  if (updated.members.length) {
    const targetName = (await prisma.user.findUnique({ where: { id: targetUserId }, select: { username: true } }))
      ?.username;
    await postSystemMessage(
      conv.id,
      req.user.id,
      isSelf ? `${nameOf(req.user)} left` : `${nameOf(req.user)} removed ${targetName}`,
      { event: isSelf ? 'member_left' : 'member_removed', userId: targetUserId }
    );
  }

  res.json({ conversation: updated });
}

/** REST fallback for marking read (the socket event also broadcasts receipts). */
export async function markRead(req, res) {
  await prisma.conversationMember.updateMany({
    where: { conversationId: req.params.id, userId: req.user.id },
    data: { lastReadAt: new Date(), markedUnread: false },
  });
  res.json({ ok: true });
}

/** Rename / describe / announcement mode (GR-2, GR-4). Admins only. */
export async function updateGroup(req, res) {
  const me = await groupFor(req, res, { admin: true });
  if (!me) return;
  const data = {};
  if (typeof req.body.name === 'string') {
    if (!req.body.name.trim()) return bad(res, 400, 'Group name required');
    data.name = req.body.name.trim().slice(0, 100);
  }
  if (req.body.description !== undefined) data.description = req.body.description?.trim()?.slice(0, 500) || null;
  if (req.body.onlyAdminsCanSend !== undefined) data.onlyAdminsCanSend = !!req.body.onlyAdminsCanSend;
  if (!Object.keys(data).length) return bad(res, 400, 'Nothing to update');

  await prisma.conversation.update({ where: { id: me.conversationId }, data });
  const updated = await reload(me.conversationId);
  emitToMembers(me.conversationId, 'chat:groupUpdated', { conversation: updated });
  await audit(req.user.id, 'group.update', 'conversation', me.conversationId, data);
  if (data.name) {
    await postSystemMessage(me.conversationId, req.user.id, `${nameOf(req.user)} renamed the group to "${data.name}"`, {
      event: 'renamed',
      name: data.name,
    });
  }
  if (data.onlyAdminsCanSend !== undefined) {
    await postSystemMessage(
      me.conversationId,
      req.user.id,
      data.onlyAdminsCanSend
        ? `${nameOf(req.user)} set the group so only admins can send messages`
        : `${nameOf(req.user)} allowed everyone to send messages`,
      { event: 'send_permission', onlyAdminsCanSend: data.onlyAdminsCanSend }
    );
  }
  res.json({ conversation: updated });
}

/** Make or unmake an admin (GR-1). Admins promote; only the owner demotes. */
export async function setAdmin(req, res) {
  const me = await groupFor(req, res, { admin: true });
  if (!me) return;
  const { userId, value } = req.body;
  const target = await getMembership(me.conversationId, userId);
  if (!target) return bad(res, 404, 'User is not a member');
  if (target.role === 'owner') return bad(res, 400, 'The owner is always an admin');
  if (!value && me.role !== 'owner') return bad(res, 403, 'Only the owner can remove an admin');

  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId: me.conversationId, userId } },
    data: { role: value ? 'admin' : 'member' },
  });
  const updated = await reload(me.conversationId);
  emitToMembers(me.conversationId, 'chat:groupUpdated', { conversation: updated });
  await audit(req.user.id, value ? 'group.admin.add' : 'group.admin.remove', 'conversation', me.conversationId, {
    userId,
  });
  res.json({ conversation: updated });
}

/** Hand ownership to another member (GR-1). Owner only; they become an admin. */
export async function transferOwnership(req, res) {
  const me = await groupFor(req, res);
  if (!me) return;
  if (me.role !== 'owner') return bad(res, 403, 'Only the owner can transfer ownership');
  const { userId } = req.body;
  const target = await getMembership(me.conversationId, userId);
  if (!target || userId === req.user.id) return bad(res, 404, 'User is not a member');

  await prisma.$transaction([
    prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: me.conversationId, userId } },
      data: { role: 'owner' },
    }),
    prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: me.conversationId, userId: req.user.id } },
      data: { role: 'admin' },
    }),
    prisma.conversation.update({ where: { id: me.conversationId }, data: { ownerId: userId } }),
  ]);
  const updated = await reload(me.conversationId);
  emitToMembers(me.conversationId, 'chat:groupUpdated', { conversation: updated });
  await audit(req.user.id, 'group.owner.transfer', 'conversation', me.conversationId, { userId });
  res.json({ conversation: updated });
}

/** Stop a member from sending until a time (GR-3). `until: null` lifts it. */
export async function muteMember(req, res) {
  const me = await groupFor(req, res, { admin: true });
  if (!me) return;
  const { userId, until } = req.body;
  const target = await getMembership(me.conversationId, userId);
  if (!target) return bad(res, 404, 'User is not a member');
  if (isAdminRole(target.role)) return bad(res, 400, 'Admins cannot be muted');
  const when = until ? new Date(until) : null;
  if (when && isNaN(when.getTime())) return bad(res, 400, 'Invalid until');

  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId: me.conversationId, userId } },
    data: { mutedByAdminUntil: when },
  });
  emitToMembers(me.conversationId, 'chat:memberMuted', {
    conversationId: me.conversationId,
    userId,
    until: when?.toISOString() ?? null,
  });
  await audit(req.user.id, when ? 'group.member.mute' : 'group.member.unmute', 'conversation', me.conversationId, {
    userId,
    until: when,
  });
  res.json({ ok: true });
}

/** Per-user chat settings, shared across devices (PC-1). */
export async function setPreferences(req, res) {
  const membership = await getMembership(req.params.id, req.user.id);
  if (!membership) return bad(res, 404, 'Not found');
  const data = {};
  if (req.body.pinned !== undefined) data.pinned = !!req.body.pinned;
  if (req.body.archived !== undefined) {
    if (req.body.archived && membership.conversation.type === 'announcement') {
      return bad(res, 400, 'Announcement channels cannot be archived');
    }
    data.archived = !!req.body.archived;
  }
  if (req.body.markedUnread !== undefined) data.markedUnread = !!req.body.markedUnread;
  if (req.body.mutedUntil !== undefined) {
    const v = req.body.mutedUntil;
    // `true` = muted indefinitely (stored far in the future).
    data.mutedUntil = v === null || v === false ? null : v === true ? new Date('9999-12-31') : new Date(v);
    if (data.mutedUntil && isNaN(data.mutedUntil.getTime())) return bad(res, 400, 'Invalid mutedUntil');
  }
  const updated = await prisma.conversationMember.update({
    where: { id: membership.id },
    data,
    select: { pinned: true, archived: true, markedUnread: true, mutedUntil: true },
  });
  // The user's other devices update their list.
  appEvents.emit('toUser', {
    userId: req.user.id,
    event: 'chat:preferences',
    payload: { conversationId: req.params.id, ...updated },
  });
  res.json({ preferences: updated });
}

/** One pinned message per conversation (PS-10). Groups: admins only. */
export async function pinMessage(req, res) {
  const membership = await getMembership(req.params.id, req.user.id);
  if (!membership) return bad(res, 404, 'Not found');
  if (membership.conversation.isGroup && !isAdminRole(membership.role)) {
    return bad(res, 403, 'Only group admins can pin messages', 'admins_only');
  }
  const { messageId } = req.body;
  if (messageId) {
    const msg = await prisma.directMessage.findUnique({ where: { id: messageId }, select: { conversationId: true, deletedAt: true } });
    if (msg?.conversationId !== req.params.id || msg.deletedAt) return bad(res, 404, 'Message not found');
  }
  await prisma.conversation.update({ where: { id: req.params.id }, data: { pinnedMessageId: messageId || null } });
  emitToMembers(req.params.id, 'chat:pinned', {
    conversationId: req.params.id,
    messageId: messageId || null,
    by: { id: req.user.id, username: req.user.username },
  });
  res.json({ ok: true });
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

/**
 * Media, files and links of one conversation (PS-17 / MSG-19), newest first.
 * kind=media|file|link. Links are found by scanning decrypted text.
 */
export async function listAttachments(req, res) {
  const membership = await getMembership(req.params.id, req.user.id);
  if (!membership) return bad(res, 404, 'Not found');
  const kind = String(req.query.kind || 'media');
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const before = req.query.before ? new Date(req.query.before) : null;
  const base = {
    conversationId: req.params.id,
    deletedAt: null,
    ...visibleTo(req.user.id),
    ...(before ? { createdAt: { lt: before } } : {}),
  };

  if (kind === 'link') {
    const out = [];
    let cursor = before;
    // Text is encrypted at rest, so links can only be found after decrypting.
    for (let page = 0; page < 10 && out.length < limit; page++) {
      const batch = await prisma.directMessage.findMany({
        where: { ...base, ...(cursor ? { createdAt: { lt: cursor } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: messageInclude,
      });
      if (!batch.length) break;
      cursor = batch[batch.length - 1].createdAt;
      for (const m of batch) {
        const msg = serializeMessage(m);
        for (const url of msg.content.match(URL_RE) || []) out.push({ url, message: msg });
      }
    }
    return res.json({ items: out.slice(0, limit) });
  }

  const rows = await prisma.directMessage.findMany({
    where: {
      ...base,
      attachmentUrl: { not: null },
      ...(kind === 'media'
        ? { OR: MEDIA_TYPES_FILTER }
        : { NOT: { OR: MEDIA_TYPES_FILTER } }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: messageInclude,
  });
  res.json({ items: rows.map((m) => ({ message: serializeMessage(m) })) });
}

const MEDIA_TYPES_FILTER = [
  { attachmentType: { startsWith: 'image/' } },
  { attachmentType: { startsWith: 'video/' } },
];
