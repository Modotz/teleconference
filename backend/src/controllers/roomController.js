import prisma from '../config/prisma.js';

export async function createRoom(req, res) {
  const { name, description, scheduledAt } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  let scheduled = null;
  if (scheduledAt) {
    const d = new Date(scheduledAt);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduledAt' });
    }
    scheduled = d;
  }

  const room = await prisma.room.create({
    data: {
      name,
      description: description?.trim() || null,
      scheduledAt: scheduled,
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
