import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { TaskStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CALENDAR_SCOPE,
  GOOGLE_CALENDAR_PROVIDER,
  GoogleAccessRevokedError,
  GoogleTasksUnavailableError,
  TASKS_SCOPE,
  type GoogleCalendarProvider,
  type GoogleEvent,
  type GoogleTask,
} from './google-calendar.provider.js';
import { decryptToken, encryptToken } from './token-crypto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far around "now" events are imported. */
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;

/** The granted scope string is space-separated; the person may have unticked a box on the consent screen. */
const grants = (scope: string, wanted: string) => scope.split(' ').includes(wanted);

export type TasksOutcome =
  | { status: 'synced'; created: number; updated: number; removed: number }
  /** The person did not tick Google Tasks on the consent screen (or connected before it was offered). */
  | { status: 'not-granted' }
  /** Google refused: usually the Google Tasks API is not enabled for the project. */
  | { status: 'unavailable' };

@Injectable()
export class GoogleCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GOOGLE_CALENDAR_PROVIDER) readonly provider: GoogleCalendarProvider,
  ) {}

  async status(userId: string) {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { userId },
      select: { lastSyncAt: true, scope: true },
    });
    return {
      configured: this.provider.configured,
      connected: connection !== null,
      tasksGranted: connection ? grants(connection.scope, TASKS_SCOPE) : false,
      lastSyncAt: connection?.lastSyncAt ?? null,
    };
  }

  /** Stores the refresh token (encrypted) once Google confirms the calendar scope was granted. */
  async connect(
    userId: string,
    params: { code: string; codeVerifier: string; redirectUri: string },
  ) {
    const { refreshToken, scope } = await this.provider.exchangeCode(params);
    if (!grants(scope, CALENDAR_SCOPE)) return { granted: false as const };
    const refreshTokenEnc = encryptToken(refreshToken);
    await this.prisma.googleConnection.upsert({
      where: { userId },
      update: { refreshTokenEnc, scope },
      create: { userId, refreshTokenEnc, scope },
    });
    return { granted: true as const };
  }

  /**
   * Imports the person's Google events (every calendar they have switched on) and, when allowed, their
   * Google Tasks into the workspace, and mirrors deletions made in Google.
   */
  async sync(workspaceId: string, userId: string, now = new Date()) {
    const connection = await this.prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) throw new ConflictException('Connect Google Calendar first');
    const refreshToken = decryptToken(connection.refreshTokenEnc);

    const from = new Date(now.getTime() - PAST_DAYS * DAY_MS);
    const to = new Date(now.getTime() + FUTURE_DAYS * DAY_MS);
    try {
      const { events, failedCalendarIds } = await this.provider.listEvents({
        refreshToken,
        from,
        to,
      });
      const eventResult = await this.importEvents(workspaceId, userId, {
        events,
        failedCalendarIds,
        from,
        to,
      });
      const tasks = await this.syncTasks(workspaceId, userId, {
        refreshToken,
        granted: grants(connection.scope, TASKS_SCOPE),
        completedSince: from,
      });
      await this.prisma.googleConnection.update({
        where: { userId },
        data: { lastSyncAt: now },
      });
      return { ...eventResult, tasks, syncedAt: now };
    } catch (error) {
      if (!(error instanceof GoogleAccessRevokedError)) throw error;
      await this.prisma.googleConnection.delete({ where: { userId } });
      throw new ConflictException('Google no longer allows access. Connect Google Calendar again.');
    }
  }

  private async importEvents(
    workspaceId: string,
    userId: string,
    input: { events: GoogleEvent[]; failedCalendarIds: string[]; from: Date; to: Date },
  ) {
    const { events, failedCalendarIds, from, to } = input;
    const ids = events.map((event) => event.id);
    const existing = new Set(
      (
        await this.prisma.calendarEvent.findMany({
          where: { workspaceId, googleEventId: { in: ids } },
          select: { googleEventId: true },
        })
      ).map((row) => row.googleEventId),
    );

    await this.prisma.$transaction(
      events.map((event) => {
        const fields = {
          importedById: userId,
          googleCalendarId: event.calendarId,
          calendarName: event.calendarName,
          title: event.title,
          description: event.description,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          allDay: event.allDay,
        };
        return this.prisma.calendarEvent.upsert({
          where: { workspaceId_googleEventId: { workspaceId, googleEventId: event.id } },
          create: { workspaceId, googleEventId: event.id, ...fields },
          update: fields,
        });
      }),
    );
    // Gone from Google (inside the window we looked at) means gone here, but only for this person's
    // events, and never for a calendar we could not read this time.
    const removed = await this.prisma.calendarEvent.deleteMany({
      where: {
        workspaceId,
        importedById: userId,
        googleEventId: { notIn: ids },
        startsAt: { lt: to },
        endsAt: { gt: from },
        OR: [{ googleCalendarId: null }, { googleCalendarId: { notIn: failedCalendarIds } }],
      },
    });

    const created = events.filter((event) => !existing.has(event.id)).length;
    return { created, updated: events.length - created, removed: removed.count };
  }

  private async syncTasks(
    workspaceId: string,
    userId: string,
    input: { refreshToken: string; granted: boolean; completedSince: Date },
  ): Promise<TasksOutcome> {
    if (!input.granted) return { status: 'not-granted' };
    let result: { tasks: GoogleTask[]; failedListIds: string[] };
    try {
      result = await this.provider.listTasks({
        refreshToken: input.refreshToken,
        completedSince: input.completedSince,
      });
    } catch (error) {
      if (error instanceof GoogleTasksUnavailableError) return { status: 'unavailable' };
      throw error;
    }

    const { tasks, failedListIds } = result;
    const ids = tasks.map((task) => task.id);
    const existing = new Map(
      (
        await this.prisma.task.findMany({
          where: { workspaceId, googleTaskId: { in: ids } },
          select: { googleTaskId: true, status: true },
        })
      ).map((row) => [row.googleTaskId, row.status]),
    );

    await this.prisma.$transaction(
      tasks.map((task) => {
        const shared = {
          title: task.title,
          description: task.notes ?? null,
          dueDate: task.due ?? null,
          importedById: userId,
        };
        const localStatus = existing.get(task.id);
        if (localStatus === undefined) {
          return this.prisma.task.create({
            data: {
              ...shared,
              workspaceId,
              googleTaskId: task.id,
              status: task.completed ? TaskStatus.DONE : TaskStatus.TODO,
              completedAt: task.completed ? (task.completedAt ?? new Date()) : null,
            },
          });
        }
        // Keep a local "in progress"; only a change of done / not done in Google moves the status.
        const status = task.completed
          ? TaskStatus.DONE
          : localStatus === TaskStatus.DONE
            ? TaskStatus.TODO
            : localStatus;
        return this.prisma.task.update({
          where: { workspaceId_googleTaskId: { workspaceId, googleTaskId: task.id } },
          data: {
            ...shared,
            status,
            completedAt: task.completed ? (task.completedAt ?? new Date()) : null,
          },
        });
      }),
    );

    const removed = await this.prisma.task.deleteMany({
      where: {
        workspaceId,
        importedById: userId,
        googleTaskId: { notIn: ids },
        // a task list we could not read keeps what it had
        NOT: failedListIds.map((id) => ({ googleTaskId: { startsWith: `${id}/` } })),
      },
    });
    const created = tasks.filter((task) => !existing.has(task.id)).length;
    return { status: 'synced', created, updated: tasks.length - created, removed: removed.count };
  }

  /** Forgets the connection and removes everything it imported, in every workspace. */
  async disconnect(userId: string) {
    const connection = await this.prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) return;
    await this.prisma.$transaction([
      this.prisma.calendarEvent.deleteMany({ where: { importedById: userId } }),
      this.prisma.task.deleteMany({ where: { importedById: userId } }),
      this.prisma.googleConnection.delete({ where: { userId } }),
    ]);
    await this.provider.revoke(decryptToken(connection.refreshTokenEnc));
  }
}
