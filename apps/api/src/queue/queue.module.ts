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

/** Starts the driver with the app and drains it before the app goes down. */
@Injectable()
class QueueLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(MESSAGE_QUEUE) private readonly queue: MessageQueue) {}

  onModuleInit() {
    // the broker may be down at boot; the driver keeps trying in the background
    void this.queue.start();
  }

  onModuleDestroy() {
    return this.queue.close();
  }
}

/** For ops: which driver runs and how full every queue (and its dead-letter queue) is. */
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

/** RabbitMQ when AMQP_URL is set, otherwise an in-process queue. Global so any feature can publish. */
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
