export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks.readonly';
export const EVENTS_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export interface GoogleEvent {
  // "<calendarId>/<eventId>"
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  editable: boolean;
  recurring: boolean;
  url?: string;
}

export interface EventChanges {
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  due?: Date;
  completed: boolean;
  completedAt?: Date;
}

export class GoogleAccessRevokedError extends Error {}

export class GoogleForbiddenError extends Error {}

export class GoogleEventGoneError extends Error {}

export class GoogleTasksUnavailableError extends Error {}

export interface GoogleCalendarProvider {
  readonly configured: boolean;
  authorizationUrl(params: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    write?: boolean;
  }): string;
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ refreshToken: string; scope: string }>;
  listEvents(params: { refreshToken: string; from: Date; to: Date }): Promise<{
    events: GoogleEvent[];
    failedCalendarIds: string[];
  }>;
  listTasks(params: { refreshToken: string; completedSince: Date }): Promise<{
    tasks: GoogleTask[];
    failedListIds: string[];
  }>;
  createEvent(params: { refreshToken: string; changes: EventChanges }): Promise<GoogleEvent>;
  updateEvent(params: {
    refreshToken: string;
    calendar: { id: string; name: string };
    eventId: string;
    changes: EventChanges;
  }): Promise<GoogleEvent>;
  deleteEvent(params: { refreshToken: string; calendarId: string; eventId: string }): Promise<void>;
  revoke(refreshToken: string): Promise<void>;
}

export const GOOGLE_CALENDAR_PROVIDER = Symbol('GOOGLE_CALENDAR_PROVIDER');
