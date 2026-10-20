import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb, seedWorkspace, type TestApp } from './helpers.js';

describe('Public landing pages, SEO', () => {
  let ctx: TestApp;
  let app: INestApplication;
  let workspaceId: string;
  let authorId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const { workspace } = await seedWorkspace(ctx.prisma);
    workspaceId = workspace.id;
    const author = await ctx.prisma.user.create({
      data: { email: 'author@example.com', name: 'Ann <Author>' },
    });
    authorId = author.id;
  });

  const http = () => request(app.getHttpServer());
  const publish = (slug: string, extra: object = {}) =>
    ctx.prisma.page.create({
      data: {
        title: 'Trip & plans',
        slug,
        isPublished: true,
        workspaceId,
        authorId,
        coverUrl: '/uploads/cover.png',
        blocks: {
          create: [
            { type: 'HEADING_1', content: { text: 'Day one' }, position: 1 },
            { type: 'PARAGRAPH', content: { text: 'Visit <b>museums</b>' }, position: 2 },
            { type: 'BULLETED_LIST', content: { text: 'tickets' }, position: 3 },
          ],
        },
        ...extra,
      },
    });

  it('serves a published page to anyone, without signing in', async () => {
    await publish('trip');
    const res = await http().get('/p/trip').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<h2>Day one</h2>');
    expect(res.text).toContain('<li>tickets</li>');
    expect(res.text).toContain('mailto:author@example.com');
  });

  it('escapes user text everywhere', async () => {
    await publish('trip');
    const res = await http().get('/p/trip').expect(200);
    expect(res.text).toContain('Visit &lt;b&gt;museums&lt;/b&gt;');
    expect(res.text).not.toContain('<b>museums</b>');
    expect(res.text).toContain('Ann &lt;Author&gt;');
  });

  it('has the SEO tags: title, description, canonical, Open Graph, JSON-LD', async () => {
    await publish('trip');
    const { text } = await http().get('/p/trip').expect(200);
    expect(text).toContain('<title>Trip &amp; plans · Nook</title>');
    expect(text).toMatch(/<meta name="description" content="Day one Visit/);
    expect(text).toContain('<link rel="canonical" href="http://localhost:3000/p/trip"');
    expect(text).toContain('property="og:title" content="Trip &amp; plans"');
    expect(text).toContain('property="og:image" content="http://localhost:3000/uploads/cover.png"');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(text)![1]);
    expect(ld).toMatchObject({
      '@type': 'Article',
      headline: 'Trip & plans',
      author: { '@type': 'Person', name: 'Ann <Author>' },
    });
  });

  it('hides private pages and unknown slugs', async () => {
    await publish('draft', { isPublished: false });
    await http().get('/p/draft').expect(404);
    await http().get('/p/missing').expect(404);
  });

  it('lists only published pages in sitemap.xml', async () => {
    await publish('trip');
    await publish('hidden', { isPublished: false });
    const res = await http().get('/sitemap.xml').expect(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.text).toContain('<loc>http://localhost:3000/p/trip</loc>');
    expect(res.text).not.toContain('hidden');
  });

  it('has robots.txt that points to the sitemap and hides the app', async () => {
    const res = await http().get('/robots.txt').expect(200);
    expect(res.text).toContain('Sitemap: http://localhost:3000/sitemap.xml');
    expect(res.text).toContain('Disallow: /admin');
    expect(res.text).toContain('Disallow: /api');
  });
});
