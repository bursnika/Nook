import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateWorkspaceDto, ListWorkspacesQuery, UpdateWorkspaceDto } from './workspace.dto.js';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ q, skip, limit }: ListWorkspacesQuery) {
    const where: Prisma.WorkspaceWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspace.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
      this.prisma.workspace.count({ where }),
    ]);
    return { items, total };
  }

  get(id: string) {
    return this.prisma.workspace.findUniqueOrThrow({ where: { id } });
  }

  create(dto: CreateWorkspaceDto) {
    return this.prisma.workspace.create({ data: dto });
  }

  update(id: string, dto: UpdateWorkspaceDto) {
    return this.prisma.workspace.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.prisma.workspace.delete({ where: { id } });
  }
}
