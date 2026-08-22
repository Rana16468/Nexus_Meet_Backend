import { Room } from "../models/Room.js";
import { Message } from "../models/Message.js";
import { Poll } from "../models/Poll.js";
import { isMongoConnected } from "../db/mongo.js";
import { invalidateRoomPages, pageCache } from "../cache/index.js";

/** All writes are best-effort: persistence must never block the media path. */
const safe = async (operation, fallback = null) => {
  if (!isMongoConnected()) return fallback;
  try {
    return await operation();
  } catch (error) {
    console.error("[mongo] operation failed:", error.message);
    return fallback;
  }
};

export const clampPage = (page, limit, maxLimit = 100) => {
  const p = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const l = Math.min(maxLimit, Math.max(1, Number.parseInt(limit ?? "20", 10) || 20));
  return { page: p, limit: l, skip: (p - 1) * l };
};

export const paged = (items, total, page, limit) => ({
  items,
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
  hasPrev: page > 1,
  hasNext: page * limit < total,
});

// ------------------------------------------------------------- lifecycle ---

export const recordJoin = (roomId, peerId, displayName, maxParticipants, isHost = false) => {
  invalidateRoomPages(roomId);
  return safe(() =>
    Room.findOneAndUpdate(
      { roomId },
      {
        $setOnInsert: { roomId, hostName: displayName, maxParticipants },
        ...(isHost ? { $set: { hostName: displayName, hostPeerId: peerId } } : {}),
        $push: { participants: { peerId, displayName } },
      },
      { upsert: true, new: true },
    ),
  );
};

export const recordLeave = (roomId, peerId) => {
  invalidateRoomPages(roomId);
  return safe(() =>
    Room.updateOne(
      { roomId, "participants.peerId": peerId },
      { $set: { "participants.$.leftAt": new Date() } },
    ),
  );
};

export const recordRoomEnded = (roomId) => {
  invalidateRoomPages(roomId);
  return safe(() => Room.updateOne({ roomId }, { $set: { endedAt: new Date() } }));
};

// ------------------------------------------------------------------ chat ---

export const saveMessage = (roomId, peerId, displayName, text) => {
  invalidateRoomPages(roomId);
  return safe(() => Message.create({ roomId, peerId, displayName, text }));
};

/** Newest-first slice used by joinRoom to hydrate late joiners. */
export const recentMessages = (roomId, limit = 50) =>
  safe(() => Message.find({ roomId }).sort({ sentAt: -1 }).limit(limit).lean(), []);

/** Read-through cached, paginated chat history (page 1 = newest). */
export async function messagePage(roomId, page, limit) {
  const key = `${roomId}|messages|${page}|${limit}`;
  const cached = pageCache.get(key);
  if (cached) return cached;

  const skip = (page - 1) * limit;
  const [docs, total] = await Promise.all([
    safe(() => Message.find({ roomId }).sort({ sentAt: -1 }).skip(skip).limit(limit).lean(), []),
    safe(() => Message.countDocuments({ roomId }), 0),
  ]);
  const items = (docs ?? [])
    .map((doc) => ({
      id: String(doc._id),
      peerId: doc.peerId,
      displayName: doc.displayName,
      text: doc.text,
      at: new Date(doc.sentAt ?? Date.now()).getTime(),
    }))
    .reverse();

  const result = paged(items, total ?? 0, page, limit);
  pageCache.set(key, result);
  return result;
}

// -------------------------------------------------------- meeting logs -----

export async function meetingLogPage(page, limit) {
  const key = `global|meetings|${page}|${limit}`;
  const cached = pageCache.get(key);
  if (cached) return cached;

  const skip = (page - 1) * limit;
  const [docs, total] = await Promise.all([
    safe(
      () =>
        Room.find({})
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .select("roomId hostName participants endedAt createdAt updatedAt")
          .lean(),
      [],
    ),
    safe(() => Room.countDocuments({}), 0),
  ]);

  const items = (docs ?? []).map((doc) => ({
    roomId: doc.roomId,
    hostName: doc.hostName,
    participantCount: doc.participants?.length ?? 0,
    startedAt: doc.createdAt,
    endedAt: doc.endedAt,
  }));
  const result = paged(items, total ?? 0, page, limit);
  pageCache.set(key, result);
  return result;
}

