# Teleconference (Mediasoup + Next.js + PostgreSQL)

A multi-party teleconference application using:

- **Backend**: Node.js, Express, Socket.io, Mediasoup (SFU), Prisma
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, mediasoup-client, Tailwind
- **Database**: PostgreSQL

## Features

- Multi-party video + audio (SFU, scales to many peers)
- **Dashboard** shows only rooms you created; **share an invite link** to let
  others join; **schedule meetings** for a future date/time
- **Join by link** — paste any meeting URL to jump straight in
- **WhatsApp-style chat at `/chat`**: contact list, 1-on-1 + group chats, emoji, image/file attachments, persistent history, real-time updates
- **Voice calls** (1-on-1 and group) over Mediasoup, with active-speaker detection
- **Public Voice Call API + JS SDK** — third-party apps can create calls and embed them (`@teleconf/voicecall-sdk`)
- Text chat per room (persisted in DB) with **emoji**, **image**, and **file attachments** (up to 25 MB)
- Chat history reloads when you rejoin a room
- **Screen sharing** with system audio (when supported)
- **Local recording** (client-side MediaRecorder → `.webm` download)
- **Layout settings**: grid, spotlight, sidebar; pin participant; mirror self; toggle self-view & names
- **Raise hand** with bouncing badge on tile + dedicated control button
- **Active speaker detection** (server-side AudioLevelObserver) — green ring on speaking tile, auto-spotlights speaker if no pin
- **Virtual background**: blur or replace with image, via MediaPipe SelfieSegmentation running locally in browser
- JWT auth, per-user room ownership, participant history
- HTTPS dev mode for LAN/phone testing
- Responsive UI: collapsible chat, icon controls, mobile-friendly

## Architecture

```
[ Next.js client ]  <-- WebRTC media -->  [ Mediasoup SFU ]
        |                                       |
        +-- Socket.io signaling -----------------+
                       |
                 [ Express REST API ]
                       |
                 [ PostgreSQL (Prisma) ]
```

- **Mediasoup** runs as a Selective Forwarding Unit (SFU): each peer sends a single
  upstream and the server forwards copies to other peers. This scales much better
  than mesh WebRTC for >3 participants.
- **Socket.io** carries signaling only (room join, transport/produce/consume,
  chat). Media flows directly over UDP/SRTP to Mediasoup.
- Per-room **Mediasoup Router** is created on first join; closed when last peer leaves.

## Prerequisites

- Node.js 20+
- Docker Desktop (for PostgreSQL) or a local Postgres 16+
- On Windows, Mediasoup requires Python 3 + build tools. See https://mediasoup.org/documentation/v3/mediasoup/installation/

## Setup

### 1. Start PostgreSQL

```powershell
docker compose up -d postgres
```

### 2. Backend

```powershell
cd backend
Copy-Item .env.example .env
npm install
npx prisma migrate dev --name init
npm run dev
```

Backend runs on `http://localhost:4000`.

### 3. Frontend

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`. It auto-detects the backend from the
page URL — no `NEXT_PUBLIC_API_URL` needed.

## Two run modes

The frontend **auto-derives the backend URL from the page address**, so the
same build works in both modes without editing any env file — even when your
laptop's IP changes between locations.

### Mode A — localhost (HTTP, fastest for dev)

```powershell
cd backend  ; npm run dev      # plain HTTP on :4000
cd frontend ; npm run dev      # plain HTTP on :3000
```

Open `http://localhost:3000`. Camera/mic work because `http://localhost` is a
browser "secure context". Nothing to configure, no certificates. Use this for
day-to-day development on one machine.

### Mode B — LAN / phone (HTTPS)

Required for testing from a **phone or another device** — browsers block
camera/mic on non-`localhost` HTTP origins.

```powershell
# One-time: install mkcert, then `mkcert -install` (as admin)
# One-time (admin): scripts\open-firewall.ps1
# Each new location / IP change: scripts\setup-lan.ps1   (regenerates cert)

cd backend  ; npm run dev:https
cd frontend ; npm run dev:https
```

Open `https://localhost:3000` on the laptop, `https://<lan-ip>:3000` on the
phone. See **[HTTPS.md](./HTTPS.md)** for trusting the cert on the phone.

### When the laptop IP changes

Only **Mode B** is affected (the TLS cert is IP-specific). Just run
`scripts\setup-lan.ps1` again — it regenerates the cert and updates
`MEDIASOUP_ANNOUNCED_IP`. Then restart both servers. Mode A never needs this.

## Usage

1. Open the app in **two different browsers** (or one normal + one incognito).
2. Register two accounts, log in on both → Dashboard.
3. One user starts/schedules a room → copies the **invite link**.
4. The other pastes that link into **Join by link** (or just opens the URL).
5. Allow camera & microphone access.

