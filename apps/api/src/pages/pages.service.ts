import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePageDto, ListPagesQuery, UpdatePageDto } from './page.dto.js';

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, { q, parentId, skip, limit }: ListPagesQuery) {
    const where: Prisma.PageWhereInput = {
      workspaceId,
      ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      ...(parentId ? { parentId: parentId === 'root' ? null : parentId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.page.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: { _count: { select: { blocks: true, children: true } } },
      }),
      this.prisma.page.count({ where }),
    ]);
    return { items, total };
  }

  /** A single page comes with its blocks in order, so the editor can load it in one request. */
  get(workspaceId: string, id: string) {
    return this.prisma.page.findFirstOrThrow({
      where: { id, workspaceId },
      include: { blocks: { orderBy: { position: 'asc' } }, attachments: true },
    });
  }

  async create(workspaceId: string, dto: CreatePageDto) {
    await this.assertMember(workspaceId, dto.authorId);
    if (dto.parentId) await this.assertPageInWorkspace(workspaceId, dto.parentId);
    this.assertPublishable(dto.isPublished, dto.slug);
    return this.prisma.page.create({ data: { ...dto, workspaceId } });
  }

  async update(workspaceId: string, id: string, dto: UpdatePageDto) {
    const current = await this.prisma.page.findFirstOrThrow({ where: { id, workspaceId } });
    if (dto.parentId !== undefined && dto.parentId !== null) {
      await this.assertPageInWorkspace(workspaceId, dto.parentId);
      await this.assertNoCycle(id, dto.parentId);
    }
    this.assertPublishable(dto.isPublished ?? current.isPublished, dto.slug ?? current.slug);
    return this.prisma.page.update({ where: { id }, data: dto });
  }

  async remove(workspaceId: string, id: string) {
    await this.prisma.page.findFirstOrThrow({ where: { id, workspaceId }, select: { id: true } });
    await this.prisma.page.delete({ where: { id } });
  }

  private async assertMember(workspaceId: string, userId: string) {
    const member = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { id: true },
    });
    if (!member) throw new BadRequestException('authorId must be a member of this workspace');
  }

  private async assertPageInWorkspace(workspaceId: string, pageId: string) {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, workspaceId },
      select: { id: true },
    });
    if (!page) throw new BadRequestException('parentId does not belong to this workspace');
  }

  /** Walks up from the new parent; meeting the page itself means the move would create a loop. */
  private async assertNoCycle(pageId: string, newParentId: string) {
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === pageId) throw new BadRequestException('A page cannot be moved into itself');
      const parent: { parentId: string | null } | null = await this.prisma.page.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  private assertPublishable(isPublished: boolean | undefined, slug: string | null | undefined) {
    if (isPublished && !slug) {
      throw new BadRequestException('A slug is required to publish a page');
    }
  }
}
