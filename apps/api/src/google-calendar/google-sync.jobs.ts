import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { env } from '../env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MESSAGE_QUEUE, PermanentQueueError, type MessageQueue } from '../queue/message-queue.js';
import { GoogleCalendarService } from './google-calendar.service.js';

export const GOOGLE_SYNC_QUEUE = 'google-sync';

export interface GoogleSyncJob {
  workspaceId: string;
  userId: string;
}

const isJob = (value: unknown): value is GoogleSyncJob => {
  const job = value as Partial<GoogleSyncJob> | null;
  return typeof job?.workspaceId === 'string' && typeof job.userId === 'string';
};

@Injectable()
export class GoogleSyncJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('GoogleSync');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: GoogleCalendarService,
    @Inject(MESSAGE_QUEUE) private readonly queue: MessageQueue,
  ) {}

  async onApplicationBootstrap() {
    await this.queue.subscribe<GoogleSyncJob>(GOOGLE_SYNC_QUEUE, (job) => this.run(job), {
      // google is rate limited
      prefetch: 2,
      retryDelayMs: 30_000,
    });
    const everyMs = env.googleSyncEveryMinutes * 60_000;
    if (!everyMs || !this.calendar.provider.configured || env.nodeEnv === 'test') return;
    this.timer = setInterval(
      () => void this.enqueueAll().catch((error) => this.log.warn(String(error))),
      everyMs,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async enqueue(workspaceId: string, userId: string) {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!connection) throw new ConflictException('Connect Google Calendar first');
    await this.publish({ workspaceId, userId });
  }

  async enqueueAll() {
    const connections = await this.prisma.googleConnection.findMany({
      select: {
        userId: true,
        user: { select: { memberships: { select: { workspaceId: true } } } },
      },
    });
    let queued = 0;
    for (const { userId, user } of connections) {
      for (const { workspaceId } of user.memberships) {
        await this.publish({ workspaceId, userId });
        queued += 1;
      }
    }
    return queued;
  }

  async run(job: GoogleSyncJob) {
    if (!isJob(job)) throw new PermanentQueueError('Malformed google-sync job');
    const member = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: job.userId, workspaceId: job.workspaceId } },
      select: { id: true },
    });
    if (!member) return;
    try {
      await this.calendar.sync(job.workspaceId, job.userId);
    } catch (error) {
      // no point retrying
      if (error instanceof ConflictException) {
        this.log.log(`Skipped sync for ${job.userId}: ${error.message}`);
        return;
      }
      throw error;
    }
  }

  private async publish(job: GoogleSyncJob) {
    try {
      await this.queue.publish(GOOGLE_SYNC_QUEUE, job);
    } catch (error) {
      throw new ServiceUnavailableException(`Cannot queue the sync: ${String(error)}`);
    }
  }
}