## Dashboard, sharing & scheduling

- The dashboard lists **only the rooms you created** — not everyone's rooms.
- **Start instant meeting** — creates a room and drops you straight into it.
- **Schedule for later** — tick the box, pick a date/time and optional agenda.
  Scheduled meetings appear under *Upcoming meetings* and don't open until you
  click Join. Anyone with the link can still join early.
- **Copy link** on any room copies its invite URL
  (`<origin>/room/<roomId>`) to the clipboard.
- **Join by link** accepts either a full meeting URL or a bare room id.

Rooms are owned per-user; there is no global room list. Distribution is by
link only, which is also how invitees who never created the room get in.

Run `npx prisma migrate dev --name room_scheduling` after pulling these
changes (adds `description` + `scheduledAt` to `Room`).

## Mediasoup ports

UDP `40000-40100` (configurable via `MEDIASOUP_MIN_PORT` / `MEDIASOUP_MAX_PORT`).

If accessing from a remote machine, set `MEDIASOUP_ANNOUNCED_IP` to your server's
public IP and open the UDP port range in your firewall.

## Project structure

```
Teleconference/
├── backend/
│   ├── src/
│   │   ├── config/prisma.js
│   │   ├── controllers/      # auth, room
│   │   ├── routes/           # REST endpoints
│   │   ├── middleware/auth.js
│   │   ├── mediasoup/        # worker, config, room manager
│   │   ├── sockets/signaling.js   # core SFU signaling
│   │   └── server.js
│   └── prisma/schema.prisma
├── frontend/
│   ├── app/
│   │   ├── login, register, dashboard, room/[roomId]
│   ├── lib/
│   │   ├── api.ts                 # REST client
│   │   └── mediasoupClient.ts     # mediasoup-client + socket wrapper
│   └── components/VideoTile.tsx
└── docker-compose.yml
```

## Screen sharing

Click **Share screen** in the room footer. The browser prompts you to pick a
window / tab / display, optionally including system audio.

- Each peer can have up to two producers per kind: one camera + one screen-video
  (and similarly two audio producers).
- Each producer carries `appData.source` (`camera` | `mic` | `screen-video` |
  `screen-audio`), which the client uses to display the screen share in a
  spotlight area separate from camera tiles.
- iOS Safari does not support `getDisplayMedia()` — screen share works on
  desktop browsers and Android Chrome only.

## /chat — direct messaging + voice calls

A separate messaging surface independent of the video rooms. Access at
`/chat` from the dashboard.

### Sidebar (left)
- Contact list = all conversations the user is part of, sorted by last
  activity. Click **+** to start a new chat: pick one user for 1-on-1, two
  or more to create a group.
- Search filters the visible chats.
- Unread badge (green) appears when new messages arrive in a chat that
  isn't currently open.

### Content pane (right)
- WhatsApp-style bubble layout: own messages right-aligned (blue),
  others left-aligned (slate), with sender name shown in group chats.
- Supports the same emoji / image / file attachment toolbar as room chat.
- Click the **Phone** icon in the header to start a voice call.

### Typing indicators

While anyone in the conversation is composing a message, their name appears as
"X is typing..." in the chat header for other participants.

- Client emits `chat:typing { isTyping: true }` on keystroke (throttled to once
  per 2s) and `false` after 3 s of inactivity or on send.
- Server broadcasts to subscribed peers (excluding sender).
- Receivers expire stale typing entries after 5 s in case the `false` event was
  missed.

### Voice messages

Click the **mic** icon (visible when the input is empty) to record. The header
turns red and shows elapsed time. Cancel with the trash icon or send with the
send icon — the recording is uploaded as an `audio/webm` attachment and rendered
inline with `<audio controls>` in the message bubble.

### Read receipts

Each conversation member has a `lastReadAt` timestamp. When you open a chat the
client calls `chat:markRead` which updates the DB and broadcasts the new
timestamp to peers.

- ✓ (single check, dim) — sent but no one else has opened the conversation
  since this message.
- ✓✓ (double check, gray) — at least one other member has read up to or past
  this message.
- ✓✓ (double check, bright blue) — every other member has read it.

Hover the icon (or long-press on mobile) to see "Read by X/Y" — useful in groups.

### Add / remove members in a group

Tap the group title in the chat header to open the **Group info** panel.

- **Add**: tap **Add member**, search, tap a user. Broadcast over
  `chat:memberAdded` to existing members; the new user receives `chat:added`
  and the group appears in their sidebar (no refresh needed).
- **Remove (owner)**: hover any member → red minus icon → confirm. Broadcast
  over `chat:memberRemoved`; the removed user receives `chat:removed` and the
  group disappears from their sidebar.
- **Leave (member)**: hover yourself → red log-out icon → confirm. Same
  `chat:removed` flow.
