import { join } from 'node:path';
import { expect, test } from '../support/fixtures';
import { unique } from '../support/api';
import { E2E_DIR } from '../support/env';
import { Select2, expectFlash } from '../support/admin';

const COVER = join(E2E_DIR, 'fixtures/cover.png');

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

test.describe('classic admin (MVC)', () => {
  test('is closed to a signed-out browser and open with the session cookie', async ({
    page,
    ann,
  }) => {
    const response = await page.request.get('/admin/workspaces', {
      headers: { accept: 'text/html' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toContain('/api/auth/google');

    await ann.page.goto('/admin');
    await expect(ann.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(ann.page.getByText('ann@e2e.test')).toBeVisible();
    await expect(ann.page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  });

  test('a workspace goes through create, validation, edit, search and delete', async ({
    signIn,
  }) => {
    const root = await signIn('root');
    const { page } = root;
    const name = unique('Admin ws');
    const slug = slugOf(name);

    await page.goto('/admin/workspaces');
    await page.getByRole('link', { name: '+ New workspace' }).click();

    // validation: a slug with capitals is refused and the form keeps what was typed
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Slug').fill('Not A Slug');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('slug must be lowercase letters, digits and single dashes'),
    ).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue(name);

    await page.getByLabel('Slug').fill(slug);
    await page.getByRole('button', { name: 'Save' }).click();
    await expectFlash(page, 'Created successfully.');
    await expect(page.getByRole('heading', { name })).toBeVisible();

    // the same slug again: the database refuses and the form says so
    await page.goto('/admin/workspaces/new');
    await page.getByLabel('Name').fill(`${name} twin`);
    await page.getByLabel('Slug').fill(slug);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    // search, then edit
    await page.goto('/admin/workspaces');
    await page.getByRole('searchbox', { name: 'Search' }).fill(slug);
    await page.getByRole('button', { name: 'Search' }).click();
    const row = page.getByRole('row').filter({ hasText: slug });
    await expect(row).toHaveCount(1);
    await row.getByRole('link', { name: 'Edit' }).click();
    const renamed = `${name} renamed`;
    await page.getByLabel('Name').fill(renamed);
    await page.getByRole('button', { name: 'Save' }).click();
    await expectFlash(page, 'Changes saved.');
    await expect(page.getByRole('heading', { name: renamed })).toBeVisible();

    // delete: the browser asks for confirmation first
    await page.goto(`/admin/workspaces?q=${slug}`);
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain(renamed);
      void dialog.dismiss();
    });
    await page
      .getByRole('row')
      .filter({ hasText: slug })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByRole('row').filter({ hasText: slug })).toHaveCount(1);

    page.once('dialog', (dialog) => void dialog.accept());
    await page
      .getByRole('row')
      .filter({ hasText: slug })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expectFlash(page, 'Deleted.');
    await expect(page.getByRole('row').filter({ hasText: slug })).toHaveCount(0);
  });

  test('a page is created with a cover image, edited, published and deleted', async ({
    signIn,
  }) => {
    const root = await signIn('root');
    const { page } = root;
    const workspace = await root.api.post<{ id: string }>('/workspaces', {
      name: unique('Admin pages'),
      slug: slugOf(unique('admin-pages')),
    });
    const base = `/admin/workspaces/${workspace.id}`;
    const title = unique('Cover page');
    const slug = slugOf(title);

    await page.goto(`${base}/pages/new`);
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Icon').fill('✿');
    await page.getByLabel('Public slug').fill(slug);
    await page.getByLabel('Published (visible to everyone with the link)').check();
    await page.getByLabel(/^Cover/).setInputFiles(COVER);
    await page.getByRole('button', { name: 'Save' }).click();

    await expectFlash(page, 'Created successfully.');
    await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
    const cover = page.getByRole('img', { name: `Cover of ${title}` });
    await expect(cover).toBeVisible();
    // the uploaded file is really served, as an image
    const src = await cover.getAttribute('src');
    expect(src).toMatch(/^\/uploads\/.+\.png$/);
    const file = await page.request.get(src!);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toContain('image/png');
    await expect
      .poll(() => cover.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBe(16);

    // and the public landing page shows it as its cover
    const landing = await page.request.get(`/p/${slug}`);
    expect(await landing.text()).toContain(`url('${src}')`);

    // edit: add a block through the note form, then rename
    await page.getByLabel('Add to this note').fill('First line\nSecond line');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Second line', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    const renamed = `${title} v2`;
    await page.getByLabel('Title').fill(renamed);
    await page.getByLabel('Remove the cover').check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expectFlash(page, 'Changes saved.');
    await expect(page.getByRole('heading', { name: new RegExp(renamed) })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Cover of/ })).toHaveCount(0);
    expect((await page.request.get(src!)).status()).toBe(404);

    // a file that is not an image is refused
    await page.goto(`${base}/pages/new`);
    await page.getByLabel('Title').fill(unique('Bad cover'));
    await page.getByLabel(/^Cover/).setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('The cover must be a PNG, JPEG, GIF or WebP image.')).toBeVisible();

    // delete
    await page.goto(`${base}/pages?q=${encodeURIComponent(renamed)}`);
    page.once('dialog', (dialog) => void dialog.accept());
    await page
      .getByRole('row')
      .filter({ hasText: renamed })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expectFlash(page, 'Deleted.');
    expect((await page.request.get(`/p/${slug}`)).status()).toBe(404);
    await root.api.remove(`/workspaces/${workspace.id}`);
  });

  test('a parent page is found with the Select2 autocomplete', async ({ signIn }) => {
    const root = await signIn('root');
    const { page } = root;
    const workspace = await root.api.post<{ id: string }>('/workspaces', {
      name: unique('Admin parent'),
      slug: slugOf(unique('admin-parent')),
    });
    const parentTitle = `Quarterly roadmap ${Date.now().toString(36)}`;
    await root.api.post(`/workspaces/${workspace.id}/pages`, { title: parentTitle });
    await root.api.post(`/workspaces/${workspace.id}/pages`, { title: 'Meeting notes' });

    await page.goto(`/admin/workspaces/${workspace.id}/pages/new`);
    const title = unique('Child page');
    await page.getByLabel('Title').fill(title);
    const parent = new Select2(page, 'f-parentId');
    const lookup = page.waitForResponse((response) => response.url().includes('/lookup/pages?'));
    await parent.search('roadm');
    expect((await lookup).status()).toBe(200);
    await expect(parent.options).toHaveCount(1);
    await parent.options.first().click();
    await expect(parent.container).toContainText(parentTitle);
    await page.getByRole('button', { name: 'Save' }).click();
    await expectFlash(page, 'Created successfully.');
    await expect(page.getByRole('link', { name: parentTitle })).toBeVisible();
    await root.api.remove(`/workspaces/${workspace.id}`);
  });

  test('a task goes through create (with assignee and page), edit, filter and delete', async ({
    signIn,
  }) => {
    const root = await signIn('root');
    const { page } = root;
    const workspace = await root.api.post<{ id: string }>('/workspaces', {
      name: unique('Admin tasks'),
      slug: slugOf(unique('admin-tasks')),
    });
    const base = `/admin/workspaces/${workspace.id}`;
    await root.api.post(`/workspaces/${workspace.id}/pages`, { title: 'Linked planning page' });
    const title = unique('Admin task');

    // the quick form on the workspace home
    await page.goto(base);
    await page.getByRole('textbox', { name: 'Task title' }).fill(unique('Home quick task'));
    await page.getByLabel('Priority', { exact: true }).selectOption('HIGH');
    await page.getByRole('button', { name: '+ Add task' }).click();
    await expectFlash(page, 'Task added.');

    // the full form
    await page.goto(`${base}/tasks/new`);
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Description').fill('Created through the admin form');
    await page.getByLabel('Status').selectOption('IN_PROGRESS');
    await page.getByLabel('Priority', { exact: true }).selectOption('LOW');
    await page.getByLabel('Due date').fill('2030-05-17');
    await new Select2(page, 'f-assigneeId').pick('root', /Root Admin/);
    await new Select2(page, 'f-pageId').pick('plan', /Linked planning page/);
    await page.getByRole('button', { name: 'Save' }).click();
    await expectFlash(page, 'Created successfully.');
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('Created through the admin form')).toBeVisible();
    await expect(page.getByText('Root Admin · root@e2e.test')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Linked planning page' })).toBeVisible();

    // edit
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Status').selectOption('DONE');
    await page.getByRole('button', { name: 'Save' }).click();
    await expectFlash(page, 'Changes saved.');
    await expect(
      page.locator('h1 ~ .chip, .chip').filter({ hasText: 'Done' }).first(),
    ).toBeVisible();
    await expect(page.getByText('not yet')).toHaveCount(0);

    // list filter by status, then delete
    await page.goto(`${base}/tasks`);
    await page.getByRole('searchbox', { name: 'Search' }).fill(title);
    await page.getByLabel('Status').selectOption('DONE');
    await page.getByRole('button', { name: 'Filter' }).click();
    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('2030');
    page.once('dialog', (dialog) => void dialog.accept());
    await row.getByRole('button', { name: 'Delete' }).click();
    await expectFlash(page, 'Deleted.');
    await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
    await root.api.remove(`/workspaces/${workspace.id}`);
  });

  test('the user autocomplete asks the server only from three characters', async ({ signIn }) => {
    const root = await signIn('root');
    const { page } = root;
    const workspace = await root.api.post<{ id: string }>('/workspaces', {
      name: unique('Admin team'),
      slug: slugOf(unique('admin-team')),
    });
    await page.goto(`/admin/workspaces/${workspace.id}/team`);

    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/admin/lookup/users')) requests.push(request.url());
    });
    const users = new Select2(page, 'f-userId');
    await users.search('an');
    await expect(page.getByText('Type at least 1 more character(s)')).toBeVisible();
    // the pause before a request is 300 ms: give a wrong request every chance to show up, then check
    await page.waitForTimeout(600);
    expect(requests).toHaveLength(0);

    const lookup = page.waitForResponse((response) =>
      response.url().includes('/admin/lookup/users'),
    );
    await page.getByRole('searchbox').pressSequentially('n');
    expect((await lookup).status()).toBe(200);
    await expect(page.getByRole('option', { name: 'Ann Archer · ann@e2e.test' })).toBeVisible();
    await expect(page.getByRole('option', { name: /Bob Baker/ })).toHaveCount(0);
    expect(requests).toHaveLength(1);

    await page.getByRole('option', { name: 'Ann Archer · ann@e2e.test' }).click();
    await page.getByLabel('Role').last().selectOption('ADMIN');
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'ann@e2e.test' })).toBeVisible();
    await root.api.remove(`/workspaces/${workspace.id}`);
  });

  test('an invitation link is shown once', async ({ signIn }) => {
    const root = await signIn('root');
    const { page } = root;
    const workspace = await root.api.post<{ id: string }>('/workspaces', {
      name: unique('Admin team'),
      slug: slugOf(unique('admin-team')),
    });
    await page.goto(`/admin/workspaces/${workspace.id}/team`);
    await page.getByLabel('E-mail').fill('guest@e2e.test');
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await expect(page.getByText('Invitation created for guest@e2e.test.')).toBeVisible();
    await expect(page.getByLabel('Invitation link')).toHaveValue(/\/admin\/invite\/.+/);
    // opening the page again does not show the link: the server keeps only a hash of it
    await page.goto(`/admin/workspaces/${workspace.id}/team`);
    await expect(page.getByLabel('Invitation link')).toHaveCount(0);
    await expect(page.getByText('guest@e2e.test')).toBeVisible();
    await root.api.remove(`/workspaces/${workspace.id}`);
  });
});
