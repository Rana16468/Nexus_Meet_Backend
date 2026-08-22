import mongoose from "mongoose";

const optionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true, maxlength: 160 },
    votes: { type: Number, default: 0 },
  },
  { _id: false },
);

const pollSchema = new mongoose.Schema(
  {
    pollId: { type: String, required: true, unique: true, index: true },
    roomId: { type: String, required: true, index: true },
    question: { type: String, required: true, maxlength: 300 },
    options: { type: [optionSchema], default: [] },
    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    closed: { type: Boolean, default: false },
    voters: { type: [String], default: [] },
    isDelete: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

export const Poll = mongoose.model("Poll", pollSchema);