- The group **owner cannot leave** while other members remain (would leave
  the group ownerless). They'd have to delete the group instead (not yet
  implemented).

### Chat input shortcuts

- **Enter** sends the message.
- **Shift + Enter** inserts a newline. The input is a textarea that
  auto-grows up to 5 lines, then scrolls.
- Works in both the `/chat` page and the in-room chat panel.

### Voice calls
1. Initiator clicks the phone icon → backend creates an ephemeral
   Mediasoup router scoped to the conversation id (`call:<conversationId>`).
2. All other members receive `call:invite` over their per-user socket
   room → an "Incoming call" toast appears on their `/chat` page.
3. Accept → `call:accept` joins them to the same Mediasoup router. They
   publish only their **microphone** (audio-only).
4. The same active-speaker detection from video rooms applies — the
   speaking peer's avatar gets a green ring.
5. Hang up / last person leaves → `call:ended` broadcast.

Note: this is a **standalone** call experience inside `/chat` — it doesn't
navigate to `/room/[id]`. The call overlay handles everything inline.

### DB schema additions
- `Conversation` { id, name, isGroup, ownerId, ... }
- `ConversationMember` { conversationId, userId, joinedAt, lastReadAt }
- `DirectMessage` { id, conversationId, senderId, content,
  attachmentUrl/Name/Type/Size, createdAt }

Run `npx prisma migrate dev --name chat` after pulling these changes.

## Public Voice Call API (for third-party apps)

Other applications can create voice calls and embed them, without their users
having accounts here. See **[sdk/README.md](./sdk/README.md)** for the SDK.

### Architecture

```
Partner backend  ──X-Api-Key──▶  POST /api/v1/calls            → { callId }
Partner backend  ──X-Api-Key──▶  POST /api/v1/calls/:id/token  → { accessToken }
Partner browser  ──accessToken─▶  @teleconf/voicecall-sdk  ──WSS/WebRTC──▶ Mediasoup
```

- **API key** authenticates the partner's *backend* (header `X-Api-Key`),
  stored only as a SHA-256 hash.
- **Access token** is a short-lived JWT minted per guest; the browser uses it
  to join. Identity (call id + display name) is entirely in the token — no
  `User` row, no login.
- SDK calls run on a separate mediasoup room (`sdkcall:<callId>`) and reuse the
  same transport/produce/consume signaling as in-app rooms.

### REST endpoints (`/api/v1`, all need `X-Api-Key`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/calls` | Create a call → `{ callId }` |
| POST | `/calls/:id/token` | Mint a guest access token |
| GET  | `/calls/:id` | Call status + live participants |
| POST | `/calls/:id/end` | End the call |

**OpenAPI docs**: interactive Swagger UI at `/api/v1/docs`, raw spec at
`/api/v1/openapi.json`.

### Issue an API key to a partner

```powershell
cd backend
node scripts/create-api-client.js "Partner App Name"
# prints the API key ONCE — give it to the partner
```

### Backend setup additions

- `CALL_TOKEN_SECRET` / `CALL_TOKEN_TTL` in `.env` (signs access tokens).
- `npm install` (adds `swagger-ui-express`).
- `npx prisma migrate dev --name api_clients` (adds `ApiClient` + `Call`).

### Building the SDK

```powershell
cd sdk
npm install
npm run build      # → sdk/dist
```

Distribute via your npm registry, or `npm pack` for local/private use.

## Layout settings

Click the **Layout** icon (grid icon) in the room footer to open the settings
panel.

### Layout modes

- **Grid** — equal-sized tiles for all participants. Best for small meetings
  where everyone is roughly equal.
- **Spotlight** — one large tile on top + horizontal thumbnail strip at the
  bottom. Best for presentations and webinars.
- **Sidebar** — one large tile + vertical thumbnail strip on the right.
  Compact alternative to spotlight.

### Pin a participant

Hover any remote tile and click the pin icon (or click in spotlight/sidebar
mode). The pinned peer takes the main tile. Pinning auto-switches Grid → Spotlight
so you immediately see the effect. Unpin from the same icon or the settings
panel.

Pinning is **per-session, not saved** — it resets when you reload. The other
options below are persisted in localStorage.

### Options

- **Show self view** — turn off to hide your own tile entirely.
- **Mirror my video** — flips your own tile horizontally (default ON, matches
  what you see when looking in a mirror; remote peers still see you
  un-mirrored).
- **Show participant names** — name labels on each tile.

### Screen share interaction

When *anyone* shares their screen, the screen tile always takes the spotlight
regardless of the chosen layout mode, and camera tiles drop into a thumbnail
strip below. The layout mode applies when no screen is being shared.

## Raise hand

