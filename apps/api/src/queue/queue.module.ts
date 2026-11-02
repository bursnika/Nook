import {
  Controller,
  Get,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformAdminOnly } from '../auth/decorators.js';
import { env } from '../env.js';
import { InMemoryQueue } from './in-memory-queue.js';
import { MESSAGE_QUEUE, type MessageQueue } from './message-queue.js';
import { RabbitMqQueue } from './rabbitmq-queue.js';

@Injectable()
class QueueLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(MESSAGE_QUEUE) private readonly queue: MessageQueue) {}

  onModuleInit() {
    // driver keeps reconnecting in the background
    void this.queue.start();
  }

  onModuleDestroy() {
    return this.queue.close();
  }
}

@ApiTags('ops')
@PlatformAdminOnly()
@Controller('queue-status')
class QueueStatusController {
  constructor(@Inject(MESSAGE_QUEUE) private readonly queue: MessageQueue) {}

  @Get()
  status() {
    return this.queue.status();
  }
}

@Global()
@Module({
  controllers: [QueueStatusController],
  providers: [
    {
      provide: MESSAGE_QUEUE,
      useFactory: (): MessageQueue => {
        if (!env.amqpUrl) return new InMemoryQueue({ manualRetries: env.nodeEnv === 'test' });
        new Logger('QueueModule').log('Queueing in RabbitMQ');
        return new RabbitMqQueue(env.amqpUrl);
      },
    },
    QueueLifecycle,
  ],
  exports: [MESSAGE_QUEUE],
})
export class QueueModule {}
