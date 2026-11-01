import type { INestApplication } from '@nestjs/common';
import { BadGatewayException, Logger } from '@nestjs/common';
import request from 'supertest';
import { encryptToken } from '../src/google-calendar/token-crypto.js';
import {
  CALENDAR_SCOPE,
  TASKS_SCOPE,
  type GoogleEvent,
} from '../src/google-calendar/google-calendar.provider.js';
import { GOOGLE_SYNC_QUEUE, GoogleSyncJobs } from '../src/google-calendar/google-sync.jobs.js';
import { InMemoryQueue } from '../src/queue/in-memory-queue.js';
import { MESSAGE_QUEUE } from '../src/queue/message-queue.js';
import { bearer, signIn } from './auth-helpers.js';
import { createTestApp, resetDb, seedWorkspace, type TestApp } from './helpers.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('message queues', () => {
  let ctx: TestApp;
  let app: INestApplication;
  let queue: InMemoryQueue;

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
    queue = app.get<InMemoryQueue>(MESSAGE_QUEUE);
    Logger.overrideLogger(false);
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    await queue.clear();
    await resetDb(ctx.prisma);
    ctx.googleCalendar.calendars.clear();
    ctx.googleCalendar.revokedByUser.clear();
  });

  const http = () => request(app.getHttpServer());

  describe('google sync jobs', () => {
    const at = (days: number, hour = 10) => new Date(Date.now() + days * DAY + hour * 3600_000);
    const event = (id: string, title: string): GoogleEvent => ({
      id: `primary/${id}`,
      calendarId: 'primary',
      calendarName: 'Personal',
      title,
      startsAt: at(2),
      endsAt: at(2, 11),
      allDay: false,
      editable: true,
      recurring: false,
    });

    /** A signed-in person who has connected Google (the token is stored directly, as the callback would). */
    async function person(email: string, refreshToken = `token-${email}`) {
      await signIn(ctx, { email });
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      const { workspaceId } = await ctx.prisma.membership.findFirstOrThrow({
        where: { userId: user.id },
      });
      await ctx.prisma.googleConnection.create({
        data: {
          userId: user.id,
          refreshTokenEnc: encryptToken(refreshToken),
          scope: `${CALENDAR_SCOPE} ${TASKS_SCOPE}`,
        },
      });
      return { user, workspaceId, refreshToken, token: await bearer(app, user) };
    }
    const syncAsync = (workspaceId: string, token?: string) => {
      const call = http().post(`/api/workspaces/${workspaceId}/google-calendar/sync-async`);
      return token ? call.set('Authorization', token) : call;
    };
    const titles = async (workspaceId: string) =>
      (await ctx.prisma.calendarEvent.findMany({ where: { workspaceId } })).map((e) => e.title);

    it('answers 202 at once and imports in the background', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('1', 'Lecture')]);
      // hold Google back: the answer must not wait for it
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const listEvents = ctx.googleCalendar.listEvents.bind(ctx.googleCalendar);
      ctx.googleCalendar.listEvents = async (params) => {
        await gate;
        return listEvents(params);
      };
      try {
        const res = await syncAsync(who.workspaceId, who.token).expect(202);
        expect(res.body).toEqual({ queued: true });
        expect(await titles(who.workspaceId)).toEqual([]);

        release();
        await queue.flush();
        expect(await titles(who.workspaceId)).toEqual(['Lecture']);
        const connection = await ctx.prisma.googleConnection.findUniqueOrThrow({
          where: { userId: who.user.id },
        });
        expect(connection.lastSyncAt).not.toBeNull();
      } finally {
        release();
        ctx.googleCalendar.listEvents = listEvents;
      }
    });

    it('keeps the synchronous endpoint working next to it', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('1', 'Lecture')]);
      await http()
        .post(`/api/workspaces/${who.workspaceId}/google-calendar/sync`)
        .set('Authorization', who.token)
        .expect(200);
      expect(await titles(who.workspaceId)).toEqual(['Lecture']);
    });

    it('needs a signed-in member of the workspace and a connected Google account', async () => {
      const who = await person('a@example.com');
      const stranger = await person('b@example.com');
      const publish = vi.spyOn(queue, 'publish');
      await syncAsync(who.workspaceId).expect(401);
      // other people's workspaces do not exist for you
      await syncAsync(who.workspaceId, stranger.token).expect(404);

      await ctx.prisma.googleConnection.delete({ where: { userId: who.user.id } });
      await syncAsync(who.workspaceId, who.token).expect(409);
      // nothing was queued for any of the refused calls
      expect(publish).not.toHaveBeenCalled();
      publish.mockRestore();
    });

    it('retries when Google fails for a moment', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('1', 'Lecture')]);
      const listEvents = ctx.googleCalendar.listEvents.bind(ctx.googleCalendar);
      let calls = 0;
      ctx.googleCalendar.listEvents = async (params) => {
        calls += 1;
        if (calls === 1) throw new BadGatewayException('Google hiccup');
        return listEvents(params);
      };
      try {
        await syncAsync(who.workspaceId, who.token).expect(202);
        await queue.flush();
        expect(await titles(who.workspaceId)).toEqual([]);
        await queue.drain();
        expect(calls).toBe(2);
        expect(await titles(who.workspaceId)).toEqual(['Lecture']);
        expect(queue.deadLetters(GOOGLE_SYNC_QUEUE)).toEqual([]);
      } finally {
        ctx.googleCalendar.listEvents = listEvents;
      }
    });

    it('drops the job (no dead letter) when Google access was revoked', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.revokedByUser.add(who.refreshToken);
      await syncAsync(who.workspaceId, who.token).expect(202);
      await queue.drain();
      expect(queue.deadLetters(GOOGLE_SYNC_QUEUE)).toEqual([]);
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
    });

    it('skips a job of someone who left the workspace meanwhile', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('1', 'Lecture')]);
      await ctx.prisma.membership.deleteMany({ where: { userId: who.user.id } });
      await queue.publish(GOOGLE_SYNC_QUEUE, { workspaceId: who.workspaceId, userId: who.user.id });
      await queue.flush();
      expect(await titles(who.workspaceId)).toEqual([]);
    });

    it('the periodic enqueue covers every connected person and every workspace of theirs', async () => {
      const a = await person('a@example.com');
      const b = await person('b@example.com');
      await person('c@example.com').then((c) =>
        ctx.prisma.googleConnection.delete({ where: { userId: c.user.id } }),
      );
      const second = await ctx.prisma.workspace.create({
        data: { name: 'Second', slug: 'second', memberships: { create: { userId: a.user.id } } },
      });
      ctx.googleCalendar.calendars.set(a.refreshToken, [event('1', 'A event')]);
      ctx.googleCalendar.calendars.set(b.refreshToken, [event('2', 'B event')]);

      expect(await app.get(GoogleSyncJobs).enqueueAll()).toBe(3);
      await queue.flush();
      expect(await titles(a.workspaceId)).toEqual(['A event']);
      expect(await titles(second.id)).toEqual(['A event']);
      expect(await titles(b.workspaceId)).toEqual(['B event']);
    });
  });

  describe('queue status', () => {
    it('is for platform admins only', async () => {
      const member = await seedWorkspace(ctx.prisma);
      await http().get('/api/queue-status').expect(401);
      await http()
        .get('/api/queue-status')
        .set('Authorization', await bearer(app, member.user))
        .expect(403);
    });

    it('shows the driver and the counters of every queue, dead letters included', async () => {
      const admin = await ctx.prisma.user.create({
        data: { email: 'platform-admin@example.com', name: 'Admin' },
      });
      const res = await http()
        .get('/api/queue-status')
        .set('Authorization', await bearer(app, { id: admin.id, email: admin.email }))
        .expect(200);
      expect(res.body).toMatchObject({ driver: 'memory', connected: true });
      expect(res.body.queues).toEqual(
        expect.arrayContaining([
          { name: GOOGLE_SYNC_QUEUE, messages: 0, consumers: 1, retrying: 0, dead: 0 },
        ]),
      );
    });
  });
});
