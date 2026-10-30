import { expect, test } from '../support/fixtures';
import { unique } from '../support/api';
import { PUBLIC_INTRO, PUBLIC_SLUG, PUBLIC_TITLE } from '../support/seed';

const SITE = 'http://localhost:3300';
const DESCRIPTION = `${PUBLIC_INTRO} Why publish Share a plan Share a checklist`;

test.describe('public landing pages (/p/:slug)', () => {
  test('renders the landing page with its content', async ({ page }) => {
    const response = await page.goto(`/p/${PUBLIC_SLUG}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('text/html');

    await expect(page).toHaveTitle(`${PUBLIC_TITLE} · Nook`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PUBLIC_TITLE);
    await expect(page.getByText('By Ann Archer')).toBeVisible();
    await expect(page.getByText(PUBLIC_INTRO)).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Why publish' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Share a plan' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Write to the author' })).toHaveAttribute(
      'href',
      'mailto:ann@e2e.test',
    );
    // anonymous visitors need no sign-in and the page is not part of the app
    await expect(page.getByRole('link', { name: /sitemap/ })).toHaveAttribute(
      'href',
      '/sitemap.xml',
    );
  });

  test('has the meta tags a search engine needs', async ({ page }) => {
    await page.goto(`/p/${PUBLIC_SLUG}`);
    const meta = (selector: string, attribute = 'content') =>
      page.locator(selector).getAttribute(attribute);

    expect(await meta('meta[name="description"]')).toBe(DESCRIPTION);
    expect(await meta('link[rel="canonical"]', 'href')).toBe(`${SITE}/p/${PUBLIC_SLUG}`);
    expect(await meta('meta[name="robots"]')).toBe('index, follow');
    expect(await meta('meta[property="og:title"]')).toBe(PUBLIC_TITLE);
    expect(await meta('meta[property="og:description"]')).toBe(DESCRIPTION);
    expect(await meta('meta[property="og:url"]')).toBe(`${SITE}/p/${PUBLIC_SLUG}`);
    expect(await meta('meta[property="og:type"]')).toBe('article');
    expect(await meta('meta[name="twitter:card"]')).toBe('summary');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('describes the page with valid JSON-LD', async ({ page }) => {
    await page.goto(`/p/${PUBLIC_SLUG}`);
    const raw = await page.locator('script[type="application/ld+json"]').textContent();
    const data = JSON.parse(raw ?? '') as Record<string, unknown>;
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: PUBLIC_TITLE,
      description: DESCRIPTION,
      url: `${SITE}/p/${PUBLIC_SLUG}`,
      author: { '@type': 'Person', name: 'Ann Archer' },
      publisher: { '@type': 'Organization', name: 'Nook' },
    });
    expect(Date.parse(String(data.datePublished))).not.toBeNaN();
    expect(Date.parse(String(data.dateModified))).not.toBeNaN();
  });

  test('the sitemap lists the published page and robots.txt points to it', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()['content-type']).toContain('application/xml');
    const xml = await sitemap.text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${SITE}/</loc>`);
    expect(xml).toContain(`<loc>${SITE}/p/${PUBLIC_SLUG}</loc>`);
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/lastmod>/);

    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(robots.headers()['content-type']).toContain('text/plain');
    const text = await robots.text();
    expect(text).toContain('Allow: /p/');
    expect(text).toContain('Allow: /$');
    expect(text).toContain('Disallow: /admin');
    expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  test('an unknown slug is a 404, not an empty page', async ({ request }) => {
    const response = await request.get('/p/there-is-no-such-page');
    expect(response.status()).toBe(404);
  });

  test('publishing and unpublishing a page toggles its landing page and its sitemap entry', async ({
    ann,
    request,
  }) => {
    const title = unique('Draft');
    const slug = `e2e-${Date.now().toString(36)}`;
    const page = await ann.api.createPage(title, [{ text: 'Secret until published' }]);

    // private: nobody can read it
    expect((await request.get(`/p/${slug}`)).status()).toBe(404);

    const patch = (data: object) =>
      ann.api.patch(`/workspaces/${ann.api.workspaceId}/pages/${page.id}`, data);
    await patch({ slug, isPublished: true });
    const live = await request.get(`/p/${slug}`);
    expect(live.status()).toBe(200);
    expect(await live.text()).toContain('Secret until published');
    expect(await (await request.get('/sitemap.xml')).text()).toContain(`/p/${slug}</loc>`);

    await patch({ isPublished: false });
    expect((await request.get(`/p/${slug}`)).status()).toBe(404);
    expect(await (await request.get('/sitemap.xml')).text()).not.toContain(`/p/${slug}</loc>`);
    await ann.api.deletePage(page.id);
  });

  test('text from the page is escaped, never run as HTML', async ({ ann, page, request }) => {
    const slug = `e2e-xss-${Date.now().toString(36)}`;
    const created = await ann.api.createPage('<img src=x onerror=alert(1)> title', [
      { text: '<script>window.__pwned = true</script>' },
    ]);
    await ann.api.patch(`/workspaces/${ann.api.workspaceId}/pages/${created.id}`, {
      slug,
      isPublished: true,
    });
    const html = await (await request.get(`/p/${slug}`)).text();
    expect(html).not.toContain('<script>window.__pwned');
    expect(html).toContain('&lt;script&gt;window.__pwned');

    await page.goto(`/p/${slug}`);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned),
    ).toBeUndefined();
    await ann.api.deletePage(created.id);
  });
});
