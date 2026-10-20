import jwt from 'jsonwebtoken';

function verify(token, req, res, next) {
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  return verify(header.slice(7), req, res, next);
}

/**
 * Same as authMiddleware, but falls back to `?token=` in the query string.
 *
 * `<img>`, `<audio>` and download links cannot carry an Authorization header,
 * so attachment URLs pass the JWT as a query parameter instead. That puts the
 * token in access logs, so keep this on read-only file routes — never on
 * anything that mutates state.
 */
export function authMiddlewareAllowQuery(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return verify(header.slice(7), req, res, next);
  }
  const qs = req.query?.token;
  if (typeof qs === 'string' && qs) {
    return verify(qs, req, res, next);
  }
  return res.status(401).json({ error: 'Missing token' });
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
