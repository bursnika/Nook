import { Injectable } from '@nestjs/common';
import { BlockType } from '../generated/prisma/enums.js';
import { CacheService } from '../cache/cache.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const POSITION_STEP = 1024;
const TITLE_LENGTH = 80;
const MAX_BLOCKS = 200;

/** A note is a page whose body is one paragraph block per line of text. */
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async create(workspaceId: string, authorId: string, input: { title?: string; text: string }) {
    const lines = toLines(input.text);
    const title = input.title?.trim() || firstLineAsTitle(lines);
    const page = await this.prisma.page.create({
      data: {
        workspaceId,
        authorId,
        title,
        blocks: {
          create: lines.map((text, index) => ({
            type: BlockType.PARAGRAPH,
            content: { text },
            position: (index + 1) * POSITION_STEP,
          })),
        },
      },
      select: { id: true },
    });
    await this.cache.invalidateWorkspace(workspaceId);
    return page;
  }

  /** Adds the lines after the page's last block. */
  async append(workspaceId: string, pageId: string, text: string) {
    await this.prisma.page.findFirstOrThrow({
      where: { id: pageId, workspaceId },
      select: { id: true },
    });
    const { _max } = await this.prisma.block.aggregate({
      where: { pageId },
      _max: { position: true },
    });
    const start = _max.position ?? 0;
    await this.prisma.block.createMany({
      data: toLines(text).map((line, index) => ({
        pageId,
        type: BlockType.PARAGRAPH,
        content: { text: line },
        position: start + (index + 1) * POSITION_STEP,
      })),
    });
    await this.cache.invalidateWorkspace(workspaceId);
  }
}

const toLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_BLOCKS);

const firstLineAsTitle = (lines: string[]) => {
  const first = lines[0] ?? 'Untitled note';
  return first.length > TITLE_LENGTH ? `${first.slice(0, TITLE_LENGTH - 1)}…` : first;
};
