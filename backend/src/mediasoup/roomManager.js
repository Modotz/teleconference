import { getNextWorker } from './worker.js';
import { mediasoupConfig } from './config.js';

/**
 * In-memory store of active rooms.
 * Each room: { id, router, peers: Map<socketId, Peer> }
 * Peer: { id, userId, username, transports: Map, producers: Map, consumers: Map }
 */
const rooms = new Map();

export async function getOrCreateRoom(roomId, onActiveSpeaker) {
  let room = rooms.get(roomId);
  if (room) return room;

  const worker = getNextWorker();
  const router = await worker.createRouter({
    mediaCodecs: mediasoupConfig.router.mediaCodecs,
  });

  // Detects who is currently talking by analysing RTP audio levels.
  // Fires 'volumes' (loudest single producer above threshold) and 'silence'.
  const audioLevelObserver = await router.createAudioLevelObserver({
    maxEntries: 1,
    threshold: -65,
    interval: 800,
  });

  audioLevelObserver.on('volumes', (volumes) => {
    const { producer } = volumes[0];
    // Find which peer owns this producer
    const r = rooms.get(roomId);
    if (!r) return;
    for (const [peerId, peer] of r.peers) {
      if (peer.producers.has(producer.id)) {
        onActiveSpeaker?.(roomId, peerId);
        return;
      }
    }
  });

  audioLevelObserver.on('silence', () => {
    onActiveSpeaker?.(roomId, null);
  });

  room = {
    id: roomId,
    router,
    peers: new Map(),
    audioLevelObserver,
    /** Map<peerId, { raised: boolean, raisedAt: Date }> */
    raisedHands: new Map(),
  };

  rooms.set(roomId, room);
  console.log(`Room created: ${roomId}`);
  return room;
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function addPeer(roomId, peer) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.peers.set(peer.id, peer);
}

export function getPeer(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.peers.get(peerId);
}

export function removePeer(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const peer = room.peers.get(peerId);
  if (peer) {
    peer.transports.forEach((t) => t.close());
    peer.producers.forEach((p) => p.close());
    peer.consumers.forEach((c) => c.close());
  }

  room.peers.delete(peerId);
  room.raisedHands.delete(peerId);

  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(roomId);
    console.log(`Room closed (empty): ${roomId}`);
  }
}

export function setHandState(roomId, peerId, raised) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (raised) {
    room.raisedHands.set(peerId, { raised: true, raisedAt: new Date() });
  } else {
    room.raisedHands.delete(peerId);
  }
  return room.raisedHands.get(peerId) || { raised: false };
}

export function getRaisedHands(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.raisedHands.entries()).map(([peerId, state]) => ({
    peerId,
    raisedAt: state.raisedAt,
  }));
}

export async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport({
    ...mediasoupConfig.webRtcTransport,
  });

  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}

export function getProducersInRoom(roomId, excludePeerId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  const list = [];
  room.peers.forEach((peer, peerId) => {
    if (peerId === excludePeerId) return;
    peer.producers.forEach((producer) => {
      list.push({
        producerId: producer.id,
        peerId,
        username: peer.username,
        kind: producer.kind,
        appData: producer.appData || {},
      });
    });
  });
  return list;
}
