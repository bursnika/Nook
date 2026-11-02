import type { BrowserContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NYC_OUTPUT } from './env';

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

// call the returned flush before closing the context
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
    // page is gone, pagehide already saved it
  }
}
