import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ROLES } from './decorators.js';

/**
 * Tenant isolation. Any route with a `:workspaceId` parameter is only open to members of that workspace.
 * Non-members get 404 (not 403), so workspace ids cannot be probed.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const workspaceId = req.params?.workspaceId;
    if (typeof workspaceId !== 'string' || !req.user) return true;

    if (req.user.isPlatformAdmin) {
      req.membership = { role: Role.OWNER };
      return true;
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: req.user.id, workspaceId } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException('Record not found');
    req.membership = membership;

    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed && !allowed.includes(membership.role)) {
      throw new ForbiddenException(
        `This action requires one of the roles: ${allowed.join(', ').toLowerCase()}`,
      );
    }
    return true;
  }
}
