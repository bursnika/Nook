import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { Request } from 'express';
import { WorkspaceParams } from '../common/params.js';
import { ApplyOpsDto, PresenceDto, SinceQuery, type PresenceMessage } from './ops.dto.js';
import { PresenceService } from './presence.service.js';
import { RealtimeBus } from './realtime.bus.js';
import { SyncService } from './sync.service.js';
import { TransportMetrics, type TransportName } from './transport-metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';

class PageParams extends WorkspaceParams {
  @IsUUID()
  pageId!: string;
}

const LONG_POLL_MAX_SECONDS = 55;
const LONG_POLL_DEFAULT_SECONDS = 25;

/** Interval hints for adaptive polling: fast while people are typing, slower and slower while nothing happens. */
export function nextPollMs(opsInReply: number, previousSilenceMs: number) {
  if (opsInReply > 0) return 400;
  return Math.min(10_000, Math.max(1_000, Math.round(previousSilenceMs * 1.5)));
}

/**
 * The same stream of block operations over plain HTTP, for places where WebSockets are blocked or unwanted.
 * `changes` is a normal poll (the client decides when to ask again, `nextPollMs` helps it adapt);
 * `poll` is a long poll that answers as soon as there is something new.
 */
@ApiTags('sync')
@Controller('workspaces/:workspaceId/pages/:pageId/sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly presence: PresenceService,
    private readonly bus: RealtimeBus,
    private readonly metrics: TransportMetrics,
    private readonly prisma: PrismaService,
  ) {}

  /** The page with its blocks and the log position to continue from. */
  @Get()
  snapshot(@Param() { workspaceId, pageId }: PageParams) {
    return this.sync.snapshot(workspaceId, pageId);
  }

  @Post('ops')
  @HttpCode(200)
  async apply(
    @Param() { workspaceId, pageId }: PageParams,
    @Body() dto: ApplyOpsDto,
    @Req() req: Request,
  ) {
    const message = await this.sync.apply(workspaceId, pageId, req.user!.id, dto);
    return { seq: message.seq };
  }

  /** Adaptive polling: answers at once with whatever happened after `since`. */
  @Get('changes')
  async changes(
    @Param() { workspaceId, pageId }: PageParams,
    @Query() { since = 0, clientId }: SinceQuery,
    @Req() req: Request,
  ) {
    await this.assertPage(workspaceId, pageId);
    const { messages, more } = await this.sync.changes(pageId, since);
    const reply = this.reply(pageId, messages, more, clientId);
    this.count('polling', req, reply);
    return { ...reply, nextPollMs: more ? 0 : nextPollMs(messages.length, 1000) };
  }

  /** Long poll: held open until something new arrives or the timeout passes. */
  @Get('poll')
  async poll(
    @Param() { workspaceId, pageId }: PageParams,
    @Query() { since = 0, clientId, timeout = LONG_POLL_DEFAULT_SECONDS }: SinceQuery,
    @Req() req: Request,
  ) {
    await this.assertPage(workspaceId, pageId);
    const holdMs = Math.min(Math.max(timeout, 1), LONG_POLL_MAX_SECONDS) * 1000;
    // subscribe before looking at the log, so nothing can slip in between the two
    let wake: (() => void) | undefined;
    const woken = new Promise<void>((resolve) => (wake = resolve));
    const off = this.bus.onPage(pageId, (message) => {
      // your own cursor moving is not news to you
      if (!(message.type === 'presence' && message.clientId === clientId)) wake?.();
    });
    const closed = new Promise<void>((resolve) => req.once('close', resolve));
    try {
      let { messages, more } = await this.sync.changes(pageId, since);
      if (messages.length === 0) {
        const timer = new Promise<void>((resolve) => setTimeout(resolve, holdMs).unref());
        await Promise.race([woken, timer, closed]);
        // a short pause lets a burst of operations arrive as one reply
        await new Promise((resolve) => setTimeout(resolve, 20));
        ({ messages, more } = await this.sync.changes(pageId, since));
      }
      const reply = this.reply(pageId, messages, more, clientId);
      this.count('longpoll', req, reply);
      return reply;
    } finally {
      off();
    }
  }

  @Post('presence')
  @HttpCode(200)
  async touch(
    @Param() { workspaceId, pageId }: PageParams,
    @Body() dto: PresenceDto,
    @Req() req: Request,
  ) {
    await this.assertPage(workspaceId, pageId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { name: true },
    });
    this.presence.touch(pageId, {
      clientId: dto.clientId,
      userId: req.user!.id,
      name: user.name,
      blockId: dto.blockId ?? null,
      caret: dto.caret ?? null,
    });
    return { ok: true };
  }

  @Delete('presence')
  @HttpCode(204)
  async leave(@Param() { workspaceId, pageId }: PageParams, @Query() { clientId }: SinceQuery) {
    await this.assertPage(workspaceId, pageId);
    if (clientId) this.presence.leave(pageId, clientId);
  }

  private reply(
    pageId: string,
    messages: Awaited<ReturnType<SyncService['changes']>>['messages'],
    more: boolean,
    clientId?: string,
  ) {
    const presence: PresenceMessage[] = this.presence.list(pageId, clientId);
    return { messages, more, presence, seq: messages.at(-1)?.seq };
  }

  private count(name: TransportName, req: Request, reply: unknown) {
    this.metrics.add(name, {
      requests: 1,
      bytesIn: Number(req.headers['content-length'] ?? 0) + (req.originalUrl?.length ?? 0),
      bytesOut: Buffer.byteLength(JSON.stringify(reply)),
      messages: (reply as { messages: unknown[] }).messages.length,
    });
  }

  private async assertPage(workspaceId: string, pageId: string) {
    await this.prisma.page.findFirstOrThrow({
      where: { id: pageId, workspaceId },
      select: { id: true },
    });
  }
}
