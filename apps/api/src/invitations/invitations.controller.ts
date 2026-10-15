import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { Role } from '../generated/prisma/enums.js';
import { AcceptInvitationDto, CreateInvitationDto } from './invitation.dto.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('invitations')
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get('workspaces/:workspaceId/invitations')
  @Roles(Role.OWNER, Role.ADMIN)
  list(@Param() { workspaceId }: WorkspaceParams) {
    return this.invitations.list(workspaceId);
  }

  @Post('workspaces/:workspaceId/invitations')
  @Roles(Role.OWNER, Role.ADMIN)
  create(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.invitations.create(workspaceId, user.id, dto, req.membership!.role);
  }

  @Delete('workspaces/:workspaceId/invitations/:id')
  @HttpCode(204)
  @Roles(Role.OWNER, Role.ADMIN)
  revoke(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.invitations.revoke(workspaceId, id);
  }

  /** Not tied to a workspace in the URL: the secret token identifies it. */
  @Post('invitations/accept')
  @HttpCode(200)
  accept(@Body() { token }: AcceptInvitationDto, @CurrentUser() user: AuthUser) {
    return this.invitations.accept(user, token);
  }
}
