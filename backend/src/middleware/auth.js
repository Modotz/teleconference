import jwt from 'jsonwebtoken';

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Blocks guest tokens (issued by POST /auth/guest). Guests have no DB user, so
 * any route that reads or writes user-scoped rows must sit behind this — the
 * foreign key would blow up otherwise. Use after authMiddleware.
 */
export function requireAccount(req, res, next) {
  if (req.user?.guest) {
    return res.status(403).json({ error: 'Guests cannot perform this action' });
  }
  next();
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}
