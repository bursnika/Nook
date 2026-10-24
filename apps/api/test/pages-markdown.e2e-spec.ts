import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer } from './auth-helpers.js';
import { createTestApp, resetDb, seedWorkspace, type TestApp } from './helpers.js';

const SAMPLE = [
  '# Лабораторна №1',
  '',
  'Intro paragraph',
  'on two lines',
  '',
  '## Plan',
  '',
  '- one',
  '- two',
  '',
  '1. first',
  '2. second',
  '',
  '- [ ] open',
  '- [x] done',
  '',
  '> quote',
  '',
  '---',
  '',
  '```ts',
  'const a = 1;',
  '',
  '# not a heading',
  '```',
  '',
  'The end',
  '',
].join('\n');

describe('Markdown import and export', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(() => resetDb(ctx.prisma));

  const http = () => request(app.getHttpServer());
  const importUrl = (workspaceId: string) => `/api/workspaces/${workspaceId}/pages/import`;
  const exportUrl = (workspaceId: string, pageId: string) =>
    `/api/workspaces/${workspaceId}/pages/${pageId}/export.md`;

  it('imports Markdown as a page with typed blocks, 1024 apart', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const res = await http().post(importUrl(workspace.id)).send({ markdown: SAMPLE }).expect(201);

    expect(res.body).toMatchObject({ title: 'Лабораторна №1', workspaceId: workspace.id });
    const blocks = res.body.blocks as {
      type: string;
      content: Record<string, unknown>;
      position: number;
    }[];
    expect(blocks.map((b) => b.type)).toEqual([
      'PARAGRAPH',
      'HEADING_2',
      'BULLETED_LIST',
      'BULLETED_LIST',
      'NUMBERED_LIST',
      'NUMBERED_LIST',
      'TODO',
      'TODO',
      'QUOTE',
      'DIVIDER',
      'CODE',
      'PARAGRAPH',
    ]);
    expect(blocks.map((b) => b.position)).toEqual(blocks.map((_, i) => (i + 1) * 1024));
    expect(blocks[0].content).toEqual({ text: 'Intro paragraph\non two lines' });
    expect(blocks[7].content).toEqual({ text: 'done', checked: true });
    expect(blocks[10].content).toEqual({ text: 'const a = 1;\n\n# not a heading', language: 'ts' });

    const admin = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'platform-admin@example.com' },
    });
    expect(res.body.authorId).toBe(admin.id);
  });

  it('exports a page as a .md download', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const page = (await http().post(importUrl(workspace.id)).send({ markdown: SAMPLE })).body;

    const res = await http().get(exportUrl(workspace.id, page.id)).expect(200);
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="laboratorna-no1.md"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.text).toBe(SAMPLE);
  });

  it('exports what the editor created through the blocks API, numbering each run from 1', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const page = (
      await http().post(`/api/workspaces/${workspace.id}/pages`).send({ title: 'Shopping list' })
    ).body;
    const add = (type: string, content: object) =>
      http()
        .post(`/api/workspaces/${workspace.id}/pages/${page.id}/blocks`)
        .send({ type, content })
        .expect(201);
    await add('HEADING_2', { text: 'Fruit' });
    await add('NUMBERED_LIST', { text: 'apples' });
    await add('NUMBERED_LIST', { text: 'pears' });
    await add('PARAGRAPH', { text: 'and then' });
    await add('NUMBERED_LIST', { text: 'plums' });
    await add('TODO', { text: 'pay', checked: true });

    const res = await http().get(exportUrl(workspace.id, page.id)).expect(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="shopping-list.md"');
    expect(res.text).toBe(
      '# Shopping list\n\n## Fruit\n\n1. apples\n2. pears\n\nand then\n\n1. plums\n\n- [x] pay\n',
    );
  });

  it('round trip: exporting an imported page and importing that again gives the same file', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const messy = '#  Messy \n* star\n  + nested\n7. seven\n#### deep\n> a\nlazy\n```\nunclosed';
    const first = (await http().post(importUrl(workspace.id)).send({ markdown: messy }).expect(201))
      .body;
    const once = (await http().get(exportUrl(workspace.id, first.id))).text;
    const second = (await http().post(importUrl(workspace.id)).send({ markdown: once }).expect(201))
      .body;
    const twice = (await http().get(exportUrl(workspace.id, second.id))).text;
    expect(twice).toBe(once);
    expect(second.title).toBe(first.title);
  });

  it('an explicit title wins, and then a leading # line stays in the body', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const res = await http()
      .post(importUrl(workspace.id))
      .send({ markdown: '# Heading\n\ntext', title: 'My title' })
      .expect(201);
    expect(res.body.title).toBe('My title');
    expect(res.body.blocks.map((b: { type: string }) => b.type)).toEqual([
      'HEADING_1',
      'PARAGRAPH',
    ]);
  });

  it('falls back to "Untitled" and accepts empty or exotic Markdown', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const empty = await http().post(importUrl(workspace.id)).send({ markdown: '' }).expect(201);
    expect(empty.body).toMatchObject({ title: 'Untitled', blocks: [] });

    const exotic = await http()
      .post(importUrl(workspace.id))
      .send({ markdown: '| a | b |\n|---|---|\n![i](x.png)\n<b>html</b>' })
      .expect(201);
    expect(
      exotic.body.blocks.every(
        (b: { type: string }) => b.type === 'PARAGRAPH' || b.type === 'DIVIDER',
      ),
    ).toBe(true);
  });

  it('nests the page under a parent of the same workspace', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const parent = (await http().post(`/api/workspaces/${workspace.id}/pages`).send({ title: 'P' }))
      .body;
    const res = await http()
      .post(importUrl(workspace.id))
      .send({ markdown: '# Child', parentId: parent.id })
      .expect(201);
    expect(res.body.parentId).toBe(parent.id);
  });

  it('refuses a parent from another workspace and exports of foreign pages (tenant isolation)', async () => {
    const a = await seedWorkspace(ctx.prisma, 'a');
    const b = await seedWorkspace(ctx.prisma, 'b');
    const foreign = (
      await http().post(importUrl(b.workspace.id)).send({ markdown: '# Secret\n\nplans' })
    ).body;

    await http()
      .post(importUrl(a.workspace.id))
      .send({ markdown: '# Mine', parentId: foreign.id })
      .expect(400);
    expect(await ctx.prisma.page.count({ where: { workspaceId: a.workspace.id } })).toBe(0);

    // the page exists, but not in the workspace named in the url
    await http().get(exportUrl(a.workspace.id, foreign.id)).expect(404);
  });

  it('validates the body', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const url = importUrl(workspace.id);
    await http().post(url).send({}).expect(400);
    await http().post(url).send({ markdown: 5 }).expect(400);
    await http().post(url).send({ markdown: 'x', title: '' }).expect(400);
    await http()
      .post(url)
      .send({ markdown: 'x', title: 'y'.repeat(201) })
      .expect(400);
    await http().post(url).send({ markdown: 'x', parentId: 'nope' }).expect(400);
    await http().post(url).send({ markdown: 'x', extra: 1 }).expect(400);
  });

  it('accepts up to 1 MB of Markdown and refuses more', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const url = importUrl(workspace.id);
    const line = `${'x'.repeat(98)}\n\n`; // 100 bytes, one paragraph each
    const big = line.repeat(1_000_000 / line.length);
    expect(Buffer.byteLength(big)).toBeLessThanOrEqual(1_000_000);
    // more than the block cap, so this one is turned away for its block count, not its size
    await http().post(url).send({ markdown: big }).expect(400);

    const oneBlock = 'y'.repeat(1_000_000);
    const ok = await http().post(url).send({ markdown: oneBlock }).expect(201);
    expect(ok.body.blocks).toHaveLength(1);

    await http()
      .post(url)
      .send({ markdown: 'y'.repeat(1_000_001) })
      .expect(413);
    await http()
      .post(url)
      .send({ markdown: 'ж'.repeat(600_000) })
      .expect(413); // 1.2 MB in UTF-8
    // the request body itself is capped too
    await http()
      .post(url)
      .send({ markdown: 'y'.repeat(2_200_000) })
      .expect(413);
  });

  it('keeps the small JSON limit on every other route', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    await http()
      .post(`/api/workspaces/${workspace.id}/pages`)
      .send({ title: 'x', icon: 'y'.repeat(150_000) })
      .expect(413);
  });
});

describe('Markdown export with real sign-in', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(() => resetDb(ctx.prisma));

  it('lets members import and export, and hides the workspace from outsiders', async () => {
    const a = await seedWorkspace(ctx.prisma, 'a');
    const b = await seedWorkspace(ctx.prisma, 'b');
    const http = () => request(app.getHttpServer());
    const mine = await bearer(app, a.user);
    const theirs = await bearer(app, b.user);

    const page = await http()
      .post(`/api/workspaces/${a.workspace.id}/pages/import`)
      .set('Authorization', mine)
      .send({ markdown: '# Mine\n\nprivate' })
      .expect(201);
    expect(page.body.authorId).toBe(a.user.id);

    const url = `/api/workspaces/${a.workspace.id}/pages/${page.body.id}/export.md`;
    await http().get(url).set('Authorization', mine).expect(200);
    await http().get(url).set('Authorization', theirs).expect(404);
    await http().get(url).expect(401);
    await http()
      .post(`/api/workspaces/${a.workspace.id}/pages/import`)
      .set('Authorization', theirs)
      .send({ markdown: '# Intruder' })
      .expect(404);
  });
});
