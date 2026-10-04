import { Module } from '@nestjs/common';
import { BlocksModule } from './blocks/blocks.module.js';
import { HealthController } from './health/health.controller.js';
import { MembersModule } from './members/members.module.js';
import { PagesModule } from './pages/pages.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({
  imports: [PrismaModule, UsersModule, WorkspacesModule, MembersModule, PagesModule, BlocksModule],
  controllers: [HealthController],
})
export class AppModule {}
