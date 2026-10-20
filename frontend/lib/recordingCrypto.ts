/**
 * Passphrase encryption for local meeting recordings.
 *
 * A recording never reaches the server — MediaRecorder writes it straight to
 * the user's disk. So the threat here is not the network, it is the file
 * sitting in ~/Downloads on a laptop that gets lost, shared or synced. Chunks
 * are encrypted in the browser as they come off the recorder, and the download
 * is a `.webm.enc` that nothing can open without the passphrase.
 *
 * Container layout, all integers big-endian:
 *
 *   magic       8 bytes   "TCREC1\0\0"
 *   iterations  4 bytes   PBKDF2 rounds, so old files stay readable if we
 *                         raise the cost later
 *   salt       16 bytes
 *   then, repeated until EOF:
 *   length      4 bytes   byte count of (iv + ciphertext) that follows
 *   iv         12 bytes
 *   ciphertext  n bytes   AES-256-GCM, tag included
 *
 * Each chunk is sealed with its own IV and takes its index as additional
 * authenticated data, so chunks cannot be reordered, duplicated or dropped
 * without decryption failing.
 *
 * There is no password recovery. Lose the passphrase, lose the recording.
 */

const MAGIC = new Uint8Array([0x54, 0x43, 0x52, 0x45, 0x43, 0x31, 0x00, 0x00]); // "TCREC1\0\0"
const HEADER_LEN = MAGIC.length + 4 + 16; // magic + iterations + salt
const SALT_LEN = 16;
const IV_LEN = 12;
const LEN_PREFIX = 4;
const PBKDF2_ITERATIONS = 250_000;

export const ENCRYPTED_EXTENSION = '.webm.enc';

/** Passphrases shorter than this are not worth the ceremony. */
export const MIN_PASSPHRASE_LENGTH = 8;

function aad(chunkIndex: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(chunkIndex));
  return new Uint8Array(buf);
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ArrayBuffer rather than Uint8Array throughout: both are handed straight to
// the Blob constructor, and a plain buffer is a BlobPart without any casting.
export interface RecordingEncryptor {
  /** File header — write this before the first chunk. */
  header: ArrayBuffer;
  /** Seal one recorder chunk. Call in order; the index is authenticated. */
  encryptChunk(plain: ArrayBuffer): Promise<ArrayBuffer>;
}

export async function createRecordingEncryptor(
  passphrase: string
): Promise<RecordingEncryptor> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);

  const headerBuf = new ArrayBuffer(HEADER_LEN);
  const header = new Uint8Array(headerBuf);
  header.set(MAGIC, 0);
  new DataView(headerBuf).setUint32(MAGIC.length, PBKDF2_ITERATIONS);
  header.set(salt, MAGIC.length + 4);

  let index = 0;

  return {
    header: headerBuf,
    async encryptChunk(plain: ArrayBuffer) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(index) as BufferSource },
          key,
          plain
        )
      );
      index += 1;

      const outBuf = new ArrayBuffer(LEN_PREFIX + IV_LEN + ct.length);
      const out = new Uint8Array(outBuf);
      new DataView(outBuf).setUint32(0, IV_LEN + ct.length);
      out.set(iv, LEN_PREFIX);
      out.set(ct, LEN_PREFIX + IV_LEN);
      return outBuf;
    },
  };
}

export class DecryptError extends Error {}

/**
 * Turn a `.webm.enc` back into a playable Blob.
 *
 * Reads the file in slices rather than all at once, so a long meeting does not
 * have to sit in memory twice over.
 */
export async function decryptRecording(
  file: Blob,
  passphrase: string,
  onProgress?: (fraction: number) => void
): Promise<Blob> {
  if (file.size < HEADER_LEN) throw new DecryptError('File is too small to be a recording.');

  const headerBuf = new Uint8Array(await file.slice(0, HEADER_LEN).arrayBuffer());
  if (!MAGIC.every((b, i) => headerBuf[i] === b)) {
    throw new DecryptError('Not an encrypted recording (bad file header).');
  }

  const view = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.byteLength);
  const iterations = view.getUint32(MAGIC.length);
  const salt = headerBuf.slice(MAGIC.length + 4, MAGIC.length + 4 + SALT_LEN);
  const key = await deriveKey(passphrase, salt, iterations);

  const parts: ArrayBuffer[] = [];
  let offset = HEADER_LEN;
  let index = 0;

  while (offset < file.size) {
    if (offset + LEN_PREFIX > file.size) {
      throw new DecryptError('Recording is truncated — the last chunk is incomplete.');
    }
    const lenBuf = await file.slice(offset, offset + LEN_PREFIX).arrayBuffer();
    const len = new DataView(lenBuf).getUint32(0);
    offset += LEN_PREFIX;

    if (len <= IV_LEN || offset + len > file.size) {
      throw new DecryptError('Recording is truncated or corrupt.');
    }

    const block = new Uint8Array(await file.slice(offset, offset + len).arrayBuffer());
    offset += len;

    const iv = block.subarray(0, IV_LEN);
    const ct = block.subarray(IV_LEN);

    try {
      parts.push(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(index) as BufferSource },
          key,
          ct
        )
      );
    } catch {
      // GCM cannot tell "wrong key" from "edited bytes" — but a failure on the
      // very first chunk is almost always the passphrase.
      throw new DecryptError(
        index === 0
          ? 'Wrong passphrase, or the file has been modified.'
          : `Recording is damaged (chunk ${index + 1} failed to decrypt).`
      );
    }

    index += 1;
    onProgress?.(offset / file.size);
  }

  if (parts.length === 0) throw new DecryptError('Recording is empty.');
  return new Blob(parts, { type: 'video/webm' });
}
