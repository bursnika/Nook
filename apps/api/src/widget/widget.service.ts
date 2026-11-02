import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { env } from '../env.js';
import { dayOf, planFor } from './today.js';

export const TOKEN_PREFIX = 'nkw_';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class WidgetService {
  constructor(private readonly prisma: PrismaService) {}

  async issueToken(userId: string) {
    const token = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
    await this.prisma.user.update({
      where: { id: userId },
      data: { widgetTokenHash: hash(token) },
    });
    return token;
  }

  async revokeToken(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { widgetTokenHash: null } });
  }

  async hasToken(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { widgetTokenHash: true },
    });
    return !!user?.widgetTokenHash;
  }

  async userIdForToken(token: string) {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    const user = await this.prisma.user.findUnique({
      where: { widgetTokenHash: hash(token) },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async today(userId: string, now = new Date()) {
    const day = dayOf(now);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const everywhere = !!user && env.adminEmails.has(user.email.toLowerCase());
    const { tasks, events } = await planFor(this.prisma, userId, day, everywhere);
    return {
      date: day,
      generatedAt: now.toISOString(),
      counts: { tasks: tasks.length, events: events.length },
      tasks: tasks.map((t) => ({
        title: t.title,
        priority: t.priority,
        dueAt: t.dueDate?.toISOString() ?? null,
        overdue: !!t.dueDate && dayOf(t.dueDate) < day,
        workspace: t.workspace,
      })),
      events: events.map((e) => ({
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        allDay: e.allDay,
        workspace: e.workspace,
      })),
    };
  }
}
