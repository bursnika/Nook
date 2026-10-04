import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTagDto, ListTagsQuery, UpdateTagDto } from './tag.dto.js';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, { q, skip, limit }: ListTagsQuery) {
    const where: Prisma.TagWhereInput = {
      workspaceId,
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.tag.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: { _count: { select: { tasks: true } } },
      }),
      this.prisma.tag.count({ where }),
    ]);
    return { items, total };
  }

  get(workspaceId: string, id: string) {
    return this.prisma.tag.findFirstOrThrow({ where: { id, workspaceId } });
  }

  async create(workspaceId: string, dto: CreateTagDto) {
    await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return this.prisma.tag.create({ data: { ...dto, workspaceId } });
  }

  update(workspaceId: string, id: string, dto: UpdateTagDto) {
    return this.prisma.tag.update({ where: { id, workspaceId }, data: dto });
  }

  async remove(workspaceId: string, id: string) {
    await this.prisma.tag.delete({ where: { id, workspaceId } });
  }
}
