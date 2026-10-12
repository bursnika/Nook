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
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { WorkspaceParams } from '../common/params.js';
import { CreateWorkspaceDto, ListWorkspacesQuery, UpdateWorkspaceDto } from './workspace.dto.js';
import { WorkspacesService } from './workspaces.service.js';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiPaginatedResponse()
  async list(
    @Query() query: ListWorkspacesQuery,
    @Req() req: Request,
    @CurrentUser() user: AuthUser,
  ) {
    const { items, total } = await this.workspaces.list(query, user);
    return toPage(req, items, total, query);
  }

  @Get(':workspaceId')
  get(@Param() { workspaceId }: WorkspaceParams) {
    return this.workspaces.get(workspaceId);
  }

  @Post()
  create(@Body() dto: CreateWorkspaceDto, @CurrentUser() user: AuthUser) {
    return this.workspaces.create(dto, user.id);
  }

  @Patch(':workspaceId')
  @Roles(Role.OWNER, Role.ADMIN)
  update(@Param() { workspaceId }: WorkspaceParams, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.update(workspaceId, dto);
  }

  @Delete(':workspaceId')
  @HttpCode(204)
  @Roles(Role.OWNER)
  remove(@Param() { workspaceId }: WorkspaceParams) {
    return this.workspaces.remove(workspaceId);
  }
}