export async function participantPage(roomId, page, limit) {
  const key = `${roomId}|participants|${page}|${limit}`;
  const cached = pageCache.get(key);
  if (cached) return cached;

  const doc = await safe(() => Room.findOne({ roomId }).select("participants").lean(), null);
  const all = doc?.participants ?? [];
  const skip = (page - 1) * limit;
  const items = all
    .slice()
    .reverse()
    .slice(skip, skip + limit);
  const result = paged(items, all.length, page, limit);
  pageCache.set(key, result);
  return result;
}

// ----------------------------------------------------------------- polls ---

export const savePoll = (roomId, poll) =>
  safe(() =>
    Poll.findOneAndUpdate(
      { pollId: poll.id },
      {
        pollId: poll.id,
        roomId,
        question: poll.question,
        options: poll.options,
        createdBy: poll.createdBy,
        createdByName: poll.createdByName,
        closed: poll.closed,
        voters: poll.voters ?? [],
      },
      { upsert: true, new: true },
    ),
  );

export const pollHistory = (roomId) =>
  safe(() => Poll.find({ roomId }).sort({ createdAt: 1 }).lean(), []);

// ------------------------------------------------------------- summary -----

/**
 * Extractive meeting summary — deterministic, offline, zero SaaS.
 * Scores sentences by keyword frequency + participation spread, then reports
 * top talking points, decisions/action items and poll outcomes.
 */
export async function meetingSummary(roomId) {
  const [messages, polls, room] = await Promise.all([
    safe(() => Message.find({ roomId }).sort({ sentAt: 1 }).limit(1000).lean(), []),
    pollHistory(roomId),
    safe(() => Room.findOne({ roomId }).lean(), null),
  ]);

  const list = messages ?? [];
  const stop = new Set(
    "the a an and or but if then so we i you he she it they to of in on for with is are was were be been will would can could should this that these those our your their at as by from not no yes ok okay just about into out up down do does did have has had".split(
      " ",
    ),
  );

  const freq = new Map();
  for (const m of list) {
    for (const word of String(m.text)
      .toLowerCase()
      .match(/[a-z']{3,}/g) ?? []) {
      if (stop.has(word)) continue;
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }

  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, count]) => ({ word, count }));

  const score = (text) =>
    (
      String(text)
        .toLowerCase()
        .match(/[a-z']{3,}/g) ?? []
    ).reduce((sum, w) => sum + (stop.has(w) ? 0 : (freq.get(w) ?? 0)), 0) /
    Math.max(6, String(text).split(/\s+/).length);

  const highlights = list
    .filter((m) => String(m.text).trim().length > 25)
    .map((m) => ({ speaker: m.displayName, text: m.text, at: m.sentAt, score: score(m.text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map(({ speaker, text }) => ({ speaker, text }));

  const actionRe =
    /\b(todo|to-do|action|will|next step|follow up|assign|deadline|by (mon|tue|wed|thu|fri|sat|sun)|due)\b/i;
  const decisionRe = /\b(decid|agree|approved|final|confirm|conclusion|lock(ed)? in)\b/i;

  const actionItems = list
    .filter((m) => actionRe.test(m.text))
    .slice(-8)
    .map((m) => ({ speaker: m.displayName, text: m.text }));

  const decisions = list
    .filter((m) => decisionRe.test(m.text))
    .slice(-8)
    .map((m) => ({ speaker: m.displayName, text: m.text }));

  const speakers = new Map();
  for (const m of list) speakers.set(m.displayName, (speakers.get(m.displayName) ?? 0) + 1);

  return {
    roomId,
    generatedAt: Date.now(),
    messageCount: list.length,
    participants: room?.participants?.length ?? speakers.size,
    startedAt: room?.createdAt ?? null,
    endedAt: room?.endedAt ?? null,
    topSpeakers: [...speakers.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, messages: count })),
    keywords,
    highlights,
    decisions,
    actionItems,
    polls: (polls ?? []).map((p) => ({
      question: p.question,
      closed: p.closed,
      results: p.options.map((o) => ({ text: o.text, votes: o.votes })),
      winner: p.options.slice().sort((a, b) => b.votes - a.votes)[0]?.text ?? null,
    })),
  };
}
