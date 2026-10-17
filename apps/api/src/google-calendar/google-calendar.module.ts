import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller.js';
import { GoogleCalendarGoogle } from './google-calendar.google.js';
import { GOOGLE_CALENDAR_PROVIDER } from './google-calendar.provider.js';
import { GoogleCalendarService } from './google-calendar.service.js';

@Module({
  controllers: [GoogleCalendarController],
  providers: [
    GoogleCalendarGoogle,
    { provide: GOOGLE_CALENDAR_PROVIDER, useExisting: GoogleCalendarGoogle },
    GoogleCalendarService,
  ],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
