import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb, seedWorkspace, type TestApp } from './helpers.js';

describe('Pages & blocks API', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(() => resetDb(ctx.prisma));

  const http = () => request(app.getHttpServer());

  async function createPage(workspaceId: string, extra: object = {}) {
    const res = await http()
      .post(`/api/workspaces/${workspaceId}/pages`)
      .send({ title: 'Plan', ...extra })
      .expect(201);
    return res.body;
  }

  it('creates a page and returns it with its blocks', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const page = await createPage(workspace.id, { icon: '♡' });
    expect(page).toMatchObject({ title: 'Plan', workspaceId: workspace.id, isPublished: false });

    await http()
      .post(`/api/workspaces/${workspace.id}/pages/${page.id}/blocks`)
      .send({ type: 'HEADING_1', content: { text: 'Hi' } })
      .expect(201);
    await http()
      .post(`/api/workspaces/${workspace.id}/pages/${page.id}/blocks`)
      .send({ content: { text: 'World' } })
      .expect(201);

    const full = await http().get(`/api/workspaces/${workspace.id}/pages/${page.id}`).expect(200);
    expect(full.body.blocks.map((b: { content: { text: string } }) => b.content.text)).toEqual([
      'Hi',
      'World',
    ]);
    expect(full.body.blocks[0].position).toBeLessThan(full.body.blocks[1].position);
  });

  it('records the signed-in user as the author and ignores a client-supplied one', async () => {
    const a = await seedWorkspace(ctx.prisma, 'a');
    const page = await createPage(a.workspace.id);
    const admin = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'platform-admin@example.com' },
    });
    expect(page.authorId).toBe(admin.id);
    await http()
      .post(`/api/workspaces/${a.workspace.id}/pages`)
      .send({ title: 'x', authorId: a.user.id })
      .expect(400); // not an accepted field any more
  });

  it('isolates workspaces: a page is invisible and immutable from another workspace', async () => {
    const a = await seedWorkspace(ctx.prisma, 'a');
    const b = await seedWorkspace(ctx.prisma, 'b');
    const page = await createPage(a.workspace.id);

    await http().get(`/api/workspaces/${b.workspace.id}/pages/${page.id}`).expect(404);
    await http()
      .patch(`/api/workspaces/${b.workspace.id}/pages/${page.id}`)
      .send({ title: 'hacked' })
      .expect(404);
    await http().delete(`/api/workspaces/${b.workspace.id}/pages/${page.id}`).expect(404);
    await http()
      .post(`/api/workspaces/${b.workspace.id}/pages/${page.id}/blocks`)
      .send({})
      .expect(404);

    const list = await http().get(`/api/workspaces/${b.workspace.id}/pages`).expect(200);
    expect(list.body.total).toBe(0);
    const own = await http().get(`/api/workspaces/${a.workspace.id}/pages/${page.id}`).expect(200);
    expect(own.body.title).toBe('Plan');
  });

  it('builds a page tree, filters by parent and rejects cycles', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const root = await createPage(workspace.id, { title: 'Root' });
    const child = await createPage(workspace.id, { title: 'Child', parentId: root.id });
    const grandchild = await createPage(workspace.id, {
      title: 'Grand',
      parentId: child.id,
    });

    const roots = await http()
      .get(`/api/workspaces/${workspace.id}/pages?parentId=root`)
      .expect(200);
    expect(roots.body.items.map((p: { title: string }) => p.title)).toEqual(['Root']);
    const kids = await http()
      .get(`/api/workspaces/${workspace.id}/pages?parentId=${root.id}`)
      .expect(200);
    expect(kids.body.items.map((p: { title: string }) => p.title)).toEqual(['Child']);

    await http()
      .patch(`/api/workspaces/${workspace.id}/pages/${root.id}`)
      .send({ parentId: grandchild.id })
      .expect(400);
    await http()
      .patch(`/api/workspaces/${workspace.id}/pages/${root.id}`)
      .send({ parentId: root.id })
      .expect(400);

    await http().delete(`/api/workspaces/${workspace.id}/pages/${root.id}`).expect(204);
    await http().get(`/api/workspaces/${workspace.id}/pages/${grandchild.id}`).expect(404);
  });

  it('requires a slug to publish and keeps slugs unique', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    await http()
      .post(`/api/workspaces/${workspace.id}/pages`)
      .send({ title: 'x', isPublished: true })
      .expect(400);

    const page = await createPage(workspace.id, { slug: 'my-page', isPublished: true });
    expect(page.isPublished).toBe(true);
    await http()
      .post(`/api/workspaces/${workspace.id}/pages`)
      .send({ title: 'y', slug: 'my-page' })
      .expect(409);
  });

  it('validates coverUrl and searches by title', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    await http()
      .post(`/api/workspaces/${workspace.id}/pages`)
      .send({ title: 'x', coverUrl: 'javascript:alert(1)' })
      .expect(400);
    await createPage(workspace.id, { title: 'Lab report', coverUrl: '/uploads/a.png' });
    await createPage(workspace.id, { title: 'Groceries' });
    const found = await http().get(`/api/workspaces/${workspace.id}/pages?q=lab`).expect(200);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0].coverUrl).toBe('/uploads/a.png');
  });

  it('updates, reorders and deletes blocks', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const page = await createPage(workspace.id);
    const base = `/api/workspaces/${workspace.id}/pages/${page.id}/blocks`;
    const first = (
      await http()
        .post(base)
        .send({ content: { text: 'one' } })
        .expect(201)
    ).body;
    const second = (
      await http()
        .post(base)
        .send({ content: { text: 'two' } })
        .expect(201)
    ).body;

    await http()
      .patch(`${base}/${second.id}`)
      .send({ position: first.position - 1, type: 'QUOTE' })
      .expect(200);
    const list = await http().get(base).expect(200);
    expect(list.body.map((b: { content: { text: string } }) => b.content.text)).toEqual([
      'two',
      'one',
    ]);
    expect(list.body[0].type).toBe('QUOTE');

    await http().post(base).send({ type: 'NOPE' }).expect(400);
    await http().delete(`${base}/${first.id}`).expect(204);
    await http().delete(`${base}/${first.id}`).expect(404);
  });

  it('protects the last owner of a workspace', async () => {
    const { user, workspace } = await seedWorkspace(ctx.prisma);
    const members = await http().get(`/api/workspaces/${workspace.id}/members`).expect(200);
    const ownerMembership = members.body[0];
    await http()
      .patch(`/api/workspaces/${workspace.id}/members/${ownerMembership.id}`)
      .send({ role: 'MEMBER' })
      .expect(409);
    await http()
      .delete(`/api/workspaces/${workspace.id}/members/${ownerMembership.id}`)
      .expect(409);

    const other = await ctx.prisma.user.create({
      data: { email: 'second@example.com', name: 'Second' },
    });
    const added = await http()
      .post(`/api/workspaces/${workspace.id}/members`)
      .send({ userId: other.id })
      .expect(201);
    expect(added.body.role).toBe('MEMBER');
    await http()
      .post(`/api/workspaces/${workspace.id}/members`)
      .send({ userId: other.id })
      .expect(409);
    await http()
      .patch(`/api/workspaces/${workspace.id}/members/${added.body.id}`)
      .send({ role: 'OWNER' })
      .expect(200);
    await http()
      .delete(`/api/workspaces/${workspace.id}/members/${ownerMembership.id}`)
      .expect(204);
    expect(user.id).toBeDefined();
  });
});
