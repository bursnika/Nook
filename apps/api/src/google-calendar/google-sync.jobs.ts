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

/**
 * Google sync as background jobs: the "sync" button only enqueues, a consumer runs the same sync the
 * synchronous endpoint runs, and a timer enqueues it for everyone who has connected Google.
 */
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
      // Google is rate limited; a few syncs at a time are plenty
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

  /** Queues one sync. Fails fast when the person has not connected Google, as the synchronous endpoint does. */
  async enqueue(workspaceId: string, userId: string) {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!connection) throw new ConflictException('Connect Google Calendar first');
    await this.publish({ workspaceId, userId });
  }

  /** One job per connected person and workspace they belong to. */
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

  /** The consumer. Failures other than "nothing to sync" are retried with backoff by the queue. */
  async run(job: GoogleSyncJob) {
    if (!isJob(job)) throw new PermanentQueueError('Malformed google-sync job');
    const member = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: job.userId, workspaceId: job.workspaceId } },
      select: { id: true },
    });
    // left the workspace since the job was queued
    if (!member) return;
    try {
      await this.calendar.sync(job.workspaceId, job.userId);
    } catch (error) {
      // disconnected, or Google revoked access: retrying cannot help and the person has been told
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
