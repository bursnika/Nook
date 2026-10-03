import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({
  imports: [PrismaModule, UsersModule, WorkspacesModule],
  controllers: [HealthController],
})
export class AppModule {}
