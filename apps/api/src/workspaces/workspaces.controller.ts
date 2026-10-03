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
import { IdParams } from '../common/params.js';
import { CreateWorkspaceDto, ListWorkspacesQuery, UpdateWorkspaceDto } from './workspace.dto.js';
import { WorkspacesService } from './workspaces.service.js';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiPaginatedResponse()
  async list(@Query() query: ListWorkspacesQuery, @Req() req: Request) {
    const { items, total } = await this.workspaces.list(query);
    return toPage(req, items, total, query);
  }

  @Get(':id')
  get(@Param() { id }: IdParams) {
    return this.workspaces.get(id);
  }

  @Post()
  create(@Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(dto);
  }

  @Patch(':id')
  update(@Param() { id }: IdParams, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { id }: IdParams) {
    return this.workspaces.remove(id);
  }
}
