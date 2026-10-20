import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { GraphqlController } from './graphql.controller.js';
import { GraphqlWsService } from './graphql-ws.service.js';
import { GraphqlService } from './graphql.service.js';

@Module({
  imports: [TasksModule, EventsModule],
  controllers: [GraphqlController],
  providers: [GraphqlService, GraphqlWsService],
  exports: [GraphqlService, GraphqlWsService],
})
export class GraphqlModule {}
