// Launches Next.js after loading .env, so the server port can come from PORT
// in .env (Next does not read PORT from .env on its own).
//
//   node run.js dev    -> next dev  -H 0.0.0.0 -p $PORT
//   node run.js start  -> next start          -p $PORT
//
// PORT defaults to 3000 when not set in .env / the environment.

const { spawn } = require('child_process');
const { loadEnvConfig } = require('@next/env');

const mode = process.argv[2] === 'dev' ? 'dev' : 'start';

// Populate process.env from .env / .env.local / .env.[mode]
loadEnvConfig(process.cwd(), mode === 'dev');

const port = process.env.PORT || '3000';
const args = [mode, '-p', port];
if (mode === 'dev') args.push('-H', '0.0.0.0');

const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, ...args], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
