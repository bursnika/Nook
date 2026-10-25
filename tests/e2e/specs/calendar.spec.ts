import { expect, test } from '../support/fixtures';
import { unique, type Api } from '../support/api';

/** Today in the browser's time zone, which the config pins to UTC. */
const today = () => new Date().toISOString().slice(0, 10);
const todayLabel = () =>
  new Date().toLocaleDateString('en-GB', { dateStyle: 'full', timeZone: 'UTC' });

async function removeEvents(api: Api, title: string) {
  for (const event of await api.events())
    if (event.title.startsWith(title)) await api.deleteEvent(event.id);
}

test.describe('calendar', () => {
  test('today is highlighted and the seeded event sits on tomorrow', async ({ ann, seed }) => {
    await ann.open('/calendar');
    await expect(ann.page.getByRole('heading', { level: 2 }).first()).toContainText(
      new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    );
    const todayButton = ann.page.getByRole('button', { name: new RegExp(`^${todayLabel()}`) });
    await expect(todayButton).toHaveAttribute('aria-current', 'date');
    await expect(todayButton).toHaveAttribute('aria-pressed', 'true');
    await expect(ann.page.locator('.cal__cell.is-today')).toHaveCount(1);
    await expect(ann.page.getByRole('heading', { level: 3, name: todayLabel() })).toBeVisible();

    // the seeded event is tomorrow at noon; the six-week grid always shows the next day
    const tomorrow = new Date(Date.now() + 86_400_000);
    const tomorrowLabel = tomorrow.toLocaleDateString('en-GB', {
      dateStyle: 'full',
      timeZone: 'UTC',
    });
    await ann.page.getByRole('button', { name: new RegExp(`^${tomorrowLabel}, 1 item`) }).click();
    await expect(
      ann.page
        .getByRole('region', { name: tomorrowLabel })
        .getByRole('button', { name: seed.event.title }),
    ).toBeVisible();
    await expect(
      ann.page.getByRole('region', { name: tomorrowLabel }).getByText('12:00–13:00'),
    ).toBeVisible();
  });

  test('previous, next and today buttons move through the months', async ({ ann }) => {
    await ann.open('/calendar');
    const heading = ann.page.getByRole('heading', { level: 2 }).first();
    const now = new Date();
    const label = (offset: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toLocaleDateString(
        'en-GB',
        { month: 'long', year: 'numeric', timeZone: 'UTC' },
      );
    await expect(heading).toHaveText(label(0));
    await ann.page.getByRole('button', { name: 'Next month' }).click();
    await expect(heading).toHaveText(label(1));
    await ann.page.getByRole('button', { name: 'Previous month' }).click();
    await ann.page.getByRole('button', { name: 'Previous month' }).click();
    await expect(heading).toHaveText(label(-1));
    await ann.page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(heading).toHaveText(label(0));
  });

  test('an event is created from the quick form, edited and deleted', async ({ ann }) => {
    const title = unique('Quick event');
    await ann.open('/calendar');

    // create: the form under the day list adds it to the selected day (today)
    await ann.page.getByLabel('New event on this day').fill(title);
    await ann.page.getByRole('button', { name: 'Add event' }).click();
    const agenda = ann.page.getByRole('region', { name: todayLabel() });
    await expect(agenda.getByRole('button', { name: title })).toBeVisible();
    await expect(agenda.getByText('09:00–10:00')).toBeVisible();
    await expect(
      ann.page.locator('.cal__cell.is-today').getByRole('button', { name: `Event: ${title}` }),
    ).toBeVisible();

    // edit
    await agenda.getByRole('button', { name: title }).click();
    const view = ann.page.getByRole('dialog', { name: 'Event' });
    await expect(view.getByRole('heading', { name: title })).toBeVisible();
    await view.getByRole('button', { name: 'Edit' }).click();
    const form = ann.page.getByRole('dialog', { name: 'Edit event' });
    const renamed = `${title} v2`;
    await form.getByLabel('Title').fill(renamed);
    await form.getByLabel('Description').fill('Moved by the e2e test');
    await form.getByLabel('Ends').fill(`${today()}T11:30`);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toBeHidden();
    await expect(agenda.getByRole('button', { name: renamed })).toBeVisible();
    await expect(agenda.getByText('09:00–11:30')).toBeVisible();

    // delete, with the confirmation
    await agenda.getByRole('button', { name: renamed }).click();
    await expect(ann.page.getByText('Moved by the e2e test')).toBeVisible();
    await ann.page
      .getByRole('dialog', { name: 'Event' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await ann.page.getByRole('button', { name: 'Keep it' }).click();
    await expect(ann.page.getByRole('dialog', { name: 'Event' })).toBeVisible();
    await ann.page.getByRole('button', { name: 'Delete' }).click();
    await ann.page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(agenda.getByRole('button', { name: renamed })).toHaveCount(0);
    expect((await ann.api.events()).some((event) => event.title.startsWith(title))).toBe(false);
  });

  test('"More options" opens the full dialog and an all-day event can be saved', async ({
    ann,
  }) => {
    const title = unique('All day');
    await ann.open('/calendar');
    await ann.page.getByLabel('New event on this day').fill(title);
    await ann.page.getByRole('button', { name: 'More options' }).click();
    const dialog = ann.page.getByRole('dialog', { name: 'New event' });
    await expect(dialog.getByLabel('Title')).toHaveValue(title);
    await dialog.getByLabel('All day').check();
    await dialog.getByLabel('Description').fill('Whole day');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    const agenda = ann.page.getByRole('region', { name: todayLabel() });
    await expect(agenda.getByText('All day', { exact: true })).toBeVisible();
    await expect(agenda.getByRole('button', { name: title })).toBeVisible();
    await removeEvents(ann.api, title);
  });

  test('an event with an empty title is refused', async ({ ann }) => {
    await ann.open('/calendar');
    await ann.page.getByLabel('New event on this day').fill('x');
    await ann.page.getByRole('button', { name: 'More options' }).click();
    const dialog = ann.page.getByRole('dialog', { name: 'New event' });
    await dialog.getByLabel('Title').fill('   ');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Give the event a title.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('a task with a deadline shows as a pill and opens its details', async ({ ann }) => {
    const title = unique('Deadline task');
    const task = await ann.api.createTask({
      title,
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueDate: `${today()}T14:00:00.000Z`,
    });
    await ann.open('/calendar');
    const pill = ann.page
      .locator('.cal__cell.is-today')
      .getByRole('button', { name: `Task: ${title}` });
    await expect(pill).toBeVisible();
    await pill.click();
    const dialog = ann.page.getByRole('dialog', { name: 'Task' });
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
    await expect(dialog).toContainText('In progress');
    await expect(dialog).toContainText('High');
    await dialog.getByRole('link', { name: 'Open the board' }).click();
    await expect(ann.page).toHaveURL(/\/tasks$/);
    await expect(ann.page.getByRole('heading', { name: 'Board' })).toBeVisible();
    await ann.api.deleteTask(task.id);
  });

  test('an event created by someone else appears live', async ({ ann, bob }) => {
    const title = unique('Live event');
    await ann.open('/calendar');
    await expect(ann.page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
    const startsAt = `${today()}T15:00:00.000Z`;
    const event = await bob.api.createEvent({
      title,
      startsAt,
      endsAt: `${today()}T16:00:00.000Z`,
    });
    await expect(
      ann.page.getByRole('region', { name: todayLabel() }).getByRole('button', { name: title }),
    ).toBeVisible();
    await bob.api.deleteEvent(event.id);
    await expect(ann.page.getByRole('button', { name: title })).toHaveCount(0);
  });

  test('Connect sends the browser to Google for calendar access and back to the calendar', async ({
    ann,
  }) => {
    await ann.page.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: 'Google' }),
    );
    await ann.open('/calendar');
    await expect(ann.page.getByText('Bring your events into Nook.')).toBeVisible();
    const google = ann.page.waitForRequest((request) =>
      request.url().startsWith('https://accounts.google.com/'),
    );
    await ann.page.getByRole('link', { name: 'Connect' }).click();
    const url = new URL((await google).url());
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
    expect(url.searchParams.get('scope')).not.toContain('calendar.events');
    expect(url.searchParams.get('access_type')).toBe('offline');
    const cookies = await ann.context.cookies();
    const back = cookies.find((cookie) => cookie.name === 'nook_oauth_return')?.value ?? '';
    expect(decodeURIComponent(back)).toBe(`/app/w/${ann.api.workspaceId}/calendar`);
  });
});
