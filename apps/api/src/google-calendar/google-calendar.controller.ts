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
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { safeReturnTo, setOAuthCookies } from '../auth/cookies.js';
import { CurrentUser, RequireFeature } from '../auth/decorators.js';
import { newPkce } from '../auth/pkce.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { env } from '../env.js';
import { UpdateGoogleEventDto } from './google-event.dto.js';
import { GoogleCalendarService } from './google-calendar.service.js';
import { GoogleSyncJobs } from './google-sync.jobs.js';

class ConnectQuery {
  @IsOptional()
  @IsString()
  returnTo?: string;

  @IsOptional()
  @IsString()
  edit?: string;
}

@ApiTags('google-calendar')
@Controller()
export class GoogleCalendarController {
  constructor(
    private readonly calendar: GoogleCalendarService,
    private readonly jobs: GoogleSyncJobs,
  ) {}

  /**
   * Starts the extra consent for calendar access. It reuses the sign-in redirect URI, so Google only
   * needs one authorised callback; the `purpose` cookie tells the callback which flow it is finishing.
   */
  @Get('google-calendar/connect')
  connect(@Query() { returnTo, edit }: ConnectQuery, @Res() res: Response) {
    if (!this.calendar.provider.configured) {
      throw new ServiceUnavailableException('Google is not configured');
    }
    const { state, verifier, challenge } = newPkce();
    setOAuthCookies(res, {
      state,
      verifier,
      returnTo: safeReturnTo(returnTo),
      purpose: 'calendar',
    });
    res.redirect(
      this.calendar.provider.authorizationUrl({
        state,
        codeChallenge: challenge,
        redirectUri: env.google.callbackUrl,
        write: edit === '1',
      }),
    );
  }

  @Get('workspaces/:workspaceId/google-calendar')
  status(@CurrentUser() user: AuthUser, @Param() { workspaceId }: WorkspaceParams) {
    return this.calendar.status(user.id, workspaceId);
  }

  @Post('workspaces/:workspaceId/google-calendar/sync')
  @HttpCode(200)
  sync(@CurrentUser() user: AuthUser, @Param() { workspaceId }: WorkspaceParams) {
    return this.calendar.sync(workspaceId, user.id);
  }

  /** Same sync, run in the background by the queue; answers at once. */
  @Post('workspaces/:workspaceId/google-calendar/sync-async')
  @HttpCode(202)
  async syncAsync(@CurrentUser() user: AuthUser, @Param() { workspaceId }: WorkspaceParams) {
    await this.jobs.enqueue(workspaceId, user.id);
    return { queued: true };
  }

  /** A new event that goes to Google Calendar as well as into the workspace. Pro only. */
  @Post('workspaces/:workspaceId/google-calendar/events')
  @RequireFeature('google-two-way-sync')
  createEvent(
    @CurrentUser() user: AuthUser,
    @Param() { workspaceId }: WorkspaceParams,
    @Body() dto: UpdateGoogleEventDto,
  ) {
    return this.calendar.createEvent(workspaceId, user.id, dto);
  }

  /** Changes an imported event in Google Calendar itself. Pro only; see GoogleCalendarService.updateEvent. */
  @Patch('workspaces/:workspaceId/google-calendar/events/:id')
  @RequireFeature('google-two-way-sync')
  updateEvent(
    @CurrentUser() user: AuthUser,
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Body() dto: UpdateGoogleEventDto,
  ) {
    return this.calendar.updateEvent(workspaceId, user.id, id, dto);
  }

  @Delete('workspaces/:workspaceId/google-calendar/events/:id')
  @HttpCode(204)
  @RequireFeature('google-two-way-sync')
  deleteEvent(@CurrentUser() user: AuthUser, @Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.calendar.deleteEvent(workspaceId, user.id, id);
  }

  @Delete('google-calendar')
  @HttpCode(204)
  disconnect(@CurrentUser() user: AuthUser) {
    return this.calendar.disconnect(user.id);
  }
}
