import { config } from "./index.js";

/**
 * Router media codecs. VP8 + VP9 + H264 covers Chrome, Edge and Firefox on
 * Windows 11; Opus handles all audio. Keep this list in sync with what the
 * browser can produce — mediasoup-client negotiates against it.
 */
export const routerOptions = {
  mediaCodecs: [
    {
      kind: "audio",
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: "video",
      mimeType: "video/VP8",
      clockRate: 90000,
      parameters: { "x-google-start-bitrate": 1000 },
    },
    {
      kind: "video",
      mimeType: "video/VP9",
      clockRate: 90000,
      parameters: { "profile-id": 2, "x-google-start-bitrate": 1000 },
    },
    {
      kind: "video",
      mimeType: "video/H264",
      clockRate: 90000,
      parameters: {
        "packetization-mode": 1,
        "profile-level-id": "42e01f",
        "level-asymmetry-allowed": 1,
        "x-google-start-bitrate": 1000,
      },
    },
  ],
};

export const workerSettings = {
  logLevel: "warn",
  logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp", "bwe", "score", "simulcast", "svc"],
  rtcMinPort: config.mediasoup.minPort,
  rtcMaxPort: config.mediasoup.maxPort,
};

export const webRtcTransportOptions = {
  listenIps: [
    {
      ip: config.mediasoup.listenIp,
      announcedIp: config.mediasoup.announcedIp,
    },
  ],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  initialAvailableOutgoingBitrate: 1_000_000,
  maxSctpMessageSize: 262_144,
};
