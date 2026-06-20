import jwt from 'jsonwebtoken';

/**
 * Voice-call access tokens.
 *
 * These are SEPARATE from user login JWTs. A third-party app's backend mints
 * one of these (via POST /api/v1/calls/:id/token) for each guest participant.
 * The guest's browser then connects the signaling socket with this token —
 * identity (call + display name) comes entirely from the token, no account.
 */

const SECRET = process.env.CALL_TOKEN_SECRET || process.env.JWT_SECRET;
// Window to *join* with. Once the socket is connected the session persists
// regardless of expiry, so a short window is fine.
const TTL = process.env.CALL_TOKEN_TTL || '15m';

export function signAccessToken({ callId, participantId, displayName }) {
  return jwt.sign(
    { type: 'call-access', callId, pid: participantId, name: displayName },
    SECRET,
    { expiresIn: TTL }
  );
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, SECRET);
  if (payload.type !== 'call-access') {
    throw new Error('Not a call access token');
  }
  return {
    callId: payload.callId,
    participantId: payload.pid,
    displayName: payload.name,
  };
}

/** Seconds until a freshly minted token expires (for the API response). */
export function accessTokenTtlSeconds() {
  const m = /^(\d+)\s*(s|m|h)?$/.exec(String(TTL));
  if (!m) return 900;
  const n = Number(m[1]);
  const unit = m[2] || 's';
  return unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
}
