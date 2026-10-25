import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { PagesModule } from '../pages/pages.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { env } from '../env.js';
import { AnthropicAssistantModel } from './anthropic.model.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { AssistantTools } from './assistant.tools.js';
import { ASSISTANT_MODEL } from './assistant.types.js';
import { ASSISTANT_RATE_LIMITER, SlidingWindowRateLimiter } from './rate-limiter.js';

const REQUESTS_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60 * 1000;

@Module({
  imports: [TasksModule, EventsModule, PagesModule, WorkspacesModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantTools,
    {
      provide: ASSISTANT_MODEL,
      useFactory: () =>
        new AnthropicAssistantModel({ apiKey: env.anthropic.apiKey, model: env.anthropic.model }),
    },
    {
      provide: ASSISTANT_RATE_LIMITER,
      useFactory: () => new SlidingWindowRateLimiter(REQUESTS_PER_WINDOW, WINDOW_MS),
    },
  ],
})
export class AssistantModule {}
