import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import { TelegramService } from './telegram.service.js';

/** Linking a Telegram chat to the signed-in person, for the morning plan and /today. */
@ApiTags('telegram')
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.telegram.status(user.id);
  }

  @Post('link')
  @HttpCode(200)
  async link(@CurrentUser() user: AuthUser) {
    if (!(await this.telegram.status(user.id)).configured) {
      throw new ServiceUnavailableException('The Telegram bot is not configured on this server');
    }
    return this.telegram.createLinkCode(user.id);
  }

  @Delete()
  @HttpCode(204)
  unlink(@CurrentUser() user: AuthUser) {
    return this.telegram.unlink(user.id);
  }
}
