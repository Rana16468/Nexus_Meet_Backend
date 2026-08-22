import mongoose from "mongoose";

/**
 * One document per participant *session* (a single join → leave cycle).
 *
 * A user that drops and reconnects produces a new document, so the collection
 * doubles as a precise activity timeline. Every query used by the API is served
 * by an index, keeping lookups at O(log N).
 */
const timelineEventSchema = new mongoose.Schema(
  {
    /** join | heartbeat | pause | resume | reconnect | disconnect | leave */
    type: { type: String, required: true },
    at: { type: Date, default: Date.now },
    detail: { type: String, default: null },
  },
  { _id: false },
);

/**
 * Client fingerprint captured at join time (browser/OS/device/network) plus the
 * IP resolved server-side from the socket handshake. Stored as a sub-document so
 * reporting can group by `deviceInfo.os.name`, `deviceInfo.device.type`, etc.
 */
const deviceInfoSchema = new mongoose.Schema(
  {
    device: {
      type: { type: String, default: "unknown" },
      brand: { type: String, default: "" },
      model: { type: String, require: false, default: "" },
      touch: { type: Boolean, default: false },
      isDelete: { type: Boolean, default: false },
    },
    os: {
      name: { type: String, default: "Unknown" },
      version: { type: String, default: "" },
      platform: { type: String, default: "" },
    },
    client: {
      type: { type: String, default: "" },
      name: { type: String, default: "Unknown" },
      version: { type: String, default: "" },
      engine: { type: String, default: "" },
    },
    bot: {
      isBot: { type: Boolean, default: false },
      name: { type: String, default: null },
    },
    screenResolution: { type: String, default: "" },
    viewport: { type: String, default: "" },
    pixelRatio: { type: Number, default: 1 },
    language: { type: String, default: "" },
    languages: { type: [String], default: [] },
    timezone: { type: String, default: "" },
    connection: {
      type: { type: String, default: "" },
      effectiveType: { type: String, default: "" },
      downlink: { type: Number, default: null },
      rtt: { type: Number, default: null },
    },
    userAgent: { type: String, default: "" },
    /** Filled in server-side — never trusted from the client. */
    ip: { type: String, default: "" },
  },
  { _id: false },
);

const participantSessionSchema = new mongoose.Schema(
  {
    meetingId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, unique: true },
    peerId: { type: String, required: true, index: true },
    displayName: { type: String, index: true, required: true },
    isHost: { type: Boolean, default: false },

    /** Presence — flipped to false on disconnect/leave/heartbeat timeout. */
    isActive: { type: Boolean, default: true, index: true },
    lastSeenAt: { type: Date, default: Date.now },

    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    /** Denormalised so reporting never has to recompute it. */
    durationMs: { type: Number, index: true, default: 0 },

    timeline: { type: [timelineEventSchema], default: [] },

    /** Device / browser / network fingerprint captured on join. */
    deviceInfo: { type: deviceInfoSchema, default: undefined },
    isDelete: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Compound indexes for the two hot access paths: "who is in room X right now"
// and "session history for room X, newest first".
participantSessionSchema.index({ meetingId: 1, isActive: 1 });
participantSessionSchema.index({ meetingId: 1, joinedAt: -1 });

export const ParticipantSession = mongoose.model("ParticipantSession", participantSessionSchema);
