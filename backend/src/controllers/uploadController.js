import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import prisma from '../config/prisma.js';
import { UPLOAD_DIR } from '../middleware/upload.js';
import { encryptBuffer } from '../lib/contentCrypto.js';

export async function handleUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Original filename is sanitized for display only (browser may have set arbitrary chars)
  const safeName = req.file.originalname.replace(/[\r\n]/g, '').slice(0, 255);

  // Stored name carries no extension: the bytes on disk are ciphertext, and a
  // real extension would only invite something to try and open them.
  const filename = `${randomUUID()}.bin`;

  await fs.promises.writeFile(
    path.join(UPLOAD_DIR, filename),
    encryptBuffer(req.file.buffer)
  );

  // Recorded so the uploader can preview the file before the message that
  // references it exists. See canReadUpload() in fileController.
  await prisma.uploadedFile.create({
    data: {
      filename,
      uploaderId: req.user.id,
      mimeType: req.file.mimetype,
      size: req.file.size,
    },
  });

  res.status(201).json({
    url: `/uploads/${filename}`,
    name: safeName,
    type: req.file.mimetype,
    size: req.file.size,
  });
}
