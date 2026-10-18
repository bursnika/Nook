import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CALENDAR_SCOPE,
  EVENTS_WRITE_SCOPE,
  GoogleEventGoneError,
  GoogleForbiddenError,
  TASKS_SCOPE,
  type GoogleEvent,
  type GoogleTask,
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
    ctx.googleCalendar.failedCalendars.clear();
    ctx.googleCalendar.tasks.clear();
    ctx.googleCalendar.failedLists.clear();
    ctx.googleCalendar.tasksUnavailable.clear();
    ctx.googleCalendar.revokedByUser.clear();
    ctx.googleCalendar.forgotten = [];
    ctx.googleCalendar.updates = [];
    ctx.googleCalendar.creations = [];
    ctx.googleCalendar.deletions = [];
    ctx.googleCalendar.writeError = null;
  });

  const http = () => request(app.getHttpServer());
  const at = (days: number, hour = 10) => new Date(Date.now() + days * DAY + hour * 3600_000);
  const event = (
    id: string,
    title: string,
    days: number,
    extra: Partial<GoogleEvent> = {},
  ): GoogleEvent => ({
    id: `primary/${id}`,
    calendarId: 'primary',
    calendarName: 'Personal',
    title,
    startsAt: at(days),
    endsAt: at(days, 11),
    allDay: false,
    editable: true,
    recurring: false,
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
      scope: grant.scope ?? `openid ${CALENDAR_SCOPE} ${TASKS_SCOPE}`,
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
      expect(status.body).toEqual({
        configured: true,
        connected: true,
        tasksGranted: true,
        editGranted: false,
        twoWay: false,
        lastSyncAt: null,
      });
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

    it('shows a browser an explanation when the calendar attempt expired', async () => {
      const who = await person('a@example.com');
      await who.agent.get('/api/google-calendar/connect');
      const res = await who.agent
        .get('/api/auth/google/callback?code=c&state=another-tab')
        .set('Accept', 'text/html');
      expect(res.status).toBe(400);
      expect(res.text).toContain('Try again');
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
        ['Lecture', 'primary/g1', false, who.user.id],
        ['Holiday', 'primary/g2', true, who.user.id],
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

    describe('every calendar, not only the main one', () => {
      const inCalendar = (
        calendarId: string,
        calendarName: string,
        id: string,
        title: string,
        days: number,
      ) => event(id, title, days, { id: `${calendarId}/${id}`, calendarId, calendarName });

      it('imports events of all calendars and remembers which calendar each came from', async () => {
        const who = await connected();
        ctx.googleCalendar.calendars.set(who.refreshToken, [
          event('e1', 'Main event', 2),
          inCalendar('uni', 'University', 'e1', 'Lecture', 3),
          inCalendar('holidays', 'Holidays in Ukraine', 'h1', 'Independence Day', 4),
          inCalendar('birthdays', 'Birthdays', 'b1', 'Olena’s birthday', 5),
        ]);
        const res = await sync(who).expect(200);
        expect(res.body).toMatchObject({ created: 4, updated: 0, removed: 0 });

        const rows = await ctx.prisma.calendarEvent.findMany({ orderBy: { title: 'asc' } });
        expect(rows.map((r) => [r.title, r.calendarName, r.googleCalendarId])).toEqual([
          ['Independence Day', 'Holidays in Ukraine', 'holidays'],
          ['Lecture', 'University', 'uni'],
          ['Main event', 'Personal', 'primary'],
          ['Olena’s birthday', 'Birthdays', 'birthdays'],
        ]);
        // the same Google event id in two calendars stays two different events
        expect(new Set(rows.map((r) => r.googleEventId)).size).toBe(4);
      });

      it('shows the calendar name in the calendar endpoint', async () => {
        const who = await connected();
        ctx.googleCalendar.calendars.set(who.refreshToken, [
          inCalendar('uni', 'University', 'e1', 'Lecture', 2),
        ]);
        await sync(who).expect(200);
        const res = await http()
          .get(
            `/api/workspaces/${who.workspaceId}/calendar?from=${encodeURIComponent(at(0).toISOString())}&to=${encodeURIComponent(at(10).toISOString())}`,
          )
          .set('Authorization', who.token)
          .expect(200);
        expect(res.body.events).toMatchObject([{ title: 'Lecture', calendarName: 'University' }]);
      });

      it('keeps what was imported from a calendar Google could not read this time', async () => {
        const who = await connected();
        ctx.googleCalendar.calendars.set(who.refreshToken, [
          event('e1', 'Main event', 2),
          inCalendar('uni', 'University', 'e1', 'Lecture', 3),
        ]);
        await sync(who).expect(200);

        ctx.googleCalendar.failedCalendars.set(who.refreshToken, ['uni']);
        const res = await sync(who).expect(200);
        expect(res.body.removed).toBe(0);
        expect(await titles(who.workspaceId)).toEqual(['Lecture', 'Main event']);

        // once readable again, a deletion in Google is mirrored as usual
        ctx.googleCalendar.failedCalendars.clear();
        ctx.googleCalendar.calendars.set(who.refreshToken, [event('e1', 'Main event', 2)]);
        expect((await sync(who).expect(200)).body.removed).toBe(1);
        expect(await titles(who.workspaceId)).toEqual(['Main event']);
      });

      it('removes events of a calendar that was switched off in Google Calendar', async () => {
        const who = await connected();
        ctx.googleCalendar.calendars.set(who.refreshToken, [
          event('e1', 'Main event', 2),
          inCalendar('uni', 'University', 'e1', 'Lecture', 3),
        ]);
        await sync(who).expect(200);
        ctx.googleCalendar.calendars.set(who.refreshToken, [event('e1', 'Main event', 2)]);
        await sync(who).expect(200);
        expect(await titles(who.workspaceId)).toEqual(['Main event']);
      });

      it('replaces events imported by the first version, which had no calendar id', async () => {
        const who = await connected();
        await ctx.prisma.calendarEvent.create({
          data: {
            workspaceId: who.workspaceId,
            title: 'Old import',
            googleEventId: 'legacy-id',
            importedById: who.user.id,
            startsAt: at(2),
            endsAt: at(2, 11),
          },
        });
        ctx.googleCalendar.calendars.set(who.refreshToken, [event('e1', 'Same thing', 2)]);
        const res = await sync(who).expect(200);
        expect(res.body).toMatchObject({ created: 1, removed: 1 });
        expect(await titles(who.workspaceId)).toEqual(['Same thing']);
      });
    });

    describe('Google Tasks', () => {
      const task = (
        listId: string,
        id: string,
        title: string,
        extra: Partial<GoogleTask> = {},
      ): GoogleTask => ({
        id: `${listId}/${id}`,
        title,
        completed: false,
        ...extra,
      });
      const taskRows = (workspaceId: string) =>
        ctx.prisma.task.findMany({ where: { workspaceId }, orderBy: { title: 'asc' } });

      it('imports tasks with notes, due date and done state', async () => {
        const who = await connected();
        const due = new Date(Date.UTC(2030, 5, 3, 12));
        ctx.googleCalendar.tasks.set(who.refreshToken, [
          task('list1', 't1', 'Buy milk', { notes: 'two litres', due }),
          task('list1', 't2', 'Finished thing', { completed: true, completedAt: at(-1) }),
          task('list2', 't3', 'No date'),
        ]);
        const res = await sync(who).expect(200);
        expect(res.body.tasks).toEqual({ status: 'synced', created: 3, updated: 0, removed: 0 });

        const rows = await taskRows(who.workspaceId);
        expect(
          rows.map((r) => [r.title, r.status, r.googleTaskId, r.importedById, r.description]),
        ).toEqual([
          ['Buy milk', 'TODO', 'list1/t1', who.user.id, 'two litres'],
          ['Finished thing', 'DONE', 'list1/t2', who.user.id, null],
          ['No date', 'TODO', 'list2/t3', who.user.id, null],
        ]);
        expect(rows[0].dueDate).toEqual(due);
        expect(rows[1].completedAt).not.toBeNull();
        expect(rows[2].dueDate).toBeNull();
      });

      it('shows imported tasks on the home page lists', async () => {
        const who = await connected();
        ctx.googleCalendar.tasks.set(who.refreshToken, [
          task('l', 't1', 'Soon from Google', { due: new Date(Date.now() + 3600_000) }),
        ]);
        await sync(who).expect(200);
        const overview = await http()
          .get(`/api/workspaces/${who.workspaceId}/overview`)
          .set('Authorization', who.token)
          .expect(200);
        expect(overview.body.openTasks.map((t: { title: string }) => t.title)).toEqual([
          'Soon from Google',
        ]);
      });

      it('updates, completes and removes tasks, and keeps a local in-progress state', async () => {
        const who = await connected();
        ctx.googleCalendar.tasks.set(who.refreshToken, [
          task('l', 'a', 'Write report'),
          task('l', 'b', 'Delete me'),
          task('l', 'c', 'Reopen me', { completed: true, completedAt: at(-1) }),
        ]);
        await sync(who).expect(200);
        await ctx.prisma.task.updateMany({
          where: { title: 'Write report' },
          data: { status: 'IN_PROGRESS' },
        });

        ctx.googleCalendar.tasks.set(who.refreshToken, [
          task('l', 'a', 'Write the report', { notes: 'new notes' }),
          task('l', 'c', 'Reopen me'),
          task('l', 'd', 'Brand new'),
        ]);
        const res = await sync(who).expect(200);
        expect(res.body.tasks).toEqual({ status: 'synced', created: 1, updated: 2, removed: 1 });

        const rows = await taskRows(who.workspaceId);
        expect(rows.map((r) => [r.title, r.status])).toEqual([
          ['Brand new', 'TODO'],
          ['Reopen me', 'TODO'], // done in Google yesterday, open again now
          ['Write the report', 'IN_PROGRESS'], // local progress survives a rename in Google
        ]);
        expect(rows.find((r) => r.title === 'Reopen me')?.completedAt).toBeNull();

        ctx.googleCalendar.tasks.set(who.refreshToken, [
          task('l', 'a', 'Write the report', { completed: true, completedAt: new Date() }),
        ]);
        await sync(who).expect(200);
        expect((await taskRows(who.workspaceId)).map((r) => [r.title, r.status])).toEqual([
          ['Write the report', 'DONE'],
        ]);
      });

      it('skips tasks completed long ago, and leaves local tasks alone', async () => {
        const who = await connected();
        await ctx.prisma.task.create({
          data: { workspaceId: who.workspaceId, title: 'My own task' },
        });
        ctx.googleCalendar.tasks.set(who.refreshToken, [
          task('l', 'old', 'Ancient', { completed: true, completedAt: at(-200) }),
          task('l', 'new', 'Recent'),
        ]);
        await sync(who).expect(200);
        expect((await taskRows(who.workspaceId)).map((r) => r.title)).toEqual([
          'My own task',
          'Recent',
        ]);
        await sync(who).expect(200);
        expect(await ctx.prisma.task.count()).toBe(2);
      });

      it('keeps tasks of a list Google could not read this time', async () => {
        const who = await connected();
        ctx.googleCalendar.tasks.set(who.refreshToken, [
          task('l1', 'a', 'List one'),
          task('l2', 'b', 'List two'),
        ]);
        await sync(who).expect(200);
        ctx.googleCalendar.failedLists.set(who.refreshToken, ['l2']);
        const res = await sync(who).expect(200);
        expect(res.body.tasks.removed).toBe(0);
        expect((await taskRows(who.workspaceId)).map((r) => r.title)).toEqual([
          'List one',
          'List two',
        ]);
      });

      it('never touches another person’s imported tasks', async () => {
        const a = await connected('a@example.com');
        const b = await connected('b@example.com');
        await ctx.prisma.membership.create({
          data: { userId: b.user.id, workspaceId: a.workspaceId, role: 'MEMBER' },
        });
        ctx.googleCalendar.tasks.set(a.refreshToken, [task('la', 'x', 'A task')]);
        ctx.googleCalendar.tasks.set(b.refreshToken, [task('lb', 'y', 'B task')]);
        await sync({ workspaceId: a.workspaceId, token: b.token }).expect(200);
        await sync(a).expect(200);
        expect((await taskRows(a.workspaceId)).map((r) => r.title)).toEqual(['A task', 'B task']);
      });

      it('still imports events when the Tasks API is unavailable, and says so', async () => {
        const who = await connected();
        ctx.googleCalendar.calendars.set(who.refreshToken, [event('e1', 'Lecture', 2)]);
        ctx.googleCalendar.tasks.set(who.refreshToken, [task('l', 'a', 'Never seen')]);
        ctx.googleCalendar.tasksUnavailable.add(who.refreshToken);
        const res = await sync(who).expect(200);
        expect(res.body).toMatchObject({ created: 1, tasks: { status: 'unavailable' } });
        expect(await titles(who.workspaceId)).toEqual(['Lecture']);
        expect(await ctx.prisma.task.count()).toBe(0);
      });

      it('skips tasks when the person did not allow them, and offers to ask again', async () => {
        const who = await person('a@example.com');
        await connect(who, { refreshToken: 'cal-only', scope: `openid ${CALENDAR_SCOPE}` });
        ctx.googleCalendar.calendars.set('cal-only', [event('e1', 'Lecture', 2)]);
        ctx.googleCalendar.tasks.set('cal-only', [task('l', 'a', 'Should stay in Google')]);

        const res = await sync(who).expect(200);
        expect(res.body.tasks).toEqual({ status: 'not-granted' });
        expect(await ctx.prisma.task.count()).toBe(0);

        const status = await http()
          .get(`/api/workspaces/${who.workspaceId}/google-calendar`)
          .set('Authorization', who.token);
        expect(status.body).toMatchObject({ connected: true, tasksGranted: false });
        const home = await http()
          .get(`/admin/workspaces/${who.workspaceId}`)
          .set('Authorization', who.token)
          .set('Accept', 'text/html')
          .expect(200);
        expect(home.text).toContain('Also import Google Tasks');
      });

      it('forgets a revoked grant also when the failure shows up while reading tasks', async () => {
        const who = await connected();
        ctx.googleCalendar.revokedByUser.add(who.refreshToken);
        await sync(who).expect(409);
        expect(await ctx.prisma.googleConnection.count()).toBe(0);
      });
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

  describe('editing Google events from Nook', () => {
    const WRITE = `openid ${CALENDAR_SCOPE} ${TASKS_SCOPE} ${EVENTS_WRITE_SCOPE}`;
    // fixed once: asserting against a clock that keeps moving would be flaky
    const newStart = at(3);
    const newEnd = at(3, 12);
    const body = (extra: Record<string, unknown> = {}) => ({
      title: 'Lecture (moved)',
      description: 'Room 5',
      startsAt: newStart.toISOString(),
      endsAt: newEnd.toISOString(),
      allDay: false,
      ...extra,
    });

    /** Imports one editable event for a person who may (or may not) change Google events, on a Pro or Free plan. */
    async function withEvent(
      options: {
        plan?: 'PRO' | 'FREE';
        scope?: string;
        extra?: Partial<GoogleEvent>;
        email?: string;
      } = {},
    ) {
      const who = await person(options.email ?? 'a@example.com');
      await ctx.prisma.workspace.update({
        where: { id: who.workspaceId },
        data: { plan: options.plan ?? 'PRO' },
      });
      await connect(who, { refreshToken: `rt-${who.user.email}`, scope: options.scope ?? WRITE });
      ctx.googleCalendar.calendars.set(`rt-${who.user.email}`, [
        event('e1', 'Lecture', 2, { description: 'Room 4', recurring: true, ...options.extra }),
      ]);
      await http()
        .post(`/api/workspaces/${who.workspaceId}/google-calendar/sync`)
        .set('Authorization', who.token)
        .expect(200);
      const row = await ctx.prisma.calendarEvent.findFirstOrThrow({
        where: { workspaceId: who.workspaceId },
      });
      const url = `/api/workspaces/${who.workspaceId}/google-calendar/events/${row.id}`;
      return {
        ...who,
        row,
        url,
        patch: (payload: object = body(), token = who.token) =>
          http().patch(url).set('Authorization', token).send(payload),
        del: (token = who.token) => http().delete(url).set('Authorization', token),
      };
    }

    it('remembers what Google says about an imported event: editable, repeating, link', async () => {
      const w = await withEvent({ extra: { url: 'https://calendar.google.com/e/1' } });
      expect(w.row).toMatchObject({
        googleEditable: true,
        recurring: true,
        googleUrl: 'https://calendar.google.com/e/1',
        googleCalendarId: 'primary',
      });
    });

    it('sends the change to Google and mirrors Google’s answer here', async () => {
      const w = await withEvent();
      const res = await w.patch().expect(200);
      expect(res.body).toMatchObject({ title: 'Lecture (moved)', description: 'Room 5' });

      expect(ctx.googleCalendar.updates).toHaveLength(1);
      expect(ctx.googleCalendar.updates[0]).toMatchObject({
        calendarId: 'primary',
        eventId: 'e1', // Google's own id, not Nook's composite one
        changes: { title: 'Lecture (moved)', description: 'Room 5', allDay: false },
      });
      const stored = await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: w.row.id } });
      expect(stored.title).toBe('Lecture (moved)');
      expect(stored.startsAt.toISOString()).toBe(newStart.toISOString());
      expect(stored.googleUrl).toContain('updated');
      expect(stored.googleEventId).toBe(w.row.googleEventId); // still the same event
    });

    it('can turn an event into an all-day one, and clear its description', async () => {
      const w = await withEvent();
      const midnight = (days: number) => new Date(new Date(at(days)).setUTCHours(0, 0, 0, 0));
      await w
        .patch(
          body({
            description: '',
            allDay: true,
            startsAt: midnight(3).toISOString(),
            endsAt: midnight(4).toISOString(),
          }),
        )
        .expect(200);
      expect(ctx.googleCalendar.updates[0].changes).toMatchObject({
        description: null,
        allDay: true,
      });
      expect(
        await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: w.row.id } }),
      ).toMatchObject({ allDay: true, description: null });
    });

    it('validates the change before bothering Google', async () => {
      const w = await withEvent();
      await w.patch(body({ endsAt: at(3, 8).toISOString() })).expect(400); // ends before it starts
      await w.patch(body({ title: '' })).expect(400);
      await w.patch(body({ title: 'x'.repeat(201) })).expect(400);
      await w.patch(body({ startsAt: 'tomorrow' })).expect(400);
      await w.patch({ title: 'only a title' }).expect(400);
      const day = new Date(new Date(at(3)).setUTCHours(0, 0, 0, 0));
      await w
        .patch(body({ allDay: true, startsAt: day.toISOString(), endsAt: day.toISOString() }))
        .expect(400); // an all-day event lasts at least a day
      expect(ctx.googleCalendar.updates).toHaveLength(0);
    });

    it('is a Pro feature', async () => {
      const w = await withEvent({ plan: 'FREE' });
      const res = await w.patch().expect(403);
      expect(res.body).toMatchObject({
        code: 'FEATURE_NOT_AVAILABLE',
        feature: 'google-two-way-sync',
        requiredPlan: 'PRO',
      });
      await w.del().expect(403);
      expect(ctx.googleCalendar.updates).toHaveLength(0);
      expect(ctx.googleCalendar.deletions).toHaveLength(0);
    });

    it('needs the separate permission to change Google events, and says how to get it', async () => {
      const w = await withEvent({ scope: `openid ${CALENDAR_SCOPE} ${TASKS_SCOPE}` });
      const res = await w.patch().expect(403);
      expect(res.body.code).toBe('GOOGLE_WRITE_NOT_GRANTED');
      await w.del().expect(403);
      expect(ctx.googleCalendar.updates).toHaveLength(0);
    });

    it('asks for that permission only when the person chooses to', async () => {
      const who = await person('a@example.com');
      await who.agent.get('/api/google-calendar/connect');
      expect(ctx.googleCalendar.lastAuthorizationUrl?.searchParams.get('scope')).not.toContain(
        EVENTS_WRITE_SCOPE,
      );
      await who.agent.get('/api/google-calendar/connect?edit=1');
      expect(ctx.googleCalendar.lastAuthorizationUrl?.searchParams.get('scope')).toContain(
        EVENTS_WRITE_SCOPE,
      );
    });

    it('lets only the person whose calendar it came from change it', async () => {
      const w = await withEvent();
      const colleague = await person('colleague@example.com');
      await ctx.prisma.membership.create({
        data: { userId: colleague.user.id, workspaceId: w.workspaceId, role: 'ADMIN' },
      });
      await connect(colleague, { refreshToken: 'rt-colleague', scope: WRITE });
      const res = await w.patch(body(), colleague.token).expect(403);
      expect(res.body.message).toContain('someone else');
      await w.del(colleague.token).expect(403);
      expect(ctx.googleCalendar.updates).toHaveLength(0);
    });

    it('refuses events Google would not let the person change', async () => {
      const w = await withEvent({ extra: { editable: false } });
      expect((await w.patch().expect(403)).body.message).toContain('read-only');
      await w.del().expect(403);
      expect(ctx.googleCalendar.updates).toHaveLength(0);
    });

    it('does not treat Nook’s own events as Google events, and keeps them off the Google routes', async () => {
      const w = await withEvent();
      const own = await ctx.prisma.calendarEvent.create({
        data: { workspaceId: w.workspaceId, title: 'Mine', startsAt: at(1), endsAt: at(1, 11) },
      });
      const url = `/api/workspaces/${w.workspaceId}/google-calendar/events/${own.id}`;
      await http().patch(url).set('Authorization', w.token).send(body()).expect(404);
      await http().delete(url).set('Authorization', w.token).expect(404);
    });

    it('does not reach events of another workspace', async () => {
      const w = await withEvent();
      const stranger = await person('stranger@example.com');
      await http().patch(w.url).set('Authorization', stranger.token).send(body()).expect(404);
      await http()
        .patch(`/api/workspaces/${stranger.workspaceId}/google-calendar/events/${w.row.id}`)
        .set('Authorization', stranger.token)
        .send(body())
        .expect(403); // personal workspace on the Free plan, and still not their event
      await http().patch(w.url).send(body()).expect(401);
      expect(ctx.googleCalendar.updates).toHaveLength(0);
    });

    it('keeps the local event unchanged when Google refuses (for example a guest of the event)', async () => {
      const w = await withEvent();
      ctx.googleCalendar.writeError = new GoogleForbiddenError('guest');
      const res = await w.patch().expect(403);
      expect(res.body.message).toContain('only a guest');
      await w.del().expect(403);
      expect(
        await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: w.row.id } }),
      ).toMatchObject({ title: 'Lecture' });
    });

    it('removes the local copy when the event was already deleted in Google', async () => {
      const w = await withEvent();
      ctx.googleCalendar.writeError = new GoogleEventGoneError('gone');
      await w.patch().expect(410);
      expect(await ctx.prisma.calendarEvent.count()).toBe(0);
    });

    it('forgets the connection when Google no longer accepts it', async () => {
      const w = await withEvent();
      ctx.googleCalendar.revokedByUser.add(`rt-${w.user.email}`);
      await w.patch().expect(409);
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
    });

    it('deletes in Google first, then here', async () => {
      const w = await withEvent();
      await w.del().expect(204);
      expect(ctx.googleCalendar.deletions).toEqual([{ calendarId: 'primary', eventId: 'e1' }]);
      expect(await ctx.prisma.calendarEvent.count()).toBe(0);
    });

    it('keeps the event here when deleting in Google failed', async () => {
      const w = await withEvent();
      ctx.googleCalendar.writeError = new GoogleForbiddenError('guest');
      await w.del().expect(403);
      expect(await ctx.prisma.calendarEvent.count()).toBe(1);
    });

    it('stops the general events API from editing or deleting events that belong to Google', async () => {
      const w = await withEvent();
      const base = `/api/workspaces/${w.workspaceId}/events/${w.row.id}`;
      await http().patch(base).set('Authorization', w.token).send({ title: 'sneaky' }).expect(409);
      await http().delete(base).set('Authorization', w.token).expect(409);
      expect(
        await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: w.row.id } }),
      ).toMatchObject({ title: 'Lecture' });
    });

    it('tells the calendar what the viewer may do', async () => {
      const w = await withEvent();
      const window = `from=${encodeURIComponent(at(0).toISOString())}&to=${encodeURIComponent(at(10).toISOString())}`;
      const mine = await http()
        .get(`/api/workspaces/${w.workspaceId}/calendar?${window}`)
        .set('Authorization', w.token)
        .expect(200);
      expect(mine.body.google).toEqual({ connected: true, editGranted: true, twoWay: true });
      expect(mine.body.events[0]).toMatchObject({
        imported: true,
        mine: true,
        editable: true,
        recurring: true,
      });
      expect(JSON.stringify(mine.body)).not.toContain('importedById');

      const other = await person('other@example.com');
      await ctx.prisma.membership.create({
        data: { userId: other.user.id, workspaceId: w.workspaceId, role: 'MEMBER' },
      });
      const theirs = await http()
        .get(`/api/workspaces/${w.workspaceId}/calendar?${window}`)
        .set('Authorization', other.token)
        .expect(200);
      expect(theirs.body.events[0]).toMatchObject({ imported: true, mine: false });
      expect(theirs.body.google.connected).toBe(false);
    });

    it('offers the permission on the workspace home when it is missing', async () => {
      const w = await withEvent({ scope: `openid ${CALENDAR_SCOPE} ${TASKS_SCOPE}` });
      const home = await http()
        .get(`/admin/workspaces/${w.workspaceId}`)
        .set('Authorization', w.token)
        .set('Accept', 'text/html')
        .expect(200);
      expect(home.text).toContain('connect?edit=1');
      expect(home.text).toContain('Allow editing Google events');
    });
  });

  describe('creating events that go to Google', () => {
    const WRITE = `openid ${CALENDAR_SCOPE} ${TASKS_SCOPE} ${EVENTS_WRITE_SCOPE}`;
    // fixed once: asserting against a clock that keeps moving would be flaky
    const start = at(4);
    const end = at(4, 11);
    const body = (extra: Record<string, unknown> = {}) => ({
      title: 'Dentist',
      description: 'Bring the card',
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      allDay: false,
      ...extra,
    });

    async function ready(options: { plan?: 'PRO' | 'FREE'; scope?: string } = {}) {
      const who = await person('a@example.com');
      await ctx.prisma.workspace.update({
        where: { id: who.workspaceId },
        data: { plan: options.plan ?? 'PRO' },
      });
      await connect(who, { refreshToken: 'rt-create', scope: options.scope ?? WRITE });
      const url = `/api/workspaces/${who.workspaceId}/google-calendar/events`;
      return {
        ...who,
        url,
        post: (payload: object = body(), token = who.token) =>
          http().post(url).set('Authorization', token).send(payload),
      };
    }

    it('creates the event in Google and keeps it here as the person’s own Google event', async () => {
      const w = await ready();
      const res = await w.post().expect(201);
      expect(res.body).toMatchObject({ title: 'Dentist', description: 'Bring the card' });

      expect(ctx.googleCalendar.creations).toHaveLength(1);
      expect(ctx.googleCalendar.creations[0]).toMatchObject({
        title: 'Dentist',
        description: 'Bring the card',
        allDay: false,
      });
      const row = await ctx.prisma.calendarEvent.findFirstOrThrow();
      expect(row).toMatchObject({
        workspaceId: w.workspaceId,
        importedById: w.user.id,
        googleCalendarId: 'main@example.com',
        calendarName: 'Main calendar',
        googleEditable: true,
        googleEventId: 'main@example.com/created-1',
      });
      expect(row.googleUrl).toContain('created');
      expect(row.startsAt.toISOString()).toBe(start.toISOString());
    });

    it('is not duplicated by the next sync', async () => {
      const w = await ready();
      await w.post().expect(201);
      const sync = await http()
        .post(`/api/workspaces/${w.workspaceId}/google-calendar/sync`)
        .set('Authorization', w.token)
        .expect(200);
      expect(sync.body).toMatchObject({ created: 0, updated: 1, removed: 0 });
      expect(await ctx.prisma.calendarEvent.count()).toBe(1);
    });

    it('can be edited right away through the Google routes', async () => {
      const w = await ready();
      const created = (await w.post().expect(201)).body;
      await http()
        .patch(`${w.url}/${created.id}`)
        .set('Authorization', w.token)
        .send(body({ title: 'Dentist (moved)' }))
        .expect(200);
      expect(ctx.googleCalendar.updates[0]).toMatchObject({
        calendarId: 'main@example.com',
        eventId: 'created-1',
      });
    });

    it('creates all-day events and events without a description', async () => {
      const w = await ready();
      const day = new Date(new Date(at(5)).setUTCHours(0, 0, 0, 0));
      const next = new Date(day.getTime() + DAY);
      await w
        .post(
          body({
            description: null,
            allDay: true,
            startsAt: day.toISOString(),
            endsAt: next.toISOString(),
          }),
        )
        .expect(201);
      expect(ctx.googleCalendar.creations[0]).toMatchObject({ description: null, allDay: true });
      expect(await ctx.prisma.calendarEvent.findFirstOrThrow()).toMatchObject({
        allDay: true,
        description: null,
      });
    });

    it('validates the event before bothering Google', async () => {
      const w = await ready();
      await w.post(body({ endsAt: at(4, 9).toISOString() })).expect(400);
      await w.post(body({ title: '' })).expect(400);
      await w.post(body({ startsAt: 'tomorrow' })).expect(400);
      await w.post({ title: 'only a title' }).expect(400);
      await w.post(body({ extra: 'nope' })).expect(400);
      const day = new Date(new Date(at(4)).setUTCHours(0, 0, 0, 0));
      await w
        .post(body({ allDay: true, startsAt: day.toISOString(), endsAt: day.toISOString() }))
        .expect(400);
      expect(ctx.googleCalendar.creations).toHaveLength(0);
      expect(await ctx.prisma.calendarEvent.count()).toBe(0);
    });

    it('is a Pro feature', async () => {
      const w = await ready({ plan: 'FREE' });
      const res = await w.post().expect(403);
      expect(res.body).toMatchObject({
        code: 'FEATURE_NOT_AVAILABLE',
        feature: 'google-two-way-sync',
      });
      expect(ctx.googleCalendar.creations).toHaveLength(0);
    });

    it('needs the permission to change Google events', async () => {
      const w = await ready({ scope: `openid ${CALENDAR_SCOPE} ${TASKS_SCOPE}` });
      expect((await w.post().expect(403)).body.code).toBe('GOOGLE_WRITE_NOT_GRANTED');
      expect(ctx.googleCalendar.creations).toHaveLength(0);
      expect(await ctx.prisma.calendarEvent.count()).toBe(0);
    });

    it('needs a connected Google Calendar', async () => {
      const who = await person('a@example.com');
      await ctx.prisma.workspace.update({ where: { id: who.workspaceId }, data: { plan: 'PRO' } });
      await http()
        .post(`/api/workspaces/${who.workspaceId}/google-calendar/events`)
        .set('Authorization', who.token)
        .send(body())
        .expect(409);
    });

    it('stores nothing when Google refuses', async () => {
      const w = await ready();
      ctx.googleCalendar.writeError = new GoogleForbiddenError('read-only');
      const res = await w.post().expect(403);
      expect(res.body.message).toContain('add events');
      expect(await ctx.prisma.calendarEvent.count()).toBe(0);
    });

    it('forgets the connection when Google no longer accepts it', async () => {
      const w = await ready();
      ctx.googleCalendar.revokedByUser.add('rt-create');
      await w.post().expect(409);
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
      expect(await ctx.prisma.calendarEvent.count()).toBe(0);
    });

    it('is closed to outsiders and anonymous callers', async () => {
      const w = await ready();
      const stranger = await person('stranger@example.com');
      await w.post(body(), stranger.token).expect(404);
      await http().post(w.url).send(body()).expect(401);
      expect(ctx.googleCalendar.creations).toHaveLength(0);
    });

    it('shows the new event in the calendar as the viewer’s editable Google event', async () => {
      const w = await ready();
      await w.post().expect(201);
      const window = `from=${encodeURIComponent(at(0).toISOString())}&to=${encodeURIComponent(at(10).toISOString())}`;
      const res = await http()
        .get(`/api/workspaces/${w.workspaceId}/calendar?${window}`)
        .set('Authorization', w.token)
        .expect(200);
      expect(res.body.events[0]).toMatchObject({
        title: 'Dentist',
        imported: true,
        mine: true,
        editable: true,
        calendarName: 'Main calendar',
      });
    });
  });

  describe('disconnecting', () => {
    it('forgets the connection and only that person’s imports (events and tasks), and tells Google', async () => {
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
      await ctx.prisma.task.create({ data: { workspaceId: a.workspaceId, title: 'Manual task' } });
      ctx.googleCalendar.tasks.set('token-a', [
        { id: 'l/ta', title: 'A google task', completed: false },
      ]);
      ctx.googleCalendar.tasks.set('token-b', [
        { id: 'l/tb', title: 'B google task', completed: false },
      ]);
      await http()
        .post(`/api/workspaces/${a.workspaceId}/google-calendar/sync`)
        .set('Authorization', a.token)
        .expect(200);
      await http()
        .post(`/api/workspaces/${b.workspaceId}/google-calendar/sync`)
        .set('Authorization', b.token)
        .expect(200);

      await http().delete('/api/google-calendar').set('Authorization', a.token).expect(204);

      expect(
        await ctx.prisma.googleConnection.findUnique({ where: { userId: a.user.id } }),
      ).toBeNull();
      expect(
        await ctx.prisma.googleConnection.findUnique({ where: { userId: b.user.id } }),
      ).not.toBeNull();
      const left = (await ctx.prisma.calendarEvent.findMany()).map((e) => e.title).sort();
      expect(left).toEqual(['B event', 'Manual']);
      expect((await ctx.prisma.task.findMany()).map((t) => t.title).sort()).toEqual([
        'B google task',
        'Manual task',
      ]);
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
      expect(synced.headers.location).toBe(
        `/admin/workspaces/${who.workspaceId}?flash=synced&events=1&tasks=0`,
      );
      const after = await http()
        .get(synced.headers.location)
        .set('Authorization', who.token)
        .set('Accept', 'text/html')
        .expect(200);
      expect(after.text).toContain('Google Calendar synced: 1 events and 0 tasks.');
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

    it('explains when tasks were left out, and ignores anything else in the URL', async () => {
      const who = await person('a@example.com');
      const note = (query: string) =>
        http()
          .get(`/admin/workspaces/${who.workspaceId}?${query}`)
          .set('Authorization', who.token)
          .set('Accept', 'text/html');
      expect((await note('flash=synced&events=3&tasksNote=not-granted')).text).toContain(
        'Google Tasks were not imported',
      );
      expect((await note('flash=synced&events=3&tasksNote=unavailable')).text).toContain(
        'Google Tasks API is enabled',
      );
      expect((await note('flash=synced&events=3&tasks=2')).text).toContain('3 events and 2 tasks');
      await note('flash=synced&events=<script>').expect(400);
      await note('flash=synced&tasksNote=<b>x</b>').expect(400);
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
