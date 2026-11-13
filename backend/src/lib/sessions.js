import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import { appEvents } from '../events.js';
import { audit } from './audit.js';

/**
 * Server-side sessions (AK-4, finding A3). Each login creates a Session row
 * and the JWT carries its id as `sid`; revoking the row kills the token at
 * once instead of letting it live until it expires.
 *
 * Tokens issued before sessions existed have no `sid` and are still accepted
 * until they expire (≤ JWT_EXPIRES_IN), so nobody is logged out by the deploy.
 */

const CACHE_MS = 30_000;
const cache = new Map(); // sid -> { ok, at }

const DEVICE_TYPES = new Set(['desktop', 'mobile', 'web']);

export async function issueSessionToken(user, req) {
  const sid = crypto.randomUUID();
  const token = jwt.sign(
    { id: user.id, email: user.email, username: user.username, sid },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
  const { exp } = jwt.decode(token);
  const rawType = String(req.body?.deviceType || req.headers['x-client-type'] || 'web').toLowerCase();
  await prisma.session.create({
    data: {
      id: sid,
      userId: user.id,
      deviceType: DEVICE_TYPES.has(rawType) ? rawType : 'web',
      deviceName: String(req.body?.deviceName || req.headers['user-agent'] || '').slice(0, 120) || null,
      expiresAt: new Date(exp * 1000),
    },
  });
  return token;
}

/** Throws (code `session_revoked`) when the token's session is gone. */
export async function assertSessionAlive(payload) {
  if (!payload?.sid) return;
  const hit = cache.get(payload.sid);
  let ok;
  if (hit && Date.now() - hit.at < CACHE_MS) {
    ok = hit.ok;
  } else {
    const s = await prisma.session.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, expiresAt: true },
    });
    ok = !!s && !s.revokedAt && s.expiresAt > new Date();
    cache.set(payload.sid, { ok, at: Date.now() });
    if (ok) {
      prisma.session
        .update({ where: { id: payload.sid }, data: { lastSeenAt: new Date() } })
        .catch(() => {});
    }
  }
  if (!ok) {
    const err = new Error('Session has been revoked');
    err.code = 'session_revoked';
    throw err;
  }
}

/** Revoke sessions matching `where` and kick their live sockets. */
export async function revokeSessions(where, actorId, reason = 'revoked') {
  const sessions = await prisma.session.findMany({
    where: { ...where, revokedAt: null },
    select: { id: true, userId: true },
  });
  if (!sessions.length) return 0;
  const ids = sessions.map((s) => s.id);
  await prisma.session.updateMany({ where: { id: { in: ids } }, data: { revokedAt: new Date() } });
  for (const id of ids) cache.set(id, { ok: false, at: Date.now() });
  appEvents.emit('sessionsRevoked', { sids: ids, reason });
  for (const s of sessions) await audit(actorId, 'session.revoke', 'session', s.id, { userId: s.userId, reason });
  return ids.length;
}
