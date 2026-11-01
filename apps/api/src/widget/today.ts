import { TaskStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';

export interface TodayTask {
  title: string;
  priority: string;
  dueDate: Date | null;
  workspace: string;
}

export interface TodayEvent {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  workspace: string;
}

export const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export const dayBounds = (day: string) => ({
  from: new Date(`${day}T00:00:00.000Z`),
  to: new Date(`${day}T23:59:59.999Z`),
});

/**
 * What is on a person's plate for one UTC day, across every workspace they belong to: open tasks due that
 * day or earlier (overdue ones keep showing) and the day's events. Used by the widgets.
 * A platform administrator sees every workspace in the app without being a member, so `everywhere` gives the
 * same view here.
 */
export async function planFor(
  prisma: PrismaService,
  userId: string,
  day: string,
  everywhere = false,
) {
  const { from, to } = dayBounds(day);
  const workspaces = everywhere
    ? await prisma.workspace.findMany({ select: { id: true, name: true } })
    : (
        await prisma.membership.findMany({
          where: { userId },
          select: { workspace: { select: { id: true, name: true } } },
        })
      ).map((m) => m.workspace);
  const names = new Map(workspaces.map((w) => [w.id, w.name]));
  const workspaceId = { in: [...names.keys()] };
  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: { workspaceId, status: { not: TaskStatus.DONE }, dueDate: { lte: to } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 20,
    }),
    prisma.calendarEvent.findMany({
      where: { workspaceId, startsAt: { lte: to }, endsAt: { gt: from } },
      orderBy: { startsAt: 'asc' },
      take: 20,
    }),
  ]);
  return {
    tasks: tasks.map<TodayTask>((t) => ({
      title: t.title,
      priority: t.priority,
      dueDate: t.dueDate,
      workspace: names.get(t.workspaceId) ?? '',
    })),
    events: events.map<TodayEvent>((e) => ({
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      allDay: e.allDay,
      workspace: names.get(e.workspaceId) ?? '',
    })),
  };
}
