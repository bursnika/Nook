import type { Role } from '../generated/prisma/enums.js';

export interface AuthUser {
  id: string;
  email: string;
  /** Listed in ADMIN_EMAILS: sees every workspace and the full user list. */
  isPlatformAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** The caller's membership in the workspace named by `:workspaceId` (set by WorkspaceGuard). */
      membership?: { role: Role };
    }
  }
}
