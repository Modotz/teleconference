import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server as SocketIOServer } from 'socket.io';

import swaggerUi from 'swagger-ui-express';

import routes from './routes/index.js';
import v1Routes from './routes/v1.js';
import { openapiSpec } from './openapi.js';
import { createWorkers } from './mediasoup/worker.js';
import { registerSignaling } from './sockets/signaling.js';
import { UPLOAD_DIR } from './middleware/upload.js';

const app = express();

// `npm run dev` passes --http to force plain HTTP (localhost dev mode).
// `npm run dev:https` runs without it → HTTPS if certs are present (LAN mode).
const httpOnly =
  process.argv.includes('--http') || process.env.HTTP_ONLY === 'true';

const certPath = process.env.SSL_CERT_PATH;
const keyPath = process.env.SSL_KEY_PATH;
const useHttps =
  !httpOnly &&
  Boolean(certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath));

const server = useHttps
  ? createHttpsServer(
      { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
      app
    )
  : createHttpServer(app);

const allowedOrigins = (process.env.CLIENT_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim());

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// Serve uploaded files (no auth — URLs use UUIDs so they're unguessable)
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.use('/api', routes);

// Public Voice Call API (v1) + its OpenAPI docs
app.get('/api/v1/openapi.json', (_req, res) => res.json(openapiSpec));
app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
app.use('/api/v1', v1Routes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const io = new SocketIOServer(server, { cors: corsOptions });

const PORT = Number(process.env.PORT) || 4000;

async function start() {
  await createWorkers();
  registerSignaling(io);

  server.listen(PORT, '0.0.0.0', () => {
    const proto = useHttps ? 'https' : 'http';
    console.log(`Backend running on ${proto}://localhost:${PORT}`);
    console.log(`         LAN access:  ${proto}://<your-lan-ip>:${PORT}`);
    if (httpOnly) {
      console.log('Mode: HTTP (localhost dev). Run `npm run dev:https` for LAN/phone testing.');
    } else if (!useHttps) {
      console.log('Note: running HTTP — no SSL certs found. Run scripts\\generate-certs.ps1 for HTTPS.');
    }
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
