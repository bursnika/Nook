import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  GOOGLE_CALENDAR_PROVIDER,
  CALENDAR_SCOPE,
  GoogleAccessRevokedError,
  type GoogleCalendarProvider,
} from './google-calendar.provider.js';
import { decryptToken, encryptToken } from './token-crypto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far around "now" events are imported. */
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;

/** The granted scope string is space-separated; the person may have unticked the calendar box. */
const grantsCalendar = (scope: string) => scope.split(' ').includes(CALENDAR_SCOPE);

@Injectable()
export class GoogleCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GOOGLE_CALENDAR_PROVIDER) readonly provider: GoogleCalendarProvider,
  ) {}

  async status(userId: string) {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { userId },
      select: { lastSyncAt: true },
    });
    return {
      configured: this.provider.configured,
      connected: connection !== null,
      lastSyncAt: connection?.lastSyncAt ?? null,
    };
  }

  /** Stores the refresh token (encrypted) once Google confirms the calendar scope was granted. */
  async connect(
    userId: string,
    params: { code: string; codeVerifier: string; redirectUri: string },
  ) {
    const { refreshToken, scope } = await this.provider.exchangeCode(params);
    if (!grantsCalendar(scope)) return { granted: false as const };
    const refreshTokenEnc = encryptToken(refreshToken);
    await this.prisma.googleConnection.upsert({
      where: { userId },
      update: { refreshTokenEnc, scope },
      create: { userId, refreshTokenEnc, scope },
    });
    return { granted: true as const };
  }

  /** Imports the person's Google events into the workspace and mirrors deletions made in Google. */
  async sync(workspaceId: string, userId: string, now = new Date()) {
    const connection = await this.prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) throw new ConflictException('Connect Google Calendar first');

    const from = new Date(now.getTime() - PAST_DAYS * DAY_MS);
    const to = new Date(now.getTime() + FUTURE_DAYS * DAY_MS);
    let events;
    try {
      events = await this.provider.listEvents({
        refreshToken: decryptToken(connection.refreshTokenEnc),
        from,
        to,
      });
    } catch (error) {
      if (!(error instanceof GoogleAccessRevokedError)) throw error;
      await this.prisma.googleConnection.delete({ where: { userId } });
      throw new ConflictException('Google no longer allows access. Connect Google Calendar again.');
    }

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
      events.map((event) =>
        this.prisma.calendarEvent.upsert({
          where: { workspaceId_googleEventId: { workspaceId, googleEventId: event.id } },
          create: {
            workspaceId,
            googleEventId: event.id,
            importedById: userId,
            title: event.title,
            description: event.description,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            allDay: event.allDay,
          },
          update: {
            importedById: userId,
            title: event.title,
            description: event.description,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            allDay: event.allDay,
          },
        }),
      ),
    );
    // Gone from Google (inside the window we looked at) means gone here, but only for this person's events.
    const removed = await this.prisma.calendarEvent.deleteMany({
      where: {
        workspaceId,
        importedById: userId,
        googleEventId: { notIn: ids },
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
    });
    await this.prisma.googleConnection.update({ where: { userId }, data: { lastSyncAt: now } });

    const created = events.filter((event) => !existing.has(event.id)).length;
    return {
      created,
      updated: events.length - created,
      removed: removed.count,
      syncedAt: now,
    };
  }

  /** Forgets the connection and removes the events it imported, in every workspace. */
  async disconnect(userId: string) {
    const connection = await this.prisma.googleConnection.findUnique({ where: { userId } });
    if (!connection) return;
    await this.prisma.$transaction([
      this.prisma.calendarEvent.deleteMany({ where: { importedById: userId } }),
      this.prisma.googleConnection.delete({ where: { userId } }),
    ]);
    await this.provider.revoke(decryptToken(connection.refreshTokenEnc));
  }
}
