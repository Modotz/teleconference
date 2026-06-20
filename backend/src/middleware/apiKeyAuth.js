import crypto from 'crypto';
import prisma from '../config/prisma.js';

/** Deterministic hash so we can look up an ApiClient by its key. */
export function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Authenticates a request from a third-party application's BACKEND using the
 * `X-Api-Key` header. The raw key is never stored — only its SHA-256 hash.
 */
export async function apiKeyAuth(req, res, next) {
  try {
    const key = req.headers['x-api-key'];
    if (!key || typeof key !== 'string') {
      return res.status(401).json({ error: 'Missing X-Api-Key header' });
    }

    const client = await prisma.apiClient.findUnique({
      where: { keyHash: hashApiKey(key) },
    });
    if (!client || !client.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive API key' });
    }

    req.apiClient = client;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
