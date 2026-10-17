import { BadGatewayException } from '@nestjs/common';
import { GoogleCalendarGoogle, toEvent, toTask } from './google-calendar.google.js';
import {
  CALENDAR_SCOPE,
  GoogleAccessRevokedError,
  GoogleTasksUnavailableError,
  TASKS_SCOPE,
} from './google-calendar.provider.js';

const calendar = { id: 'primary', name: 'Personal' };

describe('toEvent', () => {
  it('maps a timed event and says which calendar it belongs to', () => {
    const event = toEvent(
      {
        id: 'a',
        summary: 'Lecture',
        description: 'Room 4',
        start: { dateTime: '2030-05-01T10:00:00+03:00' },
        end: { dateTime: '2030-05-01T11:30:00+03:00' },
      },
      calendar,
    );
    expect(event).toEqual({
      id: 'primary/a',
      calendarId: 'primary',
      calendarName: 'Personal',
      title: 'Lecture',
      description: 'Room 4',
      startsAt: new Date('2030-05-01T07:00:00Z'),
      endsAt: new Date('2030-05-01T08:30:00Z'),
      allDay: false,
    });
  });

  it('keeps the same event id of two calendars apart', () => {
    const raw = {
      id: 'same',
      start: { dateTime: '2030-05-01T10:00:00Z' },
      end: { dateTime: '2030-05-01T11:00:00Z' },
    };
    expect(toEvent(raw, calendar)?.id).not.toBe(toEvent(raw, { id: 'uni', name: 'Uni' })?.id);
  });

  it('maps an all-day event to plain UTC dates with an exclusive end', () => {
    const event = toEvent(
      { id: 'b', summary: 'Holiday', start: { date: '2030-05-01' }, end: { date: '2030-05-03' } },
      calendar,
    );
    expect(event).toMatchObject({
      allDay: true,
      startsAt: new Date('2030-05-01T00:00:00Z'),
      endsAt: new Date('2030-05-03T00:00:00Z'),
    });
  });

  it('skips cancelled and incomplete events', () => {
    const when = { dateTime: '2030-05-01T10:00:00Z' };
    expect(toEvent({ id: 'c', status: 'cancelled', start: when, end: when }, calendar)).toBeNull();
    expect(toEvent({ id: 'c', start: when }, calendar)).toBeNull();
    expect(toEvent({ id: 'c', start: { dateTime: 'nonsense' }, end: when }, calendar)).toBeNull();
  });

  it('gives untitled and zero-length events something to show', () => {
    const at = { dateTime: '2030-05-01T10:00:00Z' };
    const event = toEvent({ id: 'd', start: at, end: at }, calendar);
    expect(event?.title).toBe('(no title)');
    expect(event!.endsAt.getTime() - event!.startsAt.getTime()).toBe(60_000);
  });

  it('shortens very long titles and calendar names', () => {
    const at = { dateTime: '2030-05-01T10:00:00Z' };
    const end = { dateTime: '2030-05-01T11:00:00Z' };
    const event = toEvent(
      { id: 'e', summary: 'x'.repeat(500), start: at, end },
      { id: 'c', name: 'n'.repeat(500) },
    );
    expect(event?.title).toHaveLength(200);
    expect(event?.calendarName).toHaveLength(200);
  });
});

describe('toTask', () => {
  const since = new Date('2030-04-01T00:00:00Z');

  it('maps an open task, turning the due date into noon UTC of that day', () => {
    expect(
      toTask(
        {
          id: 't',
          title: 'Buy milk',
          notes: 'two litres',
          status: 'needsAction',
          due: '2030-05-03T00:00:00.000Z',
        },
        'list',
        since,
      ),
    ).toEqual({
      id: 'list/t',
      title: 'Buy milk',
      notes: 'two litres',
      due: new Date('2030-05-03T12:00:00Z'),
      completed: false,
      completedAt: undefined,
    });
  });

  it('keeps recently completed tasks and drops old or undated completions', () => {
    const done = { id: 't', title: 'x', status: 'completed' };
    expect(toTask({ ...done, completed: '2030-04-20T10:00:00Z' }, 'l', since)).toMatchObject({
      completed: true,
      completedAt: new Date('2030-04-20T10:00:00Z'),
    });
    expect(toTask({ ...done, completed: '2030-01-01T10:00:00Z' }, 'l', since)).toBeNull();
    expect(toTask({ ...done }, 'l', since)).toBeNull();
  });

  it('skips deleted tasks and names untitled ones', () => {
    expect(toTask({ id: 't', deleted: true }, 'l', since)).toBeNull();
    expect(toTask({ id: 't', status: 'needsAction' }, 'l', since)?.title).toBe('(no title)');
  });
});

