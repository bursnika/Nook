import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { env } from '../env.js';
import {
  CALENDAR_SCOPE,
  EVENTS_WRITE_SCOPE,
  GoogleAccessRevokedError,
  GoogleEventGoneError,
  GoogleForbiddenError,
  GoogleTasksUnavailableError,
  TASKS_SCOPE,
  type EventChanges,
  type GoogleCalendarProvider,
  type GoogleEvent,
  type GoogleTask,
} from './google-calendar.provider.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const TIMEOUT_MS = 10_000;
const PAGE_SIZE = 250;
const MAX_PAGES = 10;

interface RawEvent {
  id: string;
  iCalUID?: string;
  recurringEventId?: string;
  htmlLink?: string;
  eventType?: string;
  locked?: boolean;
  status?: string;
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

interface RawCalendar {
  id: string;
  summary?: string;
  summaryOverride?: string;
  selected?: boolean;
  primary?: boolean;
  accessRole?: string;
}

interface RawTask {
  id: string;
  title?: string;
  notes?: string;
  status?: string;
  due?: string;
  completed?: string;
  deleted?: boolean;
}

/** One calendar or task list answered 403/404/410: skip it, keep everything else. */
class Unreadable extends Error {}

/** Google Calendar and Google Tasks over their REST APIs, using the same OAuth client as sign-in. */
@Injectable()
export class GoogleCalendarGoogle implements GoogleCalendarProvider {
  get configured() {
    return Boolean(env.google.clientId && env.google.clientSecret);
  }

