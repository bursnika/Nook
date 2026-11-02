import 'dotenv/config';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// walk up so it works from both src/ and dist/src/
function findAppRoot(): string {
  let dir = import.meta.dirname;
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Cannot locate the api package root');
    dir = parent;
  }
  return dir;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to apps/api/.env');
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error(
    'JWT_SECRET must be set to a random value of at least 32 characters (see .env.example)',
  );
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const env = {
  appRoot: findAppRoot(),
  databaseUrl,
  port: Number(process.env.PORT ?? 3000),
  nodeEnv,
  jwtSecret,
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 30,
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : nodeEnv === 'production',
  adminEmails: new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl:
      process.env.GOOGLE_CALLBACK_URL ??
      (process.env.RENDER_EXTERNAL_URL
        ? `${process.env.RENDER_EXTERNAL_URL}/api/auth/google/callback`
        : 'http://localhost:3000/api/auth/google/callback'),
  },
  publicUrl: (
    process.env.PUBLIC_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`
  ).replace(/\/+$/, ''),
  gaMeasurementId: process.env.GA_MEASUREMENT_ID || undefined,
  webDist: resolve(process.env.WEB_DIST ?? join(findAppRoot(), '..', 'web', 'dist')),
  uploadDir: resolve(process.env.UPLOAD_DIR ?? 'uploads'),
  redisUrl: process.env.REDIS_URL || undefined,
  amqpUrl: process.env.AMQP_URL || undefined,
  // 0 disables the background sync
  googleSyncEveryMinutes: Number(process.env.GOOGLE_SYNC_EVERY_MINUTES ?? 30) || 0,
  azureStorage: {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || undefined,
    container: process.env.AZURE_STORAGE_CONTAINER || 'nook-uploads',
  },
};
