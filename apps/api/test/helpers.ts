import {
  BadGatewayException,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AuthGuard } from '../src/auth/auth.guard.js';
import {
  OAUTH_PROVIDER,
  type OAuthProfile,
  type OAuthProvider,
} from '../src/auth/oauth.provider.js';
import {
  CALENDAR_SCOPE,
  EVENTS_WRITE_SCOPE,
  GOOGLE_CALENDAR_PROVIDER,
  GoogleAccessRevokedError,
  GoogleTasksUnavailableError,
  TASKS_SCOPE,
  type EventChanges,
  type GoogleCalendarProvider,
  type GoogleEvent,
  type GoogleTask,
} from '../src/google-calendar/google-calendar.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const PLATFORM_ADMIN_EMAIL = 'platform-admin@example.com';

/**
 * Most e2e specs test business rules, not sign-in, so they run as a platform admin.
 * Specs that test authentication use `createTestApp({ auth: 'real' })` instead.
 */
@Injectable()
class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const user = await this.prisma.user.upsert({
      where: { email: PLATFORM_ADMIN_EMAIL },
      update: {},
      create: { email: PLATFORM_ADMIN_EMAIL, name: 'Platform Admin' },
    });
    context.switchToHttp().getRequest<Request>().user = {
      id: user.id,
      email: user.email,
      isPlatformAdmin: true,
    };
    return true;
  }
}

/** A stand-in for Google: the "code" of the authorization flow is simply the e-mail to sign in as. */
export class FakeOAuthProvider implements OAuthProvider {
  configured = true;
  /** Profiles by code, so a spec can describe exactly who signs in. */
  profiles = new Map<string, OAuthProfile>();
  lastAuthorizationUrl?: URL;

  authorizationUrl({
    state,
    codeChallenge,
    redirectUri,
  }: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }) {
    const url = new URL('https://accounts.example.test/authorize');
    url.search = new URLSearchParams({
      state,
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
    }).toString();
    this.lastAuthorizationUrl = url;
    return url.toString();
  }

  async exchangeCode({ code }: { code: string; codeVerifier: string; redirectUri: string }) {
    const profile = this.profiles.get(code);
    if (!profile) throw new UnauthorizedException('Google rejected the sign-in code');
    return profile;
  }
}

