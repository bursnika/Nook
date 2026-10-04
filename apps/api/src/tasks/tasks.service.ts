import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { TaskStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTaskDto, ListTasksQuery, UpdateTaskDto } from './task.dto.js';

const POSITION_STEP = 1024;
const include = { tags: true } satisfies Prisma.TaskInclude;

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, query: ListTasksQuery) {
    const { q, status, priority, assigneeId, pageId, tagId, dueFrom, dueTo, skip, limit } = query;
    const where: Prisma.TaskWhereInput = {
      workspaceId,
      status,
      priority,
      assigneeId,
      pageId,
      ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      ...(tagId ? { tags: { some: { id: tagId } } } : {}),
      ...(dueFrom || dueTo ? { dueDate: { gte: dueFrom, lte: dueTo } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        include,
        skip,
        take: limit,
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.task.count({ where }),
    ]);
    return { items, total };
  }

  get(workspaceId: string, id: string) {
    return this.prisma.task.findFirstOrThrow({ where: { id, workspaceId }, include });
  }

  async create(workspaceId: string, dto: CreateTaskDto) {
    await this.assertRefs(workspaceId, dto);
    const status = dto.status ?? TaskStatus.TODO;
    const { tagIds, ...fields } = dto;
    return this.prisma.task.create({
      data: {
        ...fields,
        workspaceId,
        status,
        position: dto.position ?? (await this.nextPosition(workspaceId, status)),
        completedAt: status === TaskStatus.DONE ? new Date() : null,
        tags: tagIds ? { connect: tagIds.map((id) => ({ id })) } : undefined,
      },
      include,
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateTaskDto) {
    const current = await this.prisma.task.findFirstOrThrow({ where: { id, workspaceId } });
    await this.assertRefs(workspaceId, dto);
    const { tagIds, ...fields } = dto;

    let completedAt: Date | null | undefined;
    if (dto.status && dto.status !== current.status) {
      completedAt = dto.status === TaskStatus.DONE ? new Date() : null;
    }

    return this.prisma.task.update({
      where: { id },
      data: {
        ...fields,
        completedAt,
        tags: tagIds ? { set: tagIds.map((tagId) => ({ id: tagId })) } : undefined,
      },
      include,
    });
  }

  async remove(workspaceId: string, id: string) {
    await this.prisma.task.delete({ where: { id, workspaceId } });
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
    if (dto.tagIds?.length) {
      const found = await this.prisma.tag.count({
        where: { workspaceId, id: { in: dto.tagIds } },
      });
      if (found !== dto.tagIds.length) {
        throw new BadRequestException('tagIds contains tags outside this workspace');
      }
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
