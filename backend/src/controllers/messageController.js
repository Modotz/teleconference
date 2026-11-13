import prisma from '../config/prisma.js';
import { appEvents } from '../events.js';
import { audit } from '../lib/audit.js';
import { seal } from '../lib/contentCrypto.js';
import { emitToMembers, getMembership, isAdminRole, messageInclude, serializeMessage } from '../lib/messages.js';

/** PRD MSG-09: edits allowed for 15 minutes after sending. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FORWARD = 5;
const SEARCH_SCAN_LIMIT = 5000;

function bad(res, status, error, code) {
  return res.status(status).json({ error, ...(code ? { code } : {}) });
}

/** The message plus the caller's membership in its conversation, or a response. */
async function loadForMember(req, res) {
  const message = await prisma.directMessage.findUnique({ where: { id: req.params.id }, include: messageInclude });
  if (!message) {
    bad(res, 404, 'Message not found');
    return null;
  }
  const membership = await getMembership(message.conversationId, req.user.id);
  if (!membership) {
    bad(res, 404, 'Message not found');
    return null;
  }
  return { message, membership };
}

/** Edit your own text message within 15 minutes (PS-7). */
export async function editMessage(req, res) {
  const ctx = await loadForMember(req, res);
  if (!ctx) return;
  const { message } = ctx;
  const content = String(req.body?.content ?? '').trim();
  if (message.senderId !== req.user.id) return bad(res, 403, 'You can only edit your own messages');
  if (message.deletedAt || message.type !== 'text') return bad(res, 400, 'This message cannot be edited');
  if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
    return bad(res, 403, 'Messages can only be edited for 15 minutes', 'edit_window_passed');
  }
  if (!content && !message.attachmentUrl) return bad(res, 400, 'Content required');

  const updated = await prisma.directMessage.update({
    where: { id: message.id },
    data: { content: seal(content), editedAt: new Date() },
    include: messageInclude,
  });
  const wire = serializeMessage(updated);
  emitToMembers(message.conversationId, 'chat:messageEdited', { conversationId: message.conversationId, message: wire });
  res.json({ message: wire });
}

/**
 * Delete (PS-8). scope=me hides it on all of your own devices. scope=everyone
 * removes it for all members — by the sender, or by a group admin. The sealed
 * original is copied to the audit log and never sent to clients again.
 */
export async function deleteMessage(req, res) {
  const ctx = await loadForMember(req, res);
  if (!ctx) return;
  const { message, membership } = ctx;
  const scope = String(req.query.scope || req.body?.scope || 'me');

  if (scope === 'me') {
    await prisma.messageHidden.upsert({
      where: { messageId_userId: { messageId: message.id, userId: req.user.id } },
      create: { messageId: message.id, userId: req.user.id },
      update: {},
    });
    appEvents.emit('toUser', {
      userId: req.user.id,
      event: 'chat:messageHidden',
      payload: { conversationId: message.conversationId, messageId: message.id },
    });
    return res.json({ ok: true });
  }

  if (scope !== 'everyone') return bad(res, 400, 'scope must be "me" or "everyone"');
  const own = message.senderId === req.user.id;
  const asAdmin = !own && membership.conversation.isGroup && isAdminRole(membership.role);
  if (!own && !asAdmin) return bad(res, 403, 'You can only delete your own messages', 'forbidden');
  if (message.deletedAt) return res.json({ ok: true });

  await prisma.directMessage.update({
    where: { id: message.id },
    data: { deletedAt: new Date(), deletedById: req.user.id },
  });
  if (membership.conversation.pinnedMessageId === message.id) {
    await prisma.conversation.update({ where: { id: message.conversationId }, data: { pinnedMessageId: null } });
  }
  // Raw row from the DB: content is still sealed, which is what the audit keeps.
  const raw = await prisma.directMessage.findUnique({ where: { id: message.id } });
  await audit(req.user.id, asAdmin ? 'message.delete.admin' : 'message.delete', 'message', message.id, {
    conversationId: message.conversationId,
    senderId: message.senderId,
    sealedContent: raw.content,
    attachmentUrl: raw.attachmentUrl,
    attachmentName: raw.attachmentName,
  });
  emitToMembers(message.conversationId, 'chat:messageDeleted', {
    conversationId: message.conversationId,
    messageId: message.id,
    deletedBy: { id: req.user.id, username: req.user.username },
    byAdmin: asAdmin,
  });
  res.json({ ok: true });
}

