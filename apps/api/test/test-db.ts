import 'dotenv/config';

/** Same server as DATABASE_URL, but a dedicated database so e2e runs never touch dev data. */
export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set. Copy .env.example to apps/api/.env');
  const url = new URL(base);
  url.pathname = '/nook_test';
  return url.toString();
}
