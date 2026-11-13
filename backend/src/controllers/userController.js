import prisma from '../config/prisma.js';
import { isOnline } from '../sockets/chatSocket.js';
import { revokeSessions } from '../lib/sessions.js';
import { audit } from '../lib/audit.js';

/** Public profile fields (AK-2). Email is included for the directory. */
export const PROFILE_SELECT = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  nik: true,
  title: true,
  division: true,
  company: true,
  site: true,
  managerId: true,
  photoUrl: true,
  orgId: true,
  roles: true,
  active: true,
};

const ADMIN_ROLES = ['hr_admin', 'it_admin'];

async function caller(req) {
  return prisma.user.findUnique({ where: { id: req.user.id }, select: { orgId: true, roles: true } });
}

/**
 * Directory / contact picker (AK-1, finding A4): only active, non-system
 * users of the caller's own organization. Users without an organization only
 * see others without one, so accounts outside the company stay invisible.
 */
export async function listUsers(req, res) {
  const me = await caller(req);
  const q = (req.query.q || '').toString().trim();
  const where = {
    NOT: { id: req.user.id },
    isSystem: false,
    active: true,
    orgId: me?.orgId ?? null,
    ...(q
      ? {
          OR: ['username', 'email', 'fullName', 'nik', 'title', 'division'].map((f) => ({
            [f]: { contains: q, mode: 'insensitive' },
          })),
        }
      : {}),
  };

  const users = await prisma.user.findMany({
    where,
    select: { ...PROFILE_SELECT, createdAt: true },
    orderBy: { username: 'asc' },
    take: 200,
  });
  res.json({ users });
}

/** One profile, same organization only. */
export async function getUser(req, res) {
  const me = await caller(req);
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: PROFILE_SELECT });
  if (!user || (user.orgId ?? null) !== (me?.orgId ?? null)) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user });
}

/** Online status for up to 200 ids (KH-1). No "last seen" by design. */
export async function presence(req, res) {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  res.json({ presence: Object.fromEntries(ids.map((id) => [id, isOnline(id)])) });
}

// ---------------------------------------------------------------- admin
// Scaffold for HR/IT administration until a live HR integration exists.

export function requireAdmin(req, res, next) {
  caller(req)
    .then((me) => {
      if (!me?.roles?.some((r) => ADMIN_ROLES.includes(r))) {
        return res.status(403).json({ error: 'Admin role required', code: 'forbidden' });
      }
      req.callerOrgId = me.orgId ?? null;
      next();
    })
    .catch(next);
}

async function targetInOrg(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, orgId: true } });
  if (!user || (user.orgId ?? null) !== req.callerOrgId) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  return user;
}

/** Update HR fields / roles of an employee. */
export async function adminUpdateUser(req, res) {
  if (!(await targetInOrg(req, res))) return;
  const allowed = ['fullName', 'nik', 'title', 'division', 'company', 'site', 'managerId', 'photoUrl', 'roles'];
  const data = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  const user = await prisma.user.update({ where: { id: req.params.id }, data, select: PROFILE_SELECT });
  await audit(req.user.id, 'user.update', 'user', user.id, data);
  res.json({ user });
}

/** Deactivate (left the company): blocks login and kills every session. */
export async function adminSetActive(req, res) {
  if (!(await targetInOrg(req, res))) return;
  const active = !!req.body?.active;
  await prisma.user.update({ where: { id: req.params.id }, data: { active } });
  if (!active) await revokeSessions({ userId: req.params.id }, req.user.id, 'deactivated');
  await audit(req.user.id, active ? 'user.activate' : 'user.deactivate', 'user', req.params.id);
  res.json({ ok: true });
}

export async function adminRevokeSessions(req, res) {
  if (!(await targetInOrg(req, res))) return;
  const revoked = await revokeSessions({ userId: req.params.id }, req.user.id, 'admin');
  res.json({ ok: true, revoked });
}

export async function adminListSessions(req, res) {
  if (!(await targetInOrg(req, res))) return;
  const sessions = await prisma.session.findMany({
    where: { userId: req.params.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, deviceType: true, deviceName: true, createdAt: true, lastSeenAt: true },
  });
  res.json({ sessions });
}
