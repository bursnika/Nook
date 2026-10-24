import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import { CACHE_TTL_SECONDS, CacheService, setCacheHeader } from '../cache/cache.service.js';
import { ApiPaginatedResponse, toPage } from '../common/pagination.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { CreatePageDto, ListPagesQuery, UpdatePageDto } from './page.dto.js';
import { PagesService } from './pages.service.js';

@ApiTags('pages')
@Controller('workspaces/:workspaceId/pages')
export class PagesController {
  constructor(
    private readonly pages: PagesService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  @ApiPaginatedResponse()
  async list(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() query: ListPagesQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // only { items, total } is cached: nextLink is built per request from its own host
    const { value, hit } = await this.cache.remember(
      this.cache.listKey(workspaceId, 'pages', query),
      CACHE_TTL_SECONDS.pages,
      () => this.pages.list(workspaceId, query),
    );
    setCacheHeader(res, hit);
    return toPage(req, value.items, value.total, query);
  }

  @Get(':id')
  get(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.pages.get(workspaceId, id);
  }

  @Post()
  create(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() dto: CreatePageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.create(workspaceId, dto, user.id);
  }

  @Patch(':id')
  update(@Param() { workspaceId, id }: WorkspaceItemParams, @Body() dto: UpdatePageDto) {
    return this.pages.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.pages.remove(workspaceId, id);
  }
}
