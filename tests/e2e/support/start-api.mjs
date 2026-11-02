import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const url = new URL(process.env.DATABASE_URL ?? '');
const name = url.pathname.slice(1);
if (name !== 'nook_e2e') throw new Error(`Refusing to run e2e tests against database "${name}"`);

const admin = new URL(url);
admin.pathname = '/postgres';
admin.search = '';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
if (!rowCount) await client.query(`CREATE DATABASE "${name}"`);
await client.end();

const migrate = spawnSync(
  'pnpm',
  ['--filter', '@nook/api', 'exec', 'prisma', 'migrate', 'deploy'],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  },
);
if (migrate.status !== 0) throw new Error('prisma migrate deploy failed');

mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
await import(pathToFileURL(resolve(root, 'apps/api/dist/src/main.js')).href);
