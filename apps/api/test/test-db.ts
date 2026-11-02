import 'dotenv/config';

// separate database so e2e runs don't touch dev data
export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set. Copy .env.example to apps/api/.env');
  const url = new URL(base);
  url.pathname = '/nook_test';
  return url.toString();
}
