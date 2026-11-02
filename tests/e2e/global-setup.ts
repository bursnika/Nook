import { rmSync } from 'node:fs';
import { writeStorageStates } from './support/auth';
import { NYC_OUTPUT } from './support/env';
import { connect, resetDatabase, seedDatabase } from './support/seed';

export default async function globalSetup() {
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
