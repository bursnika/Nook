import { ConflictException, Injectable } from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddMemberDto, UpdateMemberDto } from './member.dto.js';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  list(workspaceId: string) {
    return this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { id: 'asc' },
    });
  }

  async add(workspaceId: string, dto: AddMemberDto) {
    await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return this.prisma.membership.create({
      data: { workspaceId, userId: dto.userId, role: dto.role },
      include: { user: true },
    });
  }

  async updateRole(workspaceId: string, id: string, dto: UpdateMemberDto) {
    const member = await this.prisma.membership.findFirstOrThrow({ where: { id, workspaceId } });
    if (member.role === Role.OWNER && dto.role !== Role.OWNER) {
      await this.assertAnotherOwnerExists(workspaceId, id);
    }
    return this.prisma.membership.update({
      where: { id },
      data: { role: dto.role },
      include: { user: true },
    });
  }

  async remove(workspaceId: string, id: string) {
    const member = await this.prisma.membership.findFirstOrThrow({ where: { id, workspaceId } });
    if (member.role === Role.OWNER) await this.assertAnotherOwnerExists(workspaceId, id);
    await this.prisma.membership.delete({ where: { id } });
  }

  private async assertAnotherOwnerExists(workspaceId: string, exceptId: string) {
    const others = await this.prisma.membership.count({
      where: { workspaceId, role: Role.OWNER, id: { not: exceptId } },
    });
    if (others === 0) {
      throw new ConflictException('A workspace must keep at least one owner');
    }
  }
}
