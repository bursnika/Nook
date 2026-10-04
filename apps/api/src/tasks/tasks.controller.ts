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
import { CreateTaskDto, ListTasksQuery, UpdateTaskDto } from './task.dto.js';
import { TasksService } from './tasks.service.js';

@ApiTags('tasks')
@Controller('workspaces/:workspaceId/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiPaginatedResponse()
  async list(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() query: ListTasksQuery,
    @Req() req: Request,
  ) {
    const { items, total } = await this.tasks.list(workspaceId, query);
    return toPage(req, items, total, query);
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
