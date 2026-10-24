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
import { CACHE_TTL_SECONDS, CacheService, setCacheHeader } from '../cache/cache.service.js';
import { ApiPaginatedResponse, toPage } from '../common/pagination.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { CreateTaskDto, ListTasksQuery, UpdateTaskDto } from './task.dto.js';
import { TasksService } from './tasks.service.js';

@ApiTags('tasks')
@Controller('workspaces/:workspaceId/tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  @ApiPaginatedResponse()
  async list(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() query: ListTasksQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // only { items, total } is cached: nextLink is built per request from its own host
    const { value, hit } = await this.cache.remember(
      this.cache.listKey(workspaceId, 'tasks', query),
      CACHE_TTL_SECONDS.tasks,
      () => this.tasks.list(workspaceId, query),
    );
    setCacheHeader(res, hit);
    return toPage(req, value.items, value.total, query);
  }

  @Get(':id')
  get(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.tasks.get(workspaceId, id);
  }

  @Post()
  create(@Param() { workspaceId }: WorkspaceParams, @Body() dto: CreateTaskDto) {
    return this.tasks.create(workspaceId, dto);
  }

  @Patch(':id')
  update(@Param() { workspaceId, id }: WorkspaceItemParams, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.tasks.remove(workspaceId, id);
  }
}
