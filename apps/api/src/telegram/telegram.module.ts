import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller.js';
import { TelegramHttp } from './telegram.http.js';
import { TELEGRAM_PROVIDER } from './telegram.provider.js';
import { TelegramService } from './telegram.service.js';

@Module({
  controllers: [TelegramController],
  providers: [
    TelegramService,
    TelegramHttp,
    { provide: TELEGRAM_PROVIDER, useExisting: TelegramHttp },
  ],
  exports: [TelegramService, TELEGRAM_PROVIDER],
})
export class TelegramModule {}
