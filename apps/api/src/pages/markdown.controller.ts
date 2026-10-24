import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { ImportMarkdownDto } from './markdown.dto.js';
import { PageMarkdownService } from './markdown.service.js';

@ApiTags('pages')
@Controller('workspaces/:workspaceId/pages')
export class PageMarkdownController {
  constructor(private readonly markdown: PageMarkdownService) {}

  /** The page as a downloadable `.md` file. */
  @Get(':id/export.md')
  async export(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { markdown, filename } = await this.markdown.export(workspaceId, id);
    res.set({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    return markdown;
  }

  /** Creates a page from Markdown text (`{ markdown, title?, parentId? }`). */
  @Post('import')
  import(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() dto: ImportMarkdownDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.markdown.import(workspaceId, user.id, dto);
  }
}
