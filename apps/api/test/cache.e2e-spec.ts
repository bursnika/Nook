import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CACHE_DRIVER, type CacheDriver } from '../src/cache/cache.driver.js';
import { CacheService } from '../src/cache/cache.service.js';
import { encryptToken } from '../src/google-calendar/token-crypto.js';
import { bearer } from './auth-helpers.js';
import { createTestApp, resetDb, seedWorkspace, type TestApp } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

describe('List caching', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await app.get(CacheService).deleteByPrefix('');
  });

  const http = () => request(app.getHttpServer());
  const ws = (workspaceId: string) => `/api/workspaces/${workspaceId}`;
  const cacheHeader = (res: { headers: Record<string, unknown> }) => res.headers['x-cache'];

  async function newTask(workspaceId: string, title: string, extra: object = {}) {
    return (
      await http()
        .post(`${ws(workspaceId)}/tasks`)
        .send({ title, ...extra })
        .expect(201)
    ).body;
  }
  const titles = (res: { body: { items: { title: string }[] } }) =>
    res.body.items.map((i) => i.title);

  it('uses the in-memory driver when REDIS_URL is not set', () => {
    expect(app.get(CacheService).driverName).toBe('memory');
  });

  describe('tasks', () => {
    it('misses first, hits after, with an identical body', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      await newTask(workspace.id, 'Write report');

      const first = await http()
        .get(`${ws(workspace.id)}/tasks`)
        .expect(200);
      const second = await http()
        .get(`${ws(workspace.id)}/tasks`)
        .expect(200);
      expect(cacheHeader(first)).toBe('MISS');
      expect(cacheHeader(second)).toBe('HIT');
      expect(second.body).toEqual(first.body);
      expect(titles(second)).toEqual(['Write report']);
    });

    it('is cleared by creating, updating and deleting a task', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const url = `${ws(workspace.id)}/tasks`;
      const read = async () => {
        await http().get(url).expect(200); // fill
        const hit = await http().get(url).expect(200);
        expect(cacheHeader(hit)).toBe('HIT');
      };

      await read();
      const task = await newTask(workspace.id, 'First');
      const afterCreate = await http().get(url).expect(200);
      expect(cacheHeader(afterCreate)).toBe('MISS');
      expect(titles(afterCreate)).toEqual(['First']);

      await read();
      await http()
        .patch(`${url}/${task.id}`)
        .send({ title: 'Renamed', status: 'DONE' })
        .expect(200);
      const afterUpdate = await http().get(url).expect(200);
      expect(cacheHeader(afterUpdate)).toBe('MISS');
      expect(afterUpdate.body.items[0]).toMatchObject({ title: 'Renamed', status: 'DONE' });

      await read();
      await http().delete(`${url}/${task.id}`).expect(204);
      const afterDelete = await http().get(url).expect(200);
      expect(cacheHeader(afterDelete)).toBe('MISS');
      expect(afterDelete.body.items).toEqual([]);
    });

    it('keeps a separate entry per query, whatever the order or the defaults spelt out', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      await newTask(workspace.id, 'Alpha', { priority: 'HIGH' });
      await newTask(workspace.id, 'Beta');
      const url = `${ws(workspace.id)}/tasks`;

      const high = await http().get(`${url}?priority=HIGH&q=alp`).expect(200);
      expect(cacheHeader(high)).toBe('MISS');
      expect(cacheHeader(await http().get(`${url}?q=alp&priority=HIGH`))).toBe('HIT');
      expect(cacheHeader(await http().get(`${url}?q=alp&priority=HIGH&skip=0&limit=20`))).toBe(
        'HIT',
      );

      const all = await http().get(url).expect(200);
      expect(cacheHeader(all)).toBe('MISS'); // a different query is not served the filtered list
      expect(titles(all)).toHaveLength(2);
      expect(titles(high)).toEqual(['Alpha']);
    });

    it("builds nextLink per request instead of caching one request's host", async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      await newTask(workspace.id, 'One');
      await newTask(workspace.id, 'Two');
      const url = `${ws(workspace.id)}/tasks?limit=1`;

      const a = await http().get(url).set('Host', 'a.example.test');
      const b = await http().get(url).set('Host', 'b.example.test');
      expect(cacheHeader(b)).toBe('HIT');
      expect(a.body.nextLink).toContain('a.example.test');
      expect(b.body.nextLink).toContain('b.example.test');
    });

    it('does not cache errors or invalid queries', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const bad = await http()
        .get(`${ws(workspace.id)}/tasks?limit=1000`)
        .expect(400);
      expect(cacheHeader(bad)).toBeUndefined();
      await http()
        .get(`${ws(workspace.id)}/tasks/not-a-uuid`)
        .expect(400);
    });

    it('leaves single-item reads alone', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const task = await newTask(workspace.id, 'Solo');
      const res = await http()
        .get(`${ws(workspace.id)}/tasks/${task.id}`)
        .expect(200);
      expect(cacheHeader(res)).toBeUndefined();
    });
  });

  describe('pages', () => {
    it('is cleared by page writes, block writes and Markdown imports', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const url = `${ws(workspace.id)}/pages`;
      const fresh = async () => {
        const res = await http().get(url).expect(200);
        expect(cacheHeader(res)).toBe('MISS');
        expect(cacheHeader(await http().get(url))).toBe('HIT');
        return res;
      };

      const page = (await http().post(url).send({ title: 'Plan' }).expect(201)).body;
      expect(titles(await fresh())).toEqual(['Plan']);

      await http()
        .post(`${url}/${page.id}/blocks`)
        .send({ content: { text: 'hi' } })
        .expect(201);
      const withBlock = await fresh();
      expect(withBlock.body.items[0]._count.blocks).toBe(1); // the count shown in the list is current

      await http().patch(`${url}/${page.id}`).send({ title: 'Plan v2' }).expect(200);
      expect(titles(await fresh())).toEqual(['Plan v2']);

      await http().post(`${url}/import`).send({ markdown: '# Imported' }).expect(201);
      expect(titles(await fresh()).sort()).toEqual(['Imported', 'Plan v2']);

      await http().delete(`${url}/${page.id}`).expect(204);
      expect(titles(await fresh())).toEqual(['Imported']);
    });

    it('is cleared when the editor syncs block operations', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const url = `${ws(workspace.id)}/pages`;
      const page = (await http().post(url).send({ title: 'Live' }).expect(201)).body;
      await http().get(url).expect(200);
      expect(cacheHeader(await http().get(url))).toBe('HIT');

      const sync = await http()
        .post(`${url}/${page.id}/sync/ops`)
        .send({
          clientId: 'tab-1',
          ops: [
            {
              type: 'insert',
              id: '018f0000-0000-7000-8000-000000000001',
              blockType: 'PARAGRAPH',
              content: { text: 'typed' },
            },
          ],
        });
      expect(sync.status).toBeLessThan(300);
      const after = await http().get(url).expect(200);
      expect(cacheHeader(after)).toBe('MISS');
      expect(after.body.items[0]._count.blocks).toBe(1);
    });
  });

  describe('events', () => {
    it('is cleared by event writes', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const url = `${ws(workspace.id)}/events`;
      const starts = new Date(Date.now() + DAY);
      const body = { title: 'Lecture', startsAt: starts, endsAt: new Date(+starts + 3600_000) };

      await http().get(url).expect(200);
      expect(cacheHeader(await http().get(url))).toBe('HIT');

      const event = (await http().post(url).send(body).expect(201)).body;
      const afterCreate = await http().get(url).expect(200);
      expect(cacheHeader(afterCreate)).toBe('MISS');
      expect(titles(afterCreate)).toEqual(['Lecture']);

      await http().get(url).expect(200);
      await http().patch(`${url}/${event.id}`).send({ title: 'Seminar' }).expect(200);
      expect(titles(await http().get(url))).toEqual(['Seminar']);

      await http().get(url).expect(200);
      await http().delete(`${url}/${event.id}`).expect(204);
      const afterDelete = await http().get(url).expect(200);
      expect(cacheHeader(afterDelete)).toBe('MISS');
      expect(afterDelete.body.items).toEqual([]);
    });

    it('is cleared by a Google sync, for events and for Google Tasks', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const admin = await ctx.prisma.user.upsert({
        where: { email: 'platform-admin@example.com' },
        update: {},
        create: { email: 'platform-admin@example.com', name: 'Platform Admin' },
      });
      await ctx.prisma.googleConnection.create({
        data: {
          userId: admin.id,
          refreshTokenEnc: encryptToken('refresh-1'),
          scope:
            'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly',
        },
      });
      const eventsUrl = `${ws(workspace.id)}/events`;
      const tasksUrl = `${ws(workspace.id)}/tasks`;
      await http().get(eventsUrl).expect(200);
      await http().get(tasksUrl).expect(200);
      expect(cacheHeader(await http().get(eventsUrl))).toBe('HIT');
      expect(cacheHeader(await http().get(tasksUrl))).toBe('HIT');

      const start = new Date(Date.now() + DAY);
      ctx.googleCalendar.calendars.set('refresh-1', [
        {
          id: 'primary/e1',
          calendarId: 'primary',
          calendarName: 'Personal',
          title: 'From Google',
          startsAt: start,
          endsAt: new Date(+start + 3600_000),
          allDay: false,
          editable: true,
          recurring: false,
        },
      ]);
      ctx.googleCalendar.tasks.set('refresh-1', [
        { id: 'list/t1', title: 'Google task', completed: false },
      ]);
      await http()
        .post(`${ws(workspace.id)}/google-calendar/sync`)
        .expect(200);

      const events = await http().get(eventsUrl).expect(200);
      expect(cacheHeader(events)).toBe('MISS');
      expect(titles(events)).toEqual(['From Google']);
      const tasks = await http().get(tasksUrl).expect(200);
      expect(cacheHeader(tasks)).toBe('MISS');
      expect(titles(tasks)).toEqual(['Google task']);
    });
  });

  describe('overview and calendar', () => {
    it('caches the summary and clears it with the data', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const url = `${ws(workspace.id)}/overview`;
      const first = await http().get(url).expect(200);
      expect(cacheHeader(first)).toBe('MISS');
      expect(first.body.openTotal).toBe(0);
      expect(cacheHeader(await http().get(url))).toBe('HIT');

      await newTask(workspace.id, 'Due', { dueDate: new Date(Date.now() + 3600_000) });
      const after = await http().get(url).expect(200);
      expect(cacheHeader(after)).toBe('MISS');
      expect(after.body.openTotal).toBe(1);
      expect(after.body.dueSoon).toHaveLength(1);
    });

    it('never caches the calendar: it depends on who is looking', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 7 * DAY).toISOString();
      const url = `${ws(workspace.id)}/calendar?from=${from}&to=${to}`;
      const a = await http().get(url).expect(200);
      const b = await http().get(url).expect(200);
      expect(cacheHeader(a)).toBeUndefined();
      expect(cacheHeader(b)).toBeUndefined();
    });
  });

  describe('when the cache driver breaks', () => {
    it('serves fresh data and never errors', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const driver = app.get<CacheDriver>(CACHE_DRIVER);
      const down = () => Promise.reject(new Error('Redis connection lost'));
      vi.spyOn(driver, 'get').mockImplementation(down);
      vi.spyOn(driver, 'set').mockImplementation(down);
      vi.spyOn(driver, 'deleteByPrefix').mockImplementation(down);
      try {
        const url = `${ws(workspace.id)}/tasks`;
        const empty = await http().get(url).expect(200);
        expect(cacheHeader(empty)).toBe('MISS');
        await newTask(workspace.id, 'Still works');
        const after = await http().get(url).expect(200);
        expect(cacheHeader(after)).toBe('MISS');
        expect(titles(after)).toEqual(['Still works']);
        await http()
          .get(`${ws(workspace.id)}/pages`)
          .expect(200);
        await http()
          .get(`${ws(workspace.id)}/overview`)
          .expect(200);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});

describe('List caching across tenants and viewers', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await app.get(CacheService).deleteByPrefix('');
  });

  const http = () => request(app.getHttpServer());
  const get = (path: string, token: string) => http().get(path).set('Authorization', token);

  it("never serves one workspace's cached lists to another", async () => {
    const a = await seedWorkspace(ctx.prisma, 'a');
    const b = await seedWorkspace(ctx.prisma, 'b');
    const tokenA = await bearer(app, a.user);
    const tokenB = await bearer(app, b.user);
    await ctx.prisma.task.create({ data: { title: 'A secret', workspaceId: a.workspace.id } });
    await ctx.prisma.task.create({ data: { title: 'B secret', workspaceId: b.workspace.id } });
    for (const [owner, other] of [
      [a, b],
      [b, a],
    ] as const) {
      await ctx.prisma.page.create({
        data: {
          title: `${owner.workspace.slug} page`,
          workspaceId: owner.workspace.id,
          authorId: owner.user.id,
        },
      });
      void other;
    }

    for (const kind of ['tasks', 'pages', 'events', 'overview']) {
      // same path shape and query, different tenants
      const mineA1 = await get(`/api/workspaces/${a.workspace.id}/${kind}`, tokenA).expect(200);
      const mineA2 = await get(`/api/workspaces/${a.workspace.id}/${kind}`, tokenA).expect(200);
      expect(mineA1.headers['x-cache']).toBe('MISS');
      expect(mineA2.headers['x-cache']).toBe('HIT');
      const mineB = await get(`/api/workspaces/${b.workspace.id}/${kind}`, tokenB).expect(200);
      expect(mineB.headers['x-cache']).toBe('MISS'); // B starts with its own empty entry
      expect(JSON.stringify(mineB.body)).not.toContain('A secret');
      expect(JSON.stringify(mineB.body)).not.toContain(a.workspace.slug);
      expect(JSON.stringify(mineA2.body)).not.toContain('B secret');

      // A's entry is warm, yet B's token cannot read it through A's url: the guard answers first
      const stolen = await get(`/api/workspaces/${a.workspace.id}/${kind}`, tokenB).expect(404);
      expect(stolen.headers['x-cache']).toBeUndefined();
      expect(JSON.stringify(stolen.body)).not.toContain('A secret');
      await http().get(`/api/workspaces/${a.workspace.id}/${kind}`).expect(401);
    }
  });

  it("a write in one workspace leaves the other's cache warm", async () => {
    const a = await seedWorkspace(ctx.prisma, 'a');
    const b = await seedWorkspace(ctx.prisma, 'b');
    const tokenA = await bearer(app, a.user);
    const tokenB = await bearer(app, b.user);
    await get(`/api/workspaces/${b.workspace.id}/tasks`, tokenB).expect(200);

    await http()
      .post(`/api/workspaces/${a.workspace.id}/tasks`)
      .set('Authorization', tokenA)
      .send({ title: 'x' })
      .expect(201);
    const res = await get(`/api/workspaces/${b.workspace.id}/tasks`, tokenB).expect(200);
    expect(res.headers['x-cache']).toBe('HIT');
  });

  it('gives each member their own calendar rights, because the calendar is not cached', async () => {
    const { user: owner, workspace } = await seedWorkspace(ctx.prisma, 'shared');
    const colleague = await ctx.prisma.user.create({
      data: { email: 'colleague@example.com', name: 'Colleague' },
    });
    await ctx.prisma.membership.create({
      data: { userId: colleague.id, workspaceId: workspace.id, role: 'MEMBER' },
    });
    await ctx.prisma.googleConnection.create({
      data: { userId: owner.id, refreshTokenEnc: encryptToken('rt'), scope: 'calendar' },
    });
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * DAY).toISOString();
    const url = `/api/workspaces/${workspace.id}/calendar?from=${from}&to=${to}`;

    const ownerView = await get(url, await bearer(app, owner)).expect(200);
    const colleagueView = await get(url, await bearer(app, colleague)).expect(200);
    expect(ownerView.body.google.connected).toBe(true);
    expect(colleagueView.body.google.connected).toBe(false);
    expect(ownerView.headers['x-cache']).toBeUndefined();
    expect(colleagueView.headers['x-cache']).toBeUndefined();

    // the lists, which are the same for every member, are shared between them
    const list = `/api/workspaces/${workspace.id}/tasks`;
    expect((await get(list, await bearer(app, owner)).expect(200)).headers['x-cache']).toBe('MISS');
    expect((await get(list, await bearer(app, colleague)).expect(200)).headers['x-cache']).toBe(
      'HIT',
    );
  });
});
