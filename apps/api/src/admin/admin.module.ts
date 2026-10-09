import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { MembersModule } from '../members/members.module.js';
import { PagesModule } from '../pages/pages.module.js';
import { TagsModule } from '../tags/tags.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { DashboardController } from './dashboard.controller.js';
import { LookupController } from './lookup.controller.js';
import { LookupService } from './lookup.service.js';
import { WorkspacesAdminController } from './workspaces.controller.js';

@Module({
  imports: [
    UsersModule,
    WorkspacesModule,
    MembersModule,
    PagesModule,
    TasksModule,
    TagsModule,
    AttachmentsModule,
    UploadsModule,
  ],
  controllers: [DashboardController, LookupController, WorkspacesAdminController],
  providers: [LookupService],
})
export class AdminModule {}
