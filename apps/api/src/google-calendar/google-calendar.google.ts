import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../env.js';
import {
  CALENDAR_SCOPE,
  GoogleAccessRevokedError,
  type GoogleCalendarProvider,
  type GoogleEvent,
} from './google-calendar.provider.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TIMEOUT_MS = 10_000;
const PAGE_SIZE = 250;
const MAX_PAGES = 10;

interface RawEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

/** Google Calendar over its REST API, using the same OAuth client as sign-in. */
@Injectable()
export class GoogleCalendarGoogle implements GoogleCalendarProvider {
  get configured() {
    return Boolean(env.google.clientId && env.google.clientSecret);
  }

  authorizationUrl({
    state,
    codeChallenge,
    redirectUri,
  }: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }) {
    this.assertConfigured();
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: env.google.clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: CALENDAR_SCOPE,
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
    const { access_token: accessToken } = await this.token({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    if (!accessToken) throw new BadGatewayException('Google returned no access token');

    const events: GoogleEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(EVENTS_URL);
      url.search = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        maxResults: String(PAGE_SIZE),
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 401 || response.status === 403) {
        throw new GoogleAccessRevokedError(`Google answered ${response.status}`);
      }
      if (!response.ok) throw new BadGatewayException('Google Calendar is not available');
      const data = (await response.json()) as { items?: RawEvent[]; nextPageToken?: string };
      for (const raw of data.items ?? []) {
        const event = toEvent(raw);
        if (event) events.push(event);
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return events;
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
export function toEvent(raw: RawEvent): GoogleEvent | null {
  if (raw.status === 'cancelled' || !raw.id || !raw.start || !raw.end) return null;
  const allDay = Boolean(raw.start.date);
  const startsAt = new Date(raw.start.date ? `${raw.start.date}T00:00:00Z` : raw.start.dateTime!);
  const endsAt = new Date(raw.end.date ? `${raw.end.date}T00:00:00Z` : raw.end.dateTime!);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  return {
    id: raw.id,
    title: (raw.summary ?? '').trim().slice(0, 200) || '(no title)',
    description: raw.description?.slice(0, 5000),
    startsAt,
    // the model requires an end after the start; an instant event gets one minute
    endsAt: endsAt > startsAt ? endsAt : new Date(startsAt.getTime() + 60_000),
    allDay,
  };
}
