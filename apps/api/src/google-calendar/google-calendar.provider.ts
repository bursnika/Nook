export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export interface GoogleEvent {
  id: string;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

/** Google no longer honours the stored refresh token: the person revoked access or the grant expired. */
export class GoogleAccessRevokedError extends Error {}

/** Everything Nook needs from Google Calendar. */
export interface GoogleCalendarProvider {
  readonly configured: boolean;
  authorizationUrl(params: { state: string; codeChallenge: string; redirectUri: string }): string;
  /** Trades the authorization code for a long-lived refresh token and the scopes that were granted. */
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ refreshToken: string; scope: string }>;
  /** Events of the primary calendar overlapping the window, recurring events expanded. */
  listEvents(params: { refreshToken: string; from: Date; to: Date }): Promise<GoogleEvent[]>;
  /** Best effort: tells Google to forget the grant. */
  revoke(refreshToken: string): Promise<void>;
}

/** Injection token, so tests can replace Google with a fake. */
export const GOOGLE_CALENDAR_PROVIDER = Symbol('GOOGLE_CALENDAR_PROVIDER');
