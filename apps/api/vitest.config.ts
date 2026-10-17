import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    // pure unit tests never connect, but env.ts insists on these settings
    env: {
      DATABASE_URL: 'postgresql://unit:unit@localhost:5432/unit',
      JWT_SECRET: 'unit-test-secret-unit-test-secret-unit-test-secret',
      // the Google provider refuses to work without credentials; its HTTP calls are stubbed in the specs
      GOOGLE_CLIENT_ID: 'unit-client-id',
      GOOGLE_CLIENT_SECRET: 'unit-client-secret',
    },
  },
});
