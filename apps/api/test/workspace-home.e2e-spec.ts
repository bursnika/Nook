import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer } from './auth-helpers.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

const HOUR = 60 * 60 * 1000;

describe('Workspace home: overview, calendar and notes', () => {
  let ctx: TestApp;
  let app: INestApplication;
  let wsId: string;
  let otherWsId: string;
  let ownerId: string;
  let tok: { owner: string; outsider: string };

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const owner = await ctx.prisma.user.create({ data: { email: 'o@example.com', name: 'Owner' } });
    const outsider = await ctx.prisma.user.create({
      data: { email: 'x@example.com', name: 'Outsider' },
    });
    ownerId = owner.id;
    const ws = await ctx.prisma.workspace.create({
      data: {
        name: 'Home',
        slug: 'home',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const other = await ctx.prisma.workspace.create({
      data: {
        name: 'Other',
        slug: 'other',
        memberships: { create: { userId: outsider.id, role: 'OWNER' } },
      },
    });
    wsId = ws.id;
    otherWsId = other.id;
    tok = { owner: await bearer(app, owner), outsider: await bearer(app, outsider) };
  });

  const http = () => request(app.getHttpServer());
  const get = (url: string, token = tok.owner) =>
    http().get(url).set('Authorization', token).set('Accept', 'text/html,application/json');
  const inHours = (h: number) => new Date(Date.now() + h * HOUR);

  describe('GET /overview', () => {
    beforeEach(async () => {
      await ctx.prisma.task.createMany({
        data: [
          { workspaceId: wsId, title: 'overdue high', priority: 'HIGH', dueDate: inHours(-2) },
          { workspaceId: wsId, title: 'soon medium', dueDate: inHours(3) },
          { workspaceId: wsId, title: 'next week low', priority: 'LOW', dueDate: inHours(30) },
          { workspaceId: wsId, title: 'finished', status: 'DONE', dueDate: inHours(1) },
          { workspaceId: wsId, title: 'undated high', priority: 'HIGH' },
          { workspaceId: otherWsId, title: 'foreign', priority: 'HIGH', dueDate: inHours(1) },
        ],
      });
    });

    it('lists what is due within 24 hours, overdue first, without done or foreign tasks', async () => {
      const res = await get(`/api/workspaces/${wsId}/overview`).expect(200);
      expect(res.body.dueSoonHours).toBe(24);
      expect(
        res.body.dueSoon.map((t: { title: string; isOverdue: boolean }) => [t.title, t.isOverdue]),
      ).toEqual([
        ['overdue high', true],
        ['soon medium', false],
      ]);
    });

    it('lists timed events starting or running within 24 hours, not all-day, past or foreign ones', async () => {
      const event = (title: string, from: number, to: number, extra = {}) => ({
        workspaceId: wsId,
        title,
        startsAt: inHours(from),
        endsAt: inHours(to),
        ...extra,
      });
      await ctx.prisma.calendarEvent.createMany({
        data: [
          event('later today', 5, 6),
          event('running now', -1, 1),
          event('tomorrow evening', 30, 31),
          event('already over', -3, -2),
          event('holiday', 2, 20, { allDay: true }),
          { ...event('foreign', 2, 3), workspaceId: otherWsId },
        ],
      });
      const res = await get(`/api/workspaces/${wsId}/overview`).expect(200);
      expect(
        res.body.upcomingEvents.map((e: { title: string; isRunning: boolean }) => [
          e.title,
          e.isRunning,
        ]),
      ).toEqual([
        ['running now', true],
        ['later today', false],
      ]);
    });

    it('shows those events on the home page next to the tasks', async () => {
      await ctx.prisma.calendarEvent.create({
        data: {
          workspaceId: wsId,
          title: 'dentist visit',
          startsAt: inHours(4),
          endsAt: inHours(5),
        },
      });
      const page = await get(`/admin/workspaces/${wsId}`).expect(200);
      expect(page.text).toContain('dentist visit');
      expect(page.text).toContain('soon medium');
    });

    it('lists open high-priority tasks, undated ones last', async () => {
      const res = await get(`/api/workspaces/${wsId}/overview`).expect(200);
      expect(res.body.priority.map((t: { title: string }) => t.title)).toEqual([
        'overdue high',
        'undated high',
      ]);
    });

    it('lists open tasks and counts them', async () => {
      const res = await get(`/api/workspaces/${wsId}/overview`).expect(200);
      expect(res.body.openTasks.map((t: { title: string }) => t.title)).toEqual([
        'overdue high',
        'soon medium',
        'next week low',
        'undated high',
      ]);
      expect(res.body.openTotal).toBe(4);
    });

    it('is closed to outsiders and anonymous callers', async () => {
      await get(`/api/workspaces/${wsId}/overview`, tok.outsider).expect(404);
      await http().get(`/api/workspaces/${wsId}/overview`).expect(401);
    });
  });

  describe('GET /calendar', () => {
    const range = (from: Date, to: Date) =>
      `/api/workspaces/${wsId}/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    const day = (n: number) => new Date(Date.UTC(2030, 5, n));

    beforeEach(async () => {
      await ctx.prisma.calendarEvent.createMany({
        data: [
          { workspaceId: wsId, title: 'inside', startsAt: day(10), endsAt: day(11) },
          { workspaceId: wsId, title: 'spans the start', startsAt: day(4), endsAt: day(6) },
          { workspaceId: wsId, title: 'before', startsAt: day(1), endsAt: day(2) },
          { workspaceId: wsId, title: 'after', startsAt: day(25), endsAt: day(26) },
          {
            workspaceId: wsId,
            title: 'imported',
            startsAt: day(12),
            endsAt: day(13),
            googleEventId: 'g1',
          },
          { workspaceId: otherWsId, title: 'foreign', startsAt: day(10), endsAt: day(11) },
        ],
      });
      await ctx.prisma.task.createMany({
        data: [
          { workspaceId: wsId, title: 'due inside', dueDate: day(8) },
          { workspaceId: wsId, title: 'due outside', dueDate: day(28) },
          { workspaceId: otherWsId, title: 'foreign due', dueDate: day(8) },
        ],
      });
    });

    it('returns events overlapping the window and tasks due inside it', async () => {
      const res = await get(range(day(5), day(20))).expect(200);
      expect(res.body.events.map((e: { title: string }) => e.title)).toEqual([
        'spans the start',
        'inside',
        'imported',
      ]);
      expect(res.body.tasks.map((t: { title: string }) => t.title)).toEqual(['due inside']);
    });

    it('marks Google events as imported without exposing their Google id', async () => {
      const res = await get(range(day(5), day(20))).expect(200);
      const byTitle = Object.fromEntries(
        res.body.events.map((e: { title: string }) => [e.title, e]),
      );
      expect(byTitle['imported'].imported).toBe(true);
      expect(byTitle['inside'].imported).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain('g1');
    });

    it('validates the window', async () => {
      await get(`/api/workspaces/${wsId}/calendar`).expect(400);
      await get(`/api/workspaces/${wsId}/calendar?from=yesterday&to=tomorrow`).expect(400);
      await get(range(day(20), day(5))).expect(400);
      await get(range(day(1), new Date(day(1).getTime() + 101 * 24 * HOUR))).expect(400);
      await get(range(day(1), new Date(day(1).getTime() + 100 * 24 * HOUR))).expect(200);
    });

    it('is closed to outsiders', async () => {
      await get(range(day(5), day(20)), tok.outsider).expect(404);
    });
  });

  describe('the home page', () => {
    it('shows the dashboard sections and escapes user text', async () => {
      await ctx.prisma.task.create({
        data: {
          workspaceId: wsId,
          title: '<b>sneaky</b>',
          priority: 'HIGH',
          dueDate: inHours(2),
        },
      });
      const res = await get(`/admin/workspaces/${wsId}`).expect(200);
      for (const text of [
        'Coming up in the next 24 hours',
        'Priority tasks',
        'Open tasks',
        'Quick note',
        'id="calendar"',
        `data-workspace="${wsId}"`,
        '/static/calendar.js',
        `href="/admin/workspaces/${wsId}/team"`,
      ]) {
        expect(res.text, text).toContain(text);
      }
      expect(res.text).toContain('&lt;b&gt;sneaky&lt;/b&gt;');
      expect(res.text).not.toContain('<b>sneaky</b>');
      expect(res.text).toContain('datetime="');
    });

    it('is not shown to outsiders', async () => {
      await get(`/admin/workspaces/${wsId}`, tok.outsider).expect(404);
    });

    it('serves the calendar script', async () => {
      const res = await http().get('/static/calendar.js').expect(200);
      expect(res.headers['content-type']).toContain('javascript');
    });
  });

  describe('notes', () => {
    const note = (body: object, token = tok.owner) =>
      http()
        .post(`/admin/workspaces/${wsId}/notes`)
        .set('Authorization', token)
        .type('form')
        .send(body);

    it('turns every line into a paragraph block of a new page by the current user', async () => {
      const res = await note({ text: 'First idea\r\n\r\n  second idea  \nthird' }).expect(302);
      const page = await ctx.prisma.page.findFirstOrThrow({
        include: { blocks: { orderBy: { position: 'asc' } } },
      });
      expect(res.headers.location).toBe(`/admin/workspaces/${wsId}/pages/${page.id}?flash=created`);
      expect(page).toMatchObject({ title: 'First idea', authorId: ownerId, workspaceId: wsId });
      expect(page.blocks.map((b) => [b.type, (b.content as { text: string }).text])).toEqual([
        ['PARAGRAPH', 'First idea'],
        ['PARAGRAPH', 'second idea'],
        ['PARAGRAPH', 'third'],
      ]);
    });

    it('uses a given title, or a shortened first line', async () => {
      await note({ title: 'Groceries', text: 'milk' }).expect(302);
      await note({ text: 'x'.repeat(200) }).expect(302);
      const titles = (await ctx.prisma.page.findMany({ orderBy: { id: 'asc' } })).map(
        (p) => p.title,
      );
      expect(titles[0]).toBe('Groceries');
      expect(titles[1]).toHaveLength(80);
      expect(titles[1].endsWith('…')).toBe(true);
    });

    it('rejects an empty note without creating a page', async () => {
      await note({ text: '   ' }).expect(400);
      await note({ title: 'only a title' }).expect(400);
      await note({ text: 'x'.repeat(20001) }).expect(400);
      expect(await ctx.prisma.page.count()).toBe(0);
    });

    it('shows note text escaped', async () => {
      await note({ text: '<script>alert(1)</script>' }).expect(302);
      const page = await ctx.prisma.page.findFirstOrThrow();
      const res = await get(`/admin/workspaces/${wsId}/pages/${page.id}`).expect(200);
      expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(res.text).not.toContain('<script>alert(1)</script>');
    });

    it('appends lines after the existing blocks', async () => {
      await note({ text: 'one\ntwo' }).expect(302);
      const page = await ctx.prisma.page.findFirstOrThrow();
      const res = await http()
        .post(`/admin/workspaces/${wsId}/pages/${page.id}/blocks`)
        .set('Authorization', tok.owner)
        .type('form')
        .send({ text: 'three\nfour' })
        .expect(302);
      expect(res.headers.location).toBe(`/admin/workspaces/${wsId}/pages/${page.id}?flash=updated`);
      const blocks = await ctx.prisma.block.findMany({
        where: { pageId: page.id },
        orderBy: { position: 'asc' },
      });
      expect(blocks.map((b) => (b.content as { text: string }).text)).toEqual([
        'one',
        'two',
        'three',
        'four',
      ]);
    });

    it('does not let another workspace write notes or append to pages', async () => {
      await note({ text: 'planted' }, tok.outsider).expect(404);
      await note({ text: 'one' }).expect(302);
      const page = await ctx.prisma.page.findFirstOrThrow();
      await http()
        .post(`/admin/workspaces/${wsId}/pages/${page.id}/blocks`)
        .set('Authorization', tok.outsider)
        .type('form')
        .send({ text: 'planted' })
        .expect(404);
      await http()
        .post(`/admin/workspaces/${otherWsId}/pages/${page.id}/blocks`)
        .set('Authorization', tok.outsider)
        .type('form')
        .send({ text: 'planted' })
        .expect(404);
      expect(await ctx.prisma.block.count()).toBe(1);
    });
  });

  describe('the team page', () => {
    it('keeps members, invitations and the plan, and redirects back to itself', async () => {
      const team = await get(`/admin/workspaces/${wsId}/team`).expect(200);
      expect(team.text).toContain('Create invitation');
      expect(team.text).toContain('Switch to PRO');
      const res = await http()
        .post(`/admin/workspaces/${wsId}/plan`)
        .set('Authorization', tok.owner)
        .type('form')
        .send({ plan: 'PRO' })
        .expect(302);
      expect(res.headers.location).toBe(`/admin/workspaces/${wsId}/team?flash=updated`);
    });
  });
});
