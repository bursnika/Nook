import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateEventDto, ListEventsQuery, UpdateEventDto } from './event.dto.js';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, { from, to, q, skip, limit }: ListEventsQuery) {
    const where: Prisma.CalendarEventWhereInput = {
      workspaceId,
      ...(from ? { endsAt: { gt: from } } : {}),
      ...(to ? { startsAt: { lt: to } } : {}),
      ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.calendarEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.calendarEvent.count({ where }),
    ]);
    return { items, total };
  }

  get(workspaceId: string, id: string) {
    return this.prisma.calendarEvent.findFirstOrThrow({ where: { id, workspaceId } });
  }

  async create(workspaceId: string, dto: CreateEventDto) {
    this.assertRange(dto.startsAt, dto.endsAt);
    await this.assertTask(workspaceId, dto.taskId);
    return this.prisma.calendarEvent.create({ data: { ...dto, workspaceId } });
  }

  async update(workspaceId: string, id: string, dto: UpdateEventDto) {
    const current = await this.get(workspaceId, id);
    this.assertRange(dto.startsAt ?? current.startsAt, dto.endsAt ?? current.endsAt);
    await this.assertTask(workspaceId, dto.taskId);
    return this.prisma.calendarEvent.update({ where: { id }, data: dto });
  }

  async remove(workspaceId: string, id: string) {
    await this.prisma.calendarEvent.delete({ where: { id, workspaceId } });
  }

  private assertRange(startsAt: Date, endsAt: Date) {
    if (endsAt < startsAt) throw new BadRequestException('endsAt must not be before startsAt');
  }

  private async assertTask(workspaceId: string, taskId?: string | null) {
    if (!taskId) return;
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId },
      select: { id: true },
    });
    if (!task) throw new BadRequestException('taskId does not belong to this workspace');
  }
}
