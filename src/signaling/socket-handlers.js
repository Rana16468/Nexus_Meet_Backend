import { randomUUID } from "node:crypto";
import { config } from "../config/index.js";
import {
  addPeer,
  createWebRtcTransport,
  getOrCreateRoom,
  getRoom,
  listOtherProducers,
  removePeer,
  roomIsFull,
} from "../sfu/room-manager.js";
import {
  recentMessages,
  recordJoin,
  recordLeave,
  recordRoomEnded,
  saveMessage,
  savePoll,
} from "../services/room.service.js";
import {
  activeParticipants,
  beginSession,
  closeMeeting,
  endSession,
  heartbeat,
  logEvent,
} from "../services/participant.service.js";
import {
  clearBoard,
  clearSession,
  getBoard,
  getPolls,
  grantAccess,
  hasAccess,
  invalidateRoomPages,
  pushStroke,
  revokeAccess,
  setPolls,
  upsertSession,
} from "../cache/index.js";

/** roomId -> Map<peerId, displayName> of peers currently recording. */
const recorders = new Map();
const recorderList = (roomId) =>
  [...(recorders.get(roomId)?.entries() ?? [])].map(([peerId, displayName]) => ({
    peerId,
    displayName,
  }));

const ok = (cb, payload = {}) => typeof cb === "function" && cb(payload);
const fail = (cb, message) => typeof cb === "function" && cb({ error: message });
const clean = (value, max) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

/** Client IP from the proxy chain, falling back to the raw handshake address. */
const clientIp = (socket) => {
  const fwd = socket.handshake.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : String(fwd ?? "").split(",")[0];
  return clean(first, 64) || clean(socket.handshake.address, 64);
};

/**
 * Whitelists the client-reported fingerprint — the payload is untrusted, so only
 * known keys with capped string lengths make it into Mongo.
 */
const sanitizeDeviceInfo = (raw, ip) => {
  if (!raw || typeof raw !== "object") return ip ? { ip } : null;
  const s = (v, max = 120) => clean(v, max);
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    device: {
      type: s(raw.device?.type, 24) || "unknown",
      brand: s(raw.device?.brand, 40),
      model: s(raw.device?.model, 60),
      touch: !!raw.device?.touch,
    },
    os: {
      name: s(raw.os?.name, 40) || "Unknown",
      version: s(raw.os?.version, 24),
      platform: s(raw.os?.platform, 40),
    },
    client: {
      type: s(raw.client?.type, 24),
      name: s(raw.client?.name, 40) || "Unknown",
      version: s(raw.client?.version, 24),
      engine: s(raw.client?.engine, 24),
    },
    bot: { isBot: !!raw.bot?.isBot, name: s(raw.bot?.name, 40) || null },
    screenResolution: s(raw.screenResolution, 24),
    viewport: s(raw.viewport, 24),
    pixelRatio: n(raw.pixelRatio) ?? 1,
    language: s(raw.language, 24),
    languages: Array.isArray(raw.languages) ? raw.languages.slice(0, 8).map((l) => s(l, 24)) : [],
    timezone: s(raw.timezone, 60),
    connection: {
      type: s(raw.connection?.type, 24),
      effectiveType: s(raw.connection?.effectiveType, 24),
      downlink: n(raw.connection?.downlink),
      rtt: n(raw.connection?.rtt),
    },
    userAgent: s(raw.userAgent, 400),
    ip,
  };
};

/**
 * Socket.io signaling. One socket === one peer.
 *
 * ── Access control ────────────────────────────────────────────────────────
 *   requestJoin  -> { status: "admitted" | "waiting", host }
 *                   first peer becomes host and is admitted instantly;
 *                   everyone else lands in the lobby until the host decides.
 *   lobbyDecide  -> host only: { peerId, accept } -> guest gets lobbyDecision
 *   joinRoom     -> requires a cached grant, returns full room snapshot
 *
 * ── Media ─────────────────────────────────────────────────────────────────
 *   createTransport / connectTransport / produce / consume / resumeConsumer /
 *   closeProducer / setMediaState
 *
 * ── Collaboration ─────────────────────────────────────────────────────────
 *   chat, poll:create, poll:vote, poll:close, board:stroke, board:clear
 *
 * Server pushes: lobbyRequest, lobbyCancelled, lobbyDecision, peerJoined,
 *   peerLeft, hostChanged, newProducer, producerClosed, peerMediaState, chat,
 *   poll:new, poll:update, board:stroke, board:clear.
 */
