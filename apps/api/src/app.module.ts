import { Module } from '@nestjs/common';
import { BlocksModule } from './blocks/blocks.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { MembersModule } from './members/members.module.js';
import { PagesModule } from './pages/pages.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TagsModule } from './tags/tags.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { UsersModule } from './users/users.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    WorkspacesModule,
    MembersModule,
    PagesModule,
    BlocksModule,
    TagsModule,
    TasksModule,
    EventsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
