import { createRouter } from "./worker-pool.js";
import { webRtcTransportOptions } from "../config/mediasoup.config.js";
import { config } from "../config/index.js";

/**
 * In-memory room registry.
 *
 * Room = { id, router, peers: Map<peerId, Peer> }
 * Peer = { id, displayName, transports: Map, producers: Map, consumers: Map }
 *
 * MongoDB stores durable metadata (see models/), this map stores live handles
 * that cannot be serialized. Swap for Redis if you scale past one process.
 */
const rooms = new Map();

export async function getOrCreateRoom(roomId) {
  const existing = rooms.get(roomId);
  if (existing) return existing;
  const router = await createRouter();
  const room = {
    id: roomId,
    router,
    peers: new Map(),
    /** peerId -> { peerId, displayName, socketId, at } waiting for host approval. */
    lobby: new Map(),
    hostPeerId: null,
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  console.log(`[room] created ${roomId}`);
  return room;
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function roomIsFull(room) {
  return room.peers.size >= config.maxParticipants;
}

export function addPeer(room, peerId, displayName, isHost = false) {
  const peer = {
    id: peerId,
    displayName,
    isHost,
    media: { micOn: true, camOn: true, sharing: false },
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };
  room.peers.set(peerId, peer);
  return peer;
}

export async function createWebRtcTransport(room) {
  const transport = await room.router.createWebRtcTransport(webRtcTransportOptions);
  transport.on("dtlsstatechange", (state) => {
    if (state === "closed") transport.close();
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

/** Every producer in the room except the requesting peer's own. */
export function listOtherProducers(room, peerId) {
  const result = [];
  for (const peer of room.peers.values()) {
    if (peer.id === peerId) continue;
    for (const producer of peer.producers.values()) {
      result.push({
        producerId: producer.id,
        peerId: peer.id,
        displayName: peer.displayName,
        kind: producer.kind,
        appData: producer.appData,
      });
    }
  }
  return result;
}

export function removePeer(room, peerId) {
  const peer = room.peers.get(peerId);
  if (!peer) return;
  peer.consumers.forEach((consumer) => consumer.close());
  peer.producers.forEach((producer) => producer.close());
  peer.transports.forEach((transport) => transport.close());
  room.peers.delete(peerId);
  if (room.hostPeerId === peerId) {
    // Host left — promote the longest-present peer so the lobby keeps working.
    const next = room.peers.values().next().value;
    room.hostPeerId = next?.id ?? null;
    if (next) next.isHost = true;
  }
  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(room.id);
    console.log(`[room] closed ${room.id}`);
  }
}

export function roomStats() {
  return [...rooms.values()].map((room) => ({
    id: room.id,
    participants: room.peers.size,
    createdAt: room.createdAt,
  }));
}