export function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    const session = {
      roomId: null,
      peerId: socket.id,
      displayName: "Guest",
      joined: false,
      isHost: false,
      recording: false,
      waitingIn: null,
      deviceInfo: null,
    };
    console.log(`[ws] connected ${socket.id}`);

    const currentRoom = () => (session.roomId ? getRoom(session.roomId) : undefined);
    const currentPeer = () => currentRoom()?.peers.get(session.peerId);

    const hostSocket = (room) => {
      const id = room?.hostPeerId;
      return id ? io.sockets.sockets.get(id) : undefined;
    };

    const lobbySnapshot = (room) =>
      [...room.lobby.values()].map((entry) => ({
        peerId: entry.peerId,
        displayName: entry.displayName,
        at: entry.at,
      }));

    /** Tear down peer state exactly once (disconnect or explicit leave). */
    const teardown = (reason = "leave") => {
      // Waiting in a lobby but never admitted.
      if (session.waitingIn) {
        const room = getRoom(session.waitingIn);
        if (room?.lobby.delete(session.peerId)) {
          hostSocket(room)?.emit("lobbyCancelled", { peerId: session.peerId });
        }
        session.waitingIn = null;
      }

      const room = currentRoom();
      if (!room || !session.joined) return;
      session.joined = false;

      const roomId = session.roomId;
      const wasLast = room.peers.size === 1;
      removePeer(room, session.peerId);
      revokeAccess(roomId, session.peerId);

      socket.to(roomId).emit("peerLeft", { peerId: session.peerId });
      // A recorder that vanishes must clear its indicator for everyone.
      if (session.recording) {
        session.recording = false;
        recorders.get(roomId)?.delete(session.peerId);
        if (recorders.get(roomId)?.size === 0) recorders.delete(roomId);
        socket.to(roomId).emit("recording:state", {
          peerId: session.peerId,
          displayName: session.displayName,
          recording: false,
        });
      }
      socket.leave(roomId);
      void recordLeave(roomId, session.peerId);

      // Presence + session log: closes the participant session with timestamps.
      endSession(roomId, session.peerId, reason);
      io.to(roomId).emit("presence", { roomId, participants: activeParticipants(roomId) });

      const stillAlive = getRoom(roomId);
      if (stillAlive) {
        if (stillAlive.hostPeerId) {
          upsertSession(roomId, { hostPeerId: stillAlive.hostPeerId });
          const promoted = stillAlive.peers.get(stillAlive.hostPeerId);
          io.to(roomId).emit("hostChanged", {
            hostPeerId: stillAlive.hostPeerId,
            hostName: promoted?.displayName ?? null,
          });
          // Hand any pending lobby requests to the new host.
          if (stillAlive.lobby.size > 0) {
            hostSocket(stillAlive)?.emit("lobbyState", { waiting: lobbySnapshot(stillAlive) });
          }
        }
      } else {
        clearSession(roomId);
      }

      if (wasLast) {
        void recordRoomEnded(roomId);
        void closeMeeting(roomId);
      }
      invalidateRoomPages(roomId);
      session.roomId = null;
      session.isHost = false;
    };

    // ------------------------------------------------------ access control --

    socket.on("requestJoin", async ({ roomId, displayName, deviceInfo } = {}, cb) => {
      try {
        const id = clean(roomId, 80);
        const name = clean(displayName, 60);
        if (!id) return fail(cb, "roomId is required");
        if (name.length < 2) return fail(cb, "Please enter your full name");
        if (session.joined) return fail(cb, "already in a room");

        const room = await getOrCreateRoom(id);
        if (roomIsFull(room)) return fail(cb, `Room is full (${config.maxParticipants} max)`);

        session.displayName = name;
        session.deviceInfo = sanitizeDeviceInfo(deviceInfo, clientIp(socket));

        const hostAlive = room.hostPeerId && room.peers.has(room.hostPeerId);
        if (!hostAlive) {
          // First person in the room hosts it — no one left to approve them.
          room.hostPeerId = session.peerId;
          session.isHost = true;
          upsertSession(id, { hostPeerId: session.peerId, hostName: name });
          grantAccess(id, session.peerId, { displayName: name, admittedBy: "system" });
          return ok(cb, { status: "admitted", host: true, peerId: session.peerId });
        }

        room.lobby.set(session.peerId, {
          peerId: session.peerId,
          displayName: name,
          socketId: socket.id,
          at: Date.now(),
        });
        session.waitingIn = id;

        hostSocket(room)?.emit("lobbyRequest", {
          peerId: session.peerId,
          displayName: name,
          at: Date.now(),
        });

        ok(cb, {
          status: "waiting",
          host: false,
          peerId: session.peerId,
          hostName: room.peers.get(room.hostPeerId)?.displayName ?? "the host",
        });
      } catch (error) {
        console.error("[ws] requestJoin failed:", error);
        fail(cb, error.message);
      }
    });

    /** Host accepts or rejects a waiting guest. */
    socket.on("lobbyDecide", ({ peerId, accept } = {}, cb) => {
      const room = currentRoom();
      if (!room) return fail(cb, "not in a room");
      if (room.hostPeerId !== session.peerId) return fail(cb, "only the host can admit guests");

      const entry = room.lobby.get(peerId);
      if (!entry) return fail(cb, "guest is no longer waiting");
      room.lobby.delete(peerId);

      if (accept)
        grantAccess(room.id, peerId, {
          displayName: entry.displayName,
          admittedBy: session.peerId,
        });

      io.sockets.sockets.get(entry.socketId)?.emit("lobbyDecision", {
        accepted: !!accept,
        roomId: room.id,
        hostName: session.displayName,
      });
      ok(cb, { ok: true, waiting: lobbySnapshot(room) });
    });

    socket.on("lobbyList", (_payload, cb) => {
      const room = currentRoom();
      if (!room) return fail(cb, "not in a room");
      ok(cb, { waiting: room.hostPeerId === session.peerId ? lobbySnapshot(room) : [] });
    });

    // ---------------------------------------------------------------- join --

    socket.on("joinRoom", async ({ roomId, displayName, deviceInfo } = {}, cb) => {
      try {
        const id = clean(roomId, 80);
        if (!id) return fail(cb, "roomId is required");
        if (session.joined) return fail(cb, "already in a room");
        if (!hasAccess(id, session.peerId)) return fail(cb, "not admitted to this room");

        const room = await getOrCreateRoom(id);
        if (roomIsFull(room)) return fail(cb, `Room is full (${config.maxParticipants} max)`);

        session.roomId = id;
        session.displayName = clean(displayName, 60) || session.displayName;
        session.joined = true;
        session.waitingIn = null;
        if (deviceInfo) session.deviceInfo = sanitizeDeviceInfo(deviceInfo, clientIp(socket));
        else if (!session.deviceInfo) session.deviceInfo = { ip: clientIp(socket) };

        const isHost = room.hostPeerId === session.peerId;
        session.isHost = isHost;

        const peer = addPeer(room, session.peerId, session.displayName, isHost);
        peer.media = { micOn: true, camOn: true, sharing: false };
        socket.join(id);

        upsertSession(
          id,
          isHost ? { hostPeerId: session.peerId, hostName: session.displayName } : {},
        );
        void recordJoin(id, session.peerId, session.displayName, config.maxParticipants, isHost);

        // Open the tracked participant session (presence + timeline log).
        beginSession({
          roomId: id,
          peerId: session.peerId,
          displayName: session.displayName,
          isHost,
          deviceInfo: session.deviceInfo,
        });
        io.to(id).emit("presence", { roomId: id, participants: activeParticipants(id) });

        socket.to(id).emit("peerJoined", {
          peerId: session.peerId,
          displayName: session.displayName,
          media: peer.media,
          isHost,
        });

        // Chat history so a late joiner sees the conversation so far.
        const stored = (await recentMessages(id, 100)) ?? [];
        const history = stored
          .slice()
          .reverse()
          .map((doc) => ({
            id: String(doc._id ?? randomUUID()),
            peerId: doc.peerId,
            displayName: doc.displayName,
            text: doc.text,
            at: new Date(doc.sentAt ?? Date.now()).getTime(),
          }));

        ok(cb, {
          peerId: session.peerId,
          isHost,
          hostPeerId: room.hostPeerId,
          rtpCapabilities: room.router.rtpCapabilities,
          maxParticipants: config.maxParticipants,
          peers: [...room.peers.values()]
            .filter((p) => p.id !== session.peerId)
            .map((p) => ({
              id: p.id,
              displayName: p.displayName,
              isHost: !!p.isHost,
              media: p.media ?? { micOn: true, camOn: true, sharing: false },
            })),
          producers: listOtherProducers(room, session.peerId).map((p) => ({
            ...p,
            screen: !!p.appData?.screen,
          })),
          history,
          polls: getPolls(id),
          board: getBoard(id),
          waiting: isHost ? lobbySnapshot(room) : [],
          presence: activeParticipants(id),
          recorders: recorderList(id),
        });
      } catch (error) {
        console.error("[ws] joinRoom failed:", error);
        fail(cb, error.message);
      }
    });

    // --------------------------------------------------------------- media --

    socket.on("createTransport", async ({ direction } = {}, cb) => {
      try {
        const room = currentRoom();
        const peer = currentPeer();
        if (!room || !peer) return fail(cb, "not in a room");
        if (direction !== "send" && direction !== "recv") return fail(cb, "invalid direction");

        // One transport per direction — reuse if the client re-asks.
        const existing = [...peer.transports.values()].find(
          (t) => t.appData?.direction === direction,
        );
        if (existing) {
          existing.close();
          peer.transports.delete(existing.id);
        }

        const { transport, params } = await createWebRtcTransport(room);
        transport.appData = { ...transport.appData, direction, peerId: peer.id };
        transport.observer.once("close", () => peer.transports.delete(transport.id));
        peer.transports.set(transport.id, transport);
        ok(cb, params);
      } catch (error) {
        console.error("[ws] createTransport failed:", error);
        fail(cb, error.message);
      }
    });

    socket.on("connectTransport", async ({ transportId, dtlsParameters } = {}, cb) => {
      try {
        const transport = currentPeer()?.transports.get(transportId);
        if (!transport) return fail(cb, "transport not found");
        await transport.connect({ dtlsParameters });
        ok(cb, { connected: true });
      } catch (error) {
        // A double connect is harmless — report success so the client proceeds.
        if (String(error.message).includes("connect() already called")) {
          return ok(cb, { connected: true });
        }
        console.error("[ws] connectTransport failed:", error);
        fail(cb, error.message);
      }
    });

    socket.on("produce", async ({ transportId, kind, rtpParameters, appData } = {}, cb) => {
      try {
        const peer = currentPeer();
        const transport = peer?.transports.get(transportId);
        if (!transport) return fail(cb, "transport not found");
        if (transport.appData?.direction !== "send") return fail(cb, "not a send transport");

        const screen = !!appData?.screen;
        const producer = await transport.produce({
          kind,
          rtpParameters,
          appData: { ...appData, screen, peerId: session.peerId },
        });
        peer.producers.set(producer.id, producer);

        producer.observer.once("close", () => peer.producers.delete(producer.id));
        producer.on("transportclose", () => {
          peer.producers.delete(producer.id);
          socket.to(session.roomId).emit("producerClosed", {
            producerId: producer.id,
            peerId: session.peerId,
            screen,
          });
        });

        socket.to(session.roomId).emit("newProducer", {
          producerId: producer.id,
          peerId: session.peerId,
          displayName: session.displayName,
          kind,
          screen,
        });

        if (screen && peer.media) {
          peer.media.sharing = true;
          socket.to(session.roomId).emit("peerMediaState", {
            peerId: session.peerId,
            media: peer.media,
          });
        }

        ok(cb, { id: producer.id });
      } catch (error) {
        console.error("[ws] produce failed:", error);
        fail(cb, error.message);
      }
    });

    socket.on("consume", async ({ producerId, rtpCapabilities } = {}, cb) => {
      try {
        const room = currentRoom();
        const peer = currentPeer();
        if (!room || !peer) return fail(cb, "not in a room");
        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
          return fail(cb, "cannot consume this producer");
        }
        const recvTransport = [...peer.transports.values()].find(
          (transport) => transport.appData?.direction === "recv",
        );
        if (!recvTransport) return fail(cb, "recv transport missing");

        const consumer = await recvTransport.consume({
          producerId,
          rtpCapabilities,
          paused: true, // resumed once the client has wired the track
        });
        peer.consumers.set(consumer.id, consumer);
        consumer.observer.once("close", () => peer.consumers.delete(consumer.id));

        consumer.on("producerclose", () => {
          peer.consumers.delete(consumer.id);
          socket.emit("producerClosed", { consumerId: consumer.id, producerId });
        });

        // Source producer metadata so the client knows who/what this is.
        let ownerId = null;
        let ownerName = "Participant";
        let screen = false;
        for (const other of room.peers.values()) {
          const producer = other.producers.get(producerId);
          if (producer) {
            ownerId = other.id;
            ownerName = other.displayName;
            screen = !!producer.appData?.screen;
            break;
          }
        }

        ok(cb, {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          peerId: ownerId,
          displayName: ownerName,
          screen,
        });
      } catch (error) {
        console.error("[ws] consume failed:", error);
        fail(cb, error.message);
      }
    });

    socket.on("resumeConsumer", async ({ consumerId } = {}, cb) => {
      try {
        const consumer = currentPeer()?.consumers.get(consumerId);
        if (!consumer) return fail(cb, "consumer not found");
        await consumer.resume();
        ok(cb, { resumed: true });
      } catch (error) {
        fail(cb, error.message);
      }
    });

    socket.on("closeProducer", ({ producerId } = {}, cb) => {
      const peer = currentPeer();
      const producer = peer?.producers.get(producerId);
      if (!producer) return ok(cb, { closed: false });
      const screen = !!producer.appData?.screen;
      producer.close();
      peer.producers.delete(producerId);
      socket.to(session.roomId).emit("producerClosed", {
        producerId,
        peerId: session.peerId,
        screen,
      });
      if (screen && peer.media) {
        peer.media.sharing = [...peer.producers.values()].some((p) => p.appData?.screen);
        socket.to(session.roomId).emit("peerMediaState", {
          peerId: session.peerId,
          media: peer.media,
        });
      }
      ok(cb, { closed: true });
    });

    /** Mic/cam toggles are UI state — mirrored to the room so tiles stay honest. */
    socket.on("setMediaState", ({ micOn, camOn } = {}, cb) => {
      const peer = currentPeer();
      if (!peer) return fail(cb, "not in a room");
      peer.media = {
        ...(peer.media ?? { sharing: false }),
        micOn: micOn !== false,
        camOn: camOn !== false,
      };
      socket.to(session.roomId).emit("peerMediaState", {
        peerId: session.peerId,
        media: peer.media,
      });
      ok(cb, { ok: true });
    });

    // ---------------------------------------------------------------- chat --

    socket.on("chat", ({ text } = {}, cb) => {
      const body = clean(text, 2000);
      if (!session.roomId || !session.joined || !body) return fail(cb, "cannot send message");
      const message = {
        id: randomUUID(),
        peerId: session.peerId,
        displayName: session.displayName,
        text: body,
        at: Date.now(),
      };
      socket.to(session.roomId).emit("chat", message);
      void saveMessage(session.roomId, message.peerId, message.displayName, message.text);
      ok(cb, message);
    });

    // --------------------------------------------------------------- polls --

    socket.on("poll:create", ({ question, options } = {}, cb) => {
      if (!session.joined) return fail(cb, "not in a room");
      const q = clean(question, 300);
      const list = (Array.isArray(options) ? options : [])
        .map((o) => clean(o, 160))
        .filter(Boolean)
        .slice(0, 6);
      if (!q || list.length < 2) return fail(cb, "A poll needs a question and 2+ options");

      const poll = {
        id: randomUUID(),
        question: q,
        options: list.map((text) => ({ id: randomUUID(), text, votes: 0 })),
        createdBy: session.peerId,
        createdByName: session.displayName,
        closed: false,
        voters: [],
        at: Date.now(),
      };
      const polls = [...getPolls(session.roomId), poll].slice(-25);
      setPolls(session.roomId, polls);
      void savePoll(session.roomId, poll);

      io.to(session.roomId).emit("poll:new", poll);
      ok(cb, poll);
    });

    socket.on("poll:vote", ({ pollId, optionId } = {}, cb) => {
      if (!session.joined) return fail(cb, "not in a room");
      const polls = getPolls(session.roomId);
      const poll = polls.find((p) => p.id === pollId);
      if (!poll) return fail(cb, "poll not found");
      if (poll.closed) return fail(cb, "poll is closed");
      if (poll.voters.includes(session.peerId)) return fail(cb, "you already voted");
      const option = poll.options.find((o) => o.id === optionId);
      if (!option) return fail(cb, "option not found");

      option.votes += 1;
      poll.voters.push(session.peerId);
      setPolls(session.roomId, polls);
      void savePoll(session.roomId, poll);

      io.to(session.roomId).emit("poll:update", poll);
      ok(cb, poll);
    });

    socket.on("poll:close", ({ pollId } = {}, cb) => {
      const room = currentRoom();
      if (!room) return fail(cb, "not in a room");
      const polls = getPolls(session.roomId);
      const poll = polls.find((p) => p.id === pollId);
      if (!poll) return fail(cb, "poll not found");
      if (poll.createdBy !== session.peerId && room.hostPeerId !== session.peerId) {
        return fail(cb, "only the host or author can close this poll");
      }
      poll.closed = true;
      setPolls(session.roomId, polls);
      void savePoll(session.roomId, poll);
      io.to(session.roomId).emit("poll:update", poll);
      ok(cb, poll);
    });

    // ---------------------------------------------------------- whiteboard --

    socket.on("board:stroke", (stroke = {}) => {
      if (!session.joined) return;
      const points = Array.isArray(stroke.points) ? stroke.points.slice(0, 400) : [];
      if (points.length === 0) return;
      const payload = {
        id: clean(stroke.id, 60) || randomUUID(),
        peerId: session.peerId,
        displayName: session.displayName,
        color: clean(stroke.color, 24) || "#22d3ee",
        width: Math.min(24, Math.max(1, Number(stroke.width) || 3)),
        tool: stroke.tool === "eraser" ? "eraser" : "pen",
        points: points.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        at: Date.now(),
      };
      pushStroke(session.roomId, payload);
      socket.to(session.roomId).emit("board:stroke", payload);
    });

    socket.on("board:clear", (_payload, cb) => {
      if (!session.joined) return fail(cb, "not in a room");
      clearBoard(session.roomId);
      io.to(session.roomId).emit("board:clear", { by: session.displayName });
      ok(cb, { cleared: true });
    });

    // ------------------------------------------------------------ presence --

    /**
     * Client heartbeat (throttled to ~20s on the client). O(1) map write —
     * the sweeper flips anyone silent for 45s to inactive automatically.
     */
    socket.on("heartbeat", (_payload, cb) => {
      if (!session.joined || !session.roomId) return ok(cb, { ok: false });
      heartbeat(session.roomId, session.peerId);
      ok(cb, { ok: true, at: Date.now() });
    });

    /** Explicit pause/resume (tab hidden, call on hold) for the timeline log. */
    socket.on("presence:event", ({ type } = {}) => {
      if (!session.joined) return;
      const allowed = new Set(["pause", "resume", "reconnect"]);
      if (!allowed.has(type)) return;
      logEvent(session.roomId, session.peerId, type);
    });

    socket.on("presence:list", (_payload, cb) => {
      if (!session.roomId) return fail(cb, "not in a room");
      ok(cb, { participants: activeParticipants(session.roomId) });
    });

    // ----------------------------------------------------------- recording --

    /**
     * Any participant (not just the host) may record locally. The room is told
     * so every client can show the "recording in progress" indicator.
     */
    socket.on("recording:state", ({ recording } = {}, cb) => {
      if (!session.joined || !session.roomId) return fail(cb, "not in a room");
      const roomId = session.roomId;
      const on = !!recording;
      session.recording = on;

      if (on) {
        if (!recorders.has(roomId)) recorders.set(roomId, new Map());
        recorders.get(roomId).set(session.peerId, session.displayName);
      } else {
        recorders.get(roomId)?.delete(session.peerId);
        if (recorders.get(roomId)?.size === 0) recorders.delete(roomId);
      }
      logEvent(roomId, session.peerId, on ? "recording-start" : "recording-stop");

      io.to(roomId).emit("recording:state", {
        peerId: session.peerId,
        displayName: session.displayName,
        recording: on,
        recorders: recorderList(roomId),
      });
      ok(cb, { ok: true, recorders: recorderList(roomId) });
    });

    // ---------------------------------------------------------------- exit --

    socket.on("leaveRoom", (_payload, cb) => {
      teardown();
      ok(cb, { left: true });
    });

    socket.on("disconnect", (reason) => {
      teardown("disconnect");
      console.log(`[ws] disconnected ${socket.id} (${reason})`);
    });
  });
}
