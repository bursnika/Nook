import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../src/env.js';
import { BlockType, TaskPriority, TaskStatus } from '../src/generated/prisma/enums.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });

const DAY = 24 * 60 * 60 * 1000;
const at = (daysFromToday: number, hour: number, minutes = 0) => {
  const d = new Date(Date.now() + daysFromToday * DAY);
  d.setHours(hour, minutes, 0, 0);
  return d;
};

async function main() {
  if (await prisma.workspace.findUnique({ where: { slug: 'demo' } })) {
    console.log('Demo workspace already exists, nothing to seed.');
    return;
  }

  const owner = await prisma.user.create({
    data: { email: 'demo@nook.local', name: 'Demo Owner' },
  });
  const friend = await prisma.user.create({
    data: { email: 'friend@nook.local', name: 'Study Buddy' },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Demo Space',
      slug: 'demo',
      memberships: {
        create: [
          { userId: owner.id, role: 'OWNER' },
          { userId: friend.id, role: 'MEMBER' },
        ],
      },
    },
  });
  const workspaceId = workspace.id;

  const plan = await prisma.page.create({
    data: {
      workspaceId,
      authorId: owner.id,
      title: 'Plan for the week',
      icon: '♡',
      slug: 'plan-for-the-week',
      isPublished: true,
      blocks: {
        create: [
          { type: BlockType.HEADING_1, position: 1024, content: { text: 'Plan for the week' } },
          {
            type: BlockType.PARAGRAPH,
            position: 2048,
            content: { text: 'Finish the web technologies lab and do not forget to rest.' },
          },
          {
            type: BlockType.TODO,
            position: 3072,
            content: { text: 'Prisma schema', checked: true },
          },
          { type: BlockType.TODO, position: 4096, content: { text: 'REST API', checked: false } },
          { type: BlockType.QUOTE, position: 5120, content: { text: 'take breaks! drink water' } },
        ],
      },
    },
  });
  await prisma.page.create({
    data: { workspaceId, authorId: owner.id, parentId: plan.id, title: 'Lab report', icon: '✎' },
  });
  await prisma.page.create({
    data: { workspaceId, authorId: friend.id, title: 'Ideas', icon: '✦' },
  });

  const tasks = [
    {
      title: 'Write the lab report',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
      due: at(2, 18),
    },
    {
      title: 'Prepare the API demo',
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      due: at(4, 12),
    },
    {
      title: 'Buy coffee',
      status: TaskStatus.TODO,
      priority: TaskPriority.LOW,
      due: at(0, 17),
    },
    {
      title: 'Gym',
      status: TaskStatus.DONE,
      priority: TaskPriority.MEDIUM,
      due: at(-1, 9),
    },
    {
      title: 'Set up the repository',
      status: TaskStatus.DONE,
      priority: TaskPriority.HIGH,
      due: at(-3, 12),
    },
  ];
  for (const [i, t] of tasks.entries()) {
    await prisma.task.create({
      data: {
        workspaceId,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.due,
        position: (i + 1) * 1024,
        assigneeId: owner.id,
        pageId: plan.id,
        completedAt: t.status === TaskStatus.DONE ? t.due : null,
      },
    });
  }

  await prisma.calendarEvent.createMany({
    data: [
      {
        workspaceId,
        title: 'Web technologies lecture',
        startsAt: at(1, 10),
        endsAt: at(1, 11, 30),
      },
      { workspaceId, title: 'Lab defence', startsAt: at(5, 14), endsAt: at(5, 15) },
      {
        workspaceId,
        title: 'Birthday party',
        startsAt: at(3, 0),
        endsAt: at(3, 23, 59),
        allDay: true,
      },
    ],
  });

  console.log('Seeded demo workspace "demo" (id: %s)', workspaceId);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
