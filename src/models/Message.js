import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    peerId: { type: String, required: true },
    displayName: { type: String, required: true },
    text: { type: String, required: true, maxlength: 2000 },
    sentAt: { type: Date, default: Date.now },
    isDelete: { type: Boolean, default: false },
  },
  { versionKey: false, timestamps: true },
);

export const Message = mongoose.model("Message", messageSchema);
