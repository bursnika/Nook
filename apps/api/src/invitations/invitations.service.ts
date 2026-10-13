import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateInvitationDto } from './invitation.dto.js';

const TTL_DAYS = 7;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates an invitation and returns its secret token once. Only the hash is stored. */
  async create(workspaceId: string, invitedById: string, dto: CreateInvitationDto) {
    const email = dto.email.toLowerCase();
    const alreadyMember = await this.prisma.membership.findFirst({
      where: { workspaceId, user: { email } },
      select: { id: true },
    });
    if (alreadyMember)
      throw new ConflictException('This person is already a member of the workspace');

    const token = randomBytes(32).toString('base64url');
    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId,
        invitedById,
        email,
        role: dto.role,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000),
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    return { ...invitation, token };
  }

  list(workspaceId: string) {
    return this.prisma.invitation.findMany({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { id: 'desc' },
    });
  }

  async revoke(workspaceId: string, id: string) {
    await this.prisma.invitation.delete({ where: { id, workspaceId } });
  }

  /** What the invite page shows before the person accepts. Does not reveal anything beyond the token holder's own invitation. */
  async preview(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { workspace: { select: { name: true } } },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    return {
      workspaceName: invitation.workspace.name,
      email: invitation.email,
      role: invitation.role,
      usable: !invitation.acceptedAt && invitation.expiresAt > new Date(),
    };
  }

  /** Joins the signed-in user to the workspace. The invitation must have been sent to their e-mail address. */
  async accept(user: AuthUser, token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { workspace: { select: { id: true, name: true } } },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw new GoneException('This invitation has expired or was already used');
    }
    if (invitation.email !== user.email.toLowerCase()) {
      throw new ForbiddenException('This invitation was sent to a different e-mail address');
    }

    await this.prisma.$transaction([
      this.prisma.membership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: invitation.workspaceId } },
        update: {},
        create: { userId: user.id, workspaceId: invitation.workspaceId, role: invitation.role },
      }),
      this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
    return { workspace: invitation.workspace, role: invitation.role };
  }
}
