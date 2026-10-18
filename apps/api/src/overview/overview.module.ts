import { Module } from '@nestjs/common';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module.js';
import { OverviewController } from './overview.controller.js';
import { OverviewService } from './overview.service.js';

@Module({
  imports: [GoogleCalendarModule],
  controllers: [OverviewController],
  providers: [OverviewService],
  exports: [OverviewService],
})
export class OverviewModule {}
