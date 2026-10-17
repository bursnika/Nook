import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { CurrentUser } from '../auth/decorators.js';
import { newPkce } from '../auth/pkce.js';
import { WorkspaceParams } from '../common/params.js';
import { env } from '../env.js';
import { GoogleCalendarService } from './google-calendar.service.js';

class ConnectQuery {
  @IsOptional()
  @IsString()
  returnTo?: string;
}

@ApiTags('google-calendar')
@Controller()
export class GoogleCalendarController {
  constructor(private readonly calendar: GoogleCalendarService) {}

  /**
   * Starts the extra consent for calendar access. It reuses the sign-in redirect URI, so Google only
   * needs one authorised callback; the `purpose` cookie tells the callback which flow it is finishing.
   */
  @Get('google-calendar/connect')
  connect(@Query() { returnTo }: ConnectQuery, @Res() res: Response) {
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
      }),
    );
  }

  @Get('workspaces/:workspaceId/google-calendar')
  status(@CurrentUser() user: AuthUser) {
    return this.calendar.status(user.id);
  }

  @Post('workspaces/:workspaceId/google-calendar/sync')
  @HttpCode(200)
  sync(@CurrentUser() user: AuthUser, @Param() { workspaceId }: WorkspaceParams) {
    return this.calendar.sync(workspaceId, user.id);
  }

  @Delete('google-calendar')
  @HttpCode(204)
  disconnect(@CurrentUser() user: AuthUser) {
    return this.calendar.disconnect(user.id);
  }
}
