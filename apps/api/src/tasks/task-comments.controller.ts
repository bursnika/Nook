import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { TaskCommentDto, TaskCommentParams, TaskParams } from './task-comment.dto.js';
import { TaskCommentsService } from './task-comments.service.js';

@ApiTags('tasks')
@Controller('workspaces/:workspaceId/tasks/:taskId/comments')
export class TaskCommentsController {
  constructor(private readonly comments: TaskCommentsService) {}

  @Get()
  list(@Param() { workspaceId, taskId }: TaskParams) {
    return this.comments.list(workspaceId, taskId);
  }

  @Post()
  create(
    @Param() { workspaceId, taskId }: TaskParams,
    @Body() { body }: TaskCommentDto,
    @Req() req: Request,
  ) {
    return this.comments.create(workspaceId, taskId, req.user!.id, body);
  }

  @Patch(':id')
  update(
    @Param() { workspaceId, taskId, id }: TaskCommentParams,
    @Body() { body }: TaskCommentDto,
    @Req() req: Request,
  ) {
    return this.comments.update(workspaceId, taskId, id, req.user!.id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { workspaceId, taskId, id }: TaskCommentParams, @Req() req: Request) {
    return this.comments.remove(workspaceId, taskId, id, {
      userId: req.user!.id,
      role: req.membership?.role,
    });
  }
}
