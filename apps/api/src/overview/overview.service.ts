import { BadRequestException, Injectable } from '@nestjs/common';
import { TaskPriority, TaskStatus } from '../generated/prisma/enums.js';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Tasks due within this many hours are "about to expire". Overdue ones stay in the list until done. */
export const DUE_SOON_HOURS = 24;
const MAX_CALENDAR_DAYS = 100;
const CALENDAR_LIMIT = 500;

const taskCard = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  assignee: { select: { id: true, name: true } },
} as const;

const dueFirst = [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }] as const;

@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleCalendar: GoogleCalendarService,
  ) {}

  /** Everything the workspace home page shows besides the calendar. */
  async summary(workspaceId: string, now = new Date()) {
    const open = { workspaceId, status: { not: TaskStatus.DONE } };
    const soonLimit = new Date(now.getTime() + DUE_SOON_HOURS * 60 * 60 * 1000);
    const [dueSoon, priority, openTasks, openTotal, pages] = await Promise.all([
      this.prisma.task.findMany({
        where: { ...open, dueDate: { lte: soonLimit } },
        orderBy: { dueDate: 'asc' },
        take: 10,
        select: taskCard,
      }),
      this.prisma.task.findMany({
        where: { ...open, priority: TaskPriority.HIGH },
        orderBy: [...dueFirst],
        take: 8,
        select: taskCard,
      }),
      this.prisma.task.findMany({
        where: open,
        orderBy: [...dueFirst],
        take: 8,
        select: taskCard,
      }),
      this.prisma.task.count({ where: open }),
      this.prisma.page.count({ where: { workspaceId } }),
    ]);
    const mark = <T extends { dueDate: Date | null }>(tasks: T[]) =>
      tasks.map((task) => ({ ...task, isOverdue: !!task.dueDate && task.dueDate < now }));
    return {
      dueSoonHours: DUE_SOON_HOURS,
      dueSoon: mark(dueSoon),
      priority: mark(priority),
      openTasks: mark(openTasks),
      openTotal,
      pages,
    };
  }

  /** Events and task deadlines inside a window, for drawing a calendar. */
  async calendar(workspaceId: string, viewerId: string, from: Date, to: Date) {
    if (to <= from) throw new BadRequestException('"to" must be after "from"');
    if (to.getTime() - from.getTime() > MAX_CALENDAR_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`The window can span at most ${MAX_CALENDAR_DAYS} days`);
    }
    const [events, tasks, google] = await Promise.all([
      this.prisma.calendarEvent.findMany({
        where: { workspaceId, startsAt: { lt: to }, endsAt: { gt: from } },
        orderBy: { startsAt: 'asc' },
        take: CALENDAR_LIMIT,
        select: {
          id: true,
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          googleEventId: true,
          calendarName: true,
          importedById: true,
          googleEditable: true,
          recurring: true,
          googleUrl: true,
        },
      }),
      this.prisma.task.findMany({
        where: { workspaceId, dueDate: { gte: from, lt: to } },
        orderBy: { dueDate: 'asc' },
        take: CALENDAR_LIMIT,
        select: taskCard,
      }),
      this.googleCalendar.status(viewerId, workspaceId),
    ]);
    return {
      events: events.map(
        ({ googleEventId, importedById, googleEditable, googleUrl, ...event }) => ({
          ...event,
          imported: googleEventId !== null,
          // Google rights of the person looking: the client decides what to offer from these
          mine: googleEventId !== null && importedById === viewerId,
          editable: googleEditable,
          url: googleUrl,
        }),
      ),
      tasks,
      google: {
        connected: google.connected,
        editGranted: google.editGranted,
        twoWay: google.twoWay,
      },
    };
  }
}
