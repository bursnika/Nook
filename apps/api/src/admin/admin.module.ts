import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module.js';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { MembersModule } from '../members/members.module.js';
import { OverviewModule } from '../overview/overview.module.js';
import { PagesModule } from '../pages/pages.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { AttachmentsAdminController } from './attachments.controller.js';
import { DashboardController } from './dashboard.controller.js';
import { InviteAdminController } from './invite-admin.controller.js';
import { LookupController } from './lookup.controller.js';
import { LookupService } from './lookup.service.js';
import { NotesAdminController } from './notes.controller.js';
import { PagesAdminController } from './pages.controller.js';
import { SessionAdminController } from './session-admin.controller.js';
import { TasksAdminController } from './tasks.controller.js';
import { WorkspacesAdminController } from './workspaces.controller.js';

@Module({
  imports: [
    UsersModule,
    WorkspacesModule,
    MembersModule,
    PagesModule,
    TasksModule,
    AttachmentsModule,
    InvitationsModule,
    UploadsModule,
    OverviewModule,
  ],
  controllers: [
    DashboardController,
    LookupController,
    WorkspacesAdminController,
    PagesAdminController,
    NotesAdminController,
    TasksAdminController,
    AttachmentsAdminController,
    InviteAdminController,
    SessionAdminController,
  ],
  providers: [LookupService],
})
export class AdminModule {}
