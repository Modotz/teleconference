import prisma from '../config/prisma.js';

/**
 * List all users (used as contact picker).
 * Excludes the requesting user. Supports optional `q` query for username/email search.
 */
export async function listUsers(req, res) {
  const q = (req.query.q || '').toString().trim();
  const where = {
    NOT: { id: req.user.id },
    ...(q
      ? {
          OR: [
            { username: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const users = await prisma.user.findMany({
    where,
    select: { id: true, username: true, email: true, createdAt: true },
    orderBy: { username: 'asc' },
    take: 200,
  });
  res.json({ users });
}
