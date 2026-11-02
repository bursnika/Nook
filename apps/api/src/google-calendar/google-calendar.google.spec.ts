import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { GoogleCalendarGoogle, toEvent, toTask } from './google-calendar.google.js';
import {
  CALENDAR_SCOPE,
  EVENTS_WRITE_SCOPE,
  GoogleAccessRevokedError,
  GoogleEventGoneError,
  GoogleForbiddenError,
  GoogleTasksUnavailableError,
  TASKS_SCOPE,
  type EventChanges,
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
      editable: false,
      recurring: false,
      url: undefined,
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

describe('toEvent: what may be changed', () => {
  const when = {
    start: { dateTime: '2030-05-01T10:00:00Z' },
    end: { dateTime: '2030-05-01T11:00:00Z' },
  };
  const writable = { id: 'c', name: 'C', editable: true };

  it('is editable only in a calendar the person can write to', () => {
    expect(toEvent({ id: 'a', ...when }, writable)?.editable).toBe(true);
    expect(toEvent({ id: 'a', ...when }, { id: 'c', name: 'C', editable: false })?.editable).toBe(
      false,
    );
    expect(toEvent({ id: 'a', ...when }, { id: 'c', name: 'C' })?.editable).toBe(false);
  });

  it('is never editable for birthdays, events from Gmail and locked events', () => {
    for (const extra of [{ eventType: 'birthday' }, { eventType: 'fromGmail' }, { locked: true }]) {
      expect(toEvent({ id: 'a', ...when, ...extra }, writable)?.editable).toBe(false);
    }
    expect(toEvent({ id: 'a', ...when, eventType: 'default' }, writable)?.editable).toBe(true);
  });

  it('knows an occurrence of a repeating event, and keeps the link to Google', () => {
    const event = toEvent(
      {
        id: 'a_20300501T100000Z',
        recurringEventId: 'a',
        htmlLink: 'https://calendar.google.com/e',
        ...when,
      },
      writable,
    );
    expect(event).toMatchObject({ recurring: true, url: 'https://calendar.google.com/e' });
    expect(toEvent({ id: 'b', ...when }, writable)?.recurring).toBe(false);
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

      // 403 on the calendar list usually means the api is off, not revoked
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

  describe('writing events', () => {
    const calendarRef = { id: 'me@x.com', name: 'Personal' };
    const timed: EventChanges = {
      title: 'Moved lecture',
      description: 'Room 5',
      startsAt: new Date('2030-05-10T10:00:00Z'),
      endsAt: new Date('2030-05-10T11:30:00Z'),
      allDay: false,
    };
    const answer = {
      id: 'evt1',
      summary: 'Moved lecture',
      start: { dateTime: '2030-05-10T10:00:00Z' },
      end: { dateTime: '2030-05-10T11:30:00Z' },
      htmlLink: 'https://calendar.google.com/e',
    };

    function stubWrite(status: number, body: unknown = answer) {
      const sent: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      }[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: URL | string, init?: RequestInit) => {
          const url = String(input);
          if (url.includes('oauth2'))
            return new Response(JSON.stringify({ access_token: 'access' }));
          sent.push({
            url,
            method: init?.method,
            headers: init?.headers as Record<string, string>,
            body: init?.body as string | undefined,
          });
          return new Response(status === 204 ? null : JSON.stringify(body), { status });
        }),
      );
      return sent;
    }
    const update = (changes = timed) =>
      provider.updateEvent({ refreshToken: 'r', calendar: calendarRef, eventId: 'evt1', changes });

    it('patches the right event without e-mailing guests, and returns it as Google now has it', async () => {
      const sent = stubWrite(200);
      const event = await update();
      expect(sent).toHaveLength(1);
      expect(sent[0].method).toBe('PATCH');
      expect(sent[0].url).toBe(
        'https://www.googleapis.com/calendar/v3/calendars/me%40x.com/events/evt1?sendUpdates=none',
      );
      expect(sent[0].headers).toMatchObject({ authorization: 'Bearer access' });
      expect(event).toMatchObject({
        id: 'me@x.com/evt1',
        title: 'Moved lecture',
        calendarName: 'Personal',
        editable: true,
        url: 'https://calendar.google.com/e',
      });
    });

    it('sends instants for timed events and clears the date', async () => {
      const sent = stubWrite(200);
      await update();
      expect(JSON.parse(sent[0].body!)).toEqual({
        summary: 'Moved lecture',
        description: 'Room 5',
        start: { dateTime: '2030-05-10T10:00:00.000Z', date: null },
        end: { dateTime: '2030-05-10T11:30:00.000Z', date: null },
      });
    });

    it('sends plain dates for all-day events and clears the time', async () => {
      const sent = stubWrite(200, {
        ...answer,
        start: { date: '2030-05-10' },
        end: { date: '2030-05-12' },
      });
      const event = await update({
        ...timed,
        description: null,
        allDay: true,
        startsAt: new Date('2030-05-10T00:00:00Z'),
        endsAt: new Date('2030-05-12T00:00:00Z'),
      });
      expect(JSON.parse(sent[0].body!)).toMatchObject({
        description: null,
        start: { date: '2030-05-10', dateTime: null },
        end: { date: '2030-05-12', dateTime: null },
      });
      expect(event.allDay).toBe(true);
    });

    it('turns Google’s refusals into typed errors', async () => {
      stubWrite(401);
      await expect(update()).rejects.toBeInstanceOf(GoogleAccessRevokedError);
      stubWrite(403);
      await expect(update()).rejects.toBeInstanceOf(GoogleForbiddenError);
      stubWrite(404);
      await expect(update()).rejects.toBeInstanceOf(GoogleEventGoneError);
      stubWrite(410);
      await expect(update()).rejects.toBeInstanceOf(GoogleEventGoneError);
      stubWrite(400);
      await expect(update()).rejects.toBeInstanceOf(BadRequestException);
      stubWrite(500);
      await expect(update()).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('treats a cancelled answer as gone', async () => {
      stubWrite(200, { ...answer, status: 'cancelled' });
      await expect(update()).rejects.toBeInstanceOf(GoogleEventGoneError);
    });

    it('deletes without e-mailing guests, and counts "already gone" as done', async () => {
      const del = () =>
        provider.deleteEvent({ refreshToken: 'r', calendarId: 'me@x.com', eventId: 'evt1' });
      const sent = stubWrite(204);
      await del();
      expect(sent[0].method).toBe('DELETE');
      expect(sent[0].url).toContain('/calendars/me%40x.com/events/evt1?sendUpdates=none');
      stubWrite(410);
      await expect(del()).resolves.toBeUndefined();
      stubWrite(404);
      await expect(del()).resolves.toBeUndefined();
      stubWrite(403);
      await expect(del()).rejects.toBeInstanceOf(GoogleForbiddenError);
      stubWrite(401);
      await expect(del()).rejects.toBeInstanceOf(GoogleAccessRevokedError);
    });
  });

  it('asks for permission to change events only when told to', () => {
    const scope = (write?: boolean) =>
      new URL(
        provider.authorizationUrl({
          state: 's',
          codeChallenge: 'c',
          redirectUri: 'http://x/cb',
          write,
        }),
      ).searchParams.get('scope')!;
    expect(scope()).not.toContain(EVENTS_WRITE_SCOPE);
    expect(scope(true).split(' ')).toContain(EVENTS_WRITE_SCOPE);
  });

  it('knows from the access role whether a calendar can be written to', async () => {
    stubGoogle([
      token,
      {
        match: 'calendarList',
        body: {
          items: [
            { id: 'mine', primary: true, selected: true, accessRole: 'owner' },
            { id: 'team', selected: true, accessRole: 'writer' },
            { id: 'holidays', selected: true, accessRole: 'reader' },
          ],
        },
      },
      { match: 'calendars/mine/events', body: { items: [ev('a')] } },
      { match: 'calendars/team/events', body: { items: [ev('b')] } },
      { match: 'calendars/holidays/events', body: { items: [ev('c')] } },
    ]);
    const { events } = await provider.listEvents({ refreshToken: 'r', ...window });
    expect(events.map((e) => [e.calendarId, e.editable])).toEqual([
      ['mine', true],
      ['team', true],
      ['holidays', false],
    ]);
  });

  describe('creating an event', () => {
    const changes: EventChanges = {
      title: 'Dentist',
      description: 'Bring the card',
      startsAt: new Date('2030-05-10T10:00:00Z'),
      endsAt: new Date('2030-05-10T11:00:00Z'),
      allDay: false,
    };
    const created = {
      id: 'new1',
      summary: 'Dentist',
      start: { dateTime: '2030-05-10T10:00:00Z' },
      end: { dateTime: '2030-05-10T11:00:00Z' },
      htmlLink: 'https://calendar.google.com/e/new1',
    };

    function stubCreate(
      options: {
        entry?: { status: number; body?: unknown };
        post?: { status: number; body?: unknown };
      } = {},
    ) {
      const posted: { url: string; body: unknown }[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: URL | string, init?: RequestInit) => {
          const url = String(input);
          const json = (status: number, body: unknown) =>
            new Response(JSON.stringify(body), { status });
          if (url.includes('oauth2')) return json(200, { access_token: 'access' });
          if (url.includes('calendarList/primary')) {
            const entry = options.entry ?? {
              status: 200,
              body: {
                id: 'me@x.com',
                summary: 'me@x.com',
                summaryOverride: 'Personal',
                accessRole: 'owner',
              },
            };
            return json(entry.status, entry.body ?? {});
          }
          posted.push({ url, body: JSON.parse(String(init?.body)) });
          const post = options.post ?? { status: 200, body: created };
          return json(post.status, post.body ?? {});
        }),
      );
      return posted;
    }

    it('posts to the real id of the main calendar, not the "primary" alias, without e-mailing guests', async () => {
      const posted = stubCreate();
      const event = await provider.createEvent({ refreshToken: 'r', changes });
      expect(posted).toHaveLength(1);
      expect(posted[0].url).toBe(
        'https://www.googleapis.com/calendar/v3/calendars/me%40x.com/events?sendUpdates=none',
      );
      expect(posted[0].body).toEqual({
        summary: 'Dentist',
        description: 'Bring the card',
        start: { dateTime: '2030-05-10T10:00:00.000Z', date: null },
        end: { dateTime: '2030-05-10T11:00:00.000Z', date: null },
      });
      expect(event).toMatchObject({
        id: 'me@x.com/new1',
        calendarId: 'me@x.com',
        calendarName: 'Personal',
        editable: true,
        url: 'https://calendar.google.com/e/new1',
      });
    });

    it('sends plain dates for an all-day event', async () => {
      const posted = stubCreate({
        post: {
          status: 200,
          body: { ...created, start: { date: '2030-05-10' }, end: { date: '2030-05-11' } },
        },
      });
      const event = await provider.createEvent({
        refreshToken: 'r',
        changes: {
          ...changes,
          description: null,
          allDay: true,
          startsAt: new Date('2030-05-10T00:00:00Z'),
          endsAt: new Date('2030-05-11T00:00:00Z'),
        },
      });
      expect(posted[0].body).toMatchObject({
        description: null,
        start: { date: '2030-05-10', dateTime: null },
        end: { date: '2030-05-11', dateTime: null },
      });
      expect(event.allDay).toBe(true);
    });

    it('turns Google’s refusals into typed errors', async () => {
      stubCreate({ post: { status: 401 } });
      await expect(provider.createEvent({ refreshToken: 'r', changes })).rejects.toBeInstanceOf(
        GoogleAccessRevokedError,
      );
      stubCreate({ post: { status: 403 } });
      await expect(provider.createEvent({ refreshToken: 'r', changes })).rejects.toBeInstanceOf(
        GoogleForbiddenError,
      );
      stubCreate({ post: { status: 400 } });
      await expect(provider.createEvent({ refreshToken: 'r', changes })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      stubCreate({ entry: { status: 401 } });
      await expect(provider.createEvent({ refreshToken: 'r', changes })).rejects.toBeInstanceOf(
        GoogleAccessRevokedError,
      );
      stubCreate({ entry: { status: 500 } });
      await expect(provider.createEvent({ refreshToken: 'r', changes })).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('does not mistake a missing calendar for a missing event', async () => {
      stubCreate({ post: { status: 404 } });
      const error = await provider.createEvent({ refreshToken: 'r', changes }).catch((e) => e);
      expect(error).toBeInstanceOf(BadGatewayException);
      expect(error).not.toBeInstanceOf(GoogleEventGoneError);
    });
  });
});
