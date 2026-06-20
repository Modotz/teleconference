import { randomUUID } from 'crypto';
import prisma from '../../config/prisma.js';
import { signAccessToken, accessTokenTtlSeconds } from '../../lib/accessToken.js';
import { getRoom } from '../../mediasoup/roomManager.js';

/** Mediasoup room id for a public-API call. */
export function sdkCallRoomId(callId) {
  return `sdkcall:${callId}`;
}

/**
 * POST /api/v1/calls
 * Create a new voice call. Returns the call id; the call's media room is
 * created lazily when the first participant joins.
 */
export async function createCall(req, res) {
  const call = await prisma.call.create({
    data: { apiClientId: req.apiClient.id },
  });
  res.status(201).json({
    callId: call.id,
    createdAt: call.createdAt,
  });
}

/**
 * POST /api/v1/calls/:id/token
 * Mint a short-lived access token for one guest participant.
 * Body: { displayName: string, externalId?: string }
 */
export async function issueToken(req, res) {
  const { displayName, externalId } = req.body || {};
  if (!displayName || typeof displayName !== 'string') {
    return res.status(400).json({ error: 'displayName is required' });
  }

  const call = await prisma.call.findUnique({ where: { id: req.params.id } });
  if (!call || call.apiClientId !== req.apiClient.id) {
    return res.status(404).json({ error: 'Call not found' });
  }
  if (call.endedAt) {
    return res.status(409).json({ error: 'Call has already ended' });
  }

  const participantId = externalId || randomUUID();
  const accessToken = signAccessToken({
    callId: call.id,
    participantId,
    displayName: displayName.slice(0, 80),
  });

  res.status(201).json({
    accessToken,
    callId: call.id,
    participantId,
    expiresIn: accessTokenTtlSeconds(),
  });
}

/**
 * GET /api/v1/calls/:id
 * Call status + currently connected participants.
 */
export async function getCall(req, res) {
  const call = await prisma.call.findUnique({ where: { id: req.params.id } });
  if (!call || call.apiClientId !== req.apiClient.id) {
    return res.status(404).json({ error: 'Call not found' });
  }

  const room = getRoom(sdkCallRoomId(call.id));
  const participants = room
    ? Array.from(room.peers.values()).map((p) => ({
        participantId: p.participantId || p.userId,
        displayName: p.displayName || p.username,
      }))
    : [];

  res.json({
    callId: call.id,
    createdAt: call.createdAt,
    endedAt: call.endedAt,
    active: !call.endedAt,
    participantCount: participants.length,
    participants,
  });
}

/**
 * POST /api/v1/calls/:id/end
 * Mark the call ended. New participants can no longer join.
 */
export async function endCall(req, res) {
  const call = await prisma.call.findUnique({ where: { id: req.params.id } });
  if (!call || call.apiClientId !== req.apiClient.id) {
    return res.status(404).json({ error: 'Call not found' });
  }
  if (!call.endedAt) {
    await prisma.call.update({
      where: { id: call.id },
      data: { endedAt: new Date() },
    });
  }
  res.json({ ok: true, callId: call.id });
}