Click the **hand** icon in the room footer to raise/lower your hand. A bouncing
yellow badge appears on your tile and on the tile shown to every other
participant. The state is broadcast over Socket.io and stored in memory on the
server, so peers who join later see currently raised hands via the
`raisedHands` field in the `joinRoom` reply. Disconnecting auto-lowers the hand.

## Active speaker detection

The Mediasoup router runs an `AudioLevelObserver` (threshold `-65 dBFS`,
interval `800ms`). When someone is loud enough above the threshold, the server
emits an `activeSpeaker` socket event with that peer's id. Effects on the UI:

- A **green ring** highlights the speaking tile.
- In spotlight / sidebar layout with no manual pin, the main tile auto-switches
  to the active speaker.

Screen-share audio is *not* registered with the observer — only the camera
mic, so a video playing on someone's shared tab doesn't steal focus.

## Virtual background

Pick a background under the **Layout** settings panel. Options:

- **None** — pass the camera through unchanged (no segmentation cost).
- **Blur** — Gaussian blur on everything except the person.
- **Image presets** — Office, Beach (configurable in
  `frontend/components/LayoutSettingsPanel.tsx`).

How it works:

1. MediaPipe **SelfieSegmenter** model (`tasks-vision`) loads from Google's
   CDN on first use (~5 MB, cached).
2. Each video frame is segmented; the resulting confidence mask is used to
   composite person-over-background into an offscreen canvas.
3. `canvas.captureStream()` produces a new `MediaStream` whose video track
   replaces the camera producer's track via `producer.replaceTrack()`.
4. Audio is forwarded untouched.

### Performance notes

- Uses **GPU delegate** (WebGL) where available, else CPU.
- Heavy on low-end mobile — start with **Blur** before trying image
  backgrounds (image involves an extra `drawImage` per frame).
- If FPS drops, lower the source camera resolution in `publishCamera`
  options.

## Chat & attachments

The chat panel supports:

- **Plain text** — persisted in PostgreSQL via Prisma (table `Message`)
- **Emoji** — emoji-picker-react, inserted at the cursor position
- **Images** — image button (`accept="image/*"`), inline preview before send,
  thumbnail in the chat list, click → fullscreen lightbox
- **Files** — paperclip button, any file type up to 25 MB, shown as a tile with
  filename, size, and download link

### Upload flow

1. User picks file → `POST /api/upload` (multipart/form-data, JWT required)
2. Backend (`multer`) writes to `backend/uploads/<uuid><ext>`, returns
   `{ url, name, type, size }`
3. Client sends `chatMessage` socket event with the attachment metadata
4. Backend persists message row with attachment fields, broadcasts to room
5. Files are served as static `/uploads/<filename>` (URLs use UUIDs so they're
   unguessable, but in production put this behind a CDN with auth if files
   are sensitive)

### Limits

- 25 MB per file (configurable in `backend/src/middleware/upload.js`)
- File types are not restricted in dev — add MIME whitelist for production
- Upload dir defaults to `backend/uploads/` — override with `UPLOAD_DIR` env var

## Recording

Click **Record** in the room footer. The recorder uses the browser's
`MediaRecorder` API and saves a `.webm` file when you click **Stop recording**.

- Records the **screen share** if active, otherwise records your **camera+mic**.
- Files are saved to your browser's downloads folder, never uploaded.
- **Limitation**: this is client-side, so it only captures streams visible on
  *this* device — not a composite of all remote peers. For a full server-side
  recording, route producers through a Mediasoup `PlainTransport` into
  GStreamer or FFmpeg. That's out of scope for this dev setup but well-trodden
  ground (see [mediasoup-demo](https://github.com/versatica/mediasoup-demo) for
  a reference).

## Signaling flow

1. Client connects Socket.io with JWT in `auth.token`.
2. `joinRoom` → server returns router RTP capabilities + existing producers.
3. Client loads `Device` with those capabilities.
4. Client creates a **send transport** (`createTransport` direction=`send`) and a **recv transport**.
5. `connectTransport` carries DTLS params from client to server.
6. Client calls `transport.produce()` per local track → server `produce` event creates server-side producer and notifies other peers via `newProducer`.
7. On `newProducer`, client calls `consume` on its recv transport → server creates paused consumer → client calls `resumeConsumer`.
8. Tracks arrive on the consumer and are added to a `MediaStream` per remote peer.
9. `appData.source` flows from `produce` → `newProducer` → `consume` so the client knows whether each track is camera, mic, screen-video, or screen-audio.

## Production notes

- Use HTTPS (Let's Encrypt). `getUserMedia` requires a secure context.
- Replace `MEDIASOUP_ANNOUNCED_IP=127.0.0.1` with your public IP.
- Run a **TURN server** (e.g. coturn) for clients behind strict NAT/firewalls.
- Scale Mediasoup horizontally with one process per CPU core (`numWorkers`).
- Add rate limiting, helmet, CSRF where appropriate.
