import { request as playwrightRequest, type Locator, type Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { unique } from '../support/api';
import { BASE_URL } from '../support/env';

const today = () => new Date().toISOString().slice(0, 10);

interface TodayPlan {
  date: string;
  counts: { tasks: number; events: number };
  tasks: { title: string }[];
}

/** The widget endpoint is for apps that cannot sign in: it is called with no cookies at all. */
async function widgetToday(token: string) {
  const anonymous = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const response = await anonymous.get(`/api/widget/today?token=${encodeURIComponent(token)}`);
    return {
      status: response.status(),
      plan: response.ok() ? ((await response.json()) as TodayPlan) : null,
    };
  } finally {
    await anonymous.dispose();
  }
}

/** A settings card: the window around the heading with this title. */
const card = (page: Page, title: string): Locator =>
  page
    .getByRole('heading', { level: 2, name: title, exact: true })
    .locator('xpath=ancestor::section[1]');

test.describe('settings and integrations', () => {
  test('the settings screen shows the plan, the live-update choice and the integration cards', async ({
    ann,
  }) => {
    await ann.open('/settings');
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    const plan = card(ann.page, 'Plan');
    await expect(plan).toContainText('E2E Space is on the PRO plan.');
    await expect(plan).toContainText('Your role: owner.');
    await expect(plan.getByText('insights', { exact: true })).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Switch to Free' })).toBeVisible();

    await expect(card(ann.page, 'Telegram')).toContainText('The bot is not set up on this server');
    await expect(card(ann.page, 'Widgets')).toContainText('No token');
    const google = card(ann.page, 'Google Calendar');
    await expect(google).toContainText('Server setup: Ready');
    await expect(google).toContainText('Your link: Not connected');
    await expect(card(ann.page, 'Account')).toContainText('ann@e2e.test');
    await expect(ann.page.getByRole('link', { name: 'Classic admin' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });

  test('only an owner can change the plan', async ({ bob }) => {
    await bob.open('/settings');
    await expect(card(bob.page, 'Plan')).toContainText('Your role: member.');
    await expect(bob.page.getByText('Only a workspace owner can change the plan.')).toBeVisible();
    await expect(bob.page.getByRole('button', { name: /Switch to/ })).toHaveCount(0);
  });

  test('the live-update choice in Settings decides the transport of the editor', async ({
    ann,
  }) => {
    const page = await ann.api.createPage(unique('Transport setting'), [{ text: 'hello' }]);
    await ann.open('/settings');
    await ann.page.getByRole('radio', { name: /Long poll/ }).check();
    await expect(ann.page.getByRole('radio', { name: /Long poll/ })).toBeChecked();

    await ann.page.getByRole('link', { name: page.title }).click();
    await expect(ann.page.getByTestId('connection-badge')).toContainText('Long poll · online', {
      timeout: 20_000,
    });
    await expect(ann.page.getByLabel('Connection type')).toHaveValue('longpoll');
    await ann.api.deletePage(page.id);
  });

  test('a widget token is shown once and works until it is replaced or revoked', async ({
    bob,
  }) => {
    const title = unique('Widget task');
    const task = await bob.api.createTask({ title, dueDate: `${today()}T23:00:00.000Z` });
    await bob.open('/settings');
    const widgets = card(bob.page, 'Widgets');
    await expect(widgets).toContainText('No token');

    await widgets.getByRole('button', { name: 'Create token' }).click();
    const field = widgets.getByLabel('Widget token');
    await expect(field).toBeVisible();
    const token = await field.inputValue();
    expect(token).toMatch(/^nkw_/);
    await expect(widgets).toContainText('Token active');
    await expect(widgets).toContainText('it is shown only once');

    // the token opens today's plan, with no sign-in
    const first = await widgetToday(token);
    expect(first.status).toBe(200);
    expect(first.plan?.date).toBe(today());
    expect(first.plan?.tasks.map((item) => item.title)).toContain(title);

    // shown once: after a reload the token is gone from the screen but still active
    await bob.page.reload();
    await expect(widgets.getByLabel('Widget token')).toHaveCount(0);
    await expect(widgets).toContainText('Token active');

    // replacing it kills the old one
    await widgets.getByRole('button', { name: 'Replace token' }).click();
    const replacement = await widgets.getByLabel('Widget token').inputValue();
    expect(replacement).not.toBe(token);
    expect((await widgetToday(token)).status).toBe(401);
    expect((await widgetToday(replacement)).status).toBe(200);

    await widgets.getByRole('button', { name: 'Revoke' }).click();
    await expect(widgets).toContainText('No token');
    expect((await widgetToday(replacement)).status).toBe(401);
    expect((await widgetToday('nkw_not-a-real-token')).status).toBe(401);
    await bob.api.deleteTask(task.id);
  });

  test('a Pro workspace shows the Insights charts', async ({ ann }) => {
    const done = await ann.api.createTask({ title: unique('Insight task'), status: 'DONE' });
    await ann.open('/insights');
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
    for (const label of ['Done in 7 days', 'Overdue', 'Open tasks', 'Pages']) {
      await expect(ann.page.getByRole('main').getByText(label, { exact: true })).toBeVisible();
    }
    const charts = ann.page.locator('canvas[role="img"]');
    await expect(charts).toHaveCount(3);
    await expect(ann.page.getByRole('img', { name: /^Tasks finished per week/ })).toBeVisible();
    await expect(
      ann.page.getByRole('img', {
        name: /^Tasks by status: Backlog \d+, In progress \d+, On hold \d+, Complete \d+/,
      }),
    ).toBeVisible();
    await expect(ann.page.getByRole('img', { name: /^Tasks by priority/ })).toBeVisible();
    await expect(
      ann.page.getByRole('img', { name: /changes in the last \d+ days|No activity/ }),
    ).toBeVisible();

    // Chart.js really drew something: the canvases are not blank
    await expect
      .poll(() =>
        charts.evaluateAll((canvases) =>
          canvases.map((canvas) => {
            const element = canvas as HTMLCanvasElement;
            const pixels = element
              .getContext('2d')
              ?.getImageData(0, 0, element.width, element.height).data;
            return !!pixels && element.width > 0 && pixels.some((value) => value !== 0);
          }),
        ),
      )
      .toEqual([true, true, true]);
    await ann.api.deleteTask(done.id);
  });

  test('a Free workspace shows the Pro gate, and the owner can upgrade it', async ({
    ann,
    seed,
  }) => {
    // the seeded Free workspace stays Free: the upgrade is tried on a throwaway one
    await ann.page.goto(`/app/w/${seed.freeWorkspace.id}/insights`);
    await expect(
      ann.page.getByRole('heading', { name: 'Insights is a Pro feature' }),
    ).toBeVisible();
    await expect(
      ann.page.getByRole('button', { name: 'Switch this workspace to Pro' }),
    ).toBeVisible();
    await expect(ann.page.locator('canvas')).toHaveCount(0);

    const name = unique('Upgrade space');
    const created = await ann.api.post<{ id: string }>('/workspaces', {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    });
    await ann.page.goto(`/app/w/${created.id}/insights`);
    await expect(
      ann.page.getByRole('heading', { name: 'Insights is a Pro feature' }),
    ).toBeVisible();
    await ann.page.getByRole('button', { name: 'Switch this workspace to Pro' }).click();
    await expect(ann.page.locator('canvas[role="img"]')).toHaveCount(3);
    await expect(ann.page.getByText('PRO plan')).toBeVisible();
    await ann.api.remove(`/workspaces/${created.id}`);
  });

  test('a member of a Free workspace is asked to contact an owner', async ({
    bob,
    signIn,
    seed,
  }) => {
    // adding people is for platform admins: Root puts Bob into the Free workspace for this test only
    const root = await signIn('root');
    const member = await root.api.post<{ id: string }>(
      `/workspaces/${seed.freeWorkspace.id}/members`,
      {
        userId: seed.users.bob.id,
        role: 'MEMBER',
      },
    );
    await bob.page.goto(`/app/w/${seed.freeWorkspace.id}/insights`);
    await expect(bob.page.getByText('Ask a workspace owner to switch the plan.')).toBeVisible();
    await expect(
      bob.page.getByRole('button', { name: 'Switch this workspace to Pro' }),
    ).toHaveCount(0);
    await root.api.remove(`/workspaces/${seed.freeWorkspace.id}/members/${member.id}`);
  });
});
