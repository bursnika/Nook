import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PlatformAdminOnly, Roles } from '../auth/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { AddMemberDto, UpdateMemberDto } from './member.dto.js';
import { MembersService } from './members.service.js';

@ApiTags('members')
@Controller('workspaces/:workspaceId/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@Param() { workspaceId }: WorkspaceParams) {
    return this.members.list(workspaceId);
  }

  /** Adding an arbitrary user by id is a support tool; everyone else invites people by e-mail instead. */
  @Post()
  @PlatformAdminOnly()
  add(@Param() { workspaceId }: WorkspaceParams, @Body() dto: AddMemberDto) {
    return this.members.add(workspaceId, dto);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.ADMIN)
  updateRole(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Body() dto: UpdateMemberDto,
    @Req() req: Request,
  ) {
    return this.members.updateRole(workspaceId, id, dto, req.membership!.role);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(Role.OWNER, Role.ADMIN)
  remove(@Param() { workspaceId, id }: WorkspaceItemParams, @Req() req: Request) {
    return this.members.remove(workspaceId, id, req.membership!.role);
  }
}
