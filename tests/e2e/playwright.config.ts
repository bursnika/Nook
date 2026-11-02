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

/**
 * End-to-end tests of the real app: the built API serves the instrumented React build, a dedicated database
 * (`nook_e2e`) is seeded by `global-setup.ts`, and Chrome drives the pages. See tests/e2e/README.md.
 */
export default defineConfig({
  testDir: join(E2E_DIR, 'specs'),
  outputDir: join(E2E_DIR, 'test-results'),
  globalSetup: './global-setup.ts',
  // one worker and no parallel files: the specs share one database and one server
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
    // animations (framer-motion, CSS) would make assertions race with the screen
    reducedMotion: 'reduce',
    // the service worker caches the shell between runs; the tests always want the fresh build
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      // locally the installed Chrome is used (no browser download); CI leaves E2E_CHANNEL unset and
      // uses the chromium installed by `npx playwright install chromium`
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
          // never inherit optional services from the developer's shell
          REDIS_URL: '',
          AZURE_STORAGE_CONNECTION_STRING: '',
          GA_MEASUREMENT_ID: '',
          // fake Google client: enough for the sign-in redirect, the tests never call Google
          GOOGLE_CLIENT_ID: 'e2e-client-id.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
          GOOGLE_CALLBACK_URL: `http://localhost:${PORT}/api/auth/google/callback`,
        },
      },
});
