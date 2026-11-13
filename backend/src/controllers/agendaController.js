import prisma from '../config/prisma.js';
import { appEvents } from '../events.js';
import { audit } from '../lib/audit.js';

/**
 * Agenda (AG-1..AG-5) — Tahap 2 scaffold. Events with attendees and
 * responses, online/offline/hybrid, optional room booking. Not yet: Outlook
 * sync, server reminders, recurrence expansion (RRULE is stored as-is).
 */

const KINDS = new Set(['meeting', 'activity']);
const MODES = new Set(['online', 'offline', 'hybrid']);
const RESPONSES = new Set(['yes', 'maybe', 'no']);

const eventInclude = {
  attendees: true,
  bookings: { where: { cancelledAt: null }, include: { room: { select: { id: true, name: true, siteId: true } } } },
};

function bad(res, status, error, code, extra) {
  return res.status(status).json({ error, ...(code ? { code } : {}), ...(extra || {}) });
}

function parseDate(v) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function notifyAttendees(event, name, payload) {
  for (const a of event.attendees || []) {
    if (a.userId) appEvents.emit('toUser', { userId: a.userId, event: name, payload });
  }
  appEvents.emit('toUser', { userId: event.ownerId, event: name, payload });
}

/** Private events of others show only as busy blocks. */
function viewFor(event, userId) {
  const mine = event.ownerId === userId || event.attendees.some((a) => a.userId === userId);
  if (mine || !event.isPrivate) return event;
  return { id: event.id, ownerId: event.ownerId, start: event.start, end: event.end, allDay: event.allDay, showAs: event.showAs, isPrivate: true, title: 'Busy' };
}

/**
 * Book a physical room inside a transaction that locks the room row, so two
 * people can never book the same slot (RU-2). Throws {conflict} on overlap.
 */
export async function bookRoomTx(tx, { bookableRoomId, userId, eventId, start, end, purpose, note, reminderMinutes }) {
  const locked = await tx.$queryRaw`SELECT id FROM "BookableRoom" WHERE id = ${bookableRoomId} AND active = true FOR UPDATE`;
  if (!locked.length) throw Object.assign(new Error('Room not found'), { status: 404 });
  const clash = await tx.roomBooking.findFirst({
    where: { bookableRoomId, cancelledAt: null, start: { lt: end }, end: { gt: start } },
  });
  if (clash) {
    const who = await tx.user.findUnique({ where: { id: clash.userId }, select: { id: true, username: true, fullName: true } });
    throw Object.assign(new Error('Room is already booked for this time'), {
      status: 409,
      code: 'room_conflict',
      extra: { bookedBy: who, start: clash.start, end: clash.end },
    });
  }
  return tx.roomBooking.create({
    data: { bookableRoomId, userId, eventId: eventId ?? null, start, end, purpose, note, reminderMinutes },
  });
}

function sendTxError(res, err) {
  if (err.status) return bad(res, err.status, err.message, err.code, err.extra);
  throw err;
}

/** Events I own or am invited to, overlapping [from, to). */
export async function listEvents(req, res) {
  const from = parseDate(req.query.from) ?? new Date(Date.now() - 31 * 86400000);
  const to = parseDate(req.query.to) ?? new Date(Date.now() + 62 * 86400000);
  const events = await prisma.calendarEvent.findMany({
    where: {
      cancelledAt: null,
      start: { lt: to },
      end: { gt: from },
      OR: [{ ownerId: req.user.id }, { attendees: { some: { userId: req.user.id } } }],
    },
    orderBy: { start: 'asc' },
    include: eventInclude,
  });
  res.json({ events });
}

export async function getEvent(req, res) {
  const event = await prisma.calendarEvent.findUnique({ where: { id: req.params.id }, include: eventInclude });
  if (!event) return bad(res, 404, 'Event not found');
  res.json({ event: viewFor(event, req.user.id) });
}

