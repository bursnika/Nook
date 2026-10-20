import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApplyOpsDto, BlockOpDto, OpsMessage } from './ops.dto.js';
import { RealtimeBus } from './realtime.bus.js';

const POSITION_STEP = 1024;
const MAX_CHANGES = 500;

type Tx = Prisma.TransactionClient;

/** Applies block operations to the database and keeps the ordered log every transport reads from. */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
  ) {}

  /** The page as it is now plus the log position it corresponds to: a client replays only newer ops. */
  async snapshot(workspaceId: string, pageId: string) {
    const page = await this.prisma.page.findFirstOrThrow({
      where: { id: pageId, workspaceId },
      select: { id: true, title: true, icon: true, updatedAt: true },
    });
    // read the position first: an op that lands in between is then replayed, which is harmless (ops are idempotent)
    const seq = await this.lastSeq(pageId);
    const blocks = await this.prisma.block.findMany({
      where: { pageId },
      orderBy: { position: 'asc' },
    });
    return { page, blocks, seq };
  }

  /**
   * Last writer wins per block: operations are applied in the order they arrive, each one on top of the
   * current state. Replaying a batch is safe: inserting an existing id, or changing a missing block, is skipped.
   */
  async apply(workspaceId: string, pageId: string, authorId: string, dto: ApplyOpsDto) {
    await this.prisma.page.findFirstOrThrow({
      where: { id: pageId, workspaceId },
      select: { id: true },
    });
    const entry = await this.prisma.$transaction(async (tx) => {
      for (const op of dto.ops) await this.applyOne(tx, pageId, op);
      await tx.page.update({ where: { id: pageId }, data: { updatedAt: new Date() } });
      return tx.pageOp.create({
        data: {
          pageId,
          workspaceId,
          authorId,
          clientId: dto.clientId,
          ops: dto.ops as unknown as Prisma.InputJsonValue,
        },
      });
    });
    const message: OpsMessage = {
      type: 'ops',
      seq: entry.seq,
      clientId: dto.clientId,
      authorId,
      at: entry.createdAt.toISOString(),
      ops: dto.ops,
    };
    this.bus.publishPage(pageId, message);
    return message;
  }

  /** Everything after `since`, oldest first. `more` tells the client to ask again straight away. */
  async changes(pageId: string, since: number) {
    const rows = await this.prisma.pageOp.findMany({
      where: { pageId, seq: { gt: since } },
      orderBy: { seq: 'asc' },
      take: MAX_CHANGES + 1,
    });
    const more = rows.length > MAX_CHANGES;
    const messages: OpsMessage[] = rows.slice(0, MAX_CHANGES).map((row) => ({
      type: 'ops',
      seq: row.seq,
      clientId: row.clientId,
      authorId: row.authorId,
      at: row.createdAt.toISOString(),
      ops: row.ops as unknown as BlockOpDto[],
    }));
    return { messages, more };
  }

  async lastSeq(pageId: string) {
    const { _max } = await this.prisma.pageOp.aggregate({ where: { pageId }, _max: { seq: true } });
    return _max.seq ?? 0;
  }

  private async applyOne(tx: Tx, pageId: string, op: BlockOpDto) {
    switch (op.type) {
      case 'insert': {
        if (await tx.block.findFirst({ where: { id: op.id }, select: { id: true } })) return;
        await tx.block.create({
          data: {
            id: op.id,
            pageId,
            type: op.blockType,
            content: (op.content ?? {}) as Prisma.InputJsonValue,
            position: op.position ?? (await this.nextPosition(tx, pageId)),
          },
        });
        return;
      }
      case 'update':
        await tx.block.updateMany({
          where: { id: op.id, pageId },
          data: {
            type: op.blockType,
            content: op.content as Prisma.InputJsonValue | undefined,
          },
        });
        return;
      case 'move':
        if (op.position === undefined) return;
        await tx.block.updateMany({
          where: { id: op.id, pageId },
          data: { position: op.position },
        });
        return;
      case 'delete':
        await tx.block.deleteMany({ where: { id: op.id, pageId } });
    }
  }

  private async nextPosition(tx: Tx, pageId: string) {
    const { _max } = await tx.block.aggregate({ where: { pageId }, _max: { position: true } });
    return (_max.position ?? 0) + POSITION_STEP;
  }
}
