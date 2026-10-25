import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/test-db.js';

export default defineConfig({
  // graphql ships a CJS and an ESM build; Node picks the ESM one (module-sync), so Vite must too, or the
  // schema built in our code and the one graphql-ws uses come from two copies of the library
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
      // the specs always run on the in-memory cache and local-disk storage, whatever the developer's .env says
      REDIS_URL: '',
      AZURE_STORAGE_CONNECTION_STRING: '',
      // always the in-memory queue, whatever the developer's .env says
      AMQP_URL: '',
    },
  },
});
