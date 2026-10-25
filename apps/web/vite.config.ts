import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption, type ProxyOptions } from 'vite';
import istanbul from 'vite-plugin-istanbul';
import type { ViteUserConfig } from 'vitest/config';

const API = process.env.NOOK_API ?? 'http://localhost:3000';

/** The API only accepts cookie-authenticated writes from its own origin, so the dev proxy speaks as that origin. */
const asApiOrigin: ProxyOptions = {
  target: API,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on('proxyReq', (req) => req.setHeader('origin', API));
    proxy.on('proxyReqWs', (req) => req.setHeader('origin', API));
  },
};

/**
 * `VITE_COVERAGE=true` builds a copy of the app that records which lines ran (window.__coverage__); the
 * Playwright tests collect it into a code-coverage report (see tests/e2e/README.md). Never set it for a release.
 */
const coverage: PluginOption[] =
  process.env.VITE_COVERAGE === 'true'
    ? [
        istanbul({
          include: 'src/**/*',
          exclude: ['node_modules', '**/*.test.*', 'src/test-setup.ts', 'src/lib/testing.ts'],
          extension: ['.ts', '.tsx'],
          forceBuildInstrument: true,
        }),
      ]
    : [];

const config: ViteUserConfig = {
  // the API serves the production build under /app
  base: '/app/',
  plugins: [react(), ...coverage],
  server: {
    port: 5173,
    proxy: {
      '/api': asApiOrigin,
      '/uploads': asApiOrigin,
      '/ws': { ...asApiOrigin, ws: true },
      '/graphql': { ...asApiOrigin, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
};

export default defineConfig(config as never);
