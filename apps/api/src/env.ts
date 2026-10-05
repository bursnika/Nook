import 'dotenv/config';
import { resolve } from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to apps/api/.env');
}

export const env = {
  databaseUrl,
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  uploadDir: resolve(process.env.UPLOAD_DIR ?? 'uploads'),
};
