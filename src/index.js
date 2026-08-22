import http from "node:http";
import express from "express";
import cors from "cors";
import { Server as SocketServer } from "socket.io";

import { config } from "./config/index.js";
import { connectMongo, disconnectMongo } from "./db/mongo.js";
import { createWorkers, closeWorkers } from "./sfu/worker-pool.js";
import { registerSocketHandlers } from "./signaling/socket-handlers.js";
import { roomsRouter } from "./api/rooms.routes.js";
import { startPresenceSweeper } from "./services/participant.service.js";
import monitorRouter from "../utility/metrics/metricsMiddleware.js";
import systemArtc from "../utility/metrics/systemArtc.js";

async function bootstrap() {
  const app = express();
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.send(systemArtc());
  });

  app.use("/api/rooms", roomsRouter);

  app.use("/api/v1/monitor", monitorRouter); // ← metrics endpoint

  const server = http.createServer(app);
  const io = new SocketServer(server, {
    cors: { origin: config.clientOrigin, methods: ["GET", "POST"], credentials: true },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 1e6,
  });

  await connectMongo();
  await createWorkers();
  registerSocketHandlers(io);
  // Marks silent peers inactive and broadcasts corrected presence.
  const stopSweeper = startPresenceSweeper(io);

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`\n  Nexus Meet SFU`);
    console.log(`  http://localhost:${config.port}`);
    console.log(`  client origin : ${config.clientOrigin}`);
    console.log(`  announced ip  : ${config.mediasoup.announcedIp}`);
    console.log(`  rtc ports     : ${config.mediasoup.minPort}-${config.mediasoup.maxPort}`);
    console.log(`  capacity      : ${config.maxParticipants} peers/room\n`);
  });

  const shutdown = async () => {
    console.log("\n[server] shutting down…");
    stopSweeper();
    io.close();
    server.close();
    await closeWorkers();
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error("[server] fatal:", error);
  process.exit(1);
});
