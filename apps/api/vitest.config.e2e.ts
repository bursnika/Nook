import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/test-db.js';

export default defineConfig({
  // otherwise graphql gets loaded twice (cjs + esm)
  resolve: { tsconfigPaths: true, conditions: ['module-sync'] },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    globalSetup: ['./test/global-setup.ts'],
    env: {
      DATABASE_URL: testDatabaseUrl(),
      WEB_DIST: join(import.meta.dirname, 'test/fixtures/web'),
      UPLOAD_DIR: join(tmpdir(), 'nook-e2e-uploads'),
      JWT_SECRET: 'test-only-secret-test-only-secret-test-only-secret',
      ADMIN_EMAILS: 'platform-admin@example.com',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      // in-memory cache, queue and local disk storage, ignore .env
      REDIS_URL: '',
      AZURE_STORAGE_CONNECTION_STRING: '',
      AMQP_URL: '',
    },
  },
});
