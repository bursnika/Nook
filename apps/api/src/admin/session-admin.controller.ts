import { Get, Render } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { AdminController } from './admin-controller.decorator.js';

/** Signing out itself is POST /api/auth/logout: the refresh cookie is only sent to /api/auth. */
@AdminController('admin')
export class SessionAdminController {
  @Public()
  @Get('signed-out')
  @Render('admin/signed-out')
  signedOut() {
    return { title: 'Signed out' };
  }
}
