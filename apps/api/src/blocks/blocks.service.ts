import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { CacheService } from '../cache/cache.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBlockDto, UpdateBlockDto } from './block.dto.js';

const POSITION_STEP = 1024;

@Injectable()
export class BlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async list(workspaceId: string, pageId: string) {
    await this.assertPage(workspaceId, pageId);
    return this.prisma.block.findMany({ where: { pageId }, orderBy: { position: 'asc' } });
  }

  async create(workspaceId: string, pageId: string, dto: CreateBlockDto) {
    await this.assertPage(workspaceId, pageId);
    const position = dto.position ?? (await this.nextPosition(pageId));
    const block = await this.prisma.block.create({
      data: {
        pageId,
        position,
        type: dto.type,
        content: (dto.content ?? {}) as Prisma.InputJsonValue,
      },
    });
    await this.invalidate(workspaceId);
    return block;
  }

  async update(workspaceId: string, pageId: string, id: string, dto: UpdateBlockDto) {
    await this.assertPage(workspaceId, pageId);
    const block = await this.prisma.block.update({
      where: { id, pageId },
      data: {
        type: dto.type,
        position: dto.position,
        content: dto.content as Prisma.InputJsonValue | undefined,
      },
    });
    await this.invalidate(workspaceId);
    return block;
  }

  async remove(workspaceId: string, pageId: string, id: string) {
    await this.assertPage(workspaceId, pageId);
    await this.prisma.block.delete({ where: { id, pageId } });
    await this.invalidate(workspaceId);
  }

  private invalidate(workspaceId: string) {
    return this.cache.invalidateWorkspace(workspaceId);
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
