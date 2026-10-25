import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module.js';
import { RemindersService } from './reminders.service.js';

@Module({
  imports: [TelegramModule],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