/** One reaction per person; `emoji: null` removes it (PS-9). */
export async function reactToMessage(req, res) {
  const ctx = await loadForMember(req, res);
  if (!ctx) return;
  const { message } = ctx;
  if (message.deletedAt) return bad(res, 400, 'Message was deleted');
  const emoji = req.body?.emoji ? String(req.body.emoji).slice(0, 16) : null;

  if (emoji) {
    await prisma.messageReaction.upsert({
      where: { messageId_userId: { messageId: message.id, userId: req.user.id } },
      create: { messageId: message.id, userId: req.user.id, emoji },
      update: { emoji },
    });
  } else {
    await prisma.messageReaction.deleteMany({ where: { messageId: message.id, userId: req.user.id } });
  }
  emitToMembers(message.conversationId, 'chat:reaction', {
    conversationId: message.conversationId,
    messageId: message.id,
    userId: req.user.id,
    username: req.user.username,
    emoji,
  });
  res.json({ ok: true });
}

/** Star / unstar, shared across devices (PS-11). */
export async function starMessage(req, res) {
  const ctx = await loadForMember(req, res);
  if (!ctx) return;
  const value = req.body?.value !== false;
  if (value) {
    await prisma.starredMessage.upsert({
      where: { messageId_userId: { messageId: ctx.message.id, userId: req.user.id } },
      create: { messageId: ctx.message.id, userId: req.user.id },
      update: {},
    });
  } else {
    await prisma.starredMessage.deleteMany({ where: { messageId: ctx.message.id, userId: req.user.id } });
  }
  appEvents.emit('toUser', {
    userId: req.user.id,
    event: 'chat:starred',
    payload: { messageId: ctx.message.id, conversationId: ctx.message.conversationId, value },
  });
  res.json({ ok: true });
}

