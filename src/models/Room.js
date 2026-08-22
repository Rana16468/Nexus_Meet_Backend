import mongoose from "mongoose";

/** Lightweight embedded roster (fast render), authoritative log lives in ParticipantSession. */
const participantSchema = new mongoose.Schema(
  {
    peerId: { type: String, required: true },
    displayName: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    durationMs: { type: Number, default: 0 },
  },
  { _id: false },
);

const roomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, index: true },
    roomName: { type: String, default: null },
    hostName: { type: String, default: "Guest" },
    hostPeerId: { type: String, default: null },
    maxParticipants: { type: Number, default: 40 },
    participants: { type: [participantSchema], default: [] },
    /** Peak concurrent participants — useful for capacity reporting. */
    peakParticipants: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    /** Total wall-clock meeting duration, written once the room empties. */
    durationMs: { type: Number, default: 0 },
    isDelete: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Newest-first meeting log pagination is index-backed.
roomSchema.index({ createdAt: -1 });

export const Room = mongoose.model("Room", roomSchema);
