import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AttachmentsModule } from './attachments/attachments.module.js';
import { BlocksModule } from './blocks/blocks.module.js';
import { EventsModule } from './events/events.module.js';
import { FeaturesModule } from './features/features.module.js';
import { GoogleCalendarModule } from './google-calendar/google-calendar.module.js';
import { HealthController } from './health/health.controller.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { MembersModule } from './members/members.module.js';
import { OverviewModule } from './overview/overview.module.js';
import { PagesModule } from './pages/pages.module.js';
import { PublicModule } from './public/public.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { TelegramModule } from './telegram/telegram.module.js';
import { UsersModule } from './users/users.module.js';
import { WidgetModule } from './widget/widget.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    MembersModule,
    PagesModule,
    BlocksModule,
    TasksModule,
    EventsModule,
    AttachmentsModule,
    InvitationsModule,
    FeaturesModule,
    OverviewModule,
    GoogleCalendarModule,
    AdminModule,
    PublicModule,
    RealtimeModule,
    TelegramModule,
    WidgetModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
