# HTTPS + LAN Testing Guide

To test from your phone over Wi-Fi, you need HTTPS. Browsers refuse `getUserMedia`
(camera/microphone) on non-secure origins, except plain `http://localhost` —
so any other host (e.g. `http://192.168.1.42:3000`) **must** be served over HTTPS.

## TL;DR

```powershell
# 1. (Once) install mkcert and run its CA setup
choco install mkcert        # or: scoop install mkcert
mkcert -install             # run elevated; installs local root CA in Windows trust store

# 2. (Once, as Administrator) open firewall ports
powershell -ExecutionPolicy Bypass -File scripts\open-firewall.ps1

# 3. Generate certs and patch .env files with your LAN IP
powershell -ExecutionPolicy Bypass -File scripts\setup-lan.ps1

# 4. Start both servers
cd backend  ; npm run dev          # in terminal 1
cd frontend ; npm run dev:https    # in terminal 2

# 5. Open on laptop: https://localhost:3000
#    Open on phone:  https://<your-lan-ip>:3000
```

## Why mkcert

mkcert installs a **local Certificate Authority** into your OS trust store, then
issues certificates signed by that CA. Browsers see them as fully trusted — no
warning page, no `getUserMedia` block.

The same root CA can be exported and installed on your phone, so your phone also
trusts certs issued by your laptop.

## Trusting the CA on your phone

After running `scripts\generate-certs.ps1`, it prints the path to `rootCA.pem`
(usually `C:\Users\<you>\AppData\Local\mkcert\rootCA.pem`).

Transfer that file to your phone (email/AirDrop/USB), then:

- **Android**:
  Settings → Security → Encryption & credentials → Install a certificate →
  CA certificate. Accept the warning, pick the `rootCA.pem` file.
- **iOS**:
  AirDrop or email the file to your phone → tap to install profile →
  Settings → General → VPN & Device Management → install.
  Then enable: Settings → General → About → Certificate Trust Settings.

Without this step the phone will show a "Not secure" warning that you can
sometimes bypass, but on iOS Safari will outright block `getUserMedia` until
the cert is trusted.

## What setup-lan.ps1 does

1. Detects your LAN IP via `Get-NetIPAddress`.
2. Runs `mkcert` to generate `certs/cert.pem` and `certs/key.pem` valid for
   `localhost`, `127.0.0.1`, and your LAN IP.
3. Patches `backend/.env`:
   - `MEDIASOUP_ANNOUNCED_IP=<lan-ip>` so the phone can reach the Mediasoup
     UDP ports (was `127.0.0.1` — which only works on the same machine).
   - `CLIENT_ORIGIN` adds `https://<lan-ip>:3000` to the allowed origins.
4. Patches `frontend/.env`:
   - `NEXT_PUBLIC_API_URL=https://<lan-ip>:4000`
   - `NEXT_PUBLIC_SOCKET_URL=https://<lan-ip>:4000`

## Important: Mediasoup announced IP

WebRTC uses ICE candidates — IP addresses the peer should connect to. Mediasoup
*announces* a single IP for its UDP transport. If you leave it as `127.0.0.1`,
your phone will receive `127.0.0.1` as the candidate and try to connect to
*itself* (which fails). Setting `MEDIASOUP_ANNOUNCED_IP=<your-lan-ip>` is what
makes phone ↔ laptop media work.

## Firewall

Windows Defender Firewall blocks inbound by default. `scripts\open-firewall.ps1`
opens:

- TCP `3000` (Next.js)
- TCP `4000` (backend HTTPS + WSS)
- UDP `40000-40100` (Mediasoup media)

These rules are scoped to Private + Domain profiles — they do **not** open you up
to the public internet at coffee shops, only to your home/office network.

## Troubleshooting

**Phone shows "Not secure" or refuses camera** — root CA not installed on phone.
Re-do the trust step above.

**Video tile stays black on phone** — Mediasoup announced IP is wrong. Re-run
`setup-lan.ps1` (your LAN IP may have changed if you reconnected Wi-Fi) and
restart the backend.

**Socket connects, then disconnects immediately** — JWT in localStorage was
issued by HTTP backend, now backend is HTTPS. Logout + login again.

**`Failed to fetch` on phone** — usually firewall. Run `open-firewall.ps1` as
admin, or temporarily disable Windows Defender Firewall for the Private network
to confirm.

**LAN IP changed** — just re-run `scripts\setup-lan.ps1`.

**Two devices on different networks (one on Wi-Fi, one on Ethernet)** — make
sure they're on the same subnet. A guest Wi-Fi usually isolates clients from
each other and from the wired network.
