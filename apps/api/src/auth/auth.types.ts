import type { Role } from '../generated/prisma/enums.js';

export interface AuthUser {
  id: string;
  email: string;
  isPlatformAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      membership?: { role: Role };
    }
  }
}
