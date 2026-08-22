import { randomUUID } from "node:crypto";
import { ParticipantSession } from "../models/Participant.js";
import { Room } from "../models/Room.js";
import { isMongoConnected } from "../db/mongo.js";
import { invalidateRoomPages, pageCache } from "../cache/index.js";

/**
 * Participant presence + session tracking.
 *
 * Design notes
 * ────────────
 * • The in-memory `presence` map is the hot path (O(1) reads/writes) used by
 *   sockets and the REST presence endpoint — Mongo is only the durable log.
 * • Every Mongo write is best-effort: analytics must never block media.
 * • A heartbeat refreshes `lastSeenAt`; a sweeper marks stale sessions inactive
 *   so browser crashes / network drops still produce a correct `leftAt`.
 */

const HEARTBEAT_TIMEOUT_MS = 45_000;
const SWEEP_INTERVAL_MS = 15_000;

/** roomId -> Map<peerId, presence record>. */
const presence = new Map();

const safe = async (operation, fallback = null) => {
  if (!isMongoConnected()) return fallback;
  try {
    return await operation();
  } catch (error) {
    console.error("[tracking] operation failed:", error.message);
    return fallback;
  }
};

const roomPresence = (roomId) => {
  let map = presence.get(roomId);
  if (!map) {
    map = new Map();
    presence.set(roomId, map);
  }
  return map;
};

// ------------------------------------------------------------- lifecycle ---

/** Participant joined: open a session document and register live presence. */
export function beginSession({ roomId, peerId, displayName, isHost = false, deviceInfo = null }) {
  const sessionId = randomUUID();
  const now = Date.now();

  roomPresence(roomId).set(peerId, {
    sessionId,
    peerId,
    displayName,
    isHost,
    isActive: true,
    joinedAt: now,
    lastSeenAt: now,
    deviceInfo,
  });

  invalidateRoomPages(roomId);
  void safe(() =>
    ParticipantSession.create({
      meetingId: roomId,
      sessionId,
      peerId,
      displayName,
      isHost,
      isActive: true,
      joinedAt: new Date(now),
      lastSeenAt: new Date(now),
      ...(deviceInfo ? { deviceInfo } : {}),
      timeline: [{ type: "join", at: new Date(now) }],
    }),
  );
  void safe(() =>
    Room.updateOne(
      { roomId },
      { $max: { peakParticipants: roomPresence(roomId).size }, $set: { startedAt: new Date(now) } },
      { upsert: false },
    ),
  );

  return sessionId;
}

/** Cheap liveness ping — O(1), no Mongo write unless the record was stale. */
export function heartbeat(roomId, peerId) {
  const record = presence.get(roomId)?.get(peerId);
  if (!record) return false;
  const wasInactive = !record.isActive;
  record.lastSeenAt = Date.now();
  record.isActive = true;
  if (wasInactive) {
    void safe(() =>
      ParticipantSession.updateOne(
        { sessionId: record.sessionId },
        {
          $set: { isActive: true, lastSeenAt: new Date() },
          $push: { timeline: { type: "reconnect", at: new Date() } },
        },
      ),
    );
  }
  return true;
}

/** Participant left (explicitly or by disconnect) — closes the session. */
export function endSession(roomId, peerId, reason = "leave") {
  const map = presence.get(roomId);
  const record = map?.get(peerId);
  if (!record) return null;
  map.delete(peerId);
  if (map.size === 0) presence.delete(roomId);

  const leftAt = Date.now();
  const durationMs = Math.max(0, leftAt - record.joinedAt);

  invalidateRoomPages(roomId);
  void safe(() =>
    ParticipantSession.updateOne(
      { sessionId: record.sessionId },
      {
        $set: {
          isActive: false,
          leftAt: new Date(leftAt),
          durationMs,
          lastSeenAt: new Date(leftAt),
        },
        $push: { timeline: { type: reason, at: new Date(leftAt) } },
      },
    ),
  );
  void safe(() =>
    Room.updateOne(
      { roomId, "participants.peerId": peerId },
      {
        $set: {
          "participants.$.leftAt": new Date(leftAt),
          "participants.$.durationMs": durationMs,
        },
      },
    ),
  );

  return { ...record, leftAt, durationMs };
}

