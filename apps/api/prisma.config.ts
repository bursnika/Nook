import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    // Only needed by commands that replay migrations (migrate dev / migrate diff --from-migrations).
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
