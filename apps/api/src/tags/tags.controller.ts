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
import { CreateTagDto, ListTagsQuery, UpdateTagDto } from './tag.dto.js';
import { TagsService } from './tags.service.js';

@ApiTags('tags')
@Controller('workspaces/:workspaceId/tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @ApiPaginatedResponse()
  async list(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() query: ListTagsQuery,
    @Req() req: Request,
  ) {
    const { items, total } = await this.tags.list(workspaceId, query);
    return toPage(req, items, total, query);
  }

  @Get(':id')
  get(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.tags.get(workspaceId, id);
  }

  @Post()
  create(@Param() { workspaceId }: WorkspaceParams, @Body() dto: CreateTagDto) {
    return this.tags.create(workspaceId, dto);
  }

  @Patch(':id')
  update(@Param() { workspaceId, id }: WorkspaceItemParams, @Body() dto: UpdateTagDto) {
    return this.tags.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.tags.remove(workspaceId, id);
  }
}
