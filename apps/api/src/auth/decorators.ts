import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../generated/prisma/enums.js';
import type { AuthUser } from './auth.types.js';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const PLATFORM_ADMIN_ONLY = 'platformAdminOnly';
export const REQUIRED_FEATURE = 'requiredFeature';

/** The route needs no sign-in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Only these workspace roles may call the route (platform admins always pass). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Only users listed in ADMIN_EMAILS may call the route. */
export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN_ONLY, true);

/** The workspace must have this feature flag available (see FeatureGuard). */
export const RequireFeature = (key: string) => SetMetadata(REQUIRED_FEATURE, key);

/** The signed-in user; only available on routes behind AuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest<Request>().user!;
  },
);
