import prisma from '../config/prisma.js';
import {
  getOrCreateRoom,
  getRoom,
  addPeer,
  getPeer,
  removePeer,
  createWebRtcTransport,
  getProducersInRoom,
} from '../mediasoup/roomManager.js';

/**
 * Voice call signaling — reuses mediasoup roomManager but the "room id"
 * is derived from the conversation id, so calls are scoped per conversation.
 *
 * Events:
 *   call:start      { conversationId }                    → initiator
 *   call:invite     { conversationId, fromUserId, ... }   → broadcast to members (server→client)
 *   call:accept     { conversationId }                    → join the call
 *   call:decline    { conversationId }                    → decline
 *   call:cancel     { conversationId }                    → initiator cancels before anyone joined
 *   call:ended      { conversationId }                    → broadcast when room empties (server→client)
 *
 * Once joined, the existing mediasoup events (createTransport, connectTransport,
 * produce, consume, resumeConsumer, closeProducer) work using callRoomId as the
 * currentRoomId. Producers should use appData.source='mic-call' (audio only).
 */

function callRoomId(conversationId) {
  return `call:${conversationId}`;
}

/** Track who started which call and who's currently in. */
const activeCalls = new Map(); // conversationId -> { initiatorId, startedAt, callId }

export function getActiveCall(conversationId) {
  return activeCalls.get(conversationId);
}

export function registerCall(io, socket, ctx) {
  const user = socket.data.user;

  socket.on('call:start', async ({ conversationId }, cb) => {
    try {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { members: { include: { user: { select: { id: true, username: true } } } } },
      });
      if (!conv) return cb?.({ error: 'Conversation not found' });
      if (!conv.members.some((m) => m.userId === user.id)) {
        return cb?.({ error: 'Not a member' });
      }

      const existing = activeCalls.get(conversationId);
      if (existing) {
        return cb?.({
          ok: true,
          existing: true,
          startedBy: existing.initiatorId,
        });
      }

      const callId = callRoomId(conversationId);
      activeCalls.set(conversationId, {
        initiatorId: user.id,
        startedAt: new Date(),
        callId,
      });

      // Notify all other members (via their user-rooms)
      for (const m of conv.members) {
        if (m.userId === user.id) continue;
        io.to(`user:${m.userId}`).emit('call:invite', {
          conversationId,
          fromUserId: user.id,
          fromUsername: user.username,
          conversation: {
            id: conv.id,
            name: conv.name,
            isGroup: conv.isGroup,
            members: conv.members.map((mm) => ({
              id: mm.user.id,
              username: mm.user.username,
            })),
          },
        });
      }

      cb?.({ ok: true });
    } catch (err) {
      console.error('call:start error', err);
      cb?.({ error: err.message });
    }
  });

  socket.on('call:accept', async ({ conversationId }, cb) => {
    try {
      const active = activeCalls.get(conversationId);
      if (!active) return cb?.({ error: 'No active call' });

      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId: user.id } },
      });
      if (!member) return cb?.({ error: 'Not a member' });

      const room = await getOrCreateRoom(active.callId, (rid, peerId) => {
        io.to(rid).emit('activeSpeaker', { peerId });
      });

      // Set current room context for the existing mediasoup events to use
      ctx.setCurrentRoom(active.callId);
      socket.join(active.callId);

      const peer = {
        id: socket.id,
        userId: user.id,
        username: user.username,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      addPeer(active.callId, peer);

      socket.to(active.callId).emit('peerJoined', {
        peerId: socket.id,
        username: user.username,
      });

      const existingProducers = getProducersInRoom(active.callId, socket.id);
      const peers = [];
      room.peers.forEach((p) => {
        if (p.id !== socket.id) peers.push({ peerId: p.id, username: p.username });
      });

      cb?.({
        rtpCapabilities: room.router.rtpCapabilities,
        existingProducers,
        peers,
      });
    } catch (err) {
      console.error('call:accept error', err);
      cb?.({ error: err.message });
    }
  });

  socket.on('call:decline', async ({ conversationId }) => {
    const active = activeCalls.get(conversationId);
    if (!active) return;
    io.to(`user:${active.initiatorId}`).emit('call:declined', {
      conversationId,
      byUserId: user.id,
      byUsername: user.username,
    });
  });

  socket.on('call:cancel', async ({ conversationId }) => {
    const active = activeCalls.get(conversationId);
    if (!active || active.initiatorId !== user.id) return;

    // Notify all members the call was cancelled
    const members = await prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    for (const m of members) {
      io.to(`user:${m.userId}`).emit('call:cancelled', { conversationId });
    }
    activeCalls.delete(conversationId);
  });

  socket.on('call:leave', ({ conversationId }, cb) => {
    const active = activeCalls.get(conversationId);
    if (!active) return cb?.({ ok: true });

    socket.to(active.callId).emit('peerLeft', { peerId: socket.id });
    removePeer(active.callId, socket.id);
    socket.leave(active.callId);

    // If no peers remain, end the call
    const room = getRoom(active.callId);
    if (!room || room.peers.size === 0) {
      activeCalls.delete(conversationId);
      // Broadcast end so any "incoming call" toasts close
      prisma.conversationMember
        .findMany({ where: { conversationId }, select: { userId: true } })
        .then((members) => {
          for (const m of members) {
            io.to(`user:${m.userId}`).emit('call:ended', { conversationId });
          }
        });
    }
    cb?.({ ok: true });
  });
}
