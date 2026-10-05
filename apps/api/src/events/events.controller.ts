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
import { CreateEventDto, ListEventsQuery, UpdateEventDto } from './event.dto.js';
import { EventsService } from './events.service.js';

@ApiTags('events')
@Controller('workspaces/:workspaceId/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiPaginatedResponse()
  async list(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() query: ListEventsQuery,
    @Req() req: Request,
  ) {
    const { items, total } = await this.events.list(workspaceId, query);
    return toPage(req, items, total, query);
  }

  @Get(':id')
  get(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.events.get(workspaceId, id);
  }

  @Post()
  create(@Param() { workspaceId }: WorkspaceParams, @Body() dto: CreateEventDto) {
    return this.events.create(workspaceId, dto);
  }

  @Patch(':id')
  update(@Param() { workspaceId, id }: WorkspaceItemParams, @Body() dto: UpdateEventDto) {
    return this.events.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.events.remove(workspaceId, id);
  }
}
