# Nexus Meet — Backend (Custom SFU)

Express + Socket.io signaling with a **mediasoup** SFU and **MongoDB Atlas** persistence.
No Agora / LiveKit / Twilio / Daily — every media byte is routed by this process.

```
backend/
├─ package.json
├─ .env.example
└─ src/
   ├─ index.js                     # bootstrap: express + http + socket.io + workers
   ├─ config/
   │  ├─ index.js                  # env parsing
   │  └─ mediasoup.config.js       # codecs, worker + WebRtcTransport options
   ├─ db/mongo.js                  # Atlas connection (degrades gracefully)
   ├─ models/{Room,Message}.js     # mongoose schemas
   ├─ services/room.service.js     # best-effort persistence layer
   ├─ sfu/
   │  ├─ worker-pool.js            # C++ workers, round-robin routers
   │  └─ room-manager.js           # rooms, peers, transports, producers, consumers
   ├─ signaling/socket-handlers.js # the full signaling protocol
   └─ api/rooms.routes.js          # REST: create/list/inspect rooms, chat history
```

---

## 1. Windows 11 prerequisites

mediasoup compiles a C++ worker, so the build toolchain must exist **before** `npm install`.

Open **PowerShell as Administrator**:

```powershell
# Node.js 20 LTS + Python 3 (mediasoup build requirement)
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12

# Visual Studio 2022 Build Tools with the C++ workload
winget install --id Microsoft.VisualStudio.2022.BuildTools --override `
  "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Alternative (GUI): download **Build Tools for Visual Studio 2022**, tick
*Desktop development with C++*, ensure **MSVC v143** and **Windows 11 SDK** are selected.

Then close and reopen the terminal and verify:

```powershell
node -v      # v20.x or newer
python --version
npm config set msvs_version 2022
```

Allow the media ports through the firewall (once):

```powershell
New-NetFirewallRule -DisplayName "NexusMeet RTC" -Direction Inbound `
  -Protocol UDP -LocalPort 40000-40100 -Action Allow
New-NetFirewallRule -DisplayName "NexusMeet Signaling" -Direction Inbound `
  -Protocol TCP -LocalPort 4000 -Action Allow
```

## 2. Install & configure

```powershell
cd backend
npm install            # builds the mediasoup worker with MSVC — takes a few minutes
copy .env.example .env
notepad .env           # paste your MongoDB Atlas URI
```

MongoDB Atlas: create a free M0 cluster → *Database Access* add a user →
*Network Access* allow your IP → *Connect → Drivers* copy the `mongodb+srv://…` string
into `MONGODB_URI`.

For LAN meetings set `MEDIASOUP_ANNOUNCED_IP` to your IPv4 (`ipconfig`), e.g. `192.168.1.20`.

## 3. Run

```powershell
npm run dev     # http://localhost:4000
```

Health check: <http://localhost:4000/health>

## 4. Run the frontend against it

```powershell
cd ..
npm install
# .env in the project root:
#   VITE_SIGNALING_URL=http://localhost:4000
npm run dev     # http://localhost:8080
```

Open the app, click **Create new room**, copy the invite link and open it in another
browser/machine on the same network.

> Browsers only grant camera/mic/screen on `localhost` or HTTPS. For LAN testing on other
> machines, front both ports with an HTTPS reverse proxy (e.g. `caddy` with a local cert).

---

## Signaling protocol

Client → server (all with ack callback):

| Event | Payload | Ack |
| --- | --- | --- |
| `joinRoom` | `{ roomId, displayName }` | `{ rtpCapabilities, peers[], producers[] }` |
| `createTransport` | `{ direction: "send" \| "recv" }` | transport params |
| `connectTransport` | `{ transportId, dtlsParameters }` | `{ connected }` |
| `produce` | `{ transportId, kind, rtpParameters, appData }` | `{ id }` |
| `consume` | `{ producerId, rtpCapabilities }` | consumer params (paused) |
| `resumeConsumer` | `{ consumerId }` | `{ resumed }` |
| `closeProducer` | `{ producerId }` | — |
| `chat` | `{ text }` | — |

Server → client: `peerJoined`, `peerLeft`, `newProducer`, `producerClosed`, `chat`.

## REST API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | liveness |
| `POST` | `/api/rooms` | mint a room id |
| `GET` | `/api/rooms` | live rooms + counts |
| `GET` | `/api/rooms/:roomId` | capacity check |
| `GET` | `/api/rooms/:roomId/messages` | persisted chat history |

## Capacity notes

- `MEDIASOUP_WORKERS` should roughly match physical cores; each worker handles several rooms.
- 40 peers/room works with simulcast (the client publishes 3 spatial layers).
- Widen `MEDIASOUP_MIN_PORT`/`MAX_PORT` if you host many concurrent rooms (2 ports per transport).