/** Replaces fetch: each entry answers the first request whose URL contains `match`. */
type Route = { match: string; status?: number; body?: unknown };
function stubGoogle(routes: Route[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = String(input);
      calls.push(url);
      const route = routes.find((r) => url.includes(r.match));
      if (!route) throw new Error(`unexpected request ${url}`);
      const status = route.status ?? 200;
      return new Response(JSON.stringify(route.body ?? {}), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const token = { match: 'oauth2.googleapis.com/token', body: { access_token: 'access' } };
const window = { from: new Date('2030-05-01T00:00:00Z'), to: new Date('2030-06-01T00:00:00Z') };
const ev = (id: string, extra: object = {}) => ({
  id,
  summary: id,
  start: { dateTime: '2030-05-10T10:00:00Z' },
  end: { dateTime: '2030-05-10T11:00:00Z' },
  ...extra,
});

describe('GoogleCalendarGoogle', () => {
  const provider = new GoogleCalendarGoogle();
  afterEach(() => vi.unstubAllGlobals());

  it('asks for calendar and tasks access, offline, with PKCE', () => {
    const url = new URL(
      provider.authorizationUrl({ state: 's', codeChallenge: 'c', redirectUri: 'http://x/cb' }),
    );
    expect(url.searchParams.get('scope')).toBe(`${CALENDAR_SCOPE} ${TASKS_SCOPE}`);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  describe('listEvents', () => {
    it('reads every calendar that is switched on, the main one first, and skips hidden ones', async () => {
      const calls = stubGoogle([
        token,
        {
          match: 'calendarList',
          body: {
            items: [
              { id: 'uni', summary: 'University', selected: true },
              { id: 'hidden', summary: 'Hidden', selected: false },
              { id: 'me@x.com', summary: 'me@x.com', primary: true, selected: true },
              { id: 'holidays', summary: 'Holidays', summaryOverride: 'Свята', selected: true },
            ],
          },
        },
        { match: 'calendars/me%40x.com/events', body: { items: [ev('mine')] } },
        { match: 'calendars/uni/events', body: { items: [ev('lecture')] } },
        { match: 'calendars/holidays/events', body: { items: [ev('holiday')] } },
      ]);

      const { events, failedCalendarIds } = await provider.listEvents({
        refreshToken: 'r',
        ...window,
      });
      expect(events.map((e) => [e.calendarName, e.title])).toEqual([
        ['me@x.com', 'mine'],
        ['University', 'lecture'],
        ['Свята', 'holiday'],
      ]);
      expect(failedCalendarIds).toEqual([]);
      expect(calls.some((url) => url.includes('hidden'))).toBe(false);
      expect(calls.find((url) => url.includes('calendarList'))).toContain('minAccessRole=reader');
    });

    it('shows an event that sits in two calendars only once', async () => {
      stubGoogle([
        token,
        {
          match: 'calendarList',
          body: {
            items: [
              { id: 'me', primary: true, selected: true },
              { id: 'team', selected: true },
            ],
          },
        },
        {
          match: 'calendars/me/events',
          body: { items: [ev('m', { iCalUID: 'shared@google.com' })] },
        },
        {
          match: 'calendars/team/events',
          body: {
            items: [
              ev('t', { iCalUID: 'shared@google.com' }),
              ev('only-team', { iCalUID: 'other' }),
            ],
          },
        },
      ]);
      const { events } = await provider.listEvents({ refreshToken: 'r', ...window });
      expect(events.map((e) => e.title)).toEqual(['m', 'only-team']);
    });

    it('follows pagination', async () => {
      const calls: string[] = [];
      let page = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: URL | string) => {
          const url = String(input);
          calls.push(url);
          const json = (body: unknown) => new Response(JSON.stringify(body));
          if (url.includes('oauth2')) return json({ access_token: 'a' });
          if (url.includes('calendarList')) return json({ items: [{ id: 'me', primary: true }] });
          page += 1;
          return page === 1
            ? json({ items: [ev('first')], nextPageToken: 'next' })
            : json({ items: [ev('second')] });
        }),
      );
      const { events } = await provider.listEvents({ refreshToken: 'r', ...window });
      expect(events.map((e) => e.title)).toEqual(['first', 'second']);
      expect(calls.at(-1)).toContain('pageToken=next');
    });

    it('reports a calendar it may not read instead of failing everything', async () => {
      stubGoogle([
        token,
        {
          match: 'calendarList',
          body: {
            items: [
              { id: 'me', primary: true, selected: true },
              { id: 'locked', selected: true },
              { id: 'gone', selected: true },
            ],
          },
        },
        { match: 'calendars/me/events', body: { items: [ev('mine')] } },
        { match: 'calendars/locked/events', status: 403 },
        { match: 'calendars/gone/events', status: 404 },
      ]);
      const { events, failedCalendarIds } = await provider.listEvents({
        refreshToken: 'r',
        ...window,
      });
      expect(events.map((e) => e.title)).toEqual(['mine']);
      expect(failedCalendarIds).toEqual(['locked', 'gone']);
    });

    it('treats 401 and invalid_grant as a revoked grant, but a disabled API as a plain error', async () => {
      stubGoogle([token, { match: 'calendarList', status: 401 }]);
      await expect(provider.listEvents({ refreshToken: 'r', ...window })).rejects.toBeInstanceOf(
        GoogleAccessRevokedError,
      );

      stubGoogle([
        { match: 'oauth2.googleapis.com/token', status: 400, body: { error: 'invalid_grant' } },
      ]);
      await expect(provider.listEvents({ refreshToken: 'r', ...window })).rejects.toBeInstanceOf(
        GoogleAccessRevokedError,
      );

      // 403 on the calendar list is "API not enabled" far more often than "revoked":
      // dropping the connection for it would be wrong
      stubGoogle([token, { match: 'calendarList', status: 403 }]);
      const error = await provider.listEvents({ refreshToken: 'r', ...window }).catch((e) => e);
      expect(error).toBeInstanceOf(BadGatewayException);
      expect(error).not.toBeInstanceOf(GoogleAccessRevokedError);
    });
  });

  describe('listTasks', () => {
    const since = new Date('2030-04-01T00:00:00Z');

    it('reads every task list, including completed tasks, and applies the recency rule', async () => {
      const calls = stubGoogle([
        token,
        { match: 'users/@me/lists', body: { items: [{ id: 'l1' }, { id: 'l2' }] } },
        {
          match: 'lists/l1/tasks',
          body: {
            items: [
              { id: 'a', title: 'Open', status: 'needsAction' },
              {
                id: 'b',
                title: 'Old done',
                status: 'completed',
                completed: '2030-01-01T00:00:00Z',
              },
            ],
          },
        },
        {
          match: 'lists/l2/tasks',
          body: {
            items: [
              {
                id: 'c',
                title: 'Fresh done',
                status: 'completed',
                completed: '2030-04-20T00:00:00Z',
              },
              { id: 'd', title: 'Deleted', deleted: true },
            ],
          },
        },
      ]);
      const { tasks, failedListIds } = await provider.listTasks({
        refreshToken: 'r',
        completedSince: since,
      });
      expect(tasks.map((t) => [t.id, t.completed])).toEqual([
        ['l1/a', false],
        ['l2/c', true],
      ]);
      expect(failedListIds).toEqual([]);
      const request = calls.find((url) => url.includes('lists/l1/tasks'))!;
      expect(request).toContain('showCompleted=true');
      expect(request).toContain('showHidden=true');
    });

    it('reports a list it cannot read', async () => {
      stubGoogle([
        token,
        { match: 'users/@me/lists', body: { items: [{ id: 'ok' }, { id: 'locked' }] } },
        {
          match: 'lists/ok/tasks',
          body: { items: [{ id: 'a', title: 'A', status: 'needsAction' }] },
        },
        { match: 'lists/locked/tasks', status: 403 },
      ]);
      const result = await provider.listTasks({ refreshToken: 'r', completedSince: since });
      expect(result.tasks).toHaveLength(1);
      expect(result.failedListIds).toEqual(['locked']);
    });

    it('says the Tasks API is unavailable when Google refuses the list of lists', async () => {
      stubGoogle([token, { match: 'users/@me/lists', status: 403 }]);
      await expect(
        provider.listTasks({ refreshToken: 'r', completedSince: since }),
      ).rejects.toBeInstanceOf(GoogleTasksUnavailableError);
    });
  });
});
