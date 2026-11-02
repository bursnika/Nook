import { PrismaPg } from '@prisma/adapter-pg';
import { SignJWT } from 'jose';
import { env } from '../src/env.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

// prints only the token, so it can go into NOOK_TOKEN=$(...)
const EMAIL = 'newman@nook.local';
const TOKEN_TTL_MINUTES = 60;
const SLUG_PREFIX = 'newman-';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });

async function main() {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: { email: EMAIL, name: 'Newman' },
  });

  // leftovers of an aborted run
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
