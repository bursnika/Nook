import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { CacheService } from '../cache/cache.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { blocksToMarkdown, clampTitle, markdownToBlocks, slugify } from './markdown.js';
import { ImportMarkdownDto, MAX_MARKDOWN_BYTES } from './markdown.dto.js';
import { PagesService } from './pages.service.js';

const POSITION_STEP = 1024;
const MAX_IMPORT_BLOCKS = 5_000;

/** Import and export of a page as a Markdown file (the backend half of the File API task). */
@Injectable()
export class PageMarkdownService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pages: PagesService,
    private readonly cache: CacheService,
  ) {}

  async export(workspaceId: string, id: string) {
    const page = await this.prisma.page.findFirstOrThrow({
      where: { id, workspaceId },
      select: {
        title: true,
        blocks: { orderBy: { position: 'asc' }, select: { type: true, content: true } },
      },
    });
    return {
      markdown: blocksToMarkdown(page.title, page.blocks),
      filename: `${slugify(page.title)}.md`,
    };
  }

  /** Creates a page with blocks from Markdown; the signed-in user becomes its author. */
  async import(workspaceId: string, authorId: string, dto: ImportMarkdownDto) {
    if (Buffer.byteLength(dto.markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
      throw new PayloadTooLargeException(
        `The Markdown text can be at most ${MAX_MARKDOWN_BYTES} bytes`,
      );
    }
    if (dto.parentId) await this.assertParent(workspaceId, dto.parentId);

    // an explicit title wins, and then a leading `# ` line is ordinary content
    const parsed = markdownToBlocks(dto.markdown, { liftTitle: dto.title === undefined });
    if (parsed.blocks.length > MAX_IMPORT_BLOCKS) {
      throw new BadRequestException(
        `A page can be imported with at most ${MAX_IMPORT_BLOCKS} blocks`,
      );
    }
    const page = await this.prisma.page.create({
      data: {
        workspaceId,
        authorId,
        parentId: dto.parentId,
        title: clampTitle(dto.title ?? parsed.title ?? ''),
        blocks: {
          create: parsed.blocks.map((block, index) => ({
            type: block.type,
            content: block.content as Prisma.InputJsonValue,
            position: (index + 1) * POSITION_STEP,
          })),
        },
      },
      select: { id: true },
    });
    await this.cache.invalidateWorkspace(workspaceId);
    return this.pages.get(workspaceId, page.id);
  }

  /** Same rule as moving a page: the parent must live in this workspace, or tenants could be linked. */
  private async assertParent(workspaceId: string, parentId: string) {
    const parent = await this.prisma.page.findFirst({
      where: { id: parentId, workspaceId },
      select: { id: true },
    });
    if (!parent) throw new BadRequestException('parentId does not belong to this workspace');
  }
}
