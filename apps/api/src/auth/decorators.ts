import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../generated/prisma/enums.js';
import type { AuthUser } from './auth.types.js';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const PLATFORM_ADMIN_ONLY = 'platformAdminOnly';
export const REQUIRED_FEATURE = 'requiredFeature';

export const Public = () => SetMetadata(IS_PUBLIC, true);

export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN_ONLY, true);

export const RequireFeature = (key: string) => SetMetadata(REQUIRED_FEATURE, key);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest<Request>().user!;
  },
);
