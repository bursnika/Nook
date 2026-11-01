import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { TaskStatus } from '../generated/prisma/enums.js';
import { CacheService } from '../cache/cache.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeBus } from '../realtime/realtime.bus.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { CreateTaskDto, ListTasksQuery, UpdateTaskDto } from './task.dto.js';

const POSITION_STEP = 1024;

/** Every task leaves the service with how many comments and files it has, for the badges on a card. */
const WITH_COUNTS = { _count: { select: { comments: true, attachments: true } } } as const;

type TaskWithCounts = Prisma.TaskGetPayload<{ include: typeof WITH_COUNTS }>;

const withCounts = ({ _count, ...task }: TaskWithCounts) => ({
  ...task,
  commentCount: _count.comments,
  attachmentCount: _count.attachments,
});

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
    private readonly cache: CacheService,
    private readonly uploads: UploadsService,
  ) {}

  async list(workspaceId: string, query: ListTasksQuery) {
    const { q, status, priority, assigneeId, pageId, dueFrom, dueTo, skip, limit } = query;
    const where: Prisma.TaskWhereInput = {
      workspaceId,
      status,
      priority,
      assigneeId,
      pageId,
      ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      ...(dueFrom || dueTo ? { dueDate: { gte: dueFrom, lte: dueTo } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        include: WITH_COUNTS,
      }),
      this.prisma.task.count({ where }),
    ]);
    return { items: items.map(withCounts), total };
  }

  async get(workspaceId: string, id: string) {
    return withCounts(
      await this.prisma.task.findFirstOrThrow({ where: { id, workspaceId }, include: WITH_COUNTS }),
    );
  }

  async create(workspaceId: string, dto: CreateTaskDto) {
    await this.assertRefs(workspaceId, dto);
    const status = dto.status ?? TaskStatus.TODO;
    const task = withCounts(
      await this.prisma.task.create({
        data: {
          ...dto,
          workspaceId,
          status,
          position: dto.position ?? (await this.nextPosition(workspaceId, status)),
          completedAt: status === TaskStatus.DONE ? new Date() : null,
        },
        include: WITH_COUNTS,
      }),
    );
    await this.cache.invalidateWorkspace(workspaceId);
    this.bus.publishWorkspace(workspaceId, { topic: 'task', kind: 'created', id: task.id, task });
    return task;
  }

  async update(workspaceId: string, id: string, dto: UpdateTaskDto) {
    const current = await this.prisma.task.findFirstOrThrow({ where: { id, workspaceId } });
    await this.assertRefs(workspaceId, dto);

    let completedAt: Date | null | undefined;
    if (dto.status && dto.status !== current.status) {
      completedAt = dto.status === TaskStatus.DONE ? new Date() : null;
    }

    const task = withCounts(
      await this.prisma.task.update({
        where: { id },
        data: {
          ...dto,
          completedAt,
        },
        include: WITH_COUNTS,
      }),
    );
    await this.cache.invalidateWorkspace(workspaceId);
    this.bus.publishWorkspace(workspaceId, { topic: 'task', kind: 'updated', id, task });
    return task;
  }

  /** After a comment or a file was added or removed: the counts on the card change for everyone. */
  async touch(workspaceId: string, id: string) {
    const task = await this.get(workspaceId, id);
    await this.cache.invalidateWorkspace(workspaceId);
    this.bus.publishWorkspace(workspaceId, { topic: 'task', kind: 'updated', id, task });
  }

  async remove(workspaceId: string, id: string) {
    const files = await this.prisma.attachment.findMany({
      where: { taskId: id, workspaceId },
      select: { url: true },
    });
    // the attachment records go with the task (cascade); the stored files are removed here
    await this.prisma.task.delete({ where: { id, workspaceId } });
    await Promise.all(files.map((file) => this.uploads.remove(file.url)));
    await this.cache.invalidateWorkspace(workspaceId);
    this.bus.publishWorkspace(workspaceId, { topic: 'task', kind: 'deleted', id });
  }

  /** Everything a task points at must live in the same workspace, otherwise tenants could leak. */
  private async assertRefs(workspaceId: string, dto: UpdateTaskDto) {
    if (dto.pageId) {
      const page = await this.prisma.page.findFirst({
        where: { id: dto.pageId, workspaceId },
        select: { id: true },
      });
      if (!page) throw new BadRequestException('pageId does not belong to this workspace');
    }
    if (dto.assigneeId) {
      const member = await this.prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: dto.assigneeId, workspaceId } },
        select: { id: true },
      });
      if (!member) throw new BadRequestException('assigneeId must be a member of this workspace');
    }
  }

  private async nextPosition(workspaceId: string, status: TaskStatus) {
    const { _max } = await this.prisma.task.aggregate({
      where: { workspaceId, status },
      _max: { position: true },
    });
    return (_max.position ?? 0) + POSITION_STEP;
  }
}
