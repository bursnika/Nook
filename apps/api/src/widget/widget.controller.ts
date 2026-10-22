import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Public } from '../auth/decorators.js';
import { WidgetService } from './widget.service.js';

/**
 * Data for home-screen widgets (iOS Scriptable, Android KWGT, a Mac widget). They cannot sign in with Google,
 * so a person creates a personal token in the app and the widget sends it. The token can only read today's plan.
 */
@ApiTags('widget')
@Controller('widget')
export class WidgetController {
  constructor(private readonly widgets: WidgetService) {}

  @Get('token')
  async status(@CurrentUser() user: AuthUser) {
    return { exists: await this.widgets.hasToken(user.id) };
  }

  @Post('token')
  @HttpCode(200)
  async create(@CurrentUser() user: AuthUser) {
    return { token: await this.widgets.issueToken(user.id) };
  }

  @Delete('token')
  @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser) {
    return this.widgets.revokeToken(user.id);
  }

  /** `Authorization: Bearer nkw_…` or `?token=nkw_…` (some widget tools cannot set headers). */
  @Public()
  @Get('today')
  @Header('Cache-Control', 'no-store')
  async today(@Req() req: Request) {
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const query = typeof req.query.token === 'string' ? req.query.token : undefined;
    const token = bearer ?? query;
    const userId = token ? await this.widgets.userIdForToken(token) : null;
    if (!userId) throw new UnauthorizedException('A valid widget token is required');
    return this.widgets.today(userId);
  }
}
