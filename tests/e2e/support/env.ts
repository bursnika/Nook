import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const ROOT = resolve(import.meta.dirname, '../../..');
export const E2E_DIR = resolve(import.meta.dirname, '..');
export const AUTH_DIR = join(E2E_DIR, '.auth');
export const SEED_FILE = join(AUTH_DIR, 'seed.json');
export const NYC_OUTPUT = join(ROOT, '.nyc_output');

export const PORT = 3300;
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export const E2E_DB_NAME = 'nook_e2e';

export const JWT_SECRET = 'e2e-only-secret-e2e-only-secret-e2e-only-secret';

export const ANN_EMAIL = 'ann@e2e.test';
export const BOB_EMAIL = 'bob@e2e.test';
export const ROOT_EMAIL = 'root@e2e.test';

export const WEB_DIST = join(ROOT, 'apps/web/dist-e2e');
export const UPLOAD_DIR = join(tmpdir(), 'nook-e2e-uploads');

function readDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  const file = join(ROOT, 'apps/api/.env');
  if (existsSync(file)) {
    const value = parseEnv(readFileSync(file, 'utf8')).DATABASE_URL;
    if (value) return value;
  }
  throw new Error(
    'DATABASE_URL is not set (environment or apps/api/.env): the e2e run needs a Postgres server',
  );
}

export function e2eDatabaseUrl(): string {
  const url = new URL(readDatabaseUrl());
  url.pathname = `/${E2E_DB_NAME}`;
  return url.toString();
}

// used to create nook_e2e
export function maintenanceDatabaseUrl(): string {
  const url = new URL(e2eDatabaseUrl());
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}
