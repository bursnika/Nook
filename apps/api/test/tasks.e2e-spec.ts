import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb, seedWorkspace, type TestApp } from './helpers.js';

describe('Tags, tasks & events API', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(() => resetDb(ctx.prisma));

  const http = () => request(app.getHttpServer());

  describe('tags', () => {
    it('creates, renames and deletes tags; names are unique per workspace', async () => {
      const a = await seedWorkspace(ctx.prisma, 'a');
      const b = await seedWorkspace(ctx.prisma, 'b');
      const base = `/api/workspaces/${a.workspace.id}/tags`;

      const tag = (await http().post(base).send({ name: 'uni', color: '#9D7BC9' }).expect(201))
        .body;
      await http().post(base).send({ name: 'uni' }).expect(409);
      await http().post(`/api/workspaces/${b.workspace.id}/tags`).send({ name: 'uni' }).expect(201);
      await http().post(base).send({ name: 'bad', color: 'pink' }).expect(400);

      const renamed = await http()
        .patch(`${base}/${tag.id}`)
        .send({ name: 'university' })
        .expect(200);
      expect(renamed.body.name).toBe('university');
      await http()
        .patch(`/api/workspaces/${b.workspace.id}/tags/${tag.id}`)
        .send({ name: 'x' })
        .expect(404);
      await http().delete(`${base}/${tag.id}`).expect(204);
      await http().get(`${base}/${tag.id}`).expect(404);
    });
  });

  describe('tasks', () => {
    it('creates a task with defaults, tags and an assignee', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      const base = `/api/workspaces/${workspace.id}`;
      const tag = (await http().post(`${base}/tags`).send({ name: 'urgent' }).expect(201)).body;

      const res = await http()
        .post(`${base}/tasks`)
        .send({
          title: 'Lab 1',
          assigneeId: user.id,
          tagIds: [tag.id],
          dueDate: '2026-11-15T12:00:00Z',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        title: 'Lab 1',
        status: 'TODO',
        priority: 'MEDIUM',
        assigneeId: user.id,
        completedAt: null,
      });
      expect(res.body.tags.map((t: { name: string }) => t.name)).toEqual(['urgent']);
      expect(new Date(res.body.dueDate).toISOString()).toBe('2026-11-15T12:00:00.000Z');
    });

    it('sets completedAt when a task moves to DONE and clears it when reopened', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const base = `/api/workspaces/${workspace.id}/tasks`;
      const task = (await http().post(base).send({ title: 't' }).expect(201)).body;

      const done = await http().patch(`${base}/${task.id}`).send({ status: 'DONE' }).expect(200);
      expect(done.body.completedAt).not.toBeNull();
      const reopened = await http()
        .patch(`${base}/${task.id}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
      expect(reopened.body.completedAt).toBeNull();
    });

    it('appends new tasks to the end of their column', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const base = `/api/workspaces/${workspace.id}/tasks`;
      const one = (await http().post(base).send({ title: '1' }).expect(201)).body;
      const two = (await http().post(base).send({ title: '2' }).expect(201)).body;
      const other = (await http().post(base).send({ title: 'x', status: 'DONE' }).expect(201)).body;
      expect(two.position).toBeGreaterThan(one.position);
      expect(other.position).toBe(one.position);
    });

    it('rejects references that point into another workspace', async () => {
      const a = await seedWorkspace(ctx.prisma, 'a');
      const b = await seedWorkspace(ctx.prisma, 'b');
      const foreignTag = (
        await http().post(`/api/workspaces/${b.workspace.id}/tags`).send({ name: 'x' }).expect(201)
      ).body;
      const foreignPage = (
        await http()
          .post(`/api/workspaces/${b.workspace.id}/pages`)
          .send({ title: 'p' })
          .expect(201)
      ).body;
      const base = `/api/workspaces/${a.workspace.id}/tasks`;

      await http().post(base).send({ title: 't', assigneeId: b.user.id }).expect(400);
      await http()
        .post(base)
        .send({ title: 't', tagIds: [foreignTag.id] })
        .expect(400);
      await http().post(base).send({ title: 't', pageId: foreignPage.id }).expect(400);
    });

    it('isolates tasks between workspaces', async () => {
      const a = await seedWorkspace(ctx.prisma, 'a');
      const b = await seedWorkspace(ctx.prisma, 'b');
      const task = (
        await http()
          .post(`/api/workspaces/${a.workspace.id}/tasks`)
          .send({ title: 'secret' })
          .expect(201)
      ).body;
      const foreign = `/api/workspaces/${b.workspace.id}/tasks`;

      await http().get(`${foreign}/${task.id}`).expect(404);
      await http().patch(`${foreign}/${task.id}`).send({ title: 'x' }).expect(404);
      await http().delete(`${foreign}/${task.id}`).expect(404);
      expect((await http().get(foreign).expect(200)).body.total).toBe(0);
    });

    it('filters by status, priority, tag, due range and search, and paginates', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const base = `/api/workspaces/${workspace.id}`;
      const tag = (await http().post(`${base}/tags`).send({ name: 'uni' }).expect(201)).body;
      await http()
        .post(`${base}/tasks`)
        .send({
          title: 'Write report',
          priority: 'HIGH',
          tagIds: [tag.id],
          dueDate: '2026-11-01T00:00:00Z',
        })
        .expect(201);
      await http()
        .post(`${base}/tasks`)
        .send({ title: 'Buy milk', dueDate: '2026-11-10T00:00:00Z' })
        .expect(201);
      await http().post(`${base}/tasks`).send({ title: 'Gym', status: 'DONE' }).expect(201);

      const count = async (qs: string) =>
        (await http().get(`${base}/tasks?${qs}`).expect(200)).body.total;
      expect(await count('status=DONE')).toBe(1);
      expect(await count('priority=HIGH')).toBe(1);
      expect(await count(`tagId=${tag.id}`)).toBe(1);
      expect(await count('q=milk')).toBe(1);
      expect(await count('dueFrom=2026-11-05T00:00:00Z&dueTo=2026-11-30T00:00:00Z')).toBe(1);
      await http().get(`${base}/tasks?status=NOPE`).expect(400);

      const page = await http().get(`${base}/tasks?limit=2`).expect(200);
      expect(page.body.items).toHaveLength(2);
      expect(page.body.nextLink).toContain('skip=2');
    });

    it('replaces tags on update and clears nullable fields', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      const base = `/api/workspaces/${workspace.id}`;
      const t1 = (await http().post(`${base}/tags`).send({ name: 'one' }).expect(201)).body;
      const t2 = (await http().post(`${base}/tags`).send({ name: 'two' }).expect(201)).body;
      const task = (
        await http()
          .post(`${base}/tasks`)
          .send({
            title: 't',
            tagIds: [t1.id],
            assigneeId: user.id,
            dueDate: '2026-12-01T00:00:00Z',
          })
          .expect(201)
      ).body;

      const updated = await http()
        .patch(`${base}/tasks/${task.id}`)
        .send({ tagIds: [t2.id], assigneeId: null, dueDate: null })
        .expect(200);
      expect(updated.body.tags.map((t: { name: string }) => t.name)).toEqual(['two']);
      expect(updated.body.assigneeId).toBeNull();
      expect(updated.body.dueDate).toBeNull();

      await http().delete(`${base}/tags/${t2.id}`).expect(204);
      const after = await http().get(`${base}/tasks/${task.id}`).expect(200);
      expect(after.body.tags).toEqual([]);
    });
  });

  describe('events', () => {
    it('validates the time range and filters by overlap', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const base = `/api/workspaces/${workspace.id}/events`;
      await http()
        .post(base)
        .send({ title: 'bad', startsAt: '2026-11-02T10:00:00Z', endsAt: '2026-11-02T09:00:00Z' })
        .expect(400);
      await http()
        .post(base)
        .send({ title: 'bad', startsAt: 'tomorrow', endsAt: 'later' })
        .expect(400);

      await http()
        .post(base)
        .send({
          title: 'Lecture',
          startsAt: '2026-11-02T09:00:00Z',
          endsAt: '2026-11-02T10:30:00Z',
        })
        .expect(201);
      const later = (
        await http()
          .post(base)
          .send({
            title: 'Exam',
            startsAt: '2026-11-20T09:00:00Z',
            endsAt: '2026-11-20T12:00:00Z',
            allDay: false,
          })
          .expect(201)
      ).body;

      const week = await http()
        .get(`${base}?from=2026-11-01T00:00:00Z&to=2026-11-08T00:00:00Z`)
        .expect(200);
      expect(week.body.items.map((e: { title: string }) => e.title)).toEqual(['Lecture']);
      const all = await http().get(base).expect(200);
      expect(all.body.items.map((e: { title: string }) => e.title)).toEqual(['Lecture', 'Exam']);

      await http()
        .patch(`${base}/${later.id}`)
        .send({ endsAt: '2026-11-19T00:00:00Z' })
        .expect(400);
      const moved = await http()
        .patch(`${base}/${later.id}`)
        .send({ title: 'Exam (moved)' })
        .expect(200);
      expect(moved.body.title).toBe('Exam (moved)');
    });

    it('links an event to a task of the same workspace only', async () => {
      const a = await seedWorkspace(ctx.prisma, 'a');
      const b = await seedWorkspace(ctx.prisma, 'b');
      const task = (
        await http()
          .post(`/api/workspaces/${a.workspace.id}/tasks`)
          .send({ title: 't' })
          .expect(201)
      ).body;
      const body = {
        title: 'e',
        startsAt: '2026-11-02T09:00:00Z',
        endsAt: '2026-11-02T10:00:00Z',
        taskId: task.id,
      };

      await http().post(`/api/workspaces/${a.workspace.id}/events`).send(body).expect(201);
      await http().post(`/api/workspaces/${b.workspace.id}/events`).send(body).expect(400);

      const ev = (await http().get(`/api/workspaces/${a.workspace.id}/events`).expect(200)).body
        .items[0];
      await http().get(`/api/workspaces/${b.workspace.id}/events/${ev.id}`).expect(404);
      await http().delete(`/api/workspaces/${b.workspace.id}/events/${ev.id}`).expect(404);
    });
  });
});
