import prisma from '../config/prisma.js';
import { audit } from '../lib/audit.js';
import { bookRoomTx } from './agendaController.js';

/**
 * Room booking (RU-1..RU-5) — Tahap 2 scaffold. Sites and rooms are entered
 * by admins (scripts/import-rooms.js) until a facilities source exists.
 */

function bad(res, status, error, code, extra) {
  return res.status(status).json({ error, ...(code ? { code } : {}), ...(extra || {}) });
}

async function myOrg(req) {
  return (await prisma.user.findUnique({ where: { id: req.user.id }, select: { orgId: true } }))?.orgId ?? null;
}

export async function listSites(req, res) {
  const sites = await prisma.site.findMany({ where: { orgId: await myOrg(req) }, orderBy: { name: 'asc' } });
  res.json({ sites });
}

export async function listRooms(req, res) {
  const site = await prisma.site.findUnique({ where: { id: req.params.siteId } });
  if (!site || site.orgId !== (await myOrg(req))) return bad(res, 404, 'Site not found');
  const rooms = await prisma.bookableRoom.findMany({
    where: { siteId: site.id, active: true, ...(req.query.type ? { type: String(req.query.type) } : {}) },
    orderBy: { name: 'asc' },
  });
  res.json({ rooms });
}

/**
 * Bookings at a site on one day. Other people's bookings show only who and
 * when — not purpose or notes (ROOM-11).
 */
export async function availability(req, res) {
  const site = await prisma.site.findUnique({ where: { id: req.params.siteId } });
  if (!site || site.orgId !== (await myOrg(req))) return bad(res, 404, 'Site not found');
  const day = new Date(String(req.query.date || ''));
  if (isNaN(day.getTime())) return bad(res, 400, 'date (YYYY-MM-DD) required');
  // The site's day in its timezone (Asia/Jakarta has no DST: fixed +07:00).
  const from = new Date(`${String(req.query.date).slice(0, 10)}T00:00:00+07:00`);
  const to = new Date(from.getTime() + 86400000);
  const bookings = await prisma.roomBooking.findMany({
    where: { cancelledAt: null, start: { lt: to }, end: { gt: from }, room: { siteId: site.id } },
    orderBy: { start: 'asc' },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(bookings.map((b) => b.userId))] } },
    select: { id: true, username: true, fullName: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  res.json({
    bookings: bookings.map((b) => {
      const mine = b.userId === req.user.id;
      return {
        id: b.id,
        bookableRoomId: b.bookableRoomId,
        start: b.start,
        end: b.end,
        bookedBy: byId.get(b.userId) ?? null,
        mine,
        ...(mine ? { purpose: b.purpose, note: b.note, eventId: b.eventId } : {}),
      };
    }),
  });
}

/** Book a room (operational bookings: purpose + note, no attendees — RU-5). */
export async function book(req, res) {
  const { bookableRoomId, start, end, purpose, note, reminderMinutes, eventId } = req.body || {};
  const s = new Date(start);
  const e = new Date(end);
  if (!bookableRoomId || isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) {
    return bad(res, 400, 'bookableRoomId, start and end (after start) required');
  }
  const room = await prisma.bookableRoom.findUnique({ where: { id: bookableRoomId }, include: { site: true } });
  if (!room || room.site.orgId !== (await myOrg(req))) return bad(res, 404, 'Room not found');
  try {
    const booking = await prisma.$transaction((tx) =>
      bookRoomTx(tx, {
        bookableRoomId,
        userId: req.user.id,
        eventId: eventId || null,
        start: s,
        end: e,
        purpose: purpose ? String(purpose).slice(0, 200) : null,
        note: note ? String(note).slice(0, 1000) : null,
        reminderMinutes: reminderMinutes == null ? null : Number(reminderMinutes),
      })
    );
    res.status(201).json({ booking });
  } catch (err) {
    if (err.status) return bad(res, err.status, err.message, err.code, err.extra);
    throw err;
  }
}

export async function myBookings(req, res) {
  const bookings = await prisma.roomBooking.findMany({
    where: { userId: req.user.id, cancelledAt: null, end: { gt: new Date() } },
    orderBy: { start: 'asc' },
    include: { room: { include: { site: { select: { id: true, name: true } } } } },
  });
  res.json({ bookings });
}

/** Cancel my booking; `withEvent=true` also cancels the linked agenda item. */
export async function cancelBooking(req, res) {
  const b = await prisma.roomBooking.findUnique({ where: { id: req.params.id } });
  if (!b || b.cancelledAt || b.userId !== req.user.id) return bad(res, 404, 'Booking not found');
  await prisma.roomBooking.update({ where: { id: b.id }, data: { cancelledAt: new Date() } });
  if (b.eventId && req.query.withEvent === 'true') {
    await prisma.calendarEvent.updateMany({ where: { id: b.eventId, ownerId: req.user.id }, data: { cancelledAt: new Date() } });
  }
  await audit(req.user.id, 'booking.cancel', 'booking', b.id);
  res.json({ ok: true });
}
