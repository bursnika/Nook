import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { env } from '../src/env.js';
import { bearer } from './auth-helpers.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

describe('Widget token and today endpoint', () => {
  let ctx: TestApp;
  let app: INestApplication;
  let auth: string;
  let wsId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const user = await ctx.prisma.user.create({ data: { email: 'w@example.com', name: 'W' } });
    const ws = await ctx.prisma.workspace.create({
      data: {
        name: 'Home',
        slug: 'home',
        memberships: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    wsId = ws.id;
    auth = await bearer(app, user);
  });

  const http = () => request(app.getHttpServer());
  const issue = async () =>
    (await http().post('/api/widget/token').set('Authorization', auth).expect(200)).body
      .token as string;

  it('issues a token once, stores only its hash and lets the person revoke it', async () => {
    expect((await http().get('/api/widget/token').set('Authorization', auth)).body).toEqual({
      exists: false,
    });
    const token = await issue();
    expect(token).toMatch(/^nkw_[\w-]{20,}$/);
    const stored = await ctx.prisma.user.findFirstOrThrow();
    expect(stored.widgetTokenHash).not.toContain(token);
    expect((await http().get('/api/widget/token').set('Authorization', auth)).body).toEqual({
      exists: true,
    });
    await http().delete('/api/widget/token').set('Authorization', auth).expect(204);
    await http().get('/api/widget/today').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('a new token replaces the old one', async () => {
    const first = await issue();
    const second = await issue();
    await http().get('/api/widget/today').set('Authorization', `Bearer ${first}`).expect(401);
    await http().get('/api/widget/today').set('Authorization', `Bearer ${second}`).expect(200);
  });

  it("returns today's plan from the person's workspaces, by header or by query", async () => {
    const token = await issue();
    const now = new Date();
    const stranger = await ctx.prisma.workspace.create({ data: { name: 'X', slug: 'x' } });
    await ctx.prisma.task.createMany({
      data: [
        { workspaceId: wsId, title: 'Today', priority: 'HIGH', dueDate: now },
        { workspaceId: wsId, title: 'Late', dueDate: new Date(now.getTime() - 3 * 86_400_000) },
        { workspaceId: wsId, title: 'Done', status: 'DONE', dueDate: now },
        {
          workspaceId: wsId,
          title: 'Next week',
          dueDate: new Date(now.getTime() + 7 * 86_400_000),
        },
        { workspaceId: stranger.id, title: 'Not mine', dueDate: now },
      ],
    });
    await ctx.prisma.calendarEvent.create({
      data: {
        workspaceId: wsId,
        title: 'Lunch',
        startsAt: now,
        endsAt: new Date(now.getTime() + 3_600_000),
      },
    });
    const byHeader = await http()
      .get('/api/widget/today')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byHeader.headers['cache-control']).toBe('no-store');
    expect(byHeader.body.tasks.map((t: { title: string }) => t.title).sort()).toEqual([
      'Late',
      'Today',
    ]);
    expect(byHeader.body.tasks.find((t: { title: string }) => t.title === 'Late').overdue).toBe(
      true,
    );
    expect(byHeader.body.events.map((e: { title: string }) => e.title)).toEqual(['Lunch']);
    expect(byHeader.body.counts).toEqual({ tasks: 2, events: 1 });
    const byQuery = await http().get(`/api/widget/today?token=${token}`).expect(200);
    expect(byQuery.body.counts).toEqual(byHeader.body.counts);
  });

  it('shows a platform administrator the workspaces the app shows them, members or not', async () => {
    const token = await issue();
    const other = await ctx.prisma.workspace.create({ data: { name: 'Other', slug: 'other' } });
    await ctx.prisma.task.create({
      data: { workspaceId: other.id, title: 'Elsewhere', dueDate: new Date() },
    });
    const plain = await http().get(`/api/widget/today?token=${token}`).expect(200);
    expect(plain.body.counts.tasks).toBe(0);

    env.adminEmails.add('w@example.com');
    try {
      const admin = await http().get(`/api/widget/today?token=${token}`).expect(200);
      expect(admin.body.tasks.map((t: { title: string }) => t.title)).toEqual(['Elsewhere']);
    } finally {
      env.adminEmails.delete('w@example.com');
    }
  });

  it('refuses missing, wrong and ordinary access tokens', async () => {
    await http().get('/api/widget/today').expect(401);
    await http().get('/api/widget/today').set('Authorization', 'Bearer nkw_nope').expect(401);
    await http().get('/api/widget/today').set('Authorization', auth).expect(401);
    await http().post('/api/widget/token').expect(401);
  });
});