function readEventInput(body, partial) {
  const out = {};
  const err = (m) => ({ error: m });
  if (!partial || body.title !== undefined) {
    if (!body.title?.trim()) return err('title required');
    out.title = body.title.trim().slice(0, 200);
  }
  for (const k of ['description', 'location', 'category', 'color', 'recurrence']) {
    if (body[k] !== undefined) out[k] = body[k] ? String(body[k]).slice(0, 2000) : null;
  }
  if (body.kind !== undefined) {
    if (!KINDS.has(body.kind)) return err('kind must be meeting or activity');
    out.kind = body.kind;
  }
  if (body.mode !== undefined) {
    if (!MODES.has(body.mode)) return err('mode must be online, offline or hybrid');
    out.mode = body.mode;
  }
  for (const k of ['isPrivate', 'allDay', 'done']) if (body[k] !== undefined) out[k] = !!body[k];
  if (body.showAs !== undefined) out.showAs = body.showAs === 'free' ? 'free' : 'busy';
  if (body.reminderMinutes !== undefined) out.reminderMinutes = body.reminderMinutes == null ? null : Number(body.reminderMinutes);
  if (!partial || body.start !== undefined) {
    out.start = parseDate(body.start);
    if (!out.start) return err('valid start required');
  }
  if (!partial || body.end !== undefined) {
    out.end = parseDate(body.end);
    if (!out.end) return err('valid end required');
  }
  if (out.start && out.end && out.end <= out.start) return err('end must be after start');
  return { data: out };
}

/**
 * Create an event. Body: event fields + attendees [{ userId | email, optional }]
 * + optional bookableRoomId. Online/hybrid events get a Telepati meeting room.
 */
export async function createEvent(req, res) {
  const parsed = readEventInput(req.body || {}, false);
  if (parsed.error) return bad(res, 400, parsed.error);
  const data = parsed.data;
  const attendees = (Array.isArray(req.body.attendees) ? req.body.attendees : [])
    .filter((a) => a && (a.userId || a.email) && a.userId !== req.user.id)
    .slice(0, 300);

  try {
    const event = await prisma.$transaction(async (tx) => {
      let roomId = req.body.roomId || null;
      if (!roomId && (data.mode ?? 'online') !== 'offline' && (data.kind ?? 'meeting') === 'meeting') {
        const room = await tx.room.create({
          data: {
            name: data.title,
            description: data.description ?? null,
            ownerId: req.user.id,
            scheduledAt: data.start,
            durationMinutes: Math.max(5, Math.min(480, Math.round((data.end - data.start) / 60000))),
          },
        });
        roomId = room.id;
      }
      const created = await tx.calendarEvent.create({
        data: {
          ...data,
          ownerId: req.user.id,
          roomId,
          attendees: {
            create: attendees.map((a) => ({ userId: a.userId || null, email: a.email || null, optional: !!a.optional })),
          },
        },
      });
      if (req.body.bookableRoomId) {
        await bookRoomTx(tx, {
          bookableRoomId: req.body.bookableRoomId,
          userId: req.user.id,
          eventId: created.id,
          start: data.start,
          end: data.end,
          purpose: data.title,
        });
      }
      return tx.calendarEvent.findUnique({ where: { id: created.id }, include: eventInclude });
    });
    notifyAttendees(event, 'agenda:invited', { event });
    res.status(201).json({ event });
  } catch (err) {
    return sendTxError(res, err);
  }
}

/** Owner edits. A time change resets everyone's response to pending (AG-3). */
export async function updateEvent(req, res) {
  const existing = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.cancelledAt) return bad(res, 404, 'Event not found');
  if (existing.ownerId !== req.user.id) return bad(res, 403, 'Only the organizer can edit this event');
  const parsed = readEventInput(req.body || {}, true);
  if (parsed.error) return bad(res, 400, parsed.error);
  const data = parsed.data;
  const start = data.start ?? existing.start;
  const end = data.end ?? existing.end;
  if (end <= start) return bad(res, 400, 'end must be after start');
  const timeChanged = start.getTime() !== existing.start.getTime() || end.getTime() !== existing.end.getTime();

  try {
    const event = await prisma.$transaction(async (tx) => {
      await tx.calendarEvent.update({ where: { id: existing.id }, data });
      if (timeChanged) {
        await tx.eventAttendee.updateMany({
          where: { eventId: existing.id },
          data: { response: 'pending', respondedAt: null },
        });
        // Move the room booking with the event; a clash rolls everything back.
        const bookings = await tx.roomBooking.findMany({ where: { eventId: existing.id, cancelledAt: null } });
        for (const b of bookings) {
          await tx.roomBooking.update({ where: { id: b.id }, data: { cancelledAt: new Date() } });
          await bookRoomTx(tx, { bookableRoomId: b.bookableRoomId, userId: b.userId, eventId: existing.id, start, end, purpose: b.purpose, note: b.note });
        }
        if (existing.roomId) {
          await tx.room.update({ where: { id: existing.roomId }, data: { scheduledAt: start } }).catch(() => {});
        }
      }
      return tx.calendarEvent.findUnique({ where: { id: existing.id }, include: eventInclude });
    });
    notifyAttendees(event, 'agenda:updated', { event, timeChanged });
    res.json({ event });
  } catch (err) {
    return sendTxError(res, err);
  }
}

