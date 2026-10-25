import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { env } from '../env.js';
import { TaskStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MESSAGE_QUEUE, PermanentQueueError, type MessageQueue } from '../queue/message-queue.js';
import { TELEGRAM_PROVIDER, type TelegramProvider } from '../telegram/telegram.provider.js';
import { formatReminder } from './reminder.js';

export const REMINDERS_QUEUE = 'reminders';

/** What travels through the queue; the consumer re-reads the task, so a stale message does nothing. */
export interface ReminderJob {
  taskId: string;
  userId: string;
  /** The due date the reminder was planned for (epoch ms); a rescheduled task makes it stale. */
  dueAt: number;
}

/** Most tasks looked at per run; the rest follow on the next one. */
const BATCH = 500;
/** The same reminder is not queued again for this long (a retry may still be running). */
const REPUBLISH_AFTER_MS = 15 * 60_000;

const isJob = (value: unknown): value is ReminderJob => {
  const job = value as Partial<ReminderJob> | null;
  return (
    typeof job?.taskId === 'string' &&
    typeof job.userId === 'string' &&
    typeof job.dueAt === 'number'
  );
};

/**
 * "Due soon" reminders over Telegram. A scheduler queues one message per task; a consumer sends it. The
 * queue retries failed sends with backoff, so `reminderSentAt` is only set once Telegram accepted the text.
 */
@Injectable()
export class RemindersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Reminders');
  /** `taskId:dueAt` -> until when it is not queued again. */
  private readonly queued = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGE_QUEUE) private readonly queue: MessageQueue,
    @Inject(TELEGRAM_PROVIDER) private readonly telegram: TelegramProvider,
  ) {}

  async onApplicationBootstrap() {
    await this.queue.subscribe<ReminderJob>(REMINDERS_QUEUE, (job) => this.deliver(job), {
      // one at a time: two copies of a message cannot both pass the "not sent yet" check
      prefetch: 1,
      retryDelayMs: 10_000,
    });
    // nothing to send through, nothing to look for
    if (!this.telegram.configured || env.nodeEnv === 'test') return;
    this.timer = setInterval(
      () => void this.scheduleDue().catch((error) => this.log.warn(String(error))),
      env.reminders.checkEverySeconds * 1000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Queues a reminder for every open task due within the lead time whose person can be reached. */
  async scheduleDue(now = new Date()) {
    if (!this.telegram.configured) return 0;
    for (const [key, until] of this.queued) if (until <= now.getTime()) this.queued.delete(key);
    let published = 0;
    for (const job of await this.findDue(now)) {
      const key = `${job.taskId}:${job.dueAt}`;
      if (this.queued.has(key)) continue;
      try {
        await this.queue.publish(REMINDERS_QUEUE, job, { messageId: `reminder:${key}` });
      } catch (error) {
        // the broker is away; the next run tries again
        this.log.warn(`Cannot queue reminders: ${String(error)}`);
        break;
      }
      this.queued.set(key, now.getTime() + REPUBLISH_AFTER_MS);
      published += 1;
    }
    return published;
  }

  /**
   * Open, not yet reminded tasks due within the lead time, paired with who gets the reminder: the assignee,
   * else whoever imported the task from Google, else the oldest owner of the workspace. Only people who are
   * still members and have linked Telegram qualify, which also keeps a message inside its own workspace.
   */
  async findDue(now: Date): Promise<ReminderJob[]> {
    const horizon = new Date(now.getTime() + env.reminders.leadMinutes * 60_000);
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { not: TaskStatus.DONE },
        reminderSentAt: null,
        dueDate: { gte: now, lte: horizon },
      },
      select: {
        id: true,
        dueDate: true,
        workspaceId: true,
        assigneeId: true,
        importedById: true,
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: BATCH,
    });
    if (tasks.length === 0) return [];

    const workspaceIds = [...new Set(tasks.map((task) => task.workspaceId))];
    const owners = new Map<string, string>();
    const ownerRows = await this.prisma.membership.findMany({
      where: { workspaceId: { in: workspaceIds }, role: 'OWNER' },
      select: { userId: true, workspaceId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of ownerRows)
      if (!owners.has(row.workspaceId)) owners.set(row.workspaceId, row.userId);

    const recipient = (task: (typeof tasks)[number]) =>
      task.assigneeId ?? task.importedById ?? owners.get(task.workspaceId);
    const memberRows = await this.prisma.membership.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        userId: { in: [...new Set(tasks.flatMap((task) => recipient(task) ?? []))] },
      },
      select: { userId: true, workspaceId: true },
    });
    const members = new Set(memberRows.map((m) => `${m.workspaceId}:${m.userId}`));

    const planned = tasks.flatMap((task) => {
      const userId = recipient(task);
      return userId && members.has(`${task.workspaceId}:${userId}`)
        ? [{ taskId: task.id, userId, dueAt: task.dueDate!.getTime() }]
        : [];
    });
    const linked = new Set(
      (
        await this.prisma.telegramLink.findMany({
          where: { userId: { in: planned.map((job) => job.userId) } },
          select: { userId: true },
        })
      ).map((link) => link.userId),
    );
    return planned.filter((job) => linked.has(job.userId));
  }

  /** The consumer. Safe to run twice for one task: the second run finds `reminderSentAt` set. */
  async deliver(job: ReminderJob) {
    if (!isJob(job)) throw new PermanentQueueError('Malformed reminder job');
    const task = await this.prisma.task.findUnique({
      where: { id: job.taskId },
      select: {
        title: true,
        status: true,
        dueDate: true,
        updatedAt: true,
        reminderSentAt: true,
        workspaceId: true,
        workspace: { select: { name: true } },
      },
    });
    // done, deleted, already reminded or moved to another time: nothing to announce
    if (
      !task ||
      !task.dueDate ||
      task.status === TaskStatus.DONE ||
      task.reminderSentAt ||
      task.dueDate.getTime() !== job.dueAt
    ) {
      return;
    }
    const member = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: job.userId, workspaceId: task.workspaceId } },
      select: { id: true },
    });
    const link = member
      ? await this.prisma.telegramLink.findUnique({ where: { userId: job.userId } })
      : null;
    if (!link) return;

    await this.telegram.sendMessage(
      link.chatId,
      formatReminder(task.title, task.dueDate, task.workspace.name),
    );
    // only now is it "sent"; a failure above leaves the task for the retry. Keeping updatedAt as it was.
    await this.prisma.task.updateMany({
      where: { id: job.taskId, dueDate: task.dueDate, reminderSentAt: null },
      data: { reminderSentAt: new Date(), updatedAt: task.updatedAt },
    });
  }
}
