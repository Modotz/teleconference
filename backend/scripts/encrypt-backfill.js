/**
 * One-time migration to encryption at rest.
 *
 * Turning on CONTENT_KEY_B64 only affects NEW writes — everything already in
 * the database and in uploads/ stays plaintext until this runs. It is
 * idempotent: rows and files already sealed are skipped, so re-running after
 * an interruption is safe.
 *
 *   node scripts/encrypt-backfill.js          # do it
 *   node scripts/encrypt-backfill.js --dry    # just report
 *
 * Back up the database and the uploads directory first. This rewrites both.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import prisma from '../src/config/prisma.js';
import { UPLOAD_DIR } from '../src/middleware/upload.js';
import { encryptionEnabled, seal, encryptBuffer } from '../src/lib/contentCrypto.js';

const DRY = process.argv.includes('--dry');
const SEALED = /^v1\./;
const ALREADY_ENCRYPTED = /^[0-9a-f-]{36}\.bin$/i;
const BATCH = 500;

function log(...args) {
  console.log(DRY ? '[dry]' : '[run]', ...args);
}

/** Seal plaintext `content` on a message table, in batches. */
async function backfillMessages(model, label) {
  let cursor = null;
  let scanned = 0;
  let sealedCount = 0;

  for (;;) {
    const rows = await model.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, content: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;

    for (const row of rows) {
      if (!row.content || SEALED.test(row.content)) continue;
      sealedCount += 1;
      if (!DRY) {
        await model.update({ where: { id: row.id }, data: { content: seal(row.content) } });
      }
    }
  }

  log(`${label}: ${sealedCount} of ${scanned} rows needed sealing`);
  return sealedCount;
}

/**
 * Encrypt the files already sitting in uploads/ and repoint the messages that
 * reference them. Old names carry a real extension (`<uuid>.png`); the new
 * scheme is `<uuid>.bin`, so the URL in each message has to change too.
 */
async function backfillUploads() {
  let entries;
  try {
    entries = await fs.promises.readdir(UPLOAD_DIR);
  } catch {
    log('uploads: directory does not exist, nothing to do');
    return 0;
  }

  let converted = 0;
  let skipped = 0;

  for (const name of entries) {
    if (ALREADY_ENCRYPTED.test(name)) {
      skipped += 1;
      continue;
    }

    const abs = path.join(UPLOAD_DIR, name);
    const stat = await fs.promises.stat(abs).catch(() => null);
    if (!stat?.isFile()) continue;

    const oldUrl = `/uploads/${name}`;
    const base = name.replace(/\.[^.]*$/, '');
    const newName = `${base}.bin`;
    const newUrl = `/uploads/${newName}`;

    // Whoever posted it owns it. If nothing references the file it is orphaned
    // — encrypt it anyway rather than leave plaintext behind, and let the
    // uploader field record that we don't know.
    const roomMsg = await prisma.message.findFirst({
      where: { attachmentUrl: oldUrl },
      select: { userId: true, attachmentType: true },
    });
    const dm = roomMsg
      ? null
      : await prisma.directMessage.findFirst({
          where: { attachmentUrl: oldUrl },
          select: { senderId: true, attachmentType: true },
        });

    const uploaderId = roomMsg?.userId ?? dm?.senderId ?? 'backfill:unknown';
    const mimeType = roomMsg?.attachmentType ?? dm?.attachmentType ?? 'application/octet-stream';

    converted += 1;
    if (DRY) continue;

    const plain = await fs.promises.readFile(abs);
    await fs.promises.writeFile(path.join(UPLOAD_DIR, newName), encryptBuffer(plain));

    await prisma.uploadedFile.upsert({
      where: { filename: newName },
      create: { filename: newName, uploaderId, mimeType, size: plain.length },
      update: {},
    });

    await prisma.message.updateMany({
      where: { attachmentUrl: oldUrl },
      data: { attachmentUrl: newUrl },
    });
    await prisma.directMessage.updateMany({
      where: { attachmentUrl: oldUrl },
      data: { attachmentUrl: newUrl },
    });

    // Only now is the plaintext expendable.
    await fs.promises.unlink(abs);
  }

  log(`uploads: ${converted} files encrypted, ${skipped} already done`);
  return converted;
}

async function main() {
  if (!encryptionEnabled) {
    console.error(
      'CONTENT_KEY_B64 is not set — there is nothing to encrypt with. Generate a key:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n' +
        'then put it in backend/.env as CONTENT_KEY_B64.'
    );
    process.exit(1);
  }

  if (DRY) console.log('Dry run — nothing will be written.\n');
  else console.log('Rewriting messages and uploads. Make sure you have a backup.\n');

  await backfillMessages(prisma.message, 'room messages');
  await backfillMessages(prisma.directMessage, 'direct messages');
  await backfillUploads();

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('\nBackfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
