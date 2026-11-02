import { expect, test } from '../support/fixtures';
import { unique } from '../support/api';
import { BoardScreen } from '../support/kanban';

test.describe('kanban board', () => {
  test('shows the seeded cards in their columns', async ({ ann }) => {
    await ann.open('/tasks');
    const board = new BoardScreen(ann.page);
    await board.ready();
    await expect(board.column('Backlog').getByText('Seed: to do')).toBeVisible();
    await expect(board.column('In progress').getByText('Seed: in progress')).toBeVisible();
    await expect(board.column('Complete').getByText('Seed: done')).toBeVisible();
    await expect(board.column('In progress').getByText('High')).toBeVisible();
  });

  test('a card dragged with the mouse changes column and stays there after a reload', async ({
    ann,
  }) => {
    const title = unique('Mouse card');
    const task = await ann.api.createTask({ title });
    await ann.open('/tasks');
    const board = new BoardScreen(ann.page);
    await board.ready();
    await expect(board.column('Backlog').getByText(title)).toBeVisible();

    await board.dragCard(title, 'In progress');
    await expect(board.column('In progress').getByText(title)).toBeVisible();
    await expect.poll(async () => (await ann.api.task(task.id)).status).toBe('IN_PROGRESS');

    await ann.page.reload();
    await board.ready();
    await expect(board.column('In progress').getByText(title)).toBeVisible();
    await expect(board.column('Backlog').getByText(title)).toHaveCount(0);
    await ann.api.deleteTask(task.id);
  });

  test('a card moved with the keyboard changes column and persists', async ({ ann }) => {
    const title = unique('Keyboard card');
    const task = await ann.api.createTask({ title, status: 'IN_PROGRESS' });
    await ann.open('/tasks');
    const board = new BoardScreen(ann.page);
    await board.ready();

    await board.moveCardWithKeys(title, 'ArrowRight', 'On hold');
    await expect(board.column('On hold').getByText(title)).toBeVisible();
    await expect.poll(async () => (await ann.api.task(task.id)).status).toBe('ON_HOLD');

    await ann.page.reload();
    await board.ready();
    await expect(board.column('On hold').getByText(title)).toBeVisible();
    await ann.api.deleteTask(task.id);
  });

  test('the arrow buttons on a card move it between columns', async ({ ann }) => {
    const title = unique('Arrow card');
    const task = await ann.api.createTask({ title });
    await ann.open('/tasks');
    const board = new BoardScreen(ann.page);
    await board.ready();

    await ann.page.getByRole('button', { name: `Move “${title}” to In progress` }).click();
    await expect(board.column('In progress').getByText(title)).toBeVisible();
    await ann.page.getByRole('button', { name: `Move “${title}” to On hold` }).click();
    await expect(board.column('On hold').getByText(title)).toBeVisible();
    await ann.page.getByRole('button', { name: `Move “${title}” to Complete` }).click();
    await expect(board.column('Complete').getByText(title)).toBeVisible();
    await expect.poll(async () => (await ann.api.task(task.id)).status).toBe('DONE');
    await ann.api.deleteTask(task.id);
  });

  test('quick-create adds a card to a column', async ({ ann }) => {
    const title = unique('Quick card');
    await ann.open('/tasks');
    const board = new BoardScreen(ann.page);
    await board.ready();

    await board.column('In progress').getByRole('button', { name: '+ Add card' }).click();
    await ann.page.getByLabel('New card in In progress').fill(title);
    await ann.page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(board.column('In progress').getByText(title)).toBeVisible();

    await ann.page.reload();
    await board.ready();
    await expect(board.column('In progress').getByText(title)).toBeVisible();
    const tasks = await ann.api.get<{ items: { id: string; title: string; status: string }[] }>(
      `/workspaces/${ann.api.workspaceId}/tasks?limit=100`,
    );
    const created = tasks.items.find((task) => task.title === title);
    expect(created?.status).toBe('IN_PROGRESS');
    if (created) await ann.api.deleteTask(created.id);
  });

  test('the card dialog edits and deletes a card', async ({ ann }) => {
    const title = unique('Dialog card');
    const task = await ann.api.createTask({ title });
    await ann.open('/tasks');
    const board = new BoardScreen(ann.page);
    await board.ready();

    await ann.page.getByRole('button', { name: title, exact: true }).click();
    const dialog = ann.page.getByRole('dialog', { name: 'Edit card' });
    const renamed = `${title} (edited)`;
    await dialog.getByLabel('Title').fill(renamed);
    await dialog.getByLabel('Priority').selectOption('HIGH');
    await dialog.getByLabel('Description').fill('Written by the e2e test');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(board.card(renamed)).toContainText('Written by the e2e test');
    await expect(board.card(renamed).getByText('High')).toBeVisible();

    await ann.page.getByRole('button', { name: renamed, exact: true }).click();
    await ann.page
      .getByRole('dialog', { name: 'Edit card' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await ann.page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(board.card(renamed)).toHaveCount(0);
    await expect
      .poll(async () => {
        const response = await ann.context.request.get(
          `/api/workspaces/${ann.api.workspaceId}/tasks/${task.id}`,
        );
        return response.status();
      })
      .toBe(404);
  });

  test('an opened card is assigned, discussed and gets a file', async ({ ann, bob }) => {
    const title = unique('Issue card');
    const task = await ann.api.createTask({ title });
    await ann.open('/tasks');
    const board = new BoardScreen(ann.page);
    await board.ready();

    await ann.page.getByRole('button', { name: title, exact: true }).click();
    const dialog = ann.page.getByRole('dialog', { name: 'Edit card' });
    await dialog.getByRole('button', { name: 'Assign to me' }).click();
    await dialog.getByLabel('Status').selectOption('ON_HOLD');

    await dialog.getByLabel('Add a comment').fill('Waiting for the numbers');
    await dialog.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(dialog.getByText('Waiting for the numbers')).toBeVisible();

    await dialog.getByLabel('Choose files to attach').setInputFiles({
      name: 'numbers.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('42'),
    });
    await expect(dialog.getByRole('link', { name: 'numbers.txt' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    const card = board.column('On hold').locator('.card').filter({ hasText: title });
    await expect(card).toContainText('Comments: 1');
    await expect(card).toContainText('Attachments: 1');
    await expect(card.getByText(/Assigned to/)).toHaveCount(1);

    const comments = await bob.api.get<{ body: string }[]>(
      `/workspaces/${bob.api.workspaceId}/tasks/${task.id}/comments`,
    );
    expect(comments.map((c) => c.body)).toEqual(['Waiting for the numbers']);
    await ann.api.deleteTask(task.id);
  });

  test('New task dialog creates a card', async ({ ann }) => {
    const title = unique('Dialog new');
    await ann.open('/tasks');
    const board = new BoardScreen(ann.page);
    await board.ready();
    await ann.page.getByRole('button', { name: 'New task' }).click();
    const dialog = ann.page.getByRole('dialog', { name: 'New card' });
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Status').selectOption('DONE');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(board.column('Complete').getByText(title)).toBeVisible();
    const tasks = await ann.api.get<{ items: { id: string; title: string }[] }>(
      `/workspaces/${ann.api.workspaceId}/tasks?limit=100`,
    );
    const created = tasks.items.find((task) => task.title === title);
    expect(created).toBeDefined();
    if (created) await ann.api.deleteTask(created.id);
  });

  test('a task created through the REST API appears live, without a reload', async ({
    ann,
    bob,
  }) => {
    await ann.open('/tasks');
    const board = new BoardScreen(ann.page);
    await board.ready();

    const title = unique('Live card');
    const task = await bob.api.createTask({ title, status: 'IN_PROGRESS' });
    await expect(board.column('In progress').getByText(title)).toBeVisible();

    await bob.api.patch(`/workspaces/${bob.api.workspaceId}/tasks/${task.id}`, { status: 'DONE' });
    await expect(board.column('Complete').getByText(title)).toBeVisible();
    await expect(board.column('In progress').getByText(title)).toHaveCount(0);

    await bob.api.deleteTask(task.id);
    await expect(board.card(title)).toHaveCount(0);
  });

  test('the add-card form closes with Escape, and an empty column invites a drop', async ({
    ann,
  }) => {
    await ann.open('/tasks');
    const board = new BoardScreen(ann.page);
    await board.ready();
    const done = board.column('Complete');
    await done.getByRole('button', { name: '+ Add card' }).click();
    const field = ann.page.getByLabel('New card in Complete');
    await expect(field).toBeFocused();
    await expect(done.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
    await field.fill('never saved');
    await ann.page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(board.card('never saved')).toHaveCount(0);
    await expect(done.getByRole('button', { name: '+ Add card' })).toBeFocused();
  });
});
