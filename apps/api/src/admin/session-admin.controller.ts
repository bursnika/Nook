import { Get, Post, Render, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { REFRESH_COOKIE, clearSessionCookies } from '../auth/cookies.js';
import { Public } from '../auth/decorators.js';
import { AdminController } from './admin-controller.decorator.js';

@AdminController('admin')
export class SessionAdminController {
  constructor(private readonly auth: AuthService) {}

  /** Ends the session: the refresh token is revoked server-side, the cookies are cleared. */
  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearSessionCookies(res);
    return res.redirect('/admin/signed-out');
  }

  @Public()
  @Get('signed-out')
  @Render('admin/signed-out')
  signedOut() {
    return { title: 'Signed out' };
  }
}
