import NodeCache from "node-cache";

/**
 * Hot-path caches (node-cache, in-process).
 *
 * Everything here is derived state that can be rebuilt from MongoDB or the
 * live SFU maps — losing it must never break a meeting, it only costs a
 * round-trip. TTLs keep memory flat on a long-running Windows host.
 */

/** Active meeting session metadata: { roomId, hostPeerId, startedAt, ... } */
export const sessionCache = new NodeCache({
  stdTTL: 60 * 60 * 6,
  checkperiod: 120,
  useClones: false,
});

/** Validated join grants: `${roomId}:${peerId}` -> { displayName, admittedBy, at } */
export const grantCache = new NodeCache({
  stdTTL: 60 * 60 * 2,
  checkperiod: 120,
  useClones: false,
});

/** Quick room metadata for the REST layer: participant counts, poll counts. */
export const metaCache = new NodeCache({ stdTTL: 30, checkperiod: 30, useClones: false });

/** Paginated read-through cache for chat history pages. */
export const pageCache = new NodeCache({ stdTTL: 15, checkperiod: 20, useClones: false });

/** Live collaborative state per room: polls + whiteboard strokes. */
export const boardCache = new NodeCache({
  stdTTL: 60 * 60 * 6,
  checkperiod: 300,
  useClones: false,
});

const MAX_STROKES = 4000;

export const grantKey = (roomId, peerId) => `${roomId}:${peerId}`;

export function grantAccess(roomId, peerId, payload) {
  grantCache.set(grantKey(roomId, peerId), { ...payload, at: Date.now() });
}

export function hasAccess(roomId, peerId) {
  return grantCache.has(grantKey(roomId, peerId));
}

export function revokeAccess(roomId, peerId) {
  grantCache.del(grantKey(roomId, peerId));
}

export function getSession(roomId) {
  return sessionCache.get(roomId);
}

export function upsertSession(roomId, patch) {
  const current = sessionCache.get(roomId) ?? {
    roomId,
    hostPeerId: null,
    hostName: null,
    startedAt: Date.now(),
    joins: 0,
  };
  const next = { ...current, ...patch };
  sessionCache.set(roomId, next);
  return next;
}

export function clearSession(roomId) {
  sessionCache.del(roomId);
  boardCache.del(`polls:${roomId}`);
  boardCache.del(`board:${roomId}`);
}

/** Invalidate every cached page for a room (called on new chat / new peer). */
export function invalidateRoomPages(roomId) {
  pageCache.keys().forEach((key) => {
    if (key.startsWith(`${roomId}|`)) pageCache.del(key);
  });
  metaCache.del(roomId);
}

// ---------------------------------------------------------------- polls ----

export function getPolls(roomId) {
  return boardCache.get(`polls:${roomId}`) ?? [];
}

export function setPolls(roomId, polls) {
  boardCache.set(`polls:${roomId}`, polls);
}

// ----------------------------------------------------------- whiteboard ----

export function getBoard(roomId) {
  return boardCache.get(`board:${roomId}`) ?? [];
}

export function pushStroke(roomId, stroke) {
  const strokes = getBoard(roomId);
  strokes.push(stroke);
  // Ring-buffer the board so an all-day session cannot grow unbounded.
  if (strokes.length > MAX_STROKES) strokes.splice(0, strokes.length - MAX_STROKES);
  boardCache.set(`board:${roomId}`, strokes);
  return strokes.length;
}

export function clearBoard(roomId) {
  boardCache.set(`board:${roomId}`, []);
}
