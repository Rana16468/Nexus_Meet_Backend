import { Router } from "express";
import { randomBytes } from "node:crypto";
import { roomStats, getRoom } from "../sfu/room-manager.js";
import {
  clampPage,
  meetingLogPage,
  meetingSummary,
  messagePage,
  paged,
  participantPage,
  pollHistory,
} from "../services/room.service.js";
import { getBoard, getPolls, getSession, metaCache } from "../cache/index.js";
import { activeParticipants, sessionPage } from "../services/participant.service.js";
import { config } from "../config/index.js";

export const roomsRouter = Router();

const block = () => randomBytes(2).toString("hex");

/** POST /api/rooms — mint a fresh room id for the client to share. */
roomsRouter.post("/", (_req, res) => {
  res.json({ roomId: `nex-${block()}-${block()}`, maxParticipants: config.maxParticipants });
});

/** GET /api/rooms — live rooms (cached) with participant counts. */
roomsRouter.get("/", (_req, res) => {
  res.json({ rooms: roomStats() });
});

/** GET /api/rooms/logs?page=&limit= — paginated historical meeting log. */
roomsRouter.get("/logs", async (req, res) => {
  const { page, limit } = clampPage(req.query.page, req.query.limit, 50);
  res.json(await meetingLogPage(page, limit));
});

/** GET /api/rooms/:roomId — capacity + lobby check before joining. */
roomsRouter.get("/:roomId", (req, res) => {
  const { roomId } = req.params;
  const cached = metaCache.get(roomId);
  if (cached) return res.json(cached);

  const room = getRoom(roomId);
  const session = getSession(roomId);
  const payload = {
    roomId,
    exists: !!room,
    participants: room ? room.peers.size : 0,
    maxParticipants: config.maxParticipants,
    full: room ? room.peers.size >= config.maxParticipants : false,
    hostPresent: !!session?.hostPeerId,
    hostName: session?.hostName ?? null,
    requiresApproval: !!session?.hostPeerId,
  };
  metaCache.set(roomId, payload);
  res.json(payload);
});

/** GET /api/rooms/:roomId/messages?page=&limit= — paginated chat history. */
roomsRouter.get("/:roomId/messages", async (req, res) => {
  const { page, limit } = clampPage(req.query.page, req.query.limit, 100);
  res.json(await messagePage(req.params.roomId, page, limit));
});

/** GET /api/rooms/:roomId/participants?page=&limit= — paginated roster. */
roomsRouter.get("/:roomId/participants", async (req, res) => {
  const { roomId } = req.params;
  const { page, limit } = clampPage(req.query.page, req.query.limit, 50);

  const room = getRoom(roomId);
  if (room && room.peers.size > 0) {
    const live = [...room.peers.values()].map((peer) => ({
      peerId: peer.id,
      displayName: peer.displayName,
      isHost: peer.isHost,
      media: peer.media,
      live: true,
    }));
    const skip = (page - 1) * limit;
    return res.json(paged(live.slice(skip, skip + limit), live.length, page, limit));
  }
  res.json(await participantPage(roomId, page, limit));
});

/** GET /api/rooms/:roomId/polls — live polls plus persisted history. */
roomsRouter.get("/:roomId/polls", async (req, res) => {
  const live = getPolls(req.params.roomId);
  res.json({ live, history: (await pollHistory(req.params.roomId)) ?? [] });
});

/** GET /api/rooms/:roomId/board — current whiteboard strokes. */
roomsRouter.get("/:roomId/board", (req, res) => {
  res.json({ strokes: getBoard(req.params.roomId) });
});

/** GET /api/rooms/:roomId/summary — offline extractive meeting summary. */
roomsRouter.get("/:roomId/summary", async (req, res) => {
  res.json(await meetingSummary(req.params.roomId));
});

/** GET /api/rooms/:roomId/presence — live active/inactive roster (O(1) cache read). */
roomsRouter.get("/:roomId/presence", (req, res) => {
  const participants = activeParticipants(req.params.roomId);
  res.json({
    roomId: req.params.roomId,
    active: participants.filter((p) => p.isActive).length,
    total: participants.length,
    participants,
  });
});

/** GET /api/rooms/:roomId/sessions?page=&limit= — paginated participant session log. */
roomsRouter.get("/:roomId/sessions", async (req, res) => {
  const { page, limit } = clampPage(req.query.page, req.query.limit, 50);
  res.json(await sessionPage(req.params.roomId, page, limit));
});
