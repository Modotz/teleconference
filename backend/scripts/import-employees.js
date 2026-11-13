/**
 * Import / update employees from an HR export (AK-1..AK-4 scaffold).
 *
 *   node scripts/import-employees.js employees.csv [--org "RDS"] [--dry-run]
 *
 * CSV columns (header row, comma or semicolon separated):
 *   email*, username, fullName, nik, title, division, company, site,
 *   managerNik, roles, active
 *
 * - `roles`: space- or |-separated, e.g. "staff" or "manager|pic_site".
 *   Admin roles: hr_admin, it_admin.
 * - `active`: true/false (default true). Setting false revokes every session.
 * - New users get no password: they sign in via password reset (or SSO later).
 * - Everyone in the file is put in the organization given by --org (created
 *   if missing), so the directory only shows colleagues (finding A4).
 */
import 'dotenv/config';
import prisma from '../src/config/prisma.js';
import { readCsv } from './lib/csv.js';
import { revokeSessions } from '../src/lib/sessions.js';
import { audit } from '../src/lib/audit.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const orgName = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;
const dryRun = args.includes('--dry-run');
if (!file || !orgName) {
  console.error('usage: node scripts/import-employees.js <file.csv> --org "<Organization>" [--dry-run]');
  process.exit(1);
}

const truthy = (v, dflt) => (v === '' || v == null ? dflt : /^(1|true|yes|ya|aktif|active)$/i.test(v));
const usernameFrom = (email) => email.split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase() || 'user';

async function main() {
  const rows = readCsv(file);
  let org = await prisma.organization.findFirst({ where: { name: orgName } });
  if (!org && !dryRun) org = await prisma.organization.create({ data: { name: orgName } });
  console.log(`${rows.length} rows → organization "${orgName}"${dryRun ? ' (dry run)' : ''}`);

  const counts = { created: 0, updated: 0, deactivated: 0, skipped: 0 };
  const nikToId = new Map();

  for (const r of rows) {
    const email = (r.email || '').toLowerCase();
    if (!email.includes('@')) {
      counts.skipped++;
      console.warn('  skip (no email):', JSON.stringify(r));
      continue;
    }
    const data = {
      orgId: org?.id,
      fullName: r.fullName || null,
      nik: r.nik || null,
      title: r.title || null,
      division: r.division || null,
      company: r.company || null,
      site: r.site || null,
      roles: (r.roles || 'staff').split(/[|\s]+/).filter(Boolean),
      active: truthy(r.active, true),
    };
    const existing = await prisma.user.findUnique({ where: { email } });
    if (dryRun) {
      console.log(`  ${existing ? 'update' : 'create'} ${email}`, data.active ? '' : '(inactive)');
      continue;
    }

    let user;
    if (existing) {
      user = await prisma.user.update({ where: { id: existing.id }, data });
      counts.updated++;
      if (existing.active && !data.active) {
        await revokeSessions({ userId: user.id }, null, 'hr-deactivated');
        await audit(null, 'user.deactivate', 'user', user.id, { source: 'hr-import' });
        counts.deactivated++;
      }
    } else {
      let username = r.username || usernameFrom(email);
      for (let n = 1; await prisma.user.findUnique({ where: { username } }); n++) {
        username = `${r.username || usernameFrom(email)}${n}`;
      }
      user = await prisma.user.create({ data: { ...data, email, username, emailVerified: true } });
      counts.created++;
    }
    if (user.nik) nikToId.set(user.nik, user.id);
  }

  // Second pass: managers, once every NIK in the file is known.
  if (!dryRun) {
    for (const r of rows) {
      if (!r.managerNik || !r.email) continue;
      const managerId =
        nikToId.get(r.managerNik) ??
        (await prisma.user.findFirst({ where: { nik: r.managerNik, orgId: org.id }, select: { id: true } }))?.id;
      if (managerId) {
        await prisma.user.update({ where: { email: r.email.toLowerCase() }, data: { managerId } });
      }
    }
  }

  console.log('done:', counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
