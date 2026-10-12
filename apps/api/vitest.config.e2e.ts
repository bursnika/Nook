import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/test-db.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    globalSetup: ['./test/global-setup.ts'],
    env: {
      DATABASE_URL: testDatabaseUrl(),
      UPLOAD_DIR: join(tmpdir(), 'nook-e2e-uploads'),
      JWT_SECRET: 'test-only-secret-test-only-secret-test-only-secret',
      ADMIN_EMAILS: 'platform-admin@example.com',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
    },
  },
});
