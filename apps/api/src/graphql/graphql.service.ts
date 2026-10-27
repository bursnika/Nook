import { ForbiddenException, Injectable } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import type { AuthUser } from '../auth/auth.types.js';
import { EventsService } from '../events/events.service.js';
import { TaskStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeBus } from '../realtime/realtime.bus.js';
import { TasksService } from '../tasks/tasks.service.js';

export type GraphqlContext = {
  user: AuthUser;
};

const iso = (date: Date | null) => (date ? date.toISOString() : null);

const taskOut = (task: Record<string, unknown> | null | undefined) => {
  if (!task) return null;
  const { _count, ...rest } = task as { _count?: { comments: number; attachments: number } };
  return {
    ...rest,
    ...(_count ? { commentCount: _count.comments, attachmentCount: _count.attachments } : {}),
    dueDate: iso(task.dueDate as Date | null),
  };
};

const eventOut = (event: Record<string, unknown> | null | undefined) =>
  event
    ? {
        ...event,
        startsAt: iso(event.startsAt as Date),
        endsAt: iso(event.endsAt as Date),
      }
    : null;

const date = (value: string, name: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new GraphQLError(`${name} must be an ISO date`);
  return parsed;
};

/** Resolvers. Every one checks that the caller belongs to the workspace it asks about. */
@Injectable()
export class GraphqlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly events: EventsService,
    private readonly bus: RealtimeBus,
  ) {}

  async assertMember(user: AuthUser, workspaceId: string) {
    if (user.isPlatformAdmin) return;
    const membership = await this.prisma.membership
      .findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId } },
        select: { id: true },
      })
      .catch(() => null); // a malformed id is the same as an unknown one
    if (!membership) throw new ForbiddenException('Not a member of this workspace');
  }

  /** The object GraphQL reads its fields from: one function per root field. */
  readonly root = {
    tasks: async (
      { workspaceId, status }: { workspaceId: string; status?: TaskStatus },
      { user }: GraphqlContext,
    ) => {
      await this.assertMember(user, workspaceId);
      const rows = await this.prisma.task.findMany({
        where: { workspaceId, ...(status ? { status } : {}) },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: 500,
        include: { _count: { select: { comments: true, attachments: true } } },
      });
      return rows.map(taskOut);
    },

    events: async (
      { workspaceId, from, to }: { workspaceId: string; from: string; to: string },
      { user }: GraphqlContext,
    ) => {
      await this.assertMember(user, workspaceId);
      const rows = await this.prisma.calendarEvent.findMany({
        where: {
          workspaceId,
          endsAt: { gt: date(from, 'from') },
          startsAt: { lt: date(to, 'to') },
        },
        orderBy: { startsAt: 'asc' },
        take: 500,
      });
      return rows.map(eventOut);
    },

    moveTask: async (
      args: { workspaceId: string; id: string; status: TaskStatus; position?: number },
      { user }: GraphqlContext,
    ) => {
      await this.assertMember(user, args.workspaceId);
      if (!Object.values(TaskStatus).includes(args.status)) {
        throw new GraphQLError(`status must be one of ${Object.values(TaskStatus).join(', ')}`);
      }
      const task = await this.tasks.update(args.workspaceId, args.id, {
        status: args.status,
        ...(args.position === undefined ? {} : { position: args.position }),
      });
      return taskOut(task);
    },

    taskChanged: async ({ workspaceId }: { workspaceId: string }, { user }: GraphqlContext) => {
      await this.assertMember(user, workspaceId);
      return this.stream(workspaceId, 'task');
    },

    eventChanged: async ({ workspaceId }: { workspaceId: string }, { user }: GraphqlContext) => {
      await this.assertMember(user, workspaceId);
      return this.stream(workspaceId, 'event');
    },
  };

  /** Turns bus events of one topic into the payloads GraphQL expects: `{ fieldName: value }`. */
  private async *stream(workspaceId: string, topic: 'task' | 'event') {
    for await (const event of this.bus.workspaceStream(workspaceId)) {
      if (event.topic !== topic) continue;
      if (event.topic === 'task') {
        yield {
          taskChanged: { kind: event.kind, taskId: event.id, task: taskOut(event.task as never) },
        };
      } else {
        yield {
          eventChanged: {
            kind: event.kind,
            eventId: event.id,
            event: eventOut(event.event as never),
          },
        };
      }
    }
  }
}
