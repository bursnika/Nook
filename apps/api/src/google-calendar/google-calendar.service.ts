import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CacheService } from '../cache/cache.service.js';
import { FeaturesService } from '../features/features.service.js';
import type { CalendarEvent } from '../generated/prisma/client.js';
import { TaskStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CALENDAR_SCOPE,
  EVENTS_WRITE_SCOPE,
  GOOGLE_CALENDAR_PROVIDER,
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
import { UpdateGoogleEventDto } from './google-event.dto.js';
import { decryptToken, encryptToken } from './token-crypto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;

const toChanges = (dto: UpdateGoogleEventDto): EventChanges => ({
  title: dto.title.trim(),
  description: dto.description?.trim() || null,
  startsAt: dto.startsAt,
  endsAt: dto.endsAt,
  allDay: dto.allDay,
});

const rawEventId = (row: CalendarEvent) =>
  row.googleEventId!.slice(row.googleCalendarId!.length + 1);

const grants = (scope: string, wanted: string) => scope.split(' ').includes(wanted);

export type TasksOutcome =
  | { status: 'synced'; created: number; updated: number; removed: number }
  | { status: 'not-granted' }
  | { status: 'unavailable' };

@Injectable()
export class GoogleCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
    @Inject(GOOGLE_CALENDAR_PROVIDER) readonly provider: GoogleCalendarProvider,
    private readonly cache: CacheService,
  ) {}

  async status(userId: string, workspaceId?: string) {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { userId },
      select: { lastSyncAt: true, scope: true },
    });
    return {
      configured: this.provider.configured,
      connected: connection !== null,
      tasksGranted: connection ? grants(connection.scope, TASKS_SCOPE) : false,
      editGranted: connection ? grants(connection.scope, EVENTS_WRITE_SCOPE) : false,
      twoWay: workspaceId ? (await this.features.check('google-two-way-sync')).available : false,
      lastSyncAt: connection?.lastSyncAt ?? null,
    };
  }

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
          googleEditable: event.editable,
          recurring: event.recurring,
          googleUrl: event.url ?? null,
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
    // mirror deletions, but skip calendars we couldn't read
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

    await this.cache.invalidateWorkspace(workspaceId);

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
          select: { googleTaskId: true, status: true, dueDate: true },
        })
      ).map((row) => [row.googleTaskId, row]),
    );

    await this.prisma.$transaction(
      tasks.map((task) => {
        const shared = {
          title: task.title,
          description: task.notes ?? null,
          dueDate: task.due ?? null,
          importedById: userId,
        };
        const local = existing.get(task.id);
        const localStatus = local?.status;
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
        // only done/not done comes from google, keep local in-progress/on-hold
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
        NOT: failedListIds.map((id) => ({ googleTaskId: { startsWith: `${id}/` } })),
      },
    });
    await this.cache.invalidateWorkspace(workspaceId);
    const created = tasks.filter((task) => !existing.has(task.id)).length;
    return { status: 'synced', created, updated: tasks.length - created, removed: removed.count };
  }

  async updateEvent(workspaceId: string, userId: string, id: string, dto: UpdateGoogleEventDto) {
    const { row, refreshToken } = await this.writable(workspaceId, userId, id);
    const minimum = dto.allDay ? DAY_MS : 1;
    if (dto.endsAt.getTime() - dto.startsAt.getTime() < minimum) {
      throw new BadRequestException(
        dto.allDay
          ? 'An all-day event lasts at least one day'
          : 'The event must end after it starts',
      );
    }
    try {
      const updated = await this.provider.updateEvent({
        refreshToken,
        calendar: { id: row.googleCalendarId!, name: row.calendarName ?? row.googleCalendarId! },
        eventId: rawEventId(row),
        changes: toChanges(dto),
      });
      const event = await this.prisma.calendarEvent.update({
        where: { id },
        data: {
          title: updated.title,
          description: updated.description ?? null,
          startsAt: updated.startsAt,
          endsAt: updated.endsAt,
          allDay: updated.allDay,
          googleEditable: updated.editable,
          recurring: updated.recurring,
          googleUrl: updated.url ?? row.googleUrl,
        },
      });
      await this.cache.invalidateWorkspace(workspaceId);
      return event;
    } catch (error) {
      return this.explainWriteFailure(error, userId, row);
    }
  }

  async deleteEvent(workspaceId: string, userId: string, id: string) {
    const { row, refreshToken } = await this.writable(workspaceId, userId, id);
    try {
      await this.provider.deleteEvent({
        refreshToken,
        calendarId: row.googleCalendarId!,
        eventId: rawEventId(row),
      });
    } catch (error) {
      return this.explainWriteFailure(error, userId, row);
    }
    await this.prisma.calendarEvent.delete({ where: { id } });
    await this.cache.invalidateWorkspace(workspaceId);
  }

  async createEvent(workspaceId: string, userId: string, dto: UpdateGoogleEventDto) {
    const refreshToken = await this.writeAccess(userId);
    this.assertRange(dto);
    let created;
    try {
      created = await this.provider.createEvent({ refreshToken, changes: toChanges(dto) });
    } catch (error) {
      return this.explainWriteFailure(error, userId);
    }
    const fields = {
      importedById: userId,
      googleCalendarId: created.calendarId,
      calendarName: created.calendarName,
      googleEditable: created.editable,
      recurring: created.recurring,
      googleUrl: created.url ?? null,
      title: created.title,
      description: created.description ?? null,
      startsAt: created.startsAt,
      endsAt: created.endsAt,
      allDay: created.allDay,
    };
    // a sync may have already imported it
    const event = await this.prisma.calendarEvent.upsert({
      where: { workspaceId_googleEventId: { workspaceId, googleEventId: created.id } },
      create: { workspaceId, googleEventId: created.id, ...fields },
      update: fields,
    });
    await this.cache.invalidateWorkspace(workspaceId);
    return event;
  }

  private async writeAccess(userId: string) {
    const connection = await this.prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) throw new ConflictException('Connect Google Calendar first');
    if (!grants(connection.scope, EVENTS_WRITE_SCOPE)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'GOOGLE_WRITE_NOT_GRANTED',
        message:
          'Allow editing Google events first: connect Google Calendar again and tick the permission',
      });
    }
    return decryptToken(connection.refreshTokenEnc);
  }

  private assertRange(dto: UpdateGoogleEventDto) {
    const minimum = dto.allDay ? DAY_MS : 1;
    if (dto.endsAt.getTime() - dto.startsAt.getTime() < minimum) {
      throw new BadRequestException(
        dto.allDay
          ? 'An all-day event lasts at least one day'
          : 'The event must end after it starts',
      );
    }
  }

  private async writable(workspaceId: string, userId: string, id: string) {
    const row = await this.prisma.calendarEvent.findFirst({
      where: { id, workspaceId, googleEventId: { not: null } },
    });
    if (!row) throw new NotFoundException('This is not an event imported from Google Calendar');
    if (row.importedById !== userId) {
      throw new ForbiddenException(
        'This event came from someone else’s Google Calendar, so only they can change it',
      );
    }
    if (!row.googleEditable || !row.googleCalendarId) {
      throw new ForbiddenException(
        'Google Calendar does not let you change this event (read-only calendar, birthday or similar)',
      );
    }
    const refreshToken = await this.writeAccess(userId);
    return { row, refreshToken };
  }

  private async explainWriteFailure(
    error: unknown,
    userId: string,
    row?: CalendarEvent,
  ): Promise<never> {
    if (error instanceof GoogleAccessRevokedError) {
      await this.prisma.googleConnection.deleteMany({ where: { userId } });
      throw new ConflictException('Google no longer allows access. Connect Google Calendar again.');
    }
    if (error instanceof GoogleForbiddenError) {
      throw new ForbiddenException(
        row
          ? 'Google does not let you change this event. You may be only a guest of it.'
          : 'Google does not let you add events to your calendar.',
      );
    }
    if (row && error instanceof GoogleEventGoneError) {
      await this.prisma.calendarEvent.deleteMany({ where: { id: row.id } });
      await this.cache.invalidateWorkspace(row.workspaceId);
      throw new GoneException(
        'This event no longer exists in Google Calendar, so it was removed here too.',
      );
    }
    throw error;
  }

  async disconnect(userId: string) {
    const connection = await this.prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) return;
    const touched = await this.importedWorkspaces(userId);
    await this.prisma.$transaction([
      this.prisma.calendarEvent.deleteMany({ where: { importedById: userId } }),
      this.prisma.task.deleteMany({ where: { importedById: userId } }),
      this.prisma.googleConnection.delete({ where: { userId } }),
    ]);
    await Promise.all(touched.map((id) => this.cache.invalidateWorkspace(id)));
    await this.provider.revoke(decryptToken(connection.refreshTokenEnc));
  }

  private async importedWorkspaces(userId: string) {
    const [events, tasks] = await Promise.all([
      this.prisma.calendarEvent.findMany({
        where: { importedById: userId },
        distinct: ['workspaceId'],
        select: { workspaceId: true },
      }),
      this.prisma.task.findMany({
        where: { importedById: userId },
        distinct: ['workspaceId'],
        select: { workspaceId: true },
      }),
    ]);
    return [...new Set([...events, ...tasks].map((row) => row.workspaceId))];
  }
}
