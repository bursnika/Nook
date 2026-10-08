import 'dotenv/config';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The apps/api folder, found by walking up from this file (works from both src/ and dist/src/). */
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

export const env = {
  appRoot: findAppRoot(),
  databaseUrl,
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  uploadDir: resolve(process.env.UPLOAD_DIR ?? 'uploads'),
};
