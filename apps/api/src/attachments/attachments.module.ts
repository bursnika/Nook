import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { AttachmentsController } from './attachments.controller.js';
import { AttachmentsService } from './attachments.service.js';

@Module({
  imports: [UploadsModule, TasksModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
