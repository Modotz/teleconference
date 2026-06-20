# @teleconf/voicecall-sdk

Embed Teleconference **voice calls** into any Next.js / React application.
Audio-only, multi-party, with active-speaker detection. Participants are
**guests** — no account on the Teleconference side, identity comes from a
short-lived access token your backend mints.

## How it works

```
YOUR NEXT.JS APP                         TELECONFERENCE SERVER
────────────────                         ─────────────────────
server route ── X-Api-Key ──────────────▶ POST /api/v1/calls          → { callId }
server route ── X-Api-Key ──────────────▶ POST /api/v1/calls/:id/token → { accessToken }
client component ── accessToken ────────▶ SDK joins call (WSS + WebRTC)
```

**The API key lives only on your server.** The browser only ever sees the
short-lived `accessToken`.

## Install

```bash
npm install @teleconf/voicecall-sdk
```

(During local development, build this package and install it by path or
`npm pack` — see "Local development" below.)

## 1. Server side — mint a token

Your API key is secret. Keep these calls on the server (route handler,
server action, or API route).

```ts
// app/api/voicecall/route.ts  (Next.js App Router)
const BASE = 'https://voice.example.com';     // Teleconference server
const API_KEY = process.env.VOICECALL_API_KEY!;

export async function POST(req: Request) {
  const { displayName } = await req.json();

  // Create a call (or reuse an existing callId you stored earlier)
  const created = await fetch(`${BASE}/api/v1/calls`, {
    method: 'POST',
    headers: { 'X-Api-Key': API_KEY },
  }).then((r) => r.json());

  // Mint a token for this participant
  const token = await fetch(`${BASE}/api/v1/calls/${created.callId}/token`, {
    method: 'POST',
    headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  }).then((r) => r.json());

  return Response.json({ callId: created.callId, accessToken: token.accessToken });
}
```

For a multi-party call: create the call **once**, then call
`/calls/:id/token` once per participant with the **same** `callId`.

## 2. Client side — join the call

### Option A — drop-in component

```tsx
'use client';
import { VoiceCallRoom } from '@teleconf/voicecall-sdk';

export default function CallPage({ accessToken }: { accessToken: string }) {
  return (
    <VoiceCallRoom
      serverUrl="https://voice.example.com"
      accessToken={accessToken}
      selfName="Budi"
      onLeave={() => console.log('left the call')}
    />
  );
}
```

### Option B — headless hook (bring your own UI)

```tsx
'use client';
import { useVoiceCall } from '@teleconf/voicecall-sdk';

export function MyCall({ accessToken }: { accessToken: string }) {
  const call = useVoiceCall({ serverUrl: 'https://voice.example.com' });

  return (
    <div>
      <p>Status: {call.status}</p>
      <button onClick={() => call.join(accessToken)}>Join</button>
      <button onClick={call.toggleMic}>{call.micEnabled ? 'Mute' : 'Unmute'}</button>
      <button onClick={call.leave}>Leave</button>
      <ul>
        {call.participants.map((p) => (
          <li key={p.peerId}>
            {p.displayName} {p.speaking ? '🔊' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Remote audio is played automatically (hidden `<audio>` elements). You only
render UI.

### Option C — fully manual (`VoiceCallClient`)

```ts
import { VoiceCallClient } from '@teleconf/voicecall-sdk';

const client = new VoiceCallClient({ serverUrl: 'https://voice.example.com' });
client.on('remoteStream', ({ stream }) => {
  const a = new Audio();
  a.srcObject = stream;
  a.play();
});
await client.join(accessToken);
client.setMicEnabled(false);
client.leave();
```

## API reference

### `useVoiceCall({ serverUrl })`
Returns `{ status, participants, micEnabled, error, join, leave, toggleMic }`.

- `status`: `'idle' | 'connecting' | 'connected' | 'error' | 'ended'`
- `participants`: `{ peerId, displayName, speaking }[]`
- `join(accessToken)`, `leave()`, `toggleMic()`

### `VoiceCallClient` events
`status`, `participantJoined`, `participantLeft`, `remoteStream`,
`activeSpeaker`, `error` — subscribe via `client.on(event, fn)`.

## Notes

- **Microphone permission** is requested on `join()`. Must run in a secure
  context (`https://` or `http://localhost`).
- **`autoplay`** — browsers allow audio autoplay after a user gesture; call
  `join()` from a click handler.
- The access token has a short join window (default 15 min). Once connected,
  the session persists regardless of token expiry.

## Local development

```bash
cd sdk
npm install
npm run build        # outputs dist/
npm pack             # → teleconf-voicecall-sdk-0.1.0.tgz
# in the partner app:
npm install ../path/to/teleconf-voicecall-sdk-0.1.0.tgz
```

See the full REST reference at `https://voice.example.com/api/v1/docs`.
