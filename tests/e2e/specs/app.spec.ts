import { expect, test } from '../support/fixtures';
import { unique } from '../support/api';

/** A stand-in for Google's sign-in page: the tests never leave for the real one. */
const GOOGLE = 'https://accounts.google.com/**';

test.describe('sign-in and navigation', () => {
  test('a signed-out visitor is sent to the Google sign-in and comes back to the page they wanted', async ({
    page,
  }) => {
    await page.route(GOOGLE, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: 'Google' }),
    );
    const apiRequest = page.waitForRequest((request) =>
      request.url().includes('/api/auth/google?'),
    );
    const googleRequest = page.waitForRequest((request) =>
      request.url().startsWith('https://accounts.google.com/'),
    );

    await page.goto('/app/w/some-workspace/tasks');

    // our API starts the flow and remembers where to return to...
    const start = new URL((await apiRequest).url());
    expect(start.pathname).toBe('/api/auth/google');
    expect(start.searchParams.get('returnTo')).toBe('/app/w/some-workspace/tasks');
    // ...and sends the browser on to Google with PKCE and a state
    const google = new URL((await googleRequest).url());
    expect(google.searchParams.get('client_id')).toBe('e2e-client-id.apps.googleusercontent.com');
    expect(google.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/google\/callback$/);
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    expect(google.searchParams.get('code_challenge')).toBeTruthy();
    expect(google.searchParams.get('state')).toBeTruthy();

    const cookies = await page.context().cookies();
    expect(cookies.map((cookie) => cookie.name)).toEqual(
      expect.arrayContaining(['nook_oauth_state', 'nook_oauth_verifier', 'nook_oauth_return']),
    );
  });

  test('the admin redirects a signed-out browser to the same sign-in', async ({ page }) => {
    await page.route(GOOGLE, (route) => route.fulfill({ status: 200, body: 'Google' }));
    const googleRequest = page.waitForRequest((request) =>
      request.url().startsWith('https://accounts.google.com/'),
    );
    await page.goto('/admin/workspaces');
    expect(new URL((await googleRequest).url()).searchParams.get('client_id')).toBeTruthy();
  });

  test('a signed-in person picks a workspace and lands on the desktop', async ({ ann, seed }) => {
    await ann.page.goto('/app/');
    await expect(ann.page.getByRole('heading', { name: 'Welcome, Ann' })).toBeVisible();
    const list = ann.page.getByRole('list', { name: 'Open a workspace' });
    await expect(list.getByRole('link', { name: /^E2E Space/ })).toBeVisible();
    await expect(list.getByRole('link', { name: /^E2E Other Space/ })).toBeVisible();
    await expect(ann.page.getByText('Signed in as ann@e2e.test.')).toBeVisible();

    await list.getByRole('link', { name: /^E2E Space/ }).click();
    await expect(ann.page).toHaveURL(new RegExp(`/app/w/${seed.workspace.id}$`));
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Desktop' })).toBeVisible();
    await expect(
      ann.page.getByRole('heading', {
        name: /^(Good morning|Good afternoon|Good evening|Still up), Ann$/,
      }),
    ).toBeVisible();
    const sidebar = ann.page.getByRole('complementary', { name: 'Workspace navigation' });
    await expect(sidebar.getByText('E2E Space')).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Welcome' })).toBeVisible();

    // the workspace is remembered: the picker is skipped next time, unless asked for with ?pick=1
    await ann.page.goto('/app/');
    await expect(ann.page).toHaveURL(new RegExp(`/app/w/${seed.workspace.id}$`));
    await ann.page.getByRole('link', { name: 'E2E Space', exact: true }).last().click();
    await expect(ann.page.getByRole('heading', { name: 'Welcome, Ann' })).toBeVisible();
  });

  test('a new workspace can be created from the picker', async ({ ann }) => {
    const name = unique('Fresh space');
    await ann.page.goto('/app/?pick=1');
    await ann.page.getByLabel('Name').fill(name);
    await ann.page.getByRole('button', { name: 'Create' }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Desktop' })).toBeVisible();
    await expect(ann.page.getByRole('contentinfo').getByText(name)).toBeVisible();
    const id = /\/w\/([^/]+)$/.exec(ann.page.url())?.[1];
    expect(id).toBeTruthy();
    await ann.api.remove(`/workspaces/${id}`);
  });

  test('the sidebar, the taskbar and the Start menu navigate between screens', async ({ ann }) => {
    await ann.open();
    const sidebar = ann.page.getByRole('complementary', { name: 'Workspace navigation' });
    await sidebar.getByRole('link', { name: 'Tasks' }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Tasks.exe' })).toBeVisible();
    await sidebar.getByRole('link', { name: 'Calendar' }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();

    await sidebar.getByRole('link', { name: 'Home' }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Desktop' })).toBeVisible();

    await ann.page.getByRole('button', { name: 'Start' }).click();
    const menu = ann.page.getByRole('menu', { name: 'Start menu' });
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await ann.page.keyboard.press('ArrowDown');
    await ann.page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await ann.page.getByRole('button', { name: 'Start' }).click();
    await menu.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await ann.page.getByRole('button', { name: 'Close window and return to the desktop' }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Desktop' })).toBeVisible();
  });

  test('on a phone the taskbar navigates and the page list opens as a drawer', async ({ ann }) => {
    await ann.page.setViewportSize({ width: 480, height: 800 });
    await ann.open();
    const quick = ann.page.getByRole('navigation', { name: 'Quick navigation' });
    await quick.getByRole('link', { name: 'Tasks' }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Tasks.exe' })).toBeVisible();
    await quick.getByRole('link', { name: 'Calendar' }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();

    await quick.getByRole('button', { name: 'Pages' }).click();
    const sidebar = ann.page.getByRole('complementary', { name: 'Workspace navigation' });
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole('link', { name: 'Welcome' }).click();
    await expect(ann.page.getByLabel('Page title')).toHaveValue('Welcome');
    await expect(sidebar).toBeHidden();

    await quick.getByRole('button', { name: 'Pages' }).click();
    await ann.page.keyboard.press('Escape');
    await expect(sidebar).toBeHidden();
    await quick.getByRole('link', { name: 'Home' }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Desktop' })).toBeVisible();
  });

  test('the window can be minimised and maximised', async ({ ann }) => {
    await ann.open();
    const sidebar = ann.page.getByRole('complementary', { name: 'Workspace navigation' });
    await ann.page.getByRole('button', { name: 'Maximise window' }).click();
    await expect(sidebar).toBeHidden();
    await ann.page.getByRole('button', { name: 'Restore the sidebar' }).click();
    await expect(sidebar).toBeVisible();
    await ann.page.getByRole('button', { name: 'Minimise window' }).click();
    await expect(ann.page.getByText('The window is minimised.')).toBeVisible();
    await ann.page.getByRole('button', { name: 'Desktop', exact: true }).click();
    await expect(ann.page.getByRole('heading', { level: 1, name: 'Desktop' })).toBeVisible();
  });

  test('signing out ends the session', async ({ signIn }) => {
    const bob = await signIn('bob');
    await bob.page.route(GOOGLE, (route) => route.fulfill({ status: 200, body: 'Google' }));
    await bob.open();
    await expect(bob.page.getByRole('heading', { level: 1, name: 'Desktop' })).toBeVisible();
    await bob.page.getByRole('button', { name: 'Start' }).click();
    const googleRequest = bob.page.waitForRequest((request) =>
      request.url().startsWith('https://accounts.google.com/'),
    );
    await bob.page.getByRole('menuitem', { name: 'Sign out' }).click();
    await googleRequest;
    // the session cookie is gone: the API no longer knows this browser
    const response = await bob.page.request.get('/api/auth/me');
    expect(response.status()).toBe(401);
  });

  test.describe('dead ends', () => {
    test('an unknown address shows the 404 window', async ({ ann }) => {
      await ann.page.goto('/app/no/such/page');
      await expect(ann.page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
      await expect(ann.page.getByRole('alert')).toContainText('404: this page is not here');
      await ann.page.getByRole('link', { name: 'Back to the desktop' }).click();
      await expect(ann.page.getByRole('heading', { name: /^Welcome|Desktop/ })).toBeVisible();
    });

    test('an unknown screen inside a workspace keeps the desktop around it', async ({
      ann,
      seed,
    }) => {
      await ann.page.goto(`/app/w/${seed.workspace.id}/nope`);
      await expect(ann.page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
      await expect(ann.page.getByRole('alert')).toContainText('404: this page is not here');
      await expect(
        ann.page.getByRole('complementary', { name: 'Workspace navigation' }),
      ).toBeVisible();
    });

    test('a workspace that does not exist (or is not yours) looks the same', async ({
      bob,
      seed,
    }) => {
      // Bob is not a member of the free workspace, and a random id does not exist: both answer 404
      for (const id of [seed.otherWorkspace.id, '019a0000-0000-7000-8000-000000000000']) {
        await bob.page.goto(`/app/w/${id}`);
        await expect(bob.page.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
        await expect(bob.page.getByRole('alert')).toContainText('404: this workspace is not here');
      }
    });

    test('a page that does not exist says so instead of loading forever', async ({ ann, seed }) => {
      await ann.page.goto(`/app/w/${seed.workspace.id}/pages/019a0000-0000-7000-8000-000000000000`);
      await expect(ann.page.getByRole('alert')).toContainText('404: this page is not here');
      await ann.page.getByRole('link', { name: 'Back to the desktop' }).click();
      await expect(ann.page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
    });
  });
});
