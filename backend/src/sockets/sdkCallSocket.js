import prisma from '../config/prisma.js';
import {
  getOrCreateRoom,
  addPeer,
  getProducersInRoom,
} from '../mediasoup/roomManager.js';
import { sdkCallRoomId } from '../controllers/v1/callsController.js';

/**
 * Signaling for third-party SDK voice calls.
 *
 * The socket is authenticated by a call ACCESS TOKEN (set on
 * socket.data.callAccess by the handshake middleware), so the guest's
 * identity (callId + displayName) comes purely from the token — no User row.
 *
 * `sdk:join` sets the shared currentRoomId; the generic mediasoup events
 * (createTransport / produce / consume / ...) in signaling.js then operate
 * on that room exactly as they do for logged-in users.
 */
export function registerSdkCall(io, socket, ctx) {
  const access = socket.data.callAccess; // { callId, participantId, displayName }

  socket.on('sdk:join', async (_data, cb) => {
    try {
      const call = await prisma.call.findUnique({ where: { id: access.callId } });
      if (!call) return cb?.({ error: 'Call not found' });
      if (call.endedAt) return cb?.({ error: 'Call has ended' });

      const roomId = sdkCallRoomId(access.callId);
      const room = await getOrCreateRoom(roomId, (rid, peerId) => {
        io.to(rid).emit('activeSpeaker', { peerId });
      });

      ctx.setCurrentRoom(roomId);
      socket.join(roomId);

      const peer = {
        id: socket.id,
        // `username` is what the generic produce/consume handlers read.
        username: access.displayName,
        userId: access.participantId,
        participantId: access.participantId,
        displayName: access.displayName,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      addPeer(roomId, peer);

      socket.to(roomId).emit('peerJoined', {
        peerId: socket.id,
        username: access.displayName,
      });

      const existingProducers = getProducersInRoom(roomId, socket.id);
      const peers = [];
      room.peers.forEach((p) => {
        if (p.id !== socket.id) {
          peers.push({ peerId: p.id, username: p.username });
        }
      });

      cb?.({
        rtpCapabilities: room.router.rtpCapabilities,
        existingProducers,
        peers,
        self: {
          participantId: access.participantId,
          displayName: access.displayName,
        },
      });
    } catch (err) {
      console.error('sdk:join error', err);
      cb?.({ error: err.message });
    }
  });

  // Explicit leave — the disconnect handler in signaling.js does the actual
  // peer cleanup; this just lets the client ack a graceful hang-up.
  socket.on('sdk:leave', (_data, cb) => {
    cb?.({ ok: true });
  });
}
