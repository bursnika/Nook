import { PrismaPg } from '@prisma/adapter-pg';
import { SignJWT } from 'jose';
import { env } from '../src/env.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Prepares the Newman (Postman CLI) run: makes sure the dedicated test user exists and prints a
 * short-lived access token for it. The token is the ONLY thing written to stdout, so the output can be
 * captured with `NOOK_TOKEN=$(pnpm --filter @nook/api -s postman:token)`.
 * Claims mirror TokenService (src/auth/token.service.ts): HS256, sub = user id, issuer, audience, email.
 */
const EMAIL = 'newman@nook.local';
const TOKEN_TTL_MINUTES = 60;
/** The collection names the workspaces it creates `newman-<run id>`; an aborted run may leave one behind. */
const SLUG_PREFIX = 'newman-';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });

async function main() {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: { email: EMAIL, name: 'Newman' },
  });

  // Workspaces of an interrupted earlier run (pages, tasks, ... go with them by cascade).
  await prisma.workspace.deleteMany({
    where: {
      slug: { startsWith: SLUG_PREFIX },
      memberships: { some: { userId: user.id, role: 'OWNER' } },
    },
  });

  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('nook')
    .setAudience('nook-api')
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_MINUTES}m`)
    .sign(new TextEncoder().encode(env.jwtSecret));

  process.stdout.write(`${token}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
