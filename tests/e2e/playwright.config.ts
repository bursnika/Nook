import { defineConfig, devices } from '@playwright/test';
import {
  BASE_URL,
  E2E_DIR,
  JWT_SECRET,
  PORT,
  ROOT_EMAIL,
  UPLOAD_DIR,
  WEB_DIST,
  e2eDatabaseUrl,
} from './support/env';
import { join } from 'node:path';

const E2E_CHANNEL =
  (process.env.CI ? process.env.E2E_CHANNEL : (process.env.E2E_CHANNEL ?? 'chrome')) || undefined;

export default defineConfig({
  testDir: join(E2E_DIR, 'specs'),
  outputDir: join(E2E_DIR, 'test-results'),
  globalSetup: './global-setup.ts',
  // specs share one db
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: join(E2E_DIR, 'report'), open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
    locale: 'en-GB',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: E2E_CHANNEL },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node tests/e2e/support/start-api.mjs',
        cwd: join(E2E_DIR, '../..'),
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
          PORT: String(PORT),
          DATABASE_URL: e2eDatabaseUrl(),
          JWT_SECRET,
          UPLOAD_DIR,
          WEB_DIST,
          PUBLIC_URL: `http://localhost:${PORT}`,
          ADMIN_EMAILS: ROOT_EMAIL,
          COOKIE_SECURE: 'false',
          REDIS_URL: '',
          AZURE_STORAGE_CONNECTION_STRING: '',
          GA_MEASUREMENT_ID: '',
          // fake google client
          GOOGLE_CLIENT_ID: 'e2e-client-id.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
          GOOGLE_CALLBACK_URL: `http://localhost:${PORT}/api/auth/google/callback`,
        },
      },
});
