import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBlockDto, UpdateBlockDto } from './block.dto.js';

const POSITION_STEP = 1024;

@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, pageId: string) {
    await this.assertPage(workspaceId, pageId);
    return this.prisma.block.findMany({ where: { pageId }, orderBy: { position: 'asc' } });
  }

  async create(workspaceId: string, pageId: string, dto: CreateBlockDto) {
    await this.assertPage(workspaceId, pageId);
    const position = dto.position ?? (await this.nextPosition(pageId));
    return this.prisma.block.create({
      data: {
        pageId,
        position,
        type: dto.type,
        content: (dto.content ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async update(workspaceId: string, pageId: string, id: string, dto: UpdateBlockDto) {
    await this.assertPage(workspaceId, pageId);
    return this.prisma.block.update({
      where: { id, pageId },
      data: {
        type: dto.type,
        position: dto.position,
        content: dto.content as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async remove(workspaceId: string, pageId: string, id: string) {
    await this.assertPage(workspaceId, pageId);
    await this.prisma.block.delete({ where: { id, pageId } });
  }

  private async assertPage(workspaceId: string, pageId: string) {
    await this.prisma.page.findFirstOrThrow({
      where: { id: pageId, workspaceId },
      select: { id: true },
    });
  }

  private async nextPosition(pageId: string) {
    const { _max } = await this.prisma.block.aggregate({
      where: { pageId },
      _max: { position: true },
    });
    return (_max.position ?? 0) + POSITION_STEP;
  }
}