/** A stand-in for Google Calendar and Tasks: the spec describes what each refresh token can see. */
export class FakeGoogleCalendarProvider implements GoogleCalendarProvider {
  configured = true;
  /** Authorization code -> what Google would hand back. */
  codes = new Map<string, { refreshToken: string; scope: string }>();
  /** Refresh token -> events across all of that person's calendars. */
  calendars = new Map<string, GoogleEvent[]>();
  /** Refresh token -> calendar ids Google refuses to read this time. */
  failedCalendars = new Map<string, string[]>();
  /** Refresh token -> that person's Google Tasks (list id is the part of the id before "/"). */
  tasks = new Map<string, GoogleTask[]>();
  failedLists = new Map<string, string[]>();
  /** Refresh tokens for which the Tasks API is off or not granted. */
  tasksUnavailable = new Set<string>();
  /** Refresh tokens Google no longer accepts. */
  revokedByUser = new Set<string>();
  /** Refresh tokens Nook asked Google to forget. */
  forgotten: string[] = [];
  /** Changes and deletions Nook sent to Google. */
  updates: { calendarId: string; eventId: string; changes: EventChanges }[] = [];
  deletions: { calendarId: string; eventId: string }[] = [];
  /** When set, the next writes fail with it (for example GoogleForbiddenError). */
  writeError: Error | null = null;
  lastAuthorizationUrl?: URL;

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
    const url = new URL('https://accounts.example.test/calendar-consent');
    url.search = new URLSearchParams({
      state,
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
      access_type: 'offline',
      prompt: 'consent',
      scope: [CALENDAR_SCOPE, TASKS_SCOPE, ...(write ? [EVENTS_WRITE_SCOPE] : [])].join(' '),
    }).toString();
    this.lastAuthorizationUrl = url;
    return url.toString();
  }

  async exchangeCode({ code }: { code: string; codeVerifier: string; redirectUri: string }) {
    const grant = this.codes.get(code);
    if (!grant) throw new BadGatewayException('Google rejected the request');
    return grant;
  }

  async listEvents({ refreshToken, from, to }: { refreshToken: string; from: Date; to: Date }) {
    if (this.revokedByUser.has(refreshToken)) throw new GoogleAccessRevokedError('revoked');
    const failedCalendarIds = this.failedCalendars.get(refreshToken) ?? [];
    const events = (this.calendars.get(refreshToken) ?? []).filter(
      (event) =>
        event.startsAt < to && event.endsAt > from && !failedCalendarIds.includes(event.calendarId),
    );
    return { events, failedCalendarIds };
  }

  async listTasks({
    refreshToken,
    completedSince,
  }: {
    refreshToken: string;
    completedSince: Date;
  }) {
    if (this.revokedByUser.has(refreshToken)) throw new GoogleAccessRevokedError('revoked');
    if (this.tasksUnavailable.has(refreshToken)) throw new GoogleTasksUnavailableError('off');
    const failedListIds = this.failedLists.get(refreshToken) ?? [];
    const tasks = (this.tasks.get(refreshToken) ?? []).filter(
      (task) =>
        !failedListIds.includes(task.id.split('/')[0]) &&
        (!task.completed || (task.completedAt !== undefined && task.completedAt >= completedSince)),
    );
    return { tasks, failedListIds };
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
    if (this.revokedByUser.has(refreshToken)) throw new GoogleAccessRevokedError('revoked');
    if (this.writeError) throw this.writeError;
    this.updates.push({ calendarId: calendar.id, eventId, changes });
    return {
      id: `${calendar.id}/${eventId}`,
      calendarId: calendar.id,
      calendarName: calendar.name,
      title: changes.title,
      description: changes.description ?? undefined,
      startsAt: changes.startsAt,
      endsAt: changes.endsAt,
      allDay: changes.allDay,
      editable: true,
      recurring: false,
      url: 'https://calendar.google.com/calendar/event?eid=updated',
    };
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
    if (this.revokedByUser.has(refreshToken)) throw new GoogleAccessRevokedError('revoked');
    if (this.writeError) throw this.writeError;
    this.deletions.push({ calendarId, eventId });
  }

  async revoke(refreshToken: string) {
    this.forgotten.push(refreshToken);
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  oauth: FakeOAuthProvider;
  googleCalendar: FakeGoogleCalendarProvider;
}

export async function createTestApp(options: { auth?: 'bypass' | 'real' } = {}): Promise<TestApp> {
  const oauth = new FakeOAuthProvider();
  const googleCalendar = new FakeGoogleCalendarProvider();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OAUTH_PROVIDER)
    .useValue(oauth)
    .overrideProvider(GOOGLE_CALENDAR_PROVIDER)
    .useValue(googleCalendar);
  if (options.auth !== 'real')
    builder = builder.overrideProvider(AuthGuard).useClass(PlatformAdminGuard);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), oauth, googleCalendar };
}

const FEATURE_FLAGS = [
  { key: 'insights', description: 'Insights page with productivity statistics' },
  { key: 'google-two-way-sync', description: 'Two-way Google Calendar synchronisation' },
  { key: 'ai-assistant', description: 'AI planning assistant' },
];

/**
 * Empties every table between tests, except Prisma's bookkeeping. The feature flags are seeded by a
 * migration, so they are put back to their defaults instead of being deleted.
 */
export async function resetDb(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'FeatureFlag')`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  for (const flag of FEATURE_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { enabled: true },
      create: { ...flag, minPlan: 'PRO', enabled: true },
    });
  }
}

let counter = 0;

/** A workspace with one OWNER member, enough to create pages, tasks and so on. */
export async function seedWorkspace(prisma: PrismaService, label = 'ws') {
  const n = ++counter;
  const user = await prisma.user.create({
    data: { email: `${label}-${n}@example.com`, name: `${label} owner ${n}` },
  });
  const workspace = await prisma.workspace.create({
    data: { name: `${label} ${n}`, slug: `${label}-${n}` },
  });
  await prisma.membership.create({
    data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
  });
  return { user, workspace };
}
