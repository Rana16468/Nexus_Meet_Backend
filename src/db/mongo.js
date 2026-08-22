import mongoose from "mongoose";
import { config } from "../config/index.js";

let connected = false;

/**
 * MongoDB Atlas connection. The SFU works without it (rooms are in-memory),
 * so a failed connection degrades gracefully instead of killing the server.
 */
export async function connectMongo() {
  if (!config.mongoUri) {
    console.warn("[mongo] MONGODB_URI not set — running without persistence");
    return false;
  }
  try {
    mongoose.set("strictQuery", true);
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
    connected = true;
    console.log("[mongo] connected to Atlas");
    return true;
  } catch (error) {
    console.error("[mongo] connection failed:", error.message);
    return false;
  }
}

export const isMongoConnected = () => connected;

export async function disconnectMongo() {
  if (connected) await mongoose.disconnect();
  connected = false;
}
