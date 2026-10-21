import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';
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

const config: ViteUserConfig = {
  // the API serves the production build under /app
  base: '/app/',
  plugins: [react()],
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
