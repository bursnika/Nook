import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../apps/api/src/generated/prisma/client';
import { ANN_EMAIL, BOB_EMAIL, ROOT_EMAIL, e2eDatabaseUrl } from './env';

export interface Seed {
  users: Record<'ann' | 'bob' | 'root', { id: string; email: string; name: string }>;
  workspace: { id: string; name: string; slug: string };
  // bob is not a member here
  otherWorkspace: { id: string; name: string };
  welcomePage: { id: string; title: string };
  publicPage: { id: string; title: string; slug: string; description: string };
  tasks: { todo: string; inProgress: string; done: string };
  event: { id: string; title: string };
}

export const WORKSPACE_NAME = 'E2E Space';
export const OTHER_WORKSPACE_NAME = 'E2E Other Space';
export const WELCOME_TITLE = 'Welcome';
export const PUBLIC_SLUG = 'e2e-public';
export const PUBLIC_TITLE = 'Hello from the public page';
export const PUBLIC_INTRO = 'Nook pages can be published for everyone with the link.';

// seeded by a migration, restored after truncate
const FEATURE_FLAGS = [
  { key: 'insights', description: 'Insights page with productivity statistics' },
  { key: 'google-two-way-sync', description: 'Two-way Google Calendar synchronisation' },
];

export function connect(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: e2eDatabaseUrl() }) });
}

export async function resetDatabase(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'FeatureFlag')`;
  const list = tables.map((table) => `"${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  for (const flag of FEATURE_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { enabled: true },
      create: { ...flag, enabled: true },
    });
  }
}

const STEP = 1024;

export async function seedDatabase(prisma: PrismaClient): Promise<Seed> {
  const [ann, bob, root] = await Promise.all([
    prisma.user.create({ data: { email: ANN_EMAIL, name: 'Ann Archer' } }),
    prisma.user.create({ data: { email: BOB_EMAIL, name: 'Bob Baker' } }),
    prisma.user.create({ data: { email: ROOT_EMAIL, name: 'Root Admin' } }),
  ]);

  const workspace = await prisma.workspace.create({
    data: {
      name: WORKSPACE_NAME,
      slug: 'e2e-space',
      memberships: {
        create: [
          { userId: ann.id, role: 'OWNER' },
          { userId: bob.id, role: 'MEMBER' },
        ],
      },
    },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: {
      name: OTHER_WORKSPACE_NAME,
      slug: 'e2e-other-space',
      memberships: { create: [{ userId: ann.id, role: 'OWNER' }] },
    },
  });

  const welcome = await prisma.page.create({
    data: {
      title: WELCOME_TITLE,
      icon: '♡',
      workspaceId: workspace.id,
      authorId: ann.id,
      blocks: {
        create: [
          { type: 'HEADING_1', content: { text: 'Welcome to Nook' }, position: STEP },
          {
            type: 'PARAGRAPH',
            content: { text: 'This is the first paragraph.' },
            position: 2 * STEP,
          },
          {
            type: 'TODO',
            content: { text: 'Try the block editor', checked: false },
            position: 3 * STEP,
          },
          {
            type: 'BULLETED_LIST',
            content: { text: 'Drag blocks to reorder them' },
            position: 4 * STEP,
          },
        ],
      },
    },
  });

  const published = await prisma.page.create({
    data: {
      title: PUBLIC_TITLE,
      icon: '✿',
      slug: PUBLIC_SLUG,
      isPublished: true,
      workspaceId: workspace.id,
      authorId: ann.id,
      blocks: {
        create: [
          { type: 'PARAGRAPH', content: { text: PUBLIC_INTRO }, position: STEP },
          { type: 'HEADING_2', content: { text: 'Why publish' }, position: 2 * STEP },
          { type: 'BULLETED_LIST', content: { text: 'Share a plan' }, position: 3 * STEP },
          { type: 'BULLETED_LIST', content: { text: 'Share a checklist' }, position: 4 * STEP },
        ],
      },
    },
  });

  const [todo, inProgress, done] = await Promise.all([
    prisma.task.create({
      data: { workspaceId: workspace.id, title: 'Seed: to do', status: 'TODO', position: STEP },
    }),
    prisma.task.create({
      data: {
        workspaceId: workspace.id,
        title: 'Seed: in progress',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        position: STEP,
      },
    }),
    prisma.task.create({
      data: {
        workspaceId: workspace.id,
        title: 'Seed: done',
        status: 'DONE',
        position: STEP,
        completedAt: new Date(),
      },
    }),
  ]);

  // tomorrow at noon utc
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 1);
  startsAt.setUTCHours(12, 0, 0, 0);
  const event = await prisma.calendarEvent.create({
    data: {
      workspaceId: workspace.id,
      title: 'Seed: planning meeting',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
    },
  });

  const person = (user: { id: string; email: string; name: string }) => ({
    id: user.id,
    email: user.email,
    name: user.name,
  });
  return {
    users: { ann: person(ann), bob: person(bob), root: person(root) },
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    otherWorkspace: { id: otherWorkspace.id, name: otherWorkspace.name },
    welcomePage: { id: welcome.id, title: welcome.title },
    publicPage: {
      id: published.id,
      title: published.title,
      slug: PUBLIC_SLUG,
      description: PUBLIC_INTRO,
    },
    tasks: { todo: todo.id, inProgress: inProgress.id, done: done.id },
    event: { id: event.id, title: event.title },
  };
}
