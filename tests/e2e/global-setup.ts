import { rmSync } from 'node:fs';
import { writeStorageStates } from './support/auth';
import { NYC_OUTPUT } from './support/env';
import { connect, resetDatabase, seedDatabase } from './support/seed';

/**
 * Runs once before the specs, after Playwright started the API (which created `nook_e2e` and applied the
 * migrations, see support/start-api.mjs): empties the database, seeds it and writes one signed-in
 * browser state per person.
 */
export default async function globalSetup() {
  // coverage of an earlier run must not leak into this report
  rmSync(NYC_OUTPUT, { recursive: true, force: true });

  const prisma = connect();
  try {
    await resetDatabase(prisma);
    const seed = await seedDatabase(prisma);
    await writeStorageStates(seed);
  } finally {
    await prisma.$disconnect();
  }
}
