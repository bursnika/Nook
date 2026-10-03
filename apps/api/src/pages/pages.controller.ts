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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiPaginatedResponse, toPage } from '../common/pagination.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { CreatePageDto, ListPagesQuery, UpdatePageDto } from './page.dto.js';
import { PagesService } from './pages.service.js';

@ApiTags('pages')
@Controller('workspaces/:workspaceId/pages')
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  @ApiPaginatedResponse()
  async list(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() query: ListPagesQuery,
    @Req() req: Request,
  ) {
    const { items, total } = await this.pages.list(workspaceId, query);
    return toPage(req, items, total, query);
  }

  @Get(':id')
  get(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.pages.get(workspaceId, id);
  }

  @Post()
  create(@Param() { workspaceId }: WorkspaceParams, @Body() dto: CreatePageDto) {
    return this.pages.create(workspaceId, dto);
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
