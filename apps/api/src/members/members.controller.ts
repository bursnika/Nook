import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

  @Post()
  add(@Param() { workspaceId }: WorkspaceParams, @Body() dto: AddMemberDto) {
    return this.members.add(workspaceId, dto);
  }

  @Patch(':id')
  updateRole(@Param() { workspaceId, id }: WorkspaceItemParams, @Body() dto: UpdateMemberDto) {
    return this.members.updateRole(workspaceId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.members.remove(workspaceId, id);
  }
}
