/**
 * Creates an ApiClient (third-party app credential) for the Voice Call API.
 *
 *   node scripts/create-api-client.js "Partner App Name"
 *
 * The raw API key is printed ONCE — store it securely; only its hash is saved.
 */
import 'dotenv/config';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';
import { hashApiKey } from '../src/middleware/apiKeyAuth.js';

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Usage: node scripts/create-api-client.js "<app name>"');
  process.exit(1);
}

const key = 'vc_' + crypto.randomBytes(24).toString('hex');

const client = await prisma.apiClient.create({
  data: {
    name,
    keyPrefix: key.slice(0, 11),
    keyHash: hashApiKey(key),
  },
});

console.log('');
console.log('  API client created');
console.log('  ------------------');
console.log(`  name : ${client.name}`);
console.log(`  id   : ${client.id}`);
console.log('');
console.log('  API KEY (shown once — store it now, e.g. in the partner .env):');
console.log('');
console.log(`    ${key}`);
console.log('');
console.log('  Send it as the  X-Api-Key  header on every /api/v1 request.');
console.log('');

await prisma.$disconnect();
process.exit(0);
