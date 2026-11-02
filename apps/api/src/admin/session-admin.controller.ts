import { Get, Render } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { AdminController } from './admin-controller.decorator.js';

@AdminController('admin')
export class SessionAdminController {
  @Public()
  @Get('signed-out')
  @Render('admin/signed-out')
  signedOut() {
    return { title: 'Signed out' };
  }
}
