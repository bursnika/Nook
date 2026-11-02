import {
  expect,
  request as playwrightRequest,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { Api } from './api';
import { readSeed, storageStatePath, type Person } from './auth';
import { BASE_URL } from './env';
import { trackCoverage } from './coverage';
import type { Seed } from './seed';

export interface Actor {
  person: Person;
  context: BrowserContext;
  page: Page;
  api: Api;
  open(path?: string): Promise<void>;
}

type Fixtures = {
  seed: Seed;
  signIn: (person: Person) => Promise<Actor>;
  // owner
  ann: Actor;
  // member
  bob: Actor;
  coverage: void;
};

async function newActor(
  browser: Browser,
  person: Person,
  flushers: (() => Promise<void>)[],
  workspaceId: string,
): Promise<Actor> {
  const storageState = storageStatePath(person);
  const context = await browser.newContext({
    storageState,
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
    locale: 'en-GB',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  flushers.push(await trackCoverage(context));
  const page = await context.newPage();
  const request = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState });
  const api = new Api(request, workspaceId);
  return {
    person,
    context,
    page,
    api,
    open: async (path = '') => {
      await page.goto(`/app/w/${workspaceId}${path}`);
    },
  };
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright needs the destructuring pattern even when empty
  seed: async ({}, use) => {
    await use(readSeed());
  },

  coverage: [
    async ({ context }, use) => {
      const flush = await trackCoverage(context);
      await use();
      await flush();
    },
    { auto: true },
  ],

  signIn: async ({ browser, seed }, use) => {
    const flushers: (() => Promise<void>)[] = [];
    const actors: Actor[] = [];
    await use(async (person) => {
      const actor = await newActor(browser, person, flushers, seed.workspace.id);
      actors.push(actor);
      return actor;
    });
    // flush coverage before closing
    for (const flush of flushers) await flush();
    for (const actor of actors) {
      await actor.api.dispose();
      await actor.context.close();
    }
  },

  ann: async ({ signIn }, use) => {
    await use(await signIn('ann'));
  },
  bob: async ({ signIn }, use) => {
    await use(await signIn('bob'));
  },
});

export { expect };
