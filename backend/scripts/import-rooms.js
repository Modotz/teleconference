/**
 * Import sites and bookable rooms (RU-1 scaffold).
 *
 *   node scripts/import-rooms.js rooms.csv --org "RDS" [--dry-run]
 *
 * CSV columns: site*, name*, type (meeting|operational), capacity,
 *   facilities (|-separated), hasCamera (true/false), openFrom (HH:MM), openTo (HH:MM)
 *
 * Rooms are matched by site + name, so re-running updates instead of duplicating.
 */
import 'dotenv/config';
import prisma from '../src/config/prisma.js';
import { readCsv } from './lib/csv.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const orgName = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;
const dryRun = args.includes('--dry-run');
if (!file || !orgName) {
  console.error('usage: node scripts/import-rooms.js <file.csv> --org "<Organization>" [--dry-run]');
  process.exit(1);
}

const HHMM = /^\d{2}:\d{2}$/;

async function main() {
  const rows = readCsv(file);
  const org = await prisma.organization.findFirst({ where: { name: orgName } });
  if (!org) throw new Error(`Organization "${orgName}" not found — import employees first`);

  let sites = 0;
  let rooms = 0;
  for (const r of rows) {
    if (!r.site || !r.name) {
      console.warn('  skip (site and name required):', JSON.stringify(r));
      continue;
    }
    if (dryRun) {
      console.log(`  ${r.site} / ${r.name}`);
      continue;
    }
    let site = await prisma.site.findFirst({ where: { orgId: org.id, name: r.site } });
    if (!site) {
      site = await prisma.site.create({ data: { orgId: org.id, name: r.site } });
      sites++;
    }
    const data = {
      type: r.type === 'operational' ? 'operational' : 'meeting',
      capacity: parseInt(r.capacity) || 0,
      facilities: (r.facilities || '').split('|').map((s) => s.trim()).filter(Boolean),
      hasCamera: /^(1|true|yes|ya)$/i.test(r.hasCamera || ''),
      ...(HHMM.test(r.openFrom) ? { openFrom: r.openFrom } : {}),
      ...(HHMM.test(r.openTo) ? { openTo: r.openTo } : {}),
    };
    const existing = await prisma.bookableRoom.findFirst({ where: { siteId: site.id, name: r.name } });
    if (existing) await prisma.bookableRoom.update({ where: { id: existing.id }, data });
    else await prisma.bookableRoom.create({ data: { ...data, siteId: site.id, name: r.name } });
    rooms++;
  }
  console.log(`done: ${sites} new site(s), ${rooms} room(s) imported/updated`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
