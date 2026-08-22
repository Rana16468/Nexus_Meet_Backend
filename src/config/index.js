import "dotenv/config";

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int(process.env.PORT, 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:8080",
  mongoUri: process.env.MONGODB_URI ?? "",
  maxParticipants: int(process.env.MAX_PARTICIPANTS, 40),
  mediasoup: {
    workers: int(process.env.MEDIASOUP_WORKERS, 2),
    listenIp: process.env.MEDIASOUP_LISTEN_IP ?? "0.0.0.0",
    announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP ?? "127.0.0.1",
    minPort: int(process.env.MEDIASOUP_MIN_PORT, 40000),
    maxPort: int(process.env.MEDIASOUP_MAX_PORT, 40100),
  },
};
