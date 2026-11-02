import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    // env.ts requires these even though unit tests never connect
    env: {
      DATABASE_URL: 'postgresql://unit:unit@localhost:5432/unit',
      JWT_SECRET: 'unit-test-secret-unit-test-secret-unit-test-secret',
      GOOGLE_CLIENT_ID: 'unit-client-id',
      GOOGLE_CLIENT_SECRET: 'unit-client-secret',
      REDIS_URL: '',
      AZURE_STORAGE_CONNECTION_STRING: '',
      AMQP_URL: '',
    },
  },
});
