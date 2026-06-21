import { verifyToken } from '../middleware/auth.js';
import { verifyAccessToken } from '../lib/accessToken.js';
import {
  getOrCreateRoom,
  getRoom,
  addPeer,
  getPeer,
  removePeer,
  createWebRtcTransport,
  getProducersInRoom,
  setHandState,
  getRaisedHands,
} from '../mediasoup/roomManager.js';
import prisma from '../config/prisma.js';
import { registerChat, registerUserSocket, bindAppEvents } from './chatSocket.js';
import { registerCall } from './callSocket.js';
import { registerSdkCall } from './sdkCallSocket.js';

export function registerSignaling(io) {
  bindAppEvents(io);

  // Lobby: people waiting to be admitted. roomId -> Map(socketId -> { username, userId }).
  const waiting = new Map();
  // Users already admitted to a room (by userId) — lets them skip the lobby when
  // they reconnect/rejoin after a network drop. roomId -> Set(userId).
  const admittedUsers = new Map();
  const isAdmitted = (roomId, userId) =>
    !!admittedUsers.get(roomId)?.has(userId);
  const markAdmitted = (roomId, userId) => {
    let s = admittedUsers.get(roomId);
    if (!s) {
      s = new Set();
      admittedUsers.set(roomId, s);
    }
    s.add(userId);
  };

  // Whether a room is locked (no new joins). roomId -> boolean.
  const lockedRooms = new Map();
  // Current host (may be transferred at runtime). roomId -> userId.
  const roomHost = new Map();
  // Optional meeting PIN (alternative to the lobby). roomId -> string.
  const roomPins = new Map();
  // When the meeting started (first join). roomId -> epoch ms.
  const roomStart = new Map();

  // Co-host role remembered by userId so it survives a reconnect. roomId -> Set.
  const coHostUsers = new Map();
  const isCoHostUser = (roomId, userId) =>
    !!coHostUsers.get(roomId)?.has(userId);
  const setCoHostUser = (roomId, userId, value) => {
    let s = coHostUsers.get(roomId);
    if (!s) {
      s = new Set();
      coHostUsers.set(roomId, s);
    }
    if (value) s.add(userId);
    else s.delete(userId);
  };

  // Emit an event to every host/co-host currently in a room.
  function notifyModerators(roomId, event, payload) {
    const room = getRoom(roomId);
    if (!room) return;
    room.peers.forEach((p) => {
      if (p.isHost || p.isCoHost) io.to(p.id).emit(event, payload);
    });
  }

  /**
   * Handshake auth supports two kinds of caller:
   *  - `token`       → a logged-in user (JWT from /auth/login)
   *  - `accessToken` → a third-party SDK guest (call access token)
   */
  io.use((socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      if (auth.accessToken) {
        socket.data.callAccess = verifyAccessToken(auth.accessToken);
        return next();
      }
      if (auth.token) {
        socket.data.user = verifyToken(auth.token);
        return next();
      }
      return next(new Error('No token'));
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const callAccess = socket.data.callAccess;
    const isSdkGuest = Boolean(callAccess);

    console.log(
      `Socket connected: ${socket.id} (${
        isSdkGuest ? `sdk-guest=${callAccess.displayName}` : `user=${user.username}`
      })`
    );

    let currentRoomId = null;
    const roomCtx = { setCurrentRoom: (id) => { currentRoomId = id; } };

    if (isSdkGuest) {
      // ---- Third-party SDK guest: voice-call events only ----
      registerSdkCall(io, socket, roomCtx);
    } else {
      // ---- Logged-in user: chat + call + room ----
      registerUserSocket(socket, user.id);
      registerChat(io, socket);
      registerCall(io, socket, roomCtx);

      /**
       * Join request. The host enters directly; everyone else waits in the
       * lobby until a moderator admits them.
       */
      const cleanName = (name) =>
        (name && String(name).trim()) || user.username;

      socket.on('joinRoom', async ({ roomId, displayName, pin }, callback) => {
        try {
          const dbRoom = await prisma.room.findUnique({ where: { id: roomId } });
          if (!dbRoom || !dbRoom.isActive) {
            return callback({ error: 'Room not found or inactive' });
          }

          // Host = current host (room owner, unless transferred at runtime).
          if (!roomHost.has(roomId)) roomHost.set(roomId, dbRoom.ownerId);
          const isHost = roomHost.get(roomId) === user.id;

          if (!isHost && !isAdmitted(roomId, user.id)) {
            // Locked rooms reject all newcomers.
            if (lockedRooms.get(roomId)) return callback({ error: 'locked' });

            const requiredPin = roomPins.get(roomId);
            if (requiredPin) {
              // PIN mode: correct PIN skips the lobby; wrong/missing is rejected.
              if (String(pin || '') !== requiredPin) {
                return callback({ error: 'pin' });
              }
              markAdmitted(roomId, user.id);
            } else {
              // Lobby mode: wait for a moderator to admit.
              let w = waiting.get(roomId);
              if (!w) {
                w = new Map();
                waiting.set(roomId, w);
              }
              const name = cleanName(displayName);
              w.set(socket.id, { username: name, userId: user.id });
              socket.data.lobbyRoomId = roomId;
              notifyModerators(roomId, 'waitingPeer', {
                peerId: socket.id,
                username: name,
              });
              return callback({ inLobby: true });
            }
          }

          callback(await performJoin(roomId, isHost, displayName));
        } catch (err) {
          console.error('joinRoom error', err);
          callback({ error: err.message });
        }
      });

      /** Completes the join once a lobby guest has been admitted by a host. */
      socket.on('finalizeJoin', async ({ roomId, displayName }, callback) => {
        try {
          if (!socket.data.admitted) return callback({ error: 'Not admitted' });
          socket.data.admitted = false;
          socket.data.lobbyRoomId = null;
          callback(await performJoin(roomId, false, displayName));
        } catch (err) {
          console.error('finalizeJoin error', err);
          callback({ error: err.message });
        }
      });

      // Lobby guest renames themselves before being admitted.
      socket.on('setLobbyName', ({ name }) => {
        const roomId = socket.data.lobbyRoomId;
        if (!roomId) return;
        const w = waiting.get(roomId);
        const entry = w?.get(socket.id);
        if (!entry) return;
        entry.username = cleanName(name);
        notifyModerators(roomId, 'waitingPeer', {
          peerId: socket.id,
          username: entry.username,
        });
      });

      async function performJoin(roomId, isHost, displayName) {
        const room = await getOrCreateRoom(roomId, (rid, peerId) => {
          io.to(rid).emit('activeSpeaker', { peerId });
        });
        currentRoomId = roomId;
        socket.join(roomId);
        if (!roomStart.has(roomId)) roomStart.set(roomId, Date.now());

        const username = cleanName(displayName);
        const peer = {
          id: socket.id,
          userId: user.id,
          username,
          micEnabled: true,
          camEnabled: true,
          isHost,
          // Restore co-host role if this user had it before reconnecting.
          isCoHost: isCoHostUser(roomId, user.id),
          transports: new Map(),
          producers: new Map(),
          consumers: new Map(),
        };
        addPeer(roomId, peer);

        await prisma.participant.create({ data: { roomId, userId: user.id } });

        socket.to(roomId).emit('peerJoined', {
          peerId: socket.id,
          username,
          isHost,
          isCoHost: peer.isCoHost,
        });

        const existingProducers = getProducersInRoom(roomId, socket.id);
        const peers = [];
        room.peers.forEach((p) => {
          if (p.id !== socket.id) {
            peers.push({
              peerId: p.id,
              username: p.username,
              micEnabled: p.micEnabled !== false,
              camEnabled: p.camEnabled !== false,
              isHost: !!p.isHost,
              isCoHost: !!p.isCoHost,
            });
          }
        });

        const recent = await prisma.message.findMany({
          where: { roomId },
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { user: { select: { id: true, username: true } } },
        });
        const messages = recent.reverse().map((m) => ({
          id: m.id,
          userId: m.user.id,
          username: m.user.username,
          content: m.content,
          attachmentUrl: m.attachmentUrl,
          attachmentName: m.attachmentName,
          attachmentType: m.attachmentType,
          attachmentSize: m.attachmentSize,
          createdAt: m.createdAt,
        }));

        // Moderators receive the current lobby so they can admit people.
        const w = waiting.get(roomId);
        const waitingList =
          (peer.isHost || peer.isCoHost) && w
            ? Array.from(w.entries()).map(([id, info]) => ({
                peerId: id,
                username: info.username,
              }))
            : [];

        return {
          rtpCapabilities: room.router.rtpCapabilities,
          existingProducers,
          peers,
          messages,
          raisedHands: getRaisedHands(roomId),
          isHost,
          isCoHost: peer.isCoHost,
          locked: !!lockedRooms.get(roomId),
          hasPin: !!roomPins.get(roomId),
          pin: isHost ? roomPins.get(roomId) || '' : undefined,
          startedAt: roomStart.get(roomId) || Date.now(),
          waitingList,
        };
      }
    }

    // ================================================================
    // Generic mediasoup events — shared by video rooms, in-app voice
    // calls, AND third-party SDK calls. They operate purely on
    // `currentRoomId` and never touch user identity.
    // ================================================================

    socket.on('createTransport', async ({ direction }, callback) => {
      try {
        const room = getRoom(currentRoomId);
        if (!room) return callback({ error: 'Not in room' });

        const peer = getPeer(currentRoomId, socket.id);
        if (!peer) return callback({ error: 'Peer not found' });

        const { transport, params } = await createWebRtcTransport(room.router);
        transport.appData = { direction };
        peer.transports.set(transport.id, transport);

        transport.on('dtlsstatechange', (state) => {
          if (state === 'closed') transport.close();
        });

        callback({ params });
      } catch (err) {
        console.error('createTransport error', err);
        callback({ error: err.message });
      }
    });

    socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
      try {
        const peer = getPeer(currentRoomId, socket.id);
        if (!peer) return callback({ error: 'Peer not found' });

        const transport = peer.transports.get(transportId);
        if (!transport) return callback({ error: 'Transport not found' });

        await transport.connect({ dtlsParameters });
        callback({ ok: true });
      } catch (err) {
        console.error('connectTransport error', err);
        callback({ error: err.message });
      }
    });

    socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
      try {
        const peer = getPeer(currentRoomId, socket.id);
        if (!peer) return callback({ error: 'Peer not found' });

        const transport = peer.transports.get(transportId);
        if (!transport) return callback({ error: 'Transport not found' });

        const producer = await transport.produce({
          kind,
          rtpParameters,
          appData: appData || {},
        });
        peer.producers.set(producer.id, producer);

        // Register microphone audio with the active-speaker observer.
        if (
          producer.kind === 'audio' &&
          producer.appData?.source !== 'screen-audio'
        ) {
          const room = getRoom(currentRoomId);
          room?.audioLevelObserver
            ?.addProducer({ producerId: producer.id })
            .catch((e) => console.error('audioLevelObserver.addProducer', e));
        }

        producer.on('transportclose', () => {
          producer.close();
          peer.producers.delete(producer.id);
        });

        socket.to(currentRoomId).emit('newProducer', {
          producerId: producer.id,
          peerId: socket.id,
          username: peer.username,
          kind: producer.kind,
          appData: producer.appData || {},
        });

        callback({ id: producer.id });
      } catch (err) {
        console.error('produce error', err);
        callback({ error: err.message });
      }
    });

    socket.on(
      'consume',
      async ({ transportId, producerId, rtpCapabilities }, callback) => {
        try {
          const room = getRoom(currentRoomId);
          if (!room) return callback({ error: 'Not in room' });

          if (!room.router.canConsume({ producerId, rtpCapabilities })) {
            return callback({ error: 'Cannot consume' });
          }

          const peer = getPeer(currentRoomId, socket.id);
          if (!peer) return callback({ error: 'Peer not found' });

          const transport = peer.transports.get(transportId);
          if (!transport) return callback({ error: 'Transport not found' });

          const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: true,
          });
          peer.consumers.set(consumer.id, consumer);

          consumer.on('transportclose', () => {
            consumer.close();
            peer.consumers.delete(consumer.id);
          });
          consumer.on('producerclose', () => {
            consumer.close();
            peer.consumers.delete(consumer.id);
            socket.emit('consumerClosed', { consumerId: consumer.id });
          });

          let producerAppData = {};
          room.peers.forEach((p) => {
            const prod = p.producers.get(producerId);
            if (prod) producerAppData = prod.appData || {};
          });

          callback({
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            appData: producerAppData,
          });
        } catch (err) {
          console.error('consume error', err);
          callback({ error: err.message });
        }
      }
    );

    socket.on('resumeConsumer', async ({ consumerId }, callback) => {
      try {
        const peer = getPeer(currentRoomId, socket.id);
        if (!peer) return callback({ error: 'Peer not found' });
        const consumer = peer.consumers.get(consumerId);
        if (!consumer) return callback({ error: 'Consumer not found' });

        await consumer.resume();
        callback({ ok: true });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('closeProducer', async ({ producerId }, callback) => {
      try {
        const peer = getPeer(currentRoomId, socket.id);
        if (!peer) return callback?.({ error: 'Peer not found' });
        const producer = peer.producers.get(producerId);
        if (producer) {
          producer.close();
          peer.producers.delete(producerId);
          socket.to(currentRoomId).emit('producerClosed', {
            producerId,
            peerId: socket.id,
          });
        }
        callback?.({ ok: true });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    // Broadcast mic/camera mute state so peers can show an indicator per tile.
    socket.on('setMicState', ({ enabled }, callback) => {
      const peer = getPeer(currentRoomId, socket.id);
      if (!peer) return callback?.({ error: 'Peer not found' });
      peer.micEnabled = !!enabled;
      socket.to(currentRoomId).emit('micState', {
        peerId: socket.id,
        enabled: !!enabled,
      });
      callback?.({ ok: true });
    });

    socket.on('setCamState', ({ enabled }, callback) => {
      const peer = getPeer(currentRoomId, socket.id);
      if (!peer) return callback?.({ error: 'Peer not found' });
      peer.camEnabled = !!enabled;
      socket.to(currentRoomId).emit('camState', {
        peerId: socket.id,
        enabled: !!enabled,
      });
      callback?.({ ok: true });
    });

    // Emoji reaction — broadcast to everyone (including sender) to animate.
    socket.on('reaction', ({ emoji }) => {
      const peer = getPeer(currentRoomId, socket.id);
      if (!peer || !emoji) return;
      io.to(currentRoomId).emit('reaction', {
        peerId: socket.id,
        username: peer.username,
        emoji: String(emoji).slice(0, 8),
      });
    });

    // Self-reported connection quality so peers can show a signal indicator.
    socket.on('quality', ({ level }) => {
      if (!getPeer(currentRoomId, socket.id)) return;
      socket.to(currentRoomId).emit('peerQuality', {
        peerId: socket.id,
        level,
      });
    });

    // Rename yourself while in the meeting; everyone updates their roster/tiles.
    socket.on('setName', ({ name }, callback) => {
      const peer = getPeer(currentRoomId, socket.id);
      if (!peer) return callback?.({ error: 'Not in room' });
      const clean = (name && String(name).trim()) || peer.username;
      peer.username = clean;
      socket.to(currentRoomId).emit('nameChanged', {
        peerId: socket.id,
        name: clean,
      });
      callback?.({ ok: true });
    });

    // ---- Moderation ----
    // Host OR co-host may mute/unmute, stop camera, kick, and admit lobby guests.
    const requireModerator = () => {
      const self = getPeer(currentRoomId, socket.id);
      return self && (self.isHost || self.isCoHost) ? self : null;
    };
    // Only the room owner (host) may promote/demote co-hosts.
    const requireHost = () => {
      const self = getPeer(currentRoomId, socket.id);
      return self?.isHost ? self : null;
    };

    // Ask a participant to mute/unmute. The target obeys and re-broadcasts state.
    socket.on('hostMute', ({ peerId, enabled }, callback) => {
      if (!requireModerator()) return callback?.({ error: 'Not allowed' });
      io.to(peerId).emit('forceMic', { enabled: !!enabled });
      callback?.({ ok: true });
    });

    // Ask a participant to turn their camera on/off.
    socket.on('hostCam', ({ peerId, enabled }, callback) => {
      if (!requireModerator()) return callback?.({ error: 'Not allowed' });
      io.to(peerId).emit('forceCam', { enabled: !!enabled });
      callback?.({ ok: true });
    });

    // Mute everyone except the moderator who issued it.
    socket.on('hostMuteAll', (_data, callback) => {
      if (!requireModerator()) return callback?.({ error: 'Not allowed' });
      const room = getRoom(currentRoomId);
      room?.peers.forEach((p) => {
        if (p.id !== socket.id) io.to(p.id).emit('forceMic', { enabled: false });
      });
      callback?.({ ok: true });
    });

    // Remove a participant from the room.
    socket.on('hostKick', ({ peerId }, callback) => {
      if (!requireModerator()) return callback?.({ error: 'Not allowed' });
      if (peerId === socket.id) return callback?.({ error: 'Cannot kick self' });
      // Revoke admission + co-host so a kicked user can't reconnect back in.
      const targetPeer = getPeer(currentRoomId, peerId);
      if (targetPeer?.userId) {
        admittedUsers.get(currentRoomId)?.delete(targetPeer.userId);
        coHostUsers.get(currentRoomId)?.delete(targetPeer.userId);
      }
      io.to(peerId).emit('kicked');
      const target = io.sockets.sockets.get(peerId);
      // Give the 'kicked' event a tick to flush before tearing down the socket.
      setTimeout(() => target?.disconnect(true), 200);
      callback?.({ ok: true });
    });

    // Promote/demote a participant as co-host (host only).
    socket.on('hostSetCoHost', ({ peerId, value }, callback) => {
      if (!requireHost()) return callback?.({ error: 'Not host' });
      const target = getPeer(currentRoomId, peerId);
      if (!target) return callback?.({ error: 'Peer not found' });
      target.isCoHost = !!value;
      // Remember by userId so the role survives a reconnect.
      if (target.userId) setCoHostUser(currentRoomId, target.userId, !!value);
      io.to(currentRoomId).emit('coHostState', { peerId, value: !!value });
      // A fresh co-host needs the current lobby so they can admit people.
      if (value) {
        const w = waiting.get(currentRoomId);
        const list = w
          ? Array.from(w.entries()).map(([id, info]) => ({
              peerId: id,
              username: info.username,
            }))
          : [];
        io.to(peerId).emit('waitingList', { list });
      }
      callback?.({ ok: true });
    });

    // Admit a lobby guest into the meeting.
    socket.on('admitPeer', ({ peerId }, callback) => {
      if (!requireModerator()) return callback?.({ error: 'Not allowed' });
      const w = waiting.get(currentRoomId);
      const entry = w?.get(peerId);
      if (entry) {
        w.delete(peerId);
        // Remember this user so they skip the lobby if they reconnect.
        if (entry.userId) markAdmitted(currentRoomId, entry.userId);
        const target = io.sockets.sockets.get(peerId);
        if (target) {
          target.data.admitted = true;
          io.to(peerId).emit('admitted');
        }
        notifyModerators(currentRoomId, 'waitingPeerLeft', { peerId });
      }
      callback?.({ ok: true });
    });

    // Host locks/unlocks the room (lock = no new joins).
    socket.on('setLock', ({ locked }, callback) => {
      if (!requireHost()) return callback?.({ error: 'Not host' });
      lockedRooms.set(currentRoomId, !!locked);
      io.to(currentRoomId).emit('lockState', { locked: !!locked });
      callback?.({ ok: true });
    });

    // Host sets/clears the meeting PIN (empty = no PIN, lobby mode resumes).
    socket.on('setPin', ({ pin }, callback) => {
      if (!requireHost()) return callback?.({ error: 'Not host' });
      const p = String(pin || '').trim();
      if (p) roomPins.set(currentRoomId, p);
      else roomPins.delete(currentRoomId);
      io.to(currentRoomId).emit('pinState', { hasPin: !!p });
      callback?.({ ok: true, pin: p });
    });

    // Host hands the host role to another participant.
    socket.on('transferHost', ({ peerId }, callback) => {
      if (!requireHost()) return callback?.({ error: 'Not host' });
      const target = getPeer(currentRoomId, peerId);
      if (!target) return callback?.({ error: 'Peer not found' });
      const self = getPeer(currentRoomId, socket.id);
      roomHost.set(currentRoomId, target.userId);
      target.isHost = true;
      target.isCoHost = false;
      coHostUsers.get(currentRoomId)?.delete(target.userId);
      if (self) self.isHost = false;
      io.to(currentRoomId).emit('hostChanged', {
        hostPeerId: peerId,
        hostUserId: target.userId,
      });
      callback?.({ ok: true });
    });

    // Host ends the meeting for everyone.
    socket.on('endRoom', async (_data, callback) => {
      if (!requireHost()) return callback?.({ error: 'Not host' });
      const roomId = currentRoomId;
      // Tell everyone the meeting is over so they redirect out cleanly.
      io.to(roomId).emit('meetingEnded');
      // Also boot anyone still waiting in the lobby (they aren't in the room).
      const w = waiting.get(roomId);
      w?.forEach((_info, sid) => {
        io.to(sid).emit('meetingEnded');
        const s = io.sockets.sockets.get(sid);
        if (s) setTimeout(() => s.disconnect(true), 300);
      });
      // Forget all lobby/role state for the room.
      waiting.delete(roomId);
      admittedUsers.delete(roomId);
      coHostUsers.delete(roomId);
      lockedRooms.delete(roomId);
      roomHost.delete(roomId);
      roomPins.delete(roomId);
      roomStart.delete(roomId);
      // Mark inactive so nobody can rejoin.
      try {
        await prisma.room.update({
          where: { id: roomId },
          data: { isActive: false, endedAt: new Date() },
        });
      } catch (err) {
        console.error('endRoom update error', err);
      }
      // Disconnect every peer's socket (including the host).
      const room = getRoom(roomId);
      room?.peers.forEach((p) => {
        const s = io.sockets.sockets.get(p.id);
        if (s) setTimeout(() => s.disconnect(true), 300);
      });
      callback?.({ ok: true });
    });

    // Admit everyone currently waiting.
    socket.on('admitAll', (_data, callback) => {
      if (!requireModerator()) return callback?.({ error: 'Not allowed' });
      const w = waiting.get(currentRoomId);
      if (w) {
        for (const [peerId, entry] of Array.from(w.entries())) {
          w.delete(peerId);
          if (entry.userId) markAdmitted(currentRoomId, entry.userId);
          const target = io.sockets.sockets.get(peerId);
          if (target) {
            target.data.admitted = true;
            io.to(peerId).emit('admitted');
          }
          notifyModerators(currentRoomId, 'waitingPeerLeft', { peerId });
        }
      }
      callback?.({ ok: true });
    });

    // Reject a lobby guest.
    socket.on('denyPeer', ({ peerId }, callback) => {
      if (!requireModerator()) return callback?.({ error: 'Not allowed' });
      const w = waiting.get(currentRoomId);
      if (w?.has(peerId)) {
        w.delete(peerId);
        io.to(peerId).emit('denied');
        notifyModerators(currentRoomId, 'waitingPeerLeft', { peerId });
      }
      callback?.({ ok: true });
    });

    // ================================================================
    // User-only events (raise hand, in-room chat)
    // ================================================================
    if (!isSdkGuest) {
      socket.on('raiseHand', ({ raised }, callback) => {
        if (!currentRoomId) return callback?.({ error: 'Not in room' });
        const state = setHandState(currentRoomId, socket.id, !!raised);
        io.to(currentRoomId).emit('handState', {
          peerId: socket.id,
          username: user.username,
          raised: !!raised,
          raisedAt: state?.raisedAt || null,
        });
        callback?.({ ok: true });
      });

      socket.on('chatMessage', async ({ content, attachment }) => {
        if (!currentRoomId) return;
        const hasContent = content && content.trim().length > 0;
        const hasAttachment = attachment && attachment.url;
        if (!hasContent && !hasAttachment) return;

        const msg = await prisma.message.create({
          data: {
            roomId: currentRoomId,
            userId: user.id,
            content: content || '',
            attachmentUrl: attachment?.url ?? null,
            attachmentName: attachment?.name ?? null,
            attachmentType: attachment?.type ?? null,
            attachmentSize: attachment?.size ?? null,
          },
        });
        const senderName =
          getPeer(currentRoomId, socket.id)?.username || user.username;
        io.to(currentRoomId).emit('chatMessage', {
          id: msg.id,
          userId: user.id,
          username: senderName,
          content: msg.content,
          attachmentUrl: msg.attachmentUrl,
          attachmentName: msg.attachmentName,
          attachmentType: msg.attachmentType,
          attachmentSize: msg.attachmentSize,
          createdAt: msg.createdAt,
        });
      });
    }

    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id}`);

      // If they were still waiting in the lobby, drop them and tell moderators.
      const lobbyRoomId = socket.data.lobbyRoomId;
      if (lobbyRoomId) {
        const w = waiting.get(lobbyRoomId);
        if (w?.delete(socket.id)) {
          notifyModerators(lobbyRoomId, 'waitingPeerLeft', { peerId: socket.id });
        }
      }

      if (!currentRoomId) return;

      // SDK guest: just remove the peer and notify others
      if (isSdkGuest) {
        socket.to(currentRoomId).emit('peerLeft', { peerId: socket.id });
        removePeer(currentRoomId, socket.id);
        return;
      }

      // Logged-in user: lower hand, notify, remove, mark participant left
      setHandState(currentRoomId, socket.id, false);
      socket.to(currentRoomId).emit('handState', {
        peerId: socket.id,
        username: user.username,
        raised: false,
        raisedAt: null,
      });
      socket.to(currentRoomId).emit('peerLeft', { peerId: socket.id });
      removePeer(currentRoomId, socket.id);

      // When the room empties, reset the meeting clock for the next session.
      if (!getRoom(currentRoomId) || getRoom(currentRoomId).peers.size === 0) {
        roomStart.delete(currentRoomId);
      }

      try {
        const last = await prisma.participant.findFirst({
          where: { roomId: currentRoomId, userId: user.id, leftAt: null },
          orderBy: { joinedAt: 'desc' },
        });
        if (last) {
          await prisma.participant.update({
            where: { id: last.id },
            data: { leftAt: new Date() },
          });
        }
      } catch (err) {
        console.error('participant update error', err);
      }
    });
  });
}
