import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../src/env.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Bulk-generates users to demo autocomplete on a large table (task F2).
 * Usage: pnpm --filter @nook/api db:seed:users [count]   (default 1 000 000)
 */
const count = Number(process.argv[2] ?? 1_000_000);
if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });

async function main() {
  const existing = await prisma.user.count({ where: { email: { endsWith: '@bulk.nook.local' } } });
  if (existing >= count) {
    console.log(`Already have ${existing} bulk users, nothing to do.`);
    return;
  }

  const started = Date.now();
  const inserted = await prisma.$executeRaw`
    INSERT INTO "User" ("id", "email", "name", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid(),
      lower(f.first || '.' || l.last) || '.' || g.n || '@bulk.nook.local',
      f.first || ' ' || l.last,
      now(),
      now()
    FROM generate_series(${existing + 1}::int, ${count}::int) AS g(n)
    CROSS JOIN LATERAL (
      SELECT (ARRAY['Anna','Oleksandr','Maria','Dmytro','Olena','Andrii','Sofiia','Ivan','Kateryna','Mykola',
                    'Yulia','Taras','Iryna','Bohdan','Natalia','Vasyl','Oksana','Serhii','Daria','Pavlo',
                    'Veronika','Roman','Halyna','Artem','Mariia','Viktor','Tetiana','Maksym','Liudmyla','Yaroslav'])
             [1 + g.n % 30] AS first
    ) f
    CROSS JOIN LATERAL (
      SELECT (ARRAY['Shevchenko','Kovalenko','Bondarenko','Tkachenko','Kravchenko','Melnyk','Boyko','Moroz','Lysenko','Rudenko',
                    'Savchenko','Petrenko','Marchenko','Kovalchuk','Polishchuk','Hrytsenko','Danylenko','Pavlenko','Klymenko','Hnatiuk',
                    'Burkova','Zaitsev','Romaniuk','Vasylenko','Kuzmenko','Sydorenko','Panchenko','Yatsenko','Honchar','Bilyk'])
             [1 + (g.n / 30) % 30] AS last
    ) l
    ON CONFLICT DO NOTHING`;
  console.log(`Inserted ${inserted} users in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await prisma.$executeRaw`ANALYZE "User"`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
