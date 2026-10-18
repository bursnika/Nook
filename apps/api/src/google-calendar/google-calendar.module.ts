import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features/features.module.js';
import { GoogleCalendarController } from './google-calendar.controller.js';
import { GoogleCalendarGoogle } from './google-calendar.google.js';
import { GOOGLE_CALENDAR_PROVIDER } from './google-calendar.provider.js';
import { GoogleCalendarService } from './google-calendar.service.js';

@Module({
  imports: [FeaturesModule],
  controllers: [GoogleCalendarController],
  providers: [
    GoogleCalendarGoogle,
    { provide: GOOGLE_CALENDAR_PROVIDER, useExisting: GoogleCalendarGoogle },
    GoogleCalendarService,
  ],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