export async function listStarred(req, res) {
  const rows = await prisma.starredMessage.findMany({
    where: {
      userId: req.user.id,
      message: { deletedAt: null, conversation: { members: { some: { userId: req.user.id } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { message: { include: messageInclude } },
  });
  res.json({ messages: rows.map((r) => ({ ...serializeMessage(r.message), starredAt: r.createdAt })) });
}

/** Forward to up to 5 conversations, labelled "Forwarded" (PS-6). */
export async function forwardMessage(req, res) {
  const ctx = await loadForMember(req, res);
  if (!ctx) return;
  const { message } = ctx;
  if (message.deletedAt || message.type === 'system') return bad(res, 400, 'This message cannot be forwarded');
  const ids = Array.from(new Set(Array.isArray(req.body?.conversationIds) ? req.body.conversationIds : []));
  if (!ids.length) return bad(res, 400, 'conversationIds required');
  if (ids.length > MAX_FORWARD) return bad(res, 400, `Forward to at most ${MAX_FORWARD} chats`, 'too_many');

  const raw = await prisma.directMessage.findUnique({ where: { id: message.id } });
  const results = [];
  for (const conversationId of ids) {
    const m = await getMembership(conversationId, req.user.id);
    const conv = m?.conversation;
    const blocked =
      !m ||
      conv.type === 'system' ||
      ((conv.onlyAdminsCanSend || conv.type === 'announcement') && !isAdminRole(m.role)) ||
      (m.mutedByAdminUntil && m.mutedByAdminUntil > new Date());
    if (blocked) {
      results.push({ conversationId, error: 'Cannot send to this chat' });
      continue;
    }
    const copy = await prisma.directMessage.create({
      data: {
        conversationId,
        senderId: req.user.id,
        content: raw.content, // already sealed
        attachmentUrl: raw.attachmentUrl,
        attachmentName: raw.attachmentName,
        attachmentType: raw.attachmentType,
        attachmentSize: raw.attachmentSize,
        type: raw.type,
        data: raw.data ?? undefined,
        forwarded: true,
      },
      include: messageInclude,
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    const wire = serializeMessage(copy);
    appEvents.emit('deliverMessage', { message: wire, senderId: req.user.id, mentions: [] });
    results.push({ conversationId, message: wire });
  }
  res.json({ results });
}

/** Who has received / read a message (PS-2, MSG-12). */
export async function messageReceipts(req, res) {
  const ctx = await loadForMember(req, res);
  if (!ctx) return;
  const { message } = ctx;
  const sentAt = new Date(message.createdAt).getTime();
  const members = await prisma.conversationMember.findMany({
    where: { conversationId: message.conversationId, NOT: { userId: message.senderId } },
    include: { user: { select: { id: true, username: true, fullName: true } } },
  });
  const receipts = members.map((m) => {
    const read = m.lastReadAt && m.lastReadAt.getTime() >= sentAt ? m.lastReadAt : null;
    const delivered = read || (m.lastDeliveredAt && m.lastDeliveredAt.getTime() >= sentAt ? m.lastDeliveredAt : null);
    return {
      user: m.user,
      status: read ? 'read' : delivered ? 'delivered' : 'sent',
      deliveredAt: delivered,
      readAt: read,
    };
  });
  res.json({ receipts });
}

/** Report a message or a person to admins/HR (PS-12). */
export async function createReport(req, res) {
  const { messageId, userId, conversationId, reason } = req.body || {};
  if (!reason || !String(reason).trim()) return bad(res, 400, 'reason required');
  if (!messageId && !userId) return bad(res, 400, 'messageId or userId required');

  let snapshot = null;
  let convId = conversationId || null;
  if (messageId) {
    const msg = await prisma.directMessage.findUnique({ where: { id: messageId } });
    if (!msg || !(await getMembership(msg.conversationId, req.user.id))) return bad(res, 404, 'Message not found');
    convId = msg.conversationId;
    snapshot = { senderId: msg.senderId, sealedContent: msg.content, attachmentUrl: msg.attachmentUrl };
  }
  const report = await prisma.report.create({
    data: {
      reporterId: req.user.id,
      messageId: messageId || null,
      userId: userId || null,
      conversationId: convId,
      reason: String(reason).slice(0, 1000),
    },
  });
  await audit(req.user.id, 'report.create', 'report', report.id, { messageId, userId, conversationId: convId, snapshot });
  res.status(201).json({ report: { id: report.id, status: report.status, createdAt: report.createdAt } });
}

/**
 * Search message text on the server (PS-14). Bodies are encrypted at rest, so
 * matching happens after decryption over the newest messages (scan capped at
 * SEARCH_SCAN_LIMIT). `truncated: true` means older messages were not scanned.
 */
export async function searchMessages(req, res) {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return bad(res, 400, 'Query must be at least 2 characters');
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const where = {
    conversation: { members: { some: { userId: req.user.id } } },
    deletedAt: null,
    hiddenFor: { none: { userId: req.user.id } },
    type: { not: 'system' },
    ...(req.query.conversationId ? { conversationId: String(req.query.conversationId) } : {}),
    ...(req.query.senderId ? { senderId: String(req.query.senderId) } : {}),
    ...(req.query.hasAttachment === 'true' ? { attachmentUrl: { not: null } } : {}),
  };

  const results = [];
  let scanned = 0;
  let cursor = null;
  let exhausted = false;
  while (results.length < limit && scanned < SEARCH_SCAN_LIMIT) {
    const batch = await prisma.directMessage.findMany({
      where: { ...where, ...(cursor ? { createdAt: { lt: cursor } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: messageInclude,
    });
    if (!batch.length) {
      exhausted = true;
      break;
    }
    scanned += batch.length;
    cursor = batch[batch.length - 1].createdAt;
    for (const m of batch) {
      const msg = serializeMessage(m);
      const hay = `${msg.content} ${msg.attachmentName || ''}`.toLowerCase();
      if (hay.includes(q)) results.push(msg);
      if (results.length >= limit) break;
    }
    if (batch.length < 500) {
      exhausted = true;
      break;
    }
  }
  res.json({ messages: results, truncated: !exhausted && results.length < limit });
}