/** Meeting finished — stamp the total duration on the room document. */
export function closeMeeting(roomId) {
  presence.delete(roomId);
  invalidateRoomPages(roomId);
  return safe(async () => {
    const room = await Room.findOne({ roomId }).select("startedAt createdAt").lean();
    const startedAt = room?.startedAt ?? room?.createdAt ?? new Date();
    const endedAt = new Date();
    await Room.updateOne(
      { roomId },
      { $set: { endedAt, durationMs: endedAt.getTime() - new Date(startedAt).getTime() } },
    );
    await ParticipantSession.updateMany(
      { meetingId: roomId, isActive: true },
      { $set: { isActive: false, leftAt: endedAt } },
    );
  });
}

/** Arbitrary timeline entry (pause, resume, recording, …). */
export function logEvent(roomId, peerId, type, detail = null) {
  const record = presence.get(roomId)?.get(peerId);
  if (!record) return;
  void safe(() =>
    ParticipantSession.updateOne(
      { sessionId: record.sessionId },
      { $push: { timeline: { type, at: new Date(), detail } } },
    ),
  );
}

// ------------------------------------------------------------- presence ----

/** Live roster for a room — O(n) over active peers only, no DB round trip. */
export const activeParticipants = (roomId) =>
  [...(presence.get(roomId)?.values() ?? [])].map((r) => ({
    peerId: r.peerId,
    displayName: r.displayName,
    isHost: r.isHost,
    isActive: r.isActive,
    joinedAt: r.joinedAt,
    lastSeenAt: r.lastSeenAt,
    durationMs: Date.now() - r.joinedAt,
  }));

export const activeCount = (roomId) => presence.get(roomId)?.size ?? 0;

/**
 * Marks peers silent past the heartbeat window as inactive and notifies the
 * room. Emits `presence` so every client converges on the same status.
 */
export function startPresenceSweeper(io) {
  const timer = setInterval(() => {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
    for (const [roomId, map] of presence) {
      let changed = false;
      for (const record of map.values()) {
        if (record.isActive && record.lastSeenAt < cutoff) {
          record.isActive = false;
          changed = true;
          void safe(() =>
            ParticipantSession.updateOne(
              { sessionId: record.sessionId },
              {
                $set: { isActive: false, lastSeenAt: new Date(record.lastSeenAt) },
                $push: { timeline: { type: "timeout", at: new Date() } },
              },
            ),
          );
        }
      }
      if (changed)
        io.to(roomId).emit("presence", { roomId, participants: activeParticipants(roomId) });
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

// ----------------------------------------------------------- pagination ----

/** Paginated, cached session log for a meeting (newest first). */
export async function sessionPage(roomId, page, limit) {
  const key = `${roomId}|sessions|${page}|${limit}`;
  const cached = pageCache.get(key);
  if (cached) return cached;

  const skip = (page - 1) * limit;
  const [docs, total] = await Promise.all([
    safe(
      () =>
        ParticipantSession.find({ meetingId: roomId })
          .sort({ joinedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      [],
    ),
    safe(() => ParticipantSession.countDocuments({ meetingId: roomId }), 0),
  ]);

  const items = (docs ?? []).map((doc) => ({
    sessionId: doc.sessionId,
    peerId: doc.peerId,
    displayName: doc.displayName,
    isHost: doc.isHost,
    isActive: doc.isActive,
    joinedAt: doc.joinedAt,
    leftAt: doc.leftAt,
    durationMs:
      doc.durationMs || (doc.leftAt ? +new Date(doc.leftAt) - +new Date(doc.joinedAt) : 0),
    events: doc.timeline?.length ?? 0,
  }));

  const result = {
    items,
    page,
    limit,
    total: total ?? 0,
    totalPages: Math.max(1, Math.ceil((total ?? 0) / limit)),
    hasPrev: page > 1,
    hasNext: page * limit < (total ?? 0),
  };
  pageCache.set(key, result);
  return result;
}
