import type { INestApplication } from '@nestjs/common';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import request from 'supertest';
import { env } from '../src/env.js';
import { bearer } from './auth-helpers.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

const NOTE = Buffer.from('meeting notes');

describe('Task board: on hold, comments and task files', () => {
  let ctx: TestApp;
  let app: INestApplication;
  let tok: Record<'owner' | 'admin' | 'member' | 'outsider', string>;
  let owner: { id: string };
  let wsA: { id: string };
  let wsB: { id: string };

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
  });
  afterAll(async () => {
    await app.close();
    rmSync(env.uploadDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    rmSync(env.uploadDir, { recursive: true, force: true });
    const make = (name: string) =>
      ctx.prisma.user.create({ data: { email: `${name}@example.com`, name } });
    const [ownerUser, admin, member, outsider] = await Promise.all([
      make('owner'),
      make('admin'),
      make('member'),
      make('outsider'),
    ]);
    owner = ownerUser;
    wsA = await ctx.prisma.workspace.create({
      data: {
        name: 'Alpha',
        slug: 'alpha',
        memberships: {
          create: [
            { userId: ownerUser.id, role: 'OWNER' },
            { userId: admin.id, role: 'ADMIN' },
            { userId: member.id, role: 'MEMBER' },
          ],
        },
      },
    });
    wsB = await ctx.prisma.workspace.create({
      data: { name: 'Beta', slug: 'beta', memberships: { create: { userId: outsider.id } } },
    });
    tok = {
      owner: await bearer(app, ownerUser),
      admin: await bearer(app, admin),
      member: await bearer(app, member),
      outsider: await bearer(app, outsider),
    };
  });

  const as = (who: keyof typeof tok) => {
    const agent = request(app.getHttpServer());
    const auth = tok[who];
    return {
      get: (url: string) => agent.get(url).set('Authorization', auth),
      post: (url: string) => agent.post(url).set('Authorization', auth),
      patch: (url: string) => agent.patch(url).set('Authorization', auth),
      delete: (url: string) => agent.delete(url).set('Authorization', auth),
    };
  };
  const tasks = () => `/api/workspaces/${wsA.id}/tasks`;
  const newTask = async (title = 'Write report') =>
    (await as('owner').post(tasks()).send({ title }).expect(201)).body as { id: string };
  const storedFiles = () => (existsSync(env.uploadDir) ? readdirSync(env.uploadDir) : []);

  it('puts a task on hold without completing it', async () => {
    const task = await newTask();
    const held = await as('member')
      .patch(`${tasks()}/${task.id}`)
      .send({ status: 'ON_HOLD' })
      .expect(200);
    expect(held.body).toMatchObject({ status: 'ON_HOLD', completedAt: null });
    const list = await as('member').get(`${tasks()}?status=ON_HOLD`).expect(200);
    expect(list.body.items.map((t: { id: string }) => t.id)).toEqual([task.id]);
  });

  it('keeps a conversation under a task and counts it on the card', async () => {
    const task = await newTask();
    const comments = `${tasks()}/${task.id}/comments`;

    const first = await as('owner')
      .post(comments)
      .send({ body: '  Started the draft  ' })
      .expect(201);
    expect(first.body).toMatchObject({
      body: 'Started the draft',
      author: { id: owner.id, name: 'owner' },
    });
    await as('member').post(comments).send({ body: 'Send it to me when ready' }).expect(201);
    await as('member').post(comments).send({ body: '   ' }).expect(400);

    const list = await as('member').get(comments).expect(200);
    expect(list.body.map((c: { body: string }) => c.body)).toEqual([
      'Started the draft',
      'Send it to me when ready',
    ]);
    const card = await as('member').get(`${tasks()}/${task.id}`).expect(200);
    expect(card.body).toMatchObject({ commentCount: 2, attachmentCount: 0 });
    expect(card.body._count).toBeUndefined();
  });

  it('lets only the author edit, and the author or an admin delete', async () => {
    const task = await newTask();
    const comments = `${tasks()}/${task.id}/comments`;
    const mine = (await as('member').post(comments).send({ body: 'mine' }).expect(201)).body;
    const other = (await as('member').post(comments).send({ body: 'other' }).expect(201)).body;

    await as('owner').patch(`${comments}/${mine.id}`).send({ body: 'hijacked' }).expect(403);
    const edited = await as('member')
      .patch(`${comments}/${mine.id}`)
      .send({ body: 'mine, edited' })
      .expect(200);
    expect(edited.body.body).toBe('mine, edited');

    const third = (await as('owner').post(comments).send({ body: 'owner' }).expect(201)).body;
    await as('member').delete(`${comments}/${third.id}`).expect(403);
    await as('member').delete(`${comments}/${mine.id}`).expect(204);
    await as('admin').delete(`${comments}/${other.id}`).expect(204);
    expect((await as('member').get(comments).expect(200)).body).toHaveLength(1);
  });

  it('hides comments from other workspaces', async () => {
    const task = await newTask();
    const comment = (
      await as('owner').post(`${tasks()}/${task.id}/comments`).send({ body: 'secret' }).expect(201)
    ).body;
    await as('outsider').get(`${tasks()}/${task.id}/comments`).expect(404);
    const foreign = `/api/workspaces/${wsB.id}/tasks/${task.id}/comments`;
    await as('outsider').get(foreign).expect(404);
    await as('outsider').post(foreign).send({ body: 'hi' }).expect(404);
    await as('outsider').delete(`${foreign}/${comment.id}`).expect(404);
  });

  it('attaches files to a task and removes them with it', async () => {
    const task = await newTask();
    const files = `/api/workspaces/${wsA.id}/attachments`;
    const upload = await as('member')
      .post(files)
      .field('taskId', task.id)
      .attach('file', NOTE, { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(201);
    expect(upload.body).toMatchObject({ taskId: task.id, filename: 'notes.txt' });
    await as('member')
      .post(files)
      .attach('file', NOTE, { filename: 'loose.txt', contentType: 'text/plain' })
      .expect(201);

    const list = await as('member').get(`${files}?taskId=${task.id}`).expect(200);
    expect(list.body.items.map((f: { filename: string }) => f.filename)).toEqual(['notes.txt']);
    expect((await as('member').get(`${tasks()}/${task.id}`)).body.attachmentCount).toBe(1);
    expect(storedFiles()).toHaveLength(2);

    await as('owner').delete(`${tasks()}/${task.id}`).expect(204);
    expect(await ctx.prisma.attachment.count()).toBe(1);
    expect(storedFiles()).toHaveLength(1);
  });

  it('rejects a task from another workspace as a file target', async () => {
    const foreignTask = (
      await as('outsider')
        .post(`/api/workspaces/${wsB.id}/tasks`)
        .send({ title: 'theirs' })
        .expect(201)
    ).body;
    await as('member')
      .post(`/api/workspaces/${wsA.id}/attachments`)
      .field('taskId', foreignTask.id)
      .attach('file', NOTE, { filename: 'x.txt', contentType: 'text/plain' })
      .expect(400);
    expect(storedFiles()).toHaveLength(0);
  });

  it('lists members without private user fields', async () => {
    await ctx.prisma.user.update({
      where: { id: owner.id },
      data: { widgetTokenHash: 'secret-hash', googleId: 'google-sub' },
    });
    const res = await as('member').get(`/api/workspaces/${wsA.id}/members`).expect(200);
    expect(res.body).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toMatch(/widgetTokenHash|secret-hash|googleId/);
    expect(res.body[0].user).toMatchObject({ name: expect.any(String), email: expect.any(String) });
  });
});
