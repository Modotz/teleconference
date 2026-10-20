/**
 * Application-layer encryption for user content (encryption at rest).
 *
 * Two shapes, one key:
 *
 *   seal() / open()
 *     Chat bodies. AES-256-GCM — authenticated, so a row edited directly in
 *     psql is detected rather than silently served.
 *
 *   encryptBuffer() / createFileDecryptStream()
 *     Attachments. AES-256-CTR, not GCM, because HTTP Range requests need
 *     random access: scrubbing a voice note decrypts from an arbitrary byte
 *     offset, which an all-or-nothing GCM tag cannot do. The trade-off is that
 *     file bytes are confidential but not authenticated. Acceptable here since
 *     these files are written only by our own upload route and every read is
 *     authorised per-request — but do not reuse this helper for bytes that
 *     arrive from somewhere less controlled.
 *
 * Scope: this defends against a stolen DB dump, a leaked backup, or someone
 * with filesystem / psql access. It is NOT end-to-end — the server holds the
 * key and can read everything. That is deliberate: it keeps server-side
 * search, notification previews and history-on-a-new-device working.
 */
import crypto from 'crypto';
import fs from 'fs';
import { Transform } from 'stream';

const KEY_BYTES = 32; // AES-256
const BLOCK = 16; // AES block size
export const FILE_IV_LEN = 16; // CTR nonce, stored as the file's first 16 bytes

const TEXT_VERSION = 'v1';
const TEXT_IV_LEN = 12; // 96-bit nonce, the GCM optimum

function loadKey() {
  const raw = (process.env.CONTENT_KEY_B64 || '').trim();
  if (!raw) {
    const msg =
      'CONTENT_KEY_B64 is not set — chat bodies and attachments will be stored in PLAINTEXT. ' +
      'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"';
    if (process.env.NODE_ENV === 'production') throw new Error(msg);
    console.warn(`[contentCrypto] WARNING: ${msg}`);
    return null;
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CONTENT_KEY_B64 must decode to exactly ${KEY_BYTES} bytes, got ${key.length}. ` +
        'It should be the base64 of 32 random bytes.'
    );
  }
  return key;
}

const KEY = loadKey();

/** True when a key is configured, i.e. new writes will actually be encrypted. */
export const encryptionEnabled = KEY !== null;

/* -------------------------------------------------------------------------- */
/* Text                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Encrypt a chat body for storage. Returns `v1.<iv>.<tag>.<ciphertext>`, all
 * base64url. Empty strings and null pass through untouched — an attachment-only
 * message has nothing to hide and a NULL must stay NULL for the schema.
 */
export function seal(plain) {
  if (!KEY) return plain;
  if (plain == null || plain === '') return plain;

  const iv = crypto.randomBytes(TEXT_IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);

  return [
    TEXT_VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ct.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt a stored chat body.
 *
 * Anything without the `v1.` prefix is returned as-is: rows written before
 * encryption was switched on are plaintext and must keep rendering. That also
 * means old messages stay readable in the DB until they are rewritten — run
 * `npm run encrypt:backfill` to seal them.
 */
export function open(stored) {
  if (stored == null) return stored;
  if (typeof stored !== 'string') return stored;
  if (!stored.startsWith(`${TEXT_VERSION}.`)) return stored; // legacy plaintext

  if (!KEY) return '[encrypted]';

  const [, ivB64, tagB64, ctB64] = stored.split('.');
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      KEY,
      Buffer.from(ivB64, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    // Wrong key, or the ciphertext was tampered with. Loud in the log, inert
    // in the UI — one bad row must not take down a whole conversation.
    console.error('[contentCrypto] failed to decrypt a message body:', err.message);
    return '[unreadable]';
  }
}

/** Map `open()` over the `content` field of a message row (or array of them). */
export function openMessage(row) {
  if (Array.isArray(row)) return row.map(openMessage);
  if (!row) return row;
  return { ...row, content: open(row.content) };
}

/* -------------------------------------------------------------------------- */
/* Files                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Advance a CTR nonce by `blockIndex` blocks, so decryption can start in the
 * middle of a file. Big-endian increment over all 16 bytes, matching how
 * OpenSSL counts.
 */
function ivForBlock(iv, blockIndex) {
  const out = Buffer.from(iv);
  let carry = BigInt(blockIndex);
  for (let i = BLOCK - 1; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(out[i]) + (carry % 256n);
    out[i] = Number(sum % 256n);
    carry = carry / 256n + sum / 256n;
  }
  return out;
}

/** Encrypt an upload. Layout: `[16-byte IV][ciphertext]`. */
export function encryptBuffer(plain) {
  if (!KEY) return plain;
  const iv = crypto.randomBytes(FILE_IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-ctr', KEY, iv);
  return Buffer.concat([iv, cipher.update(plain), cipher.final()]);
}

/** Plaintext byte length of a stored file, given its on-disk size. */
export function plainSize(fileSize) {
  return KEY ? Math.max(0, fileSize - FILE_IV_LEN) : fileSize;
}

/**
 * Readable stream of plaintext bytes `[start, end]` (inclusive, like an HTTP
 * Range header) from an encrypted upload.
 */
export async function createFileDecryptStream(absPath, start, end) {
  if (!KEY) return fs.createReadStream(absPath, { start, end });

  const fh = await fs.promises.open(absPath, 'r');
  let iv;
  try {
    iv = Buffer.alloc(FILE_IV_LEN);
    const { bytesRead } = await fh.read(iv, 0, FILE_IV_LEN, 0);
    if (bytesRead !== FILE_IV_LEN) throw new Error('upload is truncated: no IV header');
  } finally {
    await fh.close();
  }

  // Rewind to the start of the AES block containing `start`, then drop the
  // few bytes of overshoot after decrypting.
  const blockIndex = Math.floor(start / BLOCK);
  let toSkip = start - blockIndex * BLOCK;

  const source = fs.createReadStream(absPath, {
    start: FILE_IV_LEN + blockIndex * BLOCK,
    end: FILE_IV_LEN + end,
  });
  const decipher = crypto.createDecipheriv('aes-256-ctr', KEY, ivForBlock(iv, blockIndex));

  const trim = new Transform({
    transform(chunk, _enc, cb) {
      if (toSkip > 0) {
        if (chunk.length <= toSkip) {
          toSkip -= chunk.length;
          return cb();
        }
        chunk = chunk.subarray(toSkip);
        toSkip = 0;
      }
      cb(null, chunk);
    },
  });

  // Errors on any leg must surface on the stream the caller is piping.
  source.on('error', (e) => trim.destroy(e));
  decipher.on('error', (e) => trim.destroy(e));

  return source.pipe(decipher).pipe(trim);
}
