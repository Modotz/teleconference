# Deploying to an Ubuntu VPS

This app = **Next.js frontend** + **Node/mediasoup backend** + **PostgreSQL**.
Media (audio/video) flows over **UDP directly to the server** (mediasoup SFU);
only signaling/REST goes through Nginx. Plan the firewall accordingly.

---

## 0. Before you start — what you need

- An **Ubuntu 22.04+ VPS**, ideally **2 vCPU / 2–4 GB RAM** (mediasoup is CPU-bound).
- A **domain name** with DNS A-records pointing to the VPS public IP. HTTPS is
  **mandatory** — browsers block camera/mic on non-HTTPS (non-localhost) origins.
  - `meet.example.com`  → frontend
  - `api.example.com`   → backend (REST + Socket.IO)
- Firewall / cloud **security group** open for:
  - **22** (SSH), **80**, **443** (TCP)
  - **40000–40100 UDP** ← mediasoup RTP. **Must be open in the cloud provider
    security group too**, not just `ufw`, or remote video/audio won't flow.

---

## 1. Install system packages

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Build tools required to compile the mediasoup worker
sudo apt install -y build-essential python3 python3-pip

# PostgreSQL, Nginx, Certbot, git, PM2
sudo apt install -y postgresql nginx certbot python3-certbot-nginx git
sudo npm i -g pm2
```

## 2. PostgreSQL database

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE teleconference;
CREATE USER teleconf WITH PASSWORD 'a-strong-db-password';
GRANT ALL PRIVILEGES ON DATABASE teleconference TO teleconf;
ALTER DATABASE teleconference OWNER TO teleconf;
SQL
```

## 3. Clone the repo

```bash
cd /var/www            # or /home/youruser
git clone https://github.com/Modotz/teleconference.git
cd teleconference
```

## 4. Backend

```bash
cd backend
cp .env.example .env
nano .env              # fill in (see below)
npm install            # compiles mediasoup — needs the build tools above
npx prisma migrate deploy
npx prisma generate
```

**backend/.env (production):**

```ini
PORT=4000
NODE_ENV=production
HTTP_ONLY=true                       # run plain HTTP; Nginx terminates TLS

CLIENT_ORIGIN=https://meet.example.com

DATABASE_URL="postgresql://teleconf:a-strong-db-password@localhost:5432/teleconference?schema=public"

JWT_SECRET=<long-random-string>
JWT_EXPIRES_IN=7d
CALL_TOKEN_SECRET=<another-long-random-string>

# mediasoup — ANNOUNCED_IP MUST be the VPS PUBLIC IP, or remote media fails.
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=<YOUR_VPS_PUBLIC_IP>
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=40100

# Email verification + password reset
APP_URL=https://meet.example.com
SMTP_HOST=smtp.youremail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey-or-username
SMTP_PASS=your-smtp-password
SMTP_FROM="Teleconference <no-reply@example.com>"

# Google sign-in (optional)
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
```

> Generate secrets with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## 5. Frontend

```bash
cd ../frontend
cp .env.example .env
nano .env
npm install
npm run build
```

**frontend/.env (production):**

```ini
# Point the browser at the backend's PUBLIC https URL (subdomain).
NEXT_PUBLIC_API_URL=https://api.example.com

# Google sign-in (same id as backend GOOGLE_CLIENT_ID)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
```

> `NEXT_PUBLIC_*` are baked in at **build time** — re-run `npm run build` after
> changing them. Because the frontend is HTTPS, the backend URL must be HTTPS too
> (mixed-content is blocked).

## 6. Run with PM2

```bash
pm2 start npm --name teleconf-api --cwd /var/www/teleconference/backend  -- start
pm2 start npm --name teleconf-web --cwd /var/www/teleconference/frontend -- start
pm2 save
pm2 startup        # run the command it prints to start on boot
```

- `teleconf-api` → backend on `127.0.0.1:4000`
- `teleconf-web` → `next start` on `127.0.0.1:3000`

## 7. Nginx reverse proxy

`/etc/nginx/sites-available/teleconference`:

```nginx
# WebSocket upgrade helper
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

# Frontend
server {
    server_name meet.example.com;
    listen 80;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Backend (REST + Socket.IO)
server {
    server_name api.example.com;
    listen 80;
    client_max_body_size 30m;     # file uploads (25 MB)
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;          # Socket.IO needs this
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/teleconference /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 8. HTTPS (Let's Encrypt)

```bash
sudo certbot --nginx -d meet.example.com -d api.example.com
```

Certbot rewrites the server blocks to listen on 443 and auto-renews.

## 9. Firewall (ufw)

```bash
sudo ufw allow 22,80,443/tcp
sudo ufw allow 40000:40100/udp
sudo ufw enable
```

**Also open 40000–40100/UDP in your cloud provider's security group.**

## 10. Google OAuth (if used)

In Google Cloud Console → Credentials → your Web OAuth client →
**Authorized JavaScript origins** add `https://meet.example.com`.

---

## Updating later

```bash
cd /var/www/teleconference && git pull
cd backend  && npm install && npx prisma migrate deploy && npx prisma generate
cd ../frontend && npm install && npm run build
pm2 restart teleconf-api teleconf-web
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Can join but **no remote video/audio** | `MEDIASOUP_ANNOUNCED_IP` not the public IP, or UDP 40000–40100 closed in the **cloud security group** |
| Camera/mic blocked | Site not served over **HTTPS** |
| Socket keeps reconnecting | Nginx missing the `Upgrade`/`Connection` headers on the API block |
| Frontend calls `http://...:4000` (mixed content) | Set `NEXT_PUBLIC_API_URL=https://api.example.com` and **rebuild** |
| Uploads fail >1 MB | `client_max_body_size 30m;` in Nginx |
| Google button errors | Origin not added in Google Cloud, or `NEXT_PUBLIC_GOOGLE_CLIENT_ID` not set at build time |
| Emails not arriving | Check `SMTP_*`; without it, links print to the API logs (`pm2 logs teleconf-api`) |
