import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

/** Repository root (this file lives in tests/e2e/support). */
export const ROOT = resolve(import.meta.dirname, '../../..');
export const E2E_DIR = resolve(import.meta.dirname, '..');
export const AUTH_DIR = join(E2E_DIR, '.auth');
export const SEED_FILE = join(AUTH_DIR, 'seed.json');
export const NYC_OUTPUT = join(ROOT, '.nyc_output');

/** The API under test listens here; the built SPA is served by it under /app. */
export const PORT = 3300;
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/** The only database the tests may touch. */
export const E2E_DB_NAME = 'nook_e2e';

/** A throwaway signing key for this run: the API under test and the global setup share it. */
export const JWT_SECRET = 'e2e-only-secret-e2e-only-secret-e2e-only-secret';

export const ANN_EMAIL = 'ann@e2e.test';
export const BOB_EMAIL = 'bob@e2e.test';
export const ROOT_EMAIL = 'root@e2e.test';

/** Where the instrumented build of apps/web goes (see the `e2e:build` script). */
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

/**
 * The server of DATABASE_URL (host, port, credentials) with the dedicated `nook_e2e` database,
 * so a run can never touch the development database.
 */
export function e2eDatabaseUrl(): string {
  const url = new URL(readDatabaseUrl());
  url.pathname = `/${E2E_DB_NAME}`;
  return url.toString();
}

/** The same server, the `postgres` maintenance database: used to create `nook_e2e`. */
export function maintenanceDatabaseUrl(): string {
  const url = new URL(e2eDatabaseUrl());
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}
