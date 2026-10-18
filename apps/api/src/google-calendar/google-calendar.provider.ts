export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks.readonly';
/** Asked for separately, only by someone who wants to change Google events from Nook. */
export const EVENTS_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export interface GoogleEvent {
  /** Unique in a workspace: `<calendar id>/<event id>`, because the same event id can exist in several calendars. */
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** The person may change it in Google. */
  editable: boolean;
  /** One occurrence of a repeating event. */
  recurring: boolean;
  url?: string;
}

/** What the edit window sends: always the whole event, so the provider never has to guess. */
export interface EventChanges {
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

export interface GoogleTask {
  /** `<task list id>/<task id>` */
  id: string;
  title: string;
  notes?: string;
  /** Google keeps only the date of a due time. */
  due?: Date;
  completed: boolean;
  completedAt?: Date;
}

/** Google no longer honours the stored refresh token: the person revoked access or the grant expired. */
export class GoogleAccessRevokedError extends Error {}

/** Google refuses the change: the calendar is read-only for this person, or they are only a guest. */
export class GoogleForbiddenError extends Error {}

/** The event no longer exists in Google Calendar. */
export class GoogleEventGoneError extends Error {}

/** Google Tasks cannot be read: the API is not enabled for the project, or its scope was not granted. */
export class GoogleTasksUnavailableError extends Error {}

/** Everything Nook needs from Google Calendar and Google Tasks. */
export interface GoogleCalendarProvider {
  readonly configured: boolean;
  /** `write` also asks for permission to change events (a separate, optional consent). */
  authorizationUrl(params: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    write?: boolean;
  }): string;
  /** Trades the authorization code for a long-lived refresh token and the scopes that were granted. */
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ refreshToken: string; scope: string }>;
  /**
   * Events of every calendar the person has switched on (primary, subscribed, holidays, birthdays ...)
   * overlapping the window, recurring events expanded. A calendar that could not be read is reported
   * in `failedCalendarIds` so that nothing already imported from it is deleted.
   */
  listEvents(params: { refreshToken: string; from: Date; to: Date }): Promise<{
    events: GoogleEvent[];
    failedCalendarIds: string[];
  }>;
  /** Open tasks of every task list, plus those completed since `completedSince`. */
  listTasks(params: { refreshToken: string; completedSince: Date }): Promise<{
    tasks: GoogleTask[];
    failedListIds: string[];
  }>;
  /** Changes one event in Google and returns it as Google now has it. */
  updateEvent(params: {
    refreshToken: string;
    calendar: { id: string; name: string };
    eventId: string;
    changes: EventChanges;
  }): Promise<GoogleEvent>;
  deleteEvent(params: { refreshToken: string; calendarId: string; eventId: string }): Promise<void>;
  /** Best effort: tells Google to forget the grant. */
  revoke(refreshToken: string): Promise<void>;
}

/** Injection token, so tests can replace Google with a fake. */
export const GOOGLE_CALENDAR_PROVIDER = Symbol('GOOGLE_CALENDAR_PROVIDER');