/** Organizer cancels: event, its bookings, attendees told (AG-3, ROOM-12). */
export async function cancelEvent(req, res) {
  const event = await prisma.calendarEvent.findUnique({ where: { id: req.params.id }, include: eventInclude });
  if (!event || event.cancelledAt) return bad(res, 404, 'Event not found');
  if (event.ownerId !== req.user.id) return bad(res, 403, 'Only the organizer can cancel this event');
  const keepRoom = req.query.keepRoomBooking === 'true';
  await prisma.$transaction([
    prisma.calendarEvent.update({ where: { id: event.id }, data: { cancelledAt: new Date() } }),
    ...(keepRoom ? [] : [prisma.roomBooking.updateMany({ where: { eventId: event.id, cancelledAt: null }, data: { cancelledAt: new Date() } })]),
  ]);
  notifyAttendees(event, 'agenda:cancelled', { eventId: event.id });
  await audit(req.user.id, 'agenda.cancel', 'event', event.id);
  res.json({ ok: true });
}

/** Attendee answers yes / maybe / no with an optional note (AG-2). */
export async function respondEvent(req, res) {
  const { response, note } = req.body || {};
  if (!RESPONSES.has(response)) return bad(res, 400, 'response must be yes, maybe or no');
  const attendee = await prisma.eventAttendee.findUnique({
    where: { eventId_userId: { eventId: req.params.id, userId: req.user.id } },
    include: { event: true },
  });
  if (!attendee || attendee.event.cancelledAt) return bad(res, 404, 'Invitation not found');
  const updated = await prisma.eventAttendee.update({
    where: { id: attendee.id },
    data: { response, note: note ? String(note).slice(0, 500) : null, respondedAt: new Date() },
  });
  appEvents.emit('toUser', {
    userId: attendee.event.ownerId,
    event: 'agenda:response',
    payload: { eventId: req.params.id, userId: req.user.id, response, note: updated.note },
  });
  res.json({ attendee: updated });
}

/**
 * Busy blocks for colleagues, without titles or details (AG-5). Same
 * organization only.
 */
export async function freeBusy(req, res) {
  const ids = String(req.query.userIds || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  if (!ids.length || !from || !to) return bad(res, 400, 'userIds, from and to required');
  const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { orgId: true } });
  const allowed = await prisma.user.findMany({
    where: { id: { in: ids }, orgId: me?.orgId ?? null },
    select: { id: true },
  });
  const allowedIds = allowed.map((u) => u.id);
  const events = await prisma.calendarEvent.findMany({
    where: {
      cancelledAt: null,
      showAs: 'busy',
      start: { lt: to },
      end: { gt: from },
      OR: [
        { ownerId: { in: allowedIds } },
        { attendees: { some: { userId: { in: allowedIds }, response: { not: 'no' } } } },
      ],
    },
    select: { start: true, end: true, ownerId: true, attendees: { select: { userId: true, response: true } } },
  });
  const busy = Object.fromEntries(allowedIds.map((id) => [id, []]));
  for (const e of events) {
    const people = new Set([e.ownerId, ...e.attendees.filter((a) => a.response !== 'no').map((a) => a.userId)]);
    for (const id of people) if (busy[id]) busy[id].push({ start: e.start, end: e.end });
  }
  res.json({ busy });
}
