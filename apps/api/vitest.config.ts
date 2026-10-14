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
    },
  },
});
