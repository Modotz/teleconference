import fs from 'fs';
import path from 'path';
import prisma from '../config/prisma.js';
import { UPLOAD_DIR } from '../middleware/upload.js';
import { createFileDecryptStream, plainSize } from '../lib/contentCrypto.js';

/** Stored names are `<uuid>.bin` and nothing else — no traversal, no surprises. */
const FILENAME_RE = /^[0-9a-f-]{36}\.bin$/i;

/** Rendered in the page instead of being pushed at the user as a download. */
const INLINE_TYPES = /^(image|audio|video)\//;

/**
 * Can this caller read this upload?
 *
 * Access follows the message the file is attached to: room attachments are
 * readable by that room's people, conversation attachments by that
 * conversation's members. Before any message references it, only the uploader
 * can read it — that is what makes the send-time preview work.
 */
async function canReadUpload(user, filename, record) {
  const url = `/uploads/${filename}`;

  if (record?.uploaderId === user.id) return true;

  const roomMsg = await prisma.message.findFirst({
    where: { attachmentUrl: url },
    select: { roomId: true, userId: true },
  });
  if (roomMsg) {
    // Guests have no DB rows to check membership against, and their token
    // carries no roomId, so any valid guest token opens any room attachment.
    // Still far better than the previous "no auth at all", but tighten it by
    // stamping roomId into the guest token if room files get sensitive.
    if (user.guest) return true;
    if (roomMsg.userId === user.id) return true;

    const room = await prisma.room.findUnique({
      where: { id: roomMsg.roomId },
      select: { ownerId: true },
    });
    if (room?.ownerId === user.id) return true;

    const joined = await prisma.participant.findFirst({
      where: { roomId: roomMsg.roomId, userId: user.id },
      select: { id: true },
    });
    if (joined) return true;
  }

  if (user.guest) return false; // guests are never in a conversation

  const dm = await prisma.directMessage.findFirst({
    where: { attachmentUrl: url },
    select: { conversationId: true },
  });
  if (dm) {
    const member = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId: dm.conversationId, userId: user.id },
      },
      select: { id: true },
    });
    if (member) return true;
  }

  return false;
}

/**
 * GET /uploads/:filename — decrypt an attachment for someone allowed to see it.
 *
 * Replaces the old `express.static` mount, which served every upload to anyone
 * who had the URL, logged out or not.
 */
export async function serveUpload(req, res) {
  const { filename } = req.params;
  if (!FILENAME_RE.test(filename)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const absPath = path.join(UPLOAD_DIR, filename);
  let stat;
  try {
    stat = await fs.promises.stat(absPath);
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }

  const record = await prisma.uploadedFile.findUnique({ where: { filename } });

  if (!(await canReadUpload(req.user, filename, record))) {
    return res.status(403).json({ error: 'Not allowed to read this file' });
  }

  const mimeType = record?.mimeType || 'application/octet-stream';
  const total = plainSize(stat.size);

  // nosniff + attachment-by-default: an uploaded .html must never execute on
  // our origin, where it would sit next to the user's session.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', mimeType);
  res.setHeader(
    'Content-Disposition',
    INLINE_TYPES.test(mimeType) ? 'inline' : 'attachment'
  );
  res.setHeader('Accept-Ranges', 'bytes');
  // Per-user authorised content: caches must not hand it to the next person.
  res.setHeader('Cache-Control', 'private, max-age=604800');

  let start = 0;
  let end = total - 1;
  const range = req.headers.range;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      res.setHeader('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    if (m[1] === '') {
      // Suffix range: last N bytes.
      start = Math.max(0, total - Number(m[2]));
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), total - 1);
    }
    if (start > end || start >= total) {
      res.setHeader('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  }

  res.setHeader('Content-Length', String(end - start + 1));

  if (req.method === 'HEAD' || total === 0) return res.end();

  try {
    const stream = await createFileDecryptStream(absPath, start, end);
    stream.on('error', (err) => {
      console.error('[serveUpload] decrypt failed:', err.message);
      res.destroy(err);
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    console.error('[serveUpload] could not open upload:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Could not read file' });
    else res.destroy(err);
  }
}
