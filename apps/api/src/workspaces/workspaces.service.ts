import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { Plan } from '../generated/prisma/enums.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateWorkspaceDto, ListWorkspacesQuery, UpdateWorkspaceDto } from './workspace.dto.js';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /** People only see the workspaces they belong to; platform admins see all of them. */
  async list({ q, skip, limit }: ListWorkspacesQuery, user: AuthUser) {
    const where: Prisma.WorkspaceWhereInput = {
      ...(user.isPlatformAdmin ? {} : { memberships: { some: { userId: user.id } } }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspace.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: { memberships: { where: { userId: user.id }, select: { role: true } } },
      }),
      this.prisma.workspace.count({ where }),
    ]);
    return { items, total };
  }

  get(id: string) {
    return this.prisma.workspace.findUniqueOrThrow({ where: { id } });
  }

  /** The creator becomes the first (and, until someone else is promoted, only) owner. */
  create(dto: CreateWorkspaceDto, ownerId: string) {
    return this.prisma.workspace.create({
      data: { ...dto, memberships: { create: { userId: ownerId, role: 'OWNER' } } },
    });
  }

  setPlan(id: string, plan: Plan) {
    return this.prisma.workspace.update({ where: { id }, data: { plan } });
  }

  update(id: string, dto: UpdateWorkspaceDto) {
    return this.prisma.workspace.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.prisma.workspace.delete({ where: { id } });
  }
}
