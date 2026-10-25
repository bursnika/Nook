import { expect, test } from '../support/fixtures';
import { unique } from '../support/api';
import { EditorScreen } from '../support/editor';

test.describe('pages and the desktop', () => {
  test('the pages screen lists, searches, creates and deletes pages', async ({ ann, seed }) => {
    const title = unique('Index page');
    const page = await ann.api.createPage(title, [{ text: 'x' }]);
    await ann.open('/pages');
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
    const list = ann.page.getByRole('main');
    await expect(
      list.getByRole('link', { name: new RegExp(seed.welcomePage.title) }),
    ).toBeVisible();
    await expect(list.getByRole('link', { name: new RegExp(title) })).toBeVisible();

    // search narrows the list
    const search = ann.page.getByLabel('Search pages');
    await search.fill(title.toUpperCase());
    await expect(list.getByRole('link')).toHaveCount(1);
    await search.fill('zzz no such page');
    await expect(
      ann.page.getByRole('status').filter({ hasText: 'Nothing matches “zzz no such page”.' }),
    ).toBeVisible();
    await search.fill('');

    // delete asks first
    await ann.page.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
    const warning = ann.page.getByRole('alertdialog', { name: 'Warning' });
    await expect(warning).toContainText(`Delete “${title}”?`);
    await warning.getByRole('button', { name: 'Keep it' }).click();
    await expect(warning).toBeHidden();
    await expect(list.getByRole('link', { name: new RegExp(title) })).toBeVisible();

    await ann.page.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
    await ann.page
      .getByRole('alertdialog', { name: 'Warning' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(ann.page.getByRole('button', { name: `Delete ${title}` })).toHaveCount(0);
    const gone = await ann.context.request.get(
      `/api/workspaces/${ann.api.workspaceId}/pages/${page.id}`,
    );
    expect(gone.status()).toBe(404);
  });

  test('"New page" opens an untitled page that can be named and written in', async ({ ann }) => {
    await ann.open('/pages');
    await ann.page.getByRole('button', { name: 'New page' }).click();
    const editor = new EditorScreen(ann.page);
    await editor.ready();
    const id = /\/pages\/([^/]+)$/.exec(ann.page.url())?.[1] ?? '';
    expect(id).not.toBe('');
    await expect(ann.page.getByLabel('Page title')).toHaveValue('Untitled');
    const title = unique('Named by test');
    await ann.page.getByLabel('Page title').fill(title);
    await ann.page.getByLabel('Page title').press('Enter');
    await ann.page.keyboard.type('First words');
    await editor.saved();
    await expect.poll(() => ann.api.blockTexts(id)).toEqual(['First words']);
    await expect(ann.page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await ann.api.deletePage(id);
  });

  test('a Markdown file is imported as a page and a page is exported as Markdown', async ({
    ann,
  }) => {
    const heading = unique('Imported notes');
    const markdown = `# ${heading}\n\nA paragraph of text.\n\n- first item\n- second item\n\n> a quote\n`;
    await ann.open('/pages');
    await ann.page.getByLabel('Markdown files to import').setInputFiles({
      name: 'notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(markdown),
    });
    const editor = new EditorScreen(ann.page);
    await editor.ready();
    await expect(ann.page.getByLabel('Page title')).toHaveValue(heading);
    await expect
      .poll(() => editor.texts())
      .toEqual(['A paragraph of text.', 'first item', 'second item', 'a quote']);
    const id = /\/pages\/([^/]+)$/.exec(ann.page.url())?.[1] ?? '';

    // the same page comes back out as a .md file
    await ann.open('/pages');
    const download = ann.page.waitForEvent('download');
    await ann.page.getByRole('button', { name: `Export ${heading} as Markdown` }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.md$/);
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const exported = Buffer.concat(chunks).toString('utf8');
    expect(exported).toContain(`# ${heading}`);
    expect(exported).toContain('A paragraph of text.');
    expect(exported).toContain('first item');
    await ann.api.deletePage(id);
  });

  test('files that are not Markdown, or are empty, are refused with a message', async ({ ann }) => {
    await ann.open('/pages');
    const input = ann.page.getByLabel('Markdown files to import');
    await input.setInputFiles({
      name: 'program.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    });
    await expect(ann.page.getByRole('alert')).toContainText(
      '“program.exe” is not a Markdown or text file.',
    );
    await input.setInputFiles({
      name: 'empty.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('  \n'),
    });
    await expect(ann.page.getByRole('alert')).toContainText('The file is empty.');
  });

  test('subpages are added from the sidebar and can be collapsed', async ({ ann }) => {
    const parentTitle = unique('Tree parent');
    const parent = await ann.api.createPage(parentTitle);
    await ann.open(`/pages/${parent.id}`);
    const tree = ann.page.getByRole('navigation', { name: 'Pages' });
    await ann.page.getByRole('button', { name: `Add a subpage to ${parentTitle}` }).click();
    await expect(ann.page).toHaveURL(new RegExp(`/pages/(?!${parent.id})[^/]+$`));
    const childId = /\/pages\/([^/]+)$/.exec(ann.page.url())?.[1] ?? '';
    await ann.page.getByLabel('Page title').fill('Tree child');
    await expect(tree.getByRole('link', { name: 'Tree child' })).toBeVisible();

    // go back to the parent: the child can be folded away and unfolded
    await tree.getByRole('link', { name: parentTitle }).click();
    await expect(ann.page.getByLabel('Page title')).toHaveValue(parentTitle);
    await ann.page.getByRole('button', { name: `Collapse ${parentTitle}` }).click();
    await expect(tree.getByRole('link', { name: 'Tree child' })).toHaveCount(0);
    await ann.page.getByRole('button', { name: `Expand ${parentTitle}` }).click();
    await expect(tree.getByRole('link', { name: 'Tree child' })).toBeVisible();

    await ann.page.getByRole('button', { name: 'New page' }).click();
    await expect(ann.page.getByLabel('Page title')).toHaveValue('Untitled');
    const created = /\/pages\/([^/]+)$/.exec(ann.page.url())?.[1] ?? '';
    await ann.api.deletePage(created);
    await ann.api.deletePage(childId);
    await ann.api.deletePage(parent.id);
  });

  test('the desktop shows what is due, lets a task be ticked off and saves a quick note', async ({
    ann,
  }) => {
    const soon = unique('Due soon');
    const task = await ann.api.createTask({
      title: soon,
      priority: 'HIGH',
      dueDate: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    });
    await ann.open();
    const today = ann.page
      .getByRole('heading', { level: 2, name: 'Today.exe' })
      .locator('xpath=ancestor::section[1]');
    await expect(today).toContainText('Next 24 hours');
    const tick = today.getByRole('checkbox', { name: new RegExp(soon) });
    await expect(tick).toBeVisible();
    await expect(
      ann.page
        .getByRole('heading', { level: 2, name: 'Priority' })
        .locator('xpath=ancestor::section[1]'),
    ).toContainText('Seed: in progress');

    await tick.click();
    await expect(today.getByRole('checkbox', { name: new RegExp(soon) })).toHaveCount(0);
    await expect.poll(async () => (await ann.api.task(task.id)).status).toBe('DONE');

    // quick note: the first line is the title, every line is a block
    const noteTitle = unique('Quick note');
    await ann.page.getByLabel('Jot something down').fill(`${noteTitle}\nsecond line\nthird line`);
    await ann.page.getByRole('button', { name: 'Save as page' }).click();
    const link = ann.page.getByRole('link', { name: `Open “${noteTitle}”` });
    await expect(link).toBeVisible();
    await link.click();
    const editor = new EditorScreen(ann.page);
    await editor.ready();
    await expect.poll(() => editor.texts()).toEqual([noteTitle, 'second line', 'third line']);
    const id = /\/pages\/([^/]+)$/.exec(ann.page.url())?.[1] ?? '';
    await ann.api.deletePage(id);
    await ann.api.deleteTask(task.id);
  });

  test('the desktop shows the month and links to the calendar', async ({ ann }) => {
    await ann.open();
    await expect(ann.page.getByRole('grid', { name: 'This month' })).toBeVisible();
    await ann.page.getByRole('link', { name: /open calendar/ }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();
  });
});
