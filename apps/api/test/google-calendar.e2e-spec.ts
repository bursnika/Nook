import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CALENDAR_SCOPE,
  type GoogleEvent,
} from '../src/google-calendar/google-calendar.provider.js';
import { bearer, setCookieLine, signIn } from './auth-helpers.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

describe('Google Calendar', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.googleCalendar.configured = true;
    ctx.googleCalendar.codes.clear();
    ctx.googleCalendar.calendars.clear();
    ctx.googleCalendar.revokedByUser.clear();
    ctx.googleCalendar.forgotten = [];
  });

  const http = () => request(app.getHttpServer());
  const at = (days: number, hour = 10) => new Date(Date.now() + days * DAY + hour * 3600_000);
  const event = (id: string, title: string, days: number, extra: Partial<GoogleEvent> = {}) => ({
    id,
    title,
    startsAt: at(days),
    endsAt: at(days, 11),
    allDay: false,
    ...extra,
  });

  /** A signed-in person (cookie session) with their own workspace, not yet connected to Google. */
  async function person(email: string) {
    const session = await signIn(ctx, { email });
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    const { workspaceId } = await ctx.prisma.membership.findFirstOrThrow({
      where: { userId: user.id },
    });
    return { ...session, user, workspaceId, token: await bearer(app, user) };
  }

  /** Walks the browser through the consent screen and back. */
  async function connect(
    who: Awaited<ReturnType<typeof person>>,
    grant: { refreshToken: string; scope?: string },
    code = `cal-${grant.refreshToken}`,
  ) {
    ctx.googleCalendar.codes.set(code, {
      refreshToken: grant.refreshToken,
      scope: grant.scope ?? `openid ${CALENDAR_SCOPE}`,
    });
    const start = await who.agent.get(
      `/api/google-calendar/connect?returnTo=/admin/workspaces/${who.workspaceId}`,
    );
    const state = new URL(start.headers.location).searchParams.get('state') ?? '';
    const callback = await who.agent.get(
      `/api/auth/google/callback?code=${code}&state=${state}&scope=x&authuser=0&prompt=consent`,
    );
    return { start, callback, state };
  }

  describe('connecting', () => {
    it('needs a signed-in person and a configured server', async () => {
      await http().get('/api/google-calendar/connect').expect(401);
      const who = await person('a@example.com');
      ctx.googleCalendar.configured = false;
      await who.agent.get('/api/google-calendar/connect').expect(503);
    });

    it('sends the browser to Google asking for offline access, and remembers why', async () => {
      const who = await person('a@example.com');
      const res = await who.agent.get('/api/google-calendar/connect?returnTo=/admin/workspaces/x');
      expect(res.status).toBe(302);
      const url = new URL(res.headers.location);
      expect(url.origin + url.pathname).toBe('https://accounts.example.test/calendar-consent');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('state')).toBeTruthy();
      const purpose = setCookieLine(res, 'nook_oauth_purpose')!;
      expect(purpose).toContain('nook_oauth_purpose=calendar');
      expect(purpose).toContain('HttpOnly');
      expect(purpose).toContain('Path=/api/auth');
    });

    it('does not mark ordinary sign-in as a calendar flow', async () => {
      const res = await http().get('/api/auth/google');
      expect(setCookieLine(res, 'nook_oauth_purpose')).toBeUndefined();
    });

    it('stores the refresh token encrypted and goes back where it came from', async () => {
      const who = await person('a@example.com');
      const { callback } = await connect(who, { refreshToken: 'plain-refresh-token' });
      expect(callback.status).toBe(302);
      expect(callback.headers.location).toBe(
        `/admin/workspaces/${who.workspaceId}?flash=connected`,
      );

      const stored = await ctx.prisma.googleConnection.findUniqueOrThrow({
        where: { userId: who.user.id },
      });
      expect(stored.refreshTokenEnc).not.toContain('plain-refresh-token');
      expect(stored.scope).toContain(CALENDAR_SCOPE);

      const status = await http()
        .get(`/api/workspaces/${who.workspaceId}/google-calendar`)
        .set('Authorization', who.token)
        .expect(200);
      expect(status.body).toEqual({ configured: true, connected: true, lastSyncAt: null });
    });

    it('replaces the previous connection when connecting again', async () => {
      const who = await person('a@example.com');
      await connect(who, { refreshToken: 'first' });
      await connect(who, { refreshToken: 'second' });
      expect(await ctx.prisma.googleConnection.count()).toBe(1);
    });

    it('refuses a callback whose state does not match', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.codes.set('c', { refreshToken: 'r', scope: CALENDAR_SCOPE });
      await who.agent.get('/api/google-calendar/connect');
      await who.agent.get('/api/auth/google/callback?code=c&state=forged').expect(400);
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
    });

    it('does not trust a callback without a session', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.codes.set('c', { refreshToken: 'r', scope: CALENDAR_SCOPE });
      const start = await who.agent.get('/api/google-calendar/connect');
      const state = new URL(start.headers.location).searchParams.get('state');
      // the same oauth cookies, but nobody is signed in
      const cookies = ([] as string[])
        .concat(start.headers['set-cookie'] ?? [])
        .map((line: string) => line.split(';')[0])
        .join('; ');
      await http()
        .get(`/api/auth/google/callback?code=c&state=${state}`)
        .set('Cookie', cookies)
        .expect(401);
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
    });

    it('does not connect when the calendar box was unticked on the consent screen', async () => {
      const who = await person('a@example.com');
      const { callback } = await connect(who, { refreshToken: 'r', scope: 'openid email' });
      expect(callback.headers.location).toBe(
        `/admin/workspaces/${who.workspaceId}?problem=calendar`,
      );
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
    });

    it('does not connect when the person cancels', async () => {
      const who = await person('a@example.com');
      const start = await who.agent.get(
        `/api/google-calendar/connect?returnTo=/admin/workspaces/${who.workspaceId}`,
      );
      const state = new URL(start.headers.location).searchParams.get('state');
      const res = await who.agent.get(
        `/api/auth/google/callback?error=access_denied&state=${state}`,
      );
      expect(res.headers.location).toBe(`/admin/workspaces/${who.workspaceId}?problem=calendar`);
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
    });

    it('does not connect when Google rejects the code', async () => {
      const who = await person('a@example.com');
      const start = await who.agent.get(
        `/api/google-calendar/connect?returnTo=/admin/workspaces/${who.workspaceId}`,
      );
      const state = new URL(start.headers.location).searchParams.get('state');
      const res = await who.agent.get(`/api/auth/google/callback?code=never-issued&state=${state}`);
      expect(res.headers.location).toBe(`/admin/workspaces/${who.workspaceId}?problem=calendar`);
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
    });

    it('never redirects to another site, whatever returnTo says', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.codes.set('c', { refreshToken: 'r', scope: CALENDAR_SCOPE });
      const start = await who.agent.get(
        '/api/google-calendar/connect?returnTo=https://evil.example',
      );
      const state = new URL(start.headers.location).searchParams.get('state');
      const callback = await who.agent.get(`/api/auth/google/callback?code=c&state=${state}`);
      expect(callback.headers.location).toBe('/admin?flash=connected');
    });
  });

  describe('syncing', () => {
    async function connected(email = 'a@example.com', refreshToken = `token-${email}`) {
      const who = await person(email);
      await connect(who, { refreshToken });
      return { ...who, refreshToken };
    }
    const sync = (who: { workspaceId: string; token: string }) =>
      http()
        .post(`/api/workspaces/${who.workspaceId}/google-calendar/sync`)
        .set('Authorization', who.token);
    const titles = async (workspaceId: string) =>
      (
        await ctx.prisma.calendarEvent.findMany({
          where: { workspaceId },
          orderBy: { title: 'asc' },
        })
      ).map((e) => e.title);

    it('imports timed and all-day events with their Google ids', async () => {
      const who = await connected();
      ctx.googleCalendar.calendars.set(who.refreshToken, [
        event('g1', 'Lecture', 2, { description: 'Room 4' }),
        event('g2', 'Holiday', 3, {
          allDay: true,
          startsAt: new Date(at(3).setUTCHours(0, 0, 0, 0)),
          endsAt: new Date(at(4).setUTCHours(0, 0, 0, 0)),
        }),
      ]);

      const res = await sync(who).expect(200);
      expect(res.body).toMatchObject({ created: 2, updated: 0, removed: 0 });
      const rows = await ctx.prisma.calendarEvent.findMany({ orderBy: { title: 'desc' } });
      expect(rows.map((r) => [r.title, r.googleEventId, r.allDay, r.importedById])).toEqual([
        ['Lecture', 'g1', false, who.user.id],
        ['Holiday', 'g2', true, who.user.id],
      ]);
      expect(rows[0].description).toBe('Room 4');

      const status = await http()
        .get(`/api/workspaces/${who.workspaceId}/google-calendar`)
        .set('Authorization', who.token);
      expect(status.body.lastSyncAt).not.toBeNull();
    });

    it('updates changed events, adds new ones and removes what disappeared from Google', async () => {
      const who = await connected();
      ctx.googleCalendar.calendars.set(who.refreshToken, [
        event('g1', 'Lecture', 2),
        event('g2', 'Gone soon', 3),
      ]);
      await sync(who).expect(200);

      ctx.googleCalendar.calendars.set(who.refreshToken, [
        event('g1', 'Lecture (moved)', 5),
        event('g3', 'Brand new', 6),
      ]);
      const res = await sync(who).expect(200);
      expect(res.body).toMatchObject({ created: 1, updated: 1, removed: 1 });
      expect(await titles(who.workspaceId)).toEqual(['Brand new', 'Lecture (moved)']);
    });

    it('is idempotent', async () => {
      const who = await connected();
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('g1', 'Lecture', 2)]);
      await sync(who).expect(200);
      const again = await sync(who).expect(200);
      expect(again.body).toMatchObject({ created: 0, updated: 1, removed: 0 });
      expect(await ctx.prisma.calendarEvent.count()).toBe(1);
    });

    it('leaves manual events, events outside the window and other people’s imports alone', async () => {
      const a = await connected('a@example.com');
      const b = await connected('b@example.com');
      // both people work in a's workspace
      await ctx.prisma.membership.create({
        data: { userId: b.user.id, workspaceId: a.workspaceId, role: 'MEMBER' },
      });

      await ctx.prisma.calendarEvent.create({
        data: { workspaceId: a.workspaceId, title: 'Manual', startsAt: at(2), endsAt: at(2, 11) },
      });
      await ctx.prisma.calendarEvent.create({
        data: {
          workspaceId: a.workspaceId,
          title: 'Ancient import',
          googleEventId: 'old',
          importedById: a.user.id,
          startsAt: at(-400),
          endsAt: at(-400, 11),
        },
      });
      ctx.googleCalendar.calendars.set(b.refreshToken, [event('b1', 'B meeting', 3)]);
      ctx.googleCalendar.calendars.set(a.refreshToken, [event('a1', 'A meeting', 4)]);

      await sync({ workspaceId: a.workspaceId, token: b.token }).expect(200);
      await sync(a).expect(200); // a's sync must not delete b's event

      expect(await titles(a.workspaceId)).toEqual([
        'A meeting',
        'Ancient import',
        'B meeting',
        'Manual',
      ]);
    });

    it('does not mix workspaces', async () => {
      const who = await connected();
      const second = await ctx.prisma.workspace.create({
        data: {
          name: 'Second',
          slug: 'second',
          memberships: { create: { userId: who.user.id, role: 'OWNER' } },
        },
      });
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('g1', 'Shared', 2)]);
      await sync(who).expect(200);
      await sync({ workspaceId: second.id, token: who.token }).expect(200);
      expect(await ctx.prisma.calendarEvent.count()).toBe(2);

      ctx.googleCalendar.calendars.set(who.refreshToken, []);
      await sync({ workspaceId: second.id, token: who.token }).expect(200);
      expect(await titles(who.workspaceId)).toEqual(['Shared']);
      expect(await titles(second.id)).toEqual([]);
    });

    it('asks to connect first, and forgets a grant Google has revoked', async () => {
      const who = await person('a@example.com');
      await sync(who).expect(409);

      await connect(who, { refreshToken: 'r' });
      ctx.googleCalendar.revokedByUser.add('r');
      const res = await sync(who).expect(409);
      expect(res.body.message).toContain('Connect Google Calendar again');
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
    });

    it('is closed to outsiders and anonymous callers', async () => {
      const a = await connected('a@example.com');
      const stranger = await person('stranger@example.com');
      await sync({ workspaceId: a.workspaceId, token: stranger.token }).expect(404);
      await http().post(`/api/workspaces/${a.workspaceId}/google-calendar/sync`).expect(401);
      await http().get(`/api/workspaces/${a.workspaceId}/google-calendar`).expect(401);
      expect(await ctx.prisma.calendarEvent.count()).toBe(0);
    });

    it('shows the imported events in the calendar endpoint, marked as imported', async () => {
      const who = await connected();
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('g1', 'Lecture', 2)]);
      await sync(who).expect(200);
      const res = await http()
        .get(
          `/api/workspaces/${who.workspaceId}/calendar?from=${encodeURIComponent(at(0).toISOString())}&to=${encodeURIComponent(at(10).toISOString())}`,
        )
        .set('Authorization', who.token)
        .expect(200);
      expect(res.body.events).toMatchObject([{ title: 'Lecture', imported: true }]);
    });
  });

  describe('disconnecting', () => {
    it('forgets the connection and only that person’s imported events, and tells Google', async () => {
      const a = await person('a@example.com');
      const b = await person('b@example.com');
      await connect(a, { refreshToken: 'token-a' });
      await connect(b, { refreshToken: 'token-b' });
      ctx.googleCalendar.calendars.set('token-a', [event('a1', 'A event', 2)]);
      ctx.googleCalendar.calendars.set('token-b', [event('b1', 'B event', 2)]);
      await http()
        .post(`/api/workspaces/${a.workspaceId}/google-calendar/sync`)
        .set('Authorization', a.token)
        .expect(200);
      await http()
        .post(`/api/workspaces/${b.workspaceId}/google-calendar/sync`)
        .set('Authorization', b.token)
        .expect(200);
      await ctx.prisma.calendarEvent.create({
        data: { workspaceId: a.workspaceId, title: 'Manual', startsAt: at(2), endsAt: at(2, 11) },
      });

      await http().delete('/api/google-calendar').set('Authorization', a.token).expect(204);

      expect(
        await ctx.prisma.googleConnection.findUnique({ where: { userId: a.user.id } }),
      ).toBeNull();
      expect(
        await ctx.prisma.googleConnection.findUnique({ where: { userId: b.user.id } }),
      ).not.toBeNull();
      const left = (await ctx.prisma.calendarEvent.findMany()).map((e) => e.title).sort();
      expect(left).toEqual(['B event', 'Manual']);
      expect(ctx.googleCalendar.forgotten).toEqual(['token-a']);

      await http().delete('/api/google-calendar').set('Authorization', a.token).expect(204); // idempotent
      await http().delete('/api/google-calendar').expect(401);
    });
  });

  describe('on the workspace home', () => {
    const home = (who: { token: string; workspaceId: string }, query = '') =>
      http()
        .get(`/admin/workspaces/${who.workspaceId}${query}`)
        .set('Authorization', who.token)
        .set('Accept', 'text/html');

    it('offers to connect, with the right link', async () => {
      const who = await person('a@example.com');
      const res = await home(who).expect(200);
      expect(res.text).toContain(
        `href="/api/google-calendar/connect?returnTo=/admin/workspaces/${who.workspaceId}"`,
      );
      expect(res.text).not.toContain('Sync now');
    });

    it('says so when the server has no Google credentials', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.configured = false;
      const res = await home(who).expect(200);
      expect(res.text).toContain('Google Calendar sync is not configured on this server.');
      expect(res.text).not.toContain('Connect Google Calendar</a>');
    });

    it('offers to sync and disconnect once connected, and warns about visibility', async () => {
      const who = await person('a@example.com');
      await connect(who, { refreshToken: 'r' });
      const res = await home(who).expect(200);
      expect(res.text).toContain('Google Calendar connected');
      expect(res.text).toContain('Sync now');
      expect(res.text).toContain('Disconnect');
      expect(res.text).toContain('visible to everyone in this workspace');
      expect(res.text).toContain('not synced yet');
    });

    it('syncs and disconnects through the buttons', async () => {
      const who = await person('a@example.com');
      await connect(who, { refreshToken: 'r' });
      ctx.googleCalendar.calendars.set('r', [event('g1', 'Lecture', 2)]);

      const synced = await http()
        .post(`/admin/workspaces/${who.workspaceId}/google-calendar/sync`)
        .set('Authorization', who.token)
        .expect(302);
      expect(synced.headers.location).toBe(`/admin/workspaces/${who.workspaceId}?flash=synced`);
      expect(await ctx.prisma.calendarEvent.count()).toBe(1);

      const out = await http()
        .post(`/admin/google-calendar/disconnect?returnTo=/admin/workspaces/${who.workspaceId}`)
        .set('Authorization', who.token)
        .expect(302);
      expect(out.headers.location).toBe(`/admin/workspaces/${who.workspaceId}?flash=disconnected`);
      expect(await ctx.prisma.calendarEvent.count()).toBe(0);
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
    });

    it('reports a failed sync instead of crashing', async () => {
      const who = await person('a@example.com');
      const res = await http()
        .post(`/admin/workspaces/${who.workspaceId}/google-calendar/sync`)
        .set('Authorization', who.token)
        .expect(302);
      expect(res.headers.location).toBe(
        `/admin/workspaces/${who.workspaceId}?problem=calendar-sync`,
      );
    });

    it('shows the messages for known flash and problem keys only', async () => {
      const who = await person('a@example.com');
      expect((await home(who, '?flash=connected')).text).toContain(
        'Google Calendar connected. Press',
      );
      expect((await home(who, '?problem=calendar')).text).toContain('could not be connected');
      const unknown = await home(who, '?flash=<script>x</script>&problem=<b>hi</b>').expect(200);
      expect(unknown.text).not.toContain('<script>x</script>');
      expect(unknown.text).not.toContain('<b>hi</b>');
    });
  });
});
