import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module.js';
import { TaskCommentsController } from './task-comments.controller.js';
import { TaskCommentsService } from './task-comments.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [UploadsModule],
  controllers: [TasksController, TaskCommentsController],
  providers: [TasksService, TaskCommentsService],
  exports: [TasksService],
})
export class TasksModule {}