  authorizationUrl({
    state,
    codeChallenge,
    redirectUri,
    write,
  }: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    write?: boolean;
  }) {
    this.assertConfigured();
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: env.google.clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: [CALENDAR_SCOPE, TASKS_SCOPE, ...(write ? [EVENTS_WRITE_SCOPE] : [])].join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // offline + consent: Google then always returns a refresh token
      access_type: 'offline',
      prompt: 'consent',
      // incremental authorization: keep what sign-in already granted
      include_granted_scopes: 'true',
    }).toString();
    return url.toString();
  }

  async exchangeCode({
    code,
    codeVerifier,
    redirectUri,
  }: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }) {
    this.assertConfigured();
    const body = await this.token({
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });
    if (!body.refresh_token) {
      throw new BadGatewayException('Google did not return a refresh token');
    }
    return { refreshToken: body.refresh_token, scope: body.scope ?? '' };
  }

  async listEvents({ refreshToken, from, to }: { refreshToken: string; from: Date; to: Date }) {
    this.assertConfigured();
    const accessToken = await this.accessToken(refreshToken);
    const calendars = await this.calendars(accessToken);

    const events: GoogleEvent[] = [];
    const failedCalendarIds: string[] = [];
    const seen = new Set<string>();
    for (const calendar of calendars) {
      try {
        for (const raw of await this.calendarEvents(accessToken, calendar.id, from, to)) {
          const event = toEvent(raw, calendar);
          if (!event) continue;
          // An event you were invited to can sit in several calendars; show it once.
          const key = raw.iCalUID
            ? `${raw.iCalUID}|${raw.start?.dateTime ?? raw.start?.date}`
            : null;
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          events.push(event);
        }
      } catch (error) {
        if (!(error instanceof Unreadable)) throw error;
        failedCalendarIds.push(calendar.id);
      }
    }
    return { events, failedCalendarIds };
  }

  async listTasks({
    refreshToken,
    completedSince,
  }: {
    refreshToken: string;
    completedSince: Date;
  }) {
    this.assertConfigured();
    const accessToken = await this.accessToken(refreshToken);

    const lists: { id: string }[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.get(`${TASKS_API}/users/@me/lists`, accessToken, {
        maxResults: '100',
        ...(pageToken ? { pageToken } : {}),
      });
      if (response.status === 401) throw new GoogleAccessRevokedError('Google answered 401');
      // 403/404 here means the Tasks API is off for the project or its scope was not granted
      if (response.status === 403 || response.status === 404) {
        throw new GoogleTasksUnavailableError(`Google answered ${response.status}`);
      }
      if (!response.ok) throw new BadGatewayException('Google Tasks is not available');
      const data = (await response.json()) as { items?: { id: string }[]; nextPageToken?: string };
      lists.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }

    const tasks: GoogleTask[] = [];
    const failedListIds: string[] = [];
    for (const list of lists) {
      try {
        let token: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const response = await this.get(
            `${TASKS_API}/lists/${encodeURIComponent(list.id)}/tasks`,
            accessToken,
            {
              showCompleted: 'true',
              showHidden: 'true',
              maxResults: '100',
              ...(token ? { pageToken: token } : {}),
            },
          );
          if (response.status === 401) throw new GoogleAccessRevokedError('Google answered 401');
          if ([403, 404, 410].includes(response.status)) throw new Unreadable();
          if (!response.ok) throw new BadGatewayException('Google Tasks is not available');
          const data = (await response.json()) as { items?: RawTask[]; nextPageToken?: string };
          for (const raw of data.items ?? []) {
            const task = toTask(raw, list.id, completedSince);
            if (task) tasks.push(task);
          }
          token = data.nextPageToken;
          if (!token) break;
        }
      } catch (error) {
        if (!(error instanceof Unreadable)) throw error;
        failedListIds.push(list.id);
      }
    }
    return { tasks, failedListIds };
  }

  async createEvent({ refreshToken, changes }: { refreshToken: string; changes: EventChanges }) {
    this.assertConfigured();
    const accessToken = await this.accessToken(refreshToken);

    // "primary" is only an alias. The real id and name are what a sync stores for this calendar.
    const entry = await this.get(`${CALENDAR_API}/users/me/calendarList/primary`, accessToken, {});
    if (entry.status === 401) throw new GoogleAccessRevokedError('Google answered 401');
    if (!entry.ok) throw new BadGatewayException('Google Calendar is not available');
    const primary = (await entry.json()) as RawCalendar;
    const calendar = {
      id: primary.id,
      name: (primary.summaryOverride || primary.summary || primary.id).slice(0, 200),
      editable: true,
    };

    const response = await fetch(this.eventsUrl(calendar.id), {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(this.eventBody(changes)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // a 404/410 here would mean the calendar vanished, not an event: that is Google's problem, not "gone"
    if (response.status === 404 || response.status === 410) {
      throw new BadGatewayException('Google Calendar is not available');
    }
    await this.assertWritten(response);
    const event = toEvent((await response.json()) as RawEvent, calendar);
    if (!event) throw new BadGatewayException('Google returned an unusable event');
    return event;
  }

  async updateEvent({
    refreshToken,
    calendar,
    eventId,
    changes,
  }: {
    refreshToken: string;
    calendar: { id: string; name: string };
    eventId: string;
    changes: EventChanges;
  }) {
    this.assertConfigured();
    const accessToken = await this.accessToken(refreshToken);
    const response = await fetch(this.eventUrl(calendar.id, eventId), {
      method: 'PATCH',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(this.eventBody(changes)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await this.assertWritten(response);
    const event = toEvent((await response.json()) as RawEvent, { ...calendar, editable: true });
    if (!event) throw new GoogleEventGoneError('The event was cancelled');
    return event;
  }

  async deleteEvent({
    refreshToken,
    calendarId,
    eventId,
  }: {
    refreshToken: string;
    calendarId: string;
    eventId: string;
  }) {
    this.assertConfigured();
    const accessToken = await this.accessToken(refreshToken);
    const response = await fetch(this.eventUrl(calendarId, eventId), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // already gone in Google is the outcome we wanted
    if (response.status === 404 || response.status === 410) return;
    await this.assertWritten(response);
  }

  async revoke(refreshToken: string) {
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The connection is deleted locally either way.
    }
  }

  /** The calendars the person has switched on in Google Calendar, their own first. */
  private async calendars(accessToken: string) {
    const found: { id: string; name: string; primary: boolean; editable: boolean }[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.get(`${CALENDAR_API}/users/me/calendarList`, accessToken, {
        minAccessRole: 'reader', // calendars shared as "free/busy only" have no event details to import
        maxResults: '250',
        ...(pageToken ? { pageToken } : {}),
      });
      if (response.status === 401) throw new GoogleAccessRevokedError('Google answered 401');
      // 403 is not "revoked": most often the Calendar API is not enabled for the project
      if (response.status === 403) {
        throw new BadGatewayException(
          'Google refused to list calendars. Check that the Google Calendar API is enabled for the project.',
        );
      }
      if (!response.ok) throw new BadGatewayException('Google Calendar is not available');
      const data = (await response.json()) as { items?: RawCalendar[]; nextPageToken?: string };
      for (const calendar of data.items ?? []) {
        if (calendar.selected !== true && calendar.primary !== true) continue; // hidden in Google Calendar
        found.push({
          id: calendar.id,
          name: calendar.summaryOverride || calendar.summary || calendar.id,
          primary: calendar.primary === true,
          editable: calendar.accessRole === 'owner' || calendar.accessRole === 'writer',
        });
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return found.sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  private async calendarEvents(accessToken: string, calendarId: string, from: Date, to: Date) {
    const raws: RawEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.get(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
        accessToken,
        {
          singleEvents: 'true',
          orderBy: 'startTime',
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          maxResults: String(PAGE_SIZE),
          ...(pageToken ? { pageToken } : {}),
        },
      );
      if (response.status === 401) throw new GoogleAccessRevokedError('Google answered 401');
      if ([403, 404, 410].includes(response.status)) throw new Unreadable();
      if (!response.ok) throw new BadGatewayException('Google Calendar is not available');
      const data = (await response.json()) as { items?: RawEvent[]; nextPageToken?: string };
      raws.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return raws;
  }

  /**
   * The whole event as Google wants it. For a PATCH, objects are merged, so the unused one of
   * date / dateTime is cleared explicitly (harmless for a create).
   */
  private eventBody(changes: EventChanges) {
    const day = (date: Date) => date.toISOString().slice(0, 10);
    const when = (date: Date) =>
      changes.allDay
        ? { date: day(date), dateTime: null }
        : { dateTime: date.toISOString(), date: null };
    return {
      summary: changes.title,
      description: changes.description,
      start: when(changes.startsAt),
      end: when(changes.endsAt),
    };
  }

  private eventsUrl(calendarId: string) {
    // sendUpdates=none: nobody is e-mailed because of something done in Nook
    return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`;
  }

  private eventUrl(calendarId: string, eventId: string) {
    // sendUpdates=none: changing an event here must not e-mail its guests
    return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`;
  }

  /** Maps Google's answer to a write: success passes, everything else becomes a typed error. */
  private async assertWritten(response: Response) {
    if (response.ok) return;
    if (response.status === 401) throw new GoogleAccessRevokedError('Google answered 401');
    if (response.status === 403) throw new GoogleForbiddenError('Google answered 403');
    if (response.status === 404 || response.status === 410) {
      throw new GoogleEventGoneError(`Google answered ${response.status}`);
    }
    if (response.status === 400) throw new BadRequestException('Google rejected the change');
    throw new BadGatewayException('Google Calendar is not available');
  }

  private get(url: string, accessToken: string, params: Record<string, string>) {
    const target = new URL(url);
    target.search = new URLSearchParams(params).toString();
    return fetch(target, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  private async accessToken(refreshToken: string) {
    const { access_token: accessToken } = await this.token({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    if (!accessToken) throw new BadGatewayException('Google returned no access token');
    return accessToken;
  }

  private async token(params: Record<string, string>) {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.google.clientId!,
        client_secret: env.google.clientSecret!,
        ...params,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as { error?: string };
      if (error.error === 'invalid_grant') throw new GoogleAccessRevokedError('invalid_grant');
      throw new BadGatewayException('Google rejected the request');
    }
    return (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
    };
  }

  private assertConfigured() {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Google is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)',
      );
    }
  }
}

/** All-day events carry plain dates (the end is exclusive), timed ones carry instants. */
export function toEvent(
  raw: RawEvent,
  calendar: { id: string; name: string; editable?: boolean },
): GoogleEvent | null {
  if (raw.status === 'cancelled' || !raw.id || !raw.start || !raw.end) return null;
  const allDay = Boolean(raw.start.date);
  const startsAt = new Date(raw.start.date ? `${raw.start.date}T00:00:00Z` : raw.start.dateTime!);
  const endsAt = new Date(raw.end.date ? `${raw.end.date}T00:00:00Z` : raw.end.dateTime!);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  return {
    id: `${calendar.id}/${raw.id}`,
    calendarId: calendar.id,
    calendarName: calendar.name.slice(0, 200),
    title: (raw.summary ?? '').trim().slice(0, 200) || '(no title)',
    description: raw.description?.slice(0, 5000),
    startsAt,
    // the model requires an end after the start; an instant event gets one minute
    endsAt: endsAt > startsAt ? endsAt : new Date(startsAt.getTime() + 60_000),
    allDay,
    // birthdays and events made from Gmail cannot be changed through the API, nor can locked ones
    editable:
      calendar.editable === true &&
      raw.locked !== true &&
      raw.eventType !== 'birthday' &&
      raw.eventType !== 'fromGmail',
    recurring: Boolean(raw.recurringEventId),
    url: raw.htmlLink,
  };
}

/**
 * Open tasks always; completed ones only if finished recently. Google stores just the date of a due
 * time, so a due date becomes noon UTC: that is the same calendar day in almost every time zone.
 */
export function toTask(raw: RawTask, listId: string, completedSince: Date): GoogleTask | null {
  if (raw.deleted || !raw.id) return null;
  const completed = raw.status === 'completed';
  const completedAt = raw.completed ? new Date(raw.completed) : undefined;
  if (
    completed &&
    (!completedAt || Number.isNaN(completedAt.getTime()) || completedAt < completedSince)
  ) {
    return null;
  }
  let due: Date | undefined;
  if (raw.due) {
    const day = new Date(raw.due);
    if (!Number.isNaN(day.getTime())) {
      due = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12));
    }
  }
  return {
    id: `${listId}/${raw.id}`,
    title: (raw.title ?? '').trim().slice(0, 200) || '(no title)',
    notes: raw.notes?.slice(0, 5000),
    due,
    completed,
    completedAt: completed ? completedAt : undefined,
  };
}
