import type { BrowserContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NYC_OUTPUT } from './env';

/** Code coverage of the instrumented build (VITE_COVERAGE=true): the counters live in `window.__coverage__`. */
declare global {
  interface Window {
    __coverage__?: unknown;
    __saveCoverage?: (json: string) => Promise<void>;
  }
}

function save(json: string) {
  mkdirSync(NYC_OUTPUT, { recursive: true });
  writeFileSync(join(NYC_OUTPUT, `${randomUUID()}.json`), json);
}

/**
 * Starts collecting coverage of every page of the context. A page that is reloaded or closed hands its
 * counters over just before it goes (`pagehide`); `flush` collects the pages that are still open and must be
 * called before the context is closed.
 */
export async function trackCoverage(context: BrowserContext): Promise<() => Promise<void>> {
  await context.exposeFunction('__saveCoverage', (json: string) => save(json));
  await context.addInitScript(() => {
    window.addEventListener('pagehide', () => {
      if (window.__coverage__) void window.__saveCoverage?.(JSON.stringify(window.__coverage__));
    });
  });
  return async () => {
    await Promise.all(context.pages().map(collect));
  };
}

async function collect(page: Page) {
  if (page.isClosed()) return;
  try {
    const json = await page.evaluate(() =>
      window.__coverage__ ? JSON.stringify(window.__coverage__) : null,
    );
    if (json) save(json);
  } catch {
    // the page is navigating or crashed: its earlier counters were saved on pagehide
  }
}
