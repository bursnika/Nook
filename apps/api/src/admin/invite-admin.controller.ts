import { Get, Param, Post, Render, Res } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import { InvitationsService } from '../invitations/invitations.service.js';
import { AdminController } from './admin-controller.decorator.js';

class TokenParams {
  @IsString()
  @MinLength(20)
  token!: string;
}

@AdminController('admin/invite')
export class InviteAdminController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(':token')
  @Render('admin/invite')
  async show(@Param() { token }: TokenParams, @CurrentUser() user: AuthUser) {
    const preview = await this.invitations.preview(token);
    return {
      title: 'Invitation',
      nav: 'workspaces',
      token,
      preview,
      emailMatches: preview.email === user.email.toLowerCase(),
    };
  }

  @Post(':token/accept')
  async accept(
    @Param() { token }: TokenParams,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { workspace } = await this.invitations.accept(user, token);
    return res.redirect(`/admin/workspaces/${workspace.id}?flash=created`);
  }
}
