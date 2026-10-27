import prisma from '../config/prisma.js';
import { sendMail, appUrl } from '../lib/mailer.js';

export async function createRoom(req, res) {
  const { name, description, scheduledAt, durationMinutes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  let scheduled = null;
  if (scheduledAt) {
    const d = new Date(scheduledAt);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduledAt' });
    }
    scheduled = d;
  }

  // Clamp duration to a sane range; default to 60 minutes.
  let duration = 60;
  if (durationMinutes != null) {
    const n = Math.round(Number(durationMinutes));
    if (!Number.isFinite(n) || n < 5 || n > 8 * 60) {
      return res.status(400).json({ error: 'Invalid durationMinutes' });
    }
    duration = n;
  }

  const room = await prisma.room.create({
    data: {
      name,
      description: description?.trim() || null,
      scheduledAt: scheduled,
      durationMinutes: duration,
      ownerId: req.user.id,
    },
  });
  res.status(201).json({ room });
}

/** Rooms owned by the current user (instant + scheduled). */
export async function listRooms(req, res) {
  const rooms = await prisma.room.findMany({
    where: { ownerId: req.user.id, isActive: true },
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { id: true, username: true } },
      _count: { select: { participants: true } },
    },
  });
  res.json({ rooms });
}

/**
 * Meetings the current user actually joined (instant or scheduled, any owner),
 * newest first. Built from Participant rows — one per join — over the last
 * 30 days.
 */
export async function roomHistory(req, res) {
  const since = new Date(Date.now() - 30 * 86400000);
  const joins = await prisma.participant.groupBy({
    by: ['roomId'],
    where: { userId: req.user.id, joinedAt: { gte: since } },
    _max: { joinedAt: true },
    orderBy: { _max: { joinedAt: 'desc' } },
    take: 50,
  });
  if (!joins.length) return res.json({ meetings: [] });

  const roomIds = joins.map((j) => j.roomId);
  const [rooms, people] = await Promise.all([
    prisma.room.findMany({
      where: { id: { in: roomIds } },
      select: {
        id: true,
        name: true,
        isActive: true,
        endedAt: true,
        owner: { select: { id: true, username: true } },
      },
    }),
    // Distinct signed-in attendees per room (a rejoin adds another row).
    prisma.participant.groupBy({
      by: ['roomId', 'userId'],
      where: { roomId: { in: roomIds } },
    }),
  ]);

  const byId = new Map(rooms.map((r) => [r.id, r]));
  const counts = new Map();
  for (const p of people) counts.set(p.roomId, (counts.get(p.roomId) || 0) + 1);

  const meetings = joins
    .filter((j) => byId.has(j.roomId))
    .map((j) => ({
      ...byId.get(j.roomId),
      lastJoinedAt: j._max.joinedAt,
      participantCount: counts.get(j.roomId) || 1,
    }));
  res.json({ meetings });
}

export async function getRoom(req, res) {
  const room = await prisma.room.findUnique({
    where: { id: req.params.id },
    include: {
      owner: { select: { id: true, username: true } },
    },
  });
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ room });
}

/** Email an invitation (with the join link + schedule) to a list of addresses. */
export async function inviteToRoom(req, res) {
  const room = await prisma.room.findUnique({
    where: { id: req.params.id },
    include: { owner: { select: { username: true } } },
  });
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Only the owner can invite' });
  }

  const emails = Array.isArray(req.body.emails)
    ? req.body.emails.map((e) => String(e).trim()).filter(Boolean)
    : [];
  if (!emails.length) return res.status(400).json({ error: 'emails required' });

  const link = `${appUrl()}/room/${room.id}`;
  const host = room.owner?.username || 'Someone';
  const when = room.scheduledAt
    ? new Date(room.scheduledAt).toLocaleString()
    : null;
  const subject = `Meeting invite: ${room.name}`;
  const whenText = when ? `\nWhen: ${when}` : '';
  const text = `${host} invited you to a meeting.\n\n${room.name}${whenText}\n\nJoin: ${link}`;
  const html = `<p><b>${host}</b> invited you to a meeting.</p><p style="font-size:16px"><b>${room.name}</b>${
    when ? `<br/>🗓 ${when}` : ''
  }</p><p><a href="${link}">Join the meeting</a></p><p style="color:#888">${link}</p>`;

  await Promise.all(
    emails.map((to) => sendMail({ to, subject, text, html }).catch(() => {}))
  );
  res.json({ ok: true, sent: emails.length });
}

export async function endRoom(req, res) {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Only owner can end the room' });
  }

  await prisma.room.update({
    where: { id: room.id },
    data: { isActive: false, endedAt: new Date() },
  });
  res.json({ ok: true });
}
