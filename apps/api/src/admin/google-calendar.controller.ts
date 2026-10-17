import { HttpException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { safeReturnTo } from '../auth/cookies.js';
import { CurrentUser } from '../auth/decorators.js';
import { WorkspaceParams } from '../common/params.js';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service.js';
import { AdminController } from './admin-controller.decorator.js';

/** Buttons on the workspace home. Connecting starts at GET /api/google-calendar/connect. */
@AdminController('admin')
export class GoogleCalendarAdminController {
  constructor(private readonly calendar: GoogleCalendarService) {}

  @Post('workspaces/:workspaceId/google-calendar/sync')
  async sync(
    @Param() { workspaceId }: WorkspaceParams,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const home = `/admin/workspaces/${workspaceId}`;
    let result;
    try {
      result = await this.calendar.sync(workspaceId, user.id);
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      return res.redirect(`${home}?problem=calendar-sync`);
    }
    const query = new URLSearchParams({
      flash: 'synced',
      events: String(result.created + result.updated),
    });
    if (result.tasks.status === 'synced') {
      query.set('tasks', String(result.tasks.created + result.tasks.updated));
    } else {
      query.set('tasksNote', result.tasks.status);
    }
    return res.redirect(`${home}?${query}`);
  }

  @Post('google-calendar/disconnect')
  async disconnect(
    @Query('returnTo') returnTo: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await this.calendar.disconnect(user.id);
    const target = new URL(safeReturnTo(returnTo), 'http://nook.local');
    target.searchParams.set('flash', 'disconnected');
    return res.redirect(target.pathname + target.search);
  }
}
