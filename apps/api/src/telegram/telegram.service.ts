import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { env } from '../env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { planFor, dayOf } from '../widget/today.js';
import { formatDigest } from './digest.js';
import {
  TELEGRAM_PROVIDER,
  type TelegramProvider,
  type TelegramUpdate,
} from './telegram.provider.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const POLL_SECONDS = 25;
const SCHEDULE_EVERY_MS = 60 * 1000;

@Injectable()
export class TelegramService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Telegram');
  /** One-time codes that turn a Telegram chat into a Nook user: code -> user and expiry. */
  private readonly codes = new Map<string, { userId: string; expires: number }>();
  private readonly stop = new AbortController();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TELEGRAM_PROVIDER) private readonly telegram: TelegramProvider,
  ) {}

  onApplicationBootstrap() {
    if (!this.telegram.configured || process.env.NODE_ENV === 'test') return;
    void this.listen();
    this.timer = setInterval(
      () => void this.sendDueDigests().catch(this.report),
      SCHEDULE_EVERY_MS,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    this.stop.abort();
    clearInterval(this.timer);
  }

  async status(userId: string) {
    const link = await this.prisma.telegramLink.findUnique({ where: { userId } });
    return {
      configured: this.telegram.configured,
      linked: !!link,
      botUsername: env.telegram.botUsername ?? null,
      digestHourUtc: env.telegram.digestHourUtc,
    };
  }

  /** A code the person sends to the bot (`/start <code>`), or opens through the t.me link. */
  createLinkCode(userId: string) {
    const code = randomBytes(9).toString('base64url');
    const now = Date.now();
    for (const [key, value] of this.codes) if (value.expires < now) this.codes.delete(key);
    this.codes.set(code, { userId, expires: now + CODE_TTL_MS });
    const bot = env.telegram.botUsername;
    return {
      code,
      url: bot ? `https://t.me/${bot}?start=${code}` : null,
      expiresInSeconds: CODE_TTL_MS / 1000,
    };
  }

  async unlink(userId: string) {
    await this.prisma.telegramLink.deleteMany({ where: { userId } });
  }

  /** Reacts to one message of the bot's chat. Exposed so tests can feed messages without Telegram. */
  async handle({ chatId, text }: Pick<TelegramUpdate, 'chatId' | 'text'>) {
    if (!chatId) return;
    const [command, argument] = text.trim().split(/\s+/, 2);
    const name = command.toLowerCase().replace(/@\w+$/, '');
    if (name === '/start') return this.link(chatId, argument);
    const link = await this.prisma.telegramLink.findUnique({ where: { chatId } });
    if (!link) {
      return this.telegram.sendMessage(
        chatId,
        'This chat is not linked to Nook yet. Open Settings in Nook, press "Connect Telegram" and follow the link.',
      );
    }
    if (name === '/today')
      return this.telegram.sendMessage(
        chatId,
        await this.digestFor(link.userId, dayOf(new Date())),
      );
    if (name === '/unlink') {
      await this.unlink(link.userId);
      return this.telegram.sendMessage(
        chatId,
        'Unlinked. You will not get messages from Nook any more.',
      );
    }
    return this.telegram.sendMessage(chatId, 'I know /today (plan for today) and /unlink.');
  }

  /** The morning plan, for everyone whose digest has not gone out today (once the digest hour has come). */
  async sendDueDigests(now = new Date()) {
    if (now.getUTCHours() < env.telegram.digestHourUtc) return 0;
    const day = dayOf(now);
    const links = await this.prisma.telegramLink.findMany({
      where: { OR: [{ lastDigestOn: null }, { lastDigestOn: { not: day } }] },
    });
    let sent = 0;
    for (const link of links) {
      try {
        await this.telegram.sendMessage(link.chatId, await this.digestFor(link.userId, day));
        await this.prisma.telegramLink.update({
          where: { id: link.id },
          data: { lastDigestOn: day },
        });
        sent += 1;
      } catch (error) {
        this.report(error);
      }
    }
    return sent;
  }

  /** Open tasks due today (or overdue) and today's events in every workspace the person belongs to. */
  async digestFor(userId: string, day: string) {
    const { tasks, events } = await planFor(this.prisma, userId, day);
    return formatDigest(day, tasks, events);
  }

  private async link(chatId: string, code?: string) {
    const entry = code ? this.codes.get(code) : undefined;
    if (!entry || entry.expires < Date.now()) {
      return this.telegram.sendMessage(
        chatId,
        'This link has expired. Press "Connect Telegram" in Nook again.',
      );
    }
    this.codes.delete(code!);
    await this.prisma.telegramLink.deleteMany({
      where: { OR: [{ userId: entry.userId }, { chatId }] },
    });
    await this.prisma.telegramLink.create({ data: { userId: entry.userId, chatId } });
    await this.telegram.sendMessage(
      chatId,
      'Linked ♡ I will send your plan every morning. Try /today.',
    );
  }

  /** Long polling loop of the bot. */
  private async listen() {
    let offset = 0;
    while (!this.stop.signal.aborted) {
      try {
        const updates = await this.telegram.getUpdates(offset, POLL_SECONDS, this.stop.signal);
        for (const update of updates) {
          offset = Math.max(offset, update.updateId + 1);
          await this.handle(update).catch(this.report);
        }
      } catch (error) {
        if (this.stop.signal.aborted) return;
        this.report(error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private readonly report = (error: unknown) => this.log.warn(String(error));
}
