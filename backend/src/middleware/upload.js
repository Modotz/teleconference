import multer from 'multer';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

/**
 * Uploads land in memory, not on disk: the controller encrypts the buffer
 * before it writes anything, so a plaintext copy never touches the filesystem
 * — not even briefly. Safe at this size cap; revisit if the cap grows.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

export { UPLOAD_DIR, MAX_FILE_SIZE };
