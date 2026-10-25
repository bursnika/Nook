import { Logger } from '@nestjs/common';
import { connect } from 'amqplib';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_POLICY,
  PermanentQueueError,
  QueueUnavailableError,
  retryDelay,
  retryDelays,
  type MessageQueue,
  type PublishOptions,
  type QueueHandler,
  type QueueStats,
  type QueueStatus,
  type RetryPolicy,
  type SubscribeOptions,
} from './message-queue.js';

/** The slice of an amqplib message the driver reads. */
export interface AmqpMessage {
  content: Buffer;
  fields: { deliveryTag: number };
  properties: { messageId?: string; headers?: Record<string, unknown> };
}

interface PublishProperties {
  persistent: boolean;
  contentType: string;
  messageId: string;
  headers: Record<string, unknown>;
}

/** The parts of an amqplib channel / connection in use; the real library satisfies them and specs pass fakes. */
export interface AmqpChannelLike {
  assertExchange(exchange: string, type: string, options: { durable: boolean }): Promise<unknown>;
  assertQueue(
    queue: string,
    options: { durable: boolean; arguments?: Record<string, unknown> },
  ): Promise<{ messageCount: number; consumerCount: number }>;
  bindQueue(queue: string, exchange: string, pattern: string): Promise<unknown>;
  prefetch(count: number): Promise<unknown>;
  consume(
    queue: string,
    onMessage: (message: AmqpMessage | null) => void,
  ): Promise<{ consumerTag: string }>;
  cancel(consumerTag: string): Promise<unknown>;
  ack(message: AmqpMessage): void;
  nack(message: AmqpMessage, allUpTo: boolean, requeue: boolean): void;
  close(): Promise<void>;
  on(event: 'error' | 'close', listener: (error?: Error) => void): unknown;
}

export interface AmqpConfirmChannelLike extends AmqpChannelLike {
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: PublishProperties,
    callback: (error: Error | null) => void,
  ): unknown;
  sendToQueue(
    queue: string,
    content: Buffer,
    options: PublishProperties,
    callback: (error: Error | null) => void,
  ): unknown;
}

export interface AmqpConnectionLike {
  createChannel(): Promise<AmqpChannelLike>;
  createConfirmChannel(): Promise<AmqpConfirmChannelLike>;
  close(): Promise<void>;
  on(event: 'error' | 'close', listener: (error?: Error) => void): unknown;
}

export interface RabbitMqDeps {
  connect?: (url: string) => Promise<AmqpConnectionLike>;
  /** Reconnect delay after the n-th failed attempt in a row. */
  backoffMs?: (attempt: number) => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** How long close() lets running handlers finish. */
  shutdownGraceMs?: number;
}

/** Work goes through this exchange (routing key = queue name); what fails for good goes through the DLX. */
export const EXCHANGE = 'nook';
export const DEAD_LETTER_EXCHANGE = 'nook.dlx';
export const deadQueueName = (queue: string) => `${queue}.dead`;
export const retryQueueName = (queue: string, delayMs: number) => `${queue}.retry.${delayMs}`;

const ATTEMPT_HEADER = 'x-attempt';
const ERROR_HEADER = 'x-error';

const defaultBackoff = (attempt: number) => Math.min(1_000 * 2 ** (attempt - 1), 30_000);

const defaultWait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

interface Consumer {
  queue: string;
  handler: QueueHandler<unknown>;
  prefetch: number;
  policy: RetryPolicy;
  channel?: AmqpChannelLike;
  tag?: string;
  /** Attached or being attached on the current connection; stops a double attach. */
  active: boolean;
}

function detach(consumer: Consumer) {
  consumer.channel = consumer.tag = undefined;
  consumer.active = false;
}

/**
 * RabbitMQ driver. Topology per queue `q` (all durable, messages persistent):
 *
 *   nook (direct) --q--> q ----------- nack(requeue=false) / out of attempts --> nook.dlx --q--> q.dead
 *                        ^                                                                (inspect, replay)
 *                        '---- TTL expires <---- q.retry.<delay> <---- failed handler (delay doubles per attempt)
 *
 * There is one retry queue per delay (the TTL is a queue property), so a long delay never blocks a short one.
 * The driver reconnects with backoff and, on every new connection, redeclares the topology and re-attaches
 * its consumers.
 */
export class RabbitMqQueue implements MessageQueue {
  readonly name = 'rabbitmq';
  private readonly log = new Logger('Queue');
  private readonly connectFn: (url: string) => Promise<AmqpConnectionLike>;
  private readonly backoff: (attempt: number) => number;
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly grace: number;
  private readonly stop = new AbortController();
  private readonly consumers = new Map<string, Consumer>();
  /** Every queue this process uses, so a new connection can declare them all. */
  private readonly known = new Set<string>();
  private readonly retryQueues = new Map<string, number[]>();
  private readonly inflight = new Set<Promise<void>>();
  private connection?: AmqpConnectionLike;
  private publisher?: AmqpConfirmChannelLike;
  /** Queues declared on the current publisher channel. */
  private declared = new Set<string>();
  private connecting = false;
  private loop?: Promise<void>;

  constructor(
    private readonly url: string,
    deps: RabbitMqDeps = {},
  ) {
    this.connectFn = deps.connect ?? ((target) => connect(target));
    this.backoff = deps.backoffMs ?? defaultBackoff;
    this.wait = deps.wait ?? defaultWait;
    this.grace = deps.shutdownGraceMs ?? 10_000;
  }

  /** Resolves with the first successful connection (or when the driver is closed first). */
  start() {
    this.loop ??= this.connectLoop();
    return this.loop;
  }

  async publish<T>(queue: string, payload: T, options: PublishOptions = {}) {
    const channel = this.publisher;
    if (!channel) throw new QueueUnavailableError('RabbitMQ is not connected');
    this.known.add(queue);
    if (!this.declared.has(queue)) {
      await this.declareBase(channel, queue);
      this.declared.add(queue);
    }
    await send((callback) =>
      channel.publish(
        EXCHANGE,
        queue,
        Buffer.from(JSON.stringify(payload)),
        properties(options.messageId ?? randomUUID(), 1),
        callback,
      ),
    );
  }

  async subscribe<T>(queue: string, handler: QueueHandler<T>, options: SubscribeOptions = {}) {
    if (this.consumers.has(queue)) throw new Error(`"${queue}" already has a consumer`);
    const policy = { ...DEFAULT_POLICY, ...options };
    const consumer: Consumer = {
      queue,
      handler: handler as QueueHandler<unknown>,
      prefetch: Math.max(1, options.prefetch ?? 1),
      policy,
      active: false,
    };
    this.consumers.set(queue, consumer);
    this.known.add(queue);
    this.retryQueues.set(queue, retryDelays(policy));
    // while the broker is away the consumer is attached by the next successful connection
    if (this.connection) {
      await this.attach(this.connection, consumer).catch((error) =>
        this.log.warn(`Cannot consume "${queue}" yet: ${String(error)}`),
      );
    }
  }

  async status(): Promise<QueueStatus> {
    const channel = this.publisher;
    const queues: QueueStats[] = [];
    for (const name of [...this.known].sort()) {
      if (!channel) {
        queues.push({ name, messages: null, consumers: null, retrying: null, dead: null });
        continue;
      }
      try {
        const main = await channel.assertQueue(name, mainQueue(name));
        const dead = await channel.assertQueue(deadQueueName(name), { durable: true });
        let retrying: number | null = null;
        const delays = this.retryQueues.get(name);
        if (delays) {
          retrying = 0;
          for (const delay of delays) {
            const retry = await channel.assertQueue(
              retryQueueName(name, delay),
              retryQueue(name, delay),
            );
            retrying += retry.messageCount;
          }
        }
        queues.push({
          name,
          messages: main.messageCount,
          consumers: main.consumerCount,
          retrying,
          dead: dead.messageCount,
        });
      } catch (error) {
        this.log.warn(`Cannot read the state of "${name}": ${String(error)}`);
        queues.push({ name, messages: null, consumers: null, retrying: null, dead: null });
      }
    }
    return { driver: 'rabbitmq', connected: this.connection !== undefined, queues };
  }

  async close() {
    this.stop.abort();
    const connection = this.connection;
    this.connection = undefined;
    this.publisher = undefined;
    // no new deliveries, then let the running handlers finish (bounded)
    await Promise.allSettled(
      [...this.consumers.values()].map((c) => c.channel && c.tag && c.channel.cancel(c.tag)),
    );
    let graceTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.inflight]),
      new Promise<void>((resolve) => {
        graceTimer = setTimeout(resolve, this.grace);
      }),
    ]);
    clearTimeout(graceTimer);
    await Promise.allSettled(
      [...this.consumers.values()].map((consumer) => consumer.channel?.close()),
    );
    for (const consumer of this.consumers.values()) detach(consumer);
    await connection?.close().catch(() => undefined);
  }

  private async connectLoop() {
    for (let attempt = 1; !this.stop.signal.aborted; attempt++) {
      try {
        await this.open();
        return;
      } catch (error) {
        if (this.stop.signal.aborted) return;
        const delay = this.backoff(attempt);
        this.log.warn(`RabbitMQ is unavailable (${String(error)}); retrying in ${delay} ms`);
        await this.wait(delay, this.stop.signal);
      }
    }
  }

  private async open() {
    this.connecting = true;
    let connection: AmqpConnectionLike | undefined;
    try {
      connection = await this.connectFn(this.url);
      const current = connection;
      current.on('error', (error) => this.log.warn(`RabbitMQ connection error: ${String(error)}`));
      current.on('close', () => this.lost(current));
      this.connection = current;
      const publisher = await current.createConfirmChannel();
      publisher.on('error', (error) => this.log.warn(`RabbitMQ channel error: ${String(error)}`));
      // a dead publisher channel cannot be repaired in place: start over with a fresh connection
      publisher.on('close', () => {
        if (this.publisher === publisher) {
          this.lost(current);
          void current.close().catch(() => undefined);
        }
      });
      this.declared = new Set();
      await this.declareTopology(publisher);
      this.publisher = publisher;
      for (const consumer of this.consumers.values()) await this.attach(current, consumer);
      this.log.log('Connected to RabbitMQ');
    } catch (error) {
      this.connection = this.publisher = undefined;
      await connection?.close().catch(() => undefined);
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  /** The connection dropped: forget everything tied to it and reconnect in the background. */
  private lost(connection: AmqpConnectionLike) {
    if (this.connecting || this.connection !== connection || this.stop.signal.aborted) return;
    this.log.warn('RabbitMQ connection lost; reconnecting');
    this.connection = this.publisher = undefined;
    for (const consumer of this.consumers.values()) detach(consumer);
    this.loop = this.connectLoop();
  }

  private async declareTopology(channel: AmqpChannelLike) {
    await channel.assertExchange(EXCHANGE, 'direct', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
    for (const queue of this.known) {
      await this.declareBase(channel, queue);
      this.declared.add(queue);
    }
    for (const [queue, delays] of this.retryQueues) {
      for (const delay of delays) {
        await channel.assertQueue(retryQueueName(queue, delay), retryQueue(queue, delay));
      }
    }
  }

  private async declareBase(channel: AmqpChannelLike, queue: string) {
    await channel.assertQueue(queue, mainQueue(queue));
    await channel.bindQueue(queue, EXCHANGE, queue);
    await channel.assertQueue(deadQueueName(queue), { durable: true });
    await channel.bindQueue(deadQueueName(queue), DEAD_LETTER_EXCHANGE, queue);
  }

  private async attach(connection: AmqpConnectionLike, consumer: Consumer) {
    if (consumer.active) return;
    consumer.active = true;
    try {
      await this.consume(connection, consumer);
    } catch (error) {
      const { channel } = consumer;
      detach(consumer);
      await channel?.close().catch(() => undefined);
      throw error;
    }
  }

  private async consume(connection: AmqpConnectionLike, consumer: Consumer) {
    const channel = await connection.createChannel();
    consumer.channel = channel;
    channel.on('error', (error) =>
      this.log.warn(`RabbitMQ channel of "${consumer.queue}" failed: ${String(error)}`),
    );
    // a channel can die on its own (the broker deleted the queue, ...) while the connection stays up
    channel.on('close', () => {
      if (consumer.channel !== channel || this.stop.signal.aborted) return;
      detach(consumer);
      void this.reattach(connection, consumer);
    });
    await channel.prefetch(consumer.prefetch);
    for (const delay of this.retryQueues.get(consumer.queue) ?? []) {
      await channel.assertQueue(
        retryQueueName(consumer.queue, delay),
        retryQueue(consumer.queue, delay),
      );
    }
    await this.declareBase(channel, consumer.queue);
    const { consumerTag } = await channel.consume(consumer.queue, (message) => {
      if (!message) {
        // the broker cancelled this consumer (queue deleted, node failover)
        detach(consumer);
        void channel.close().catch(() => undefined);
        void this.reattach(connection, consumer);
        return;
      }
      const run = this.process(consumer, channel, message).finally(() => this.inflight.delete(run));
      this.inflight.add(run);
    });
    consumer.tag = consumerTag;
  }

  private async reattach(connection: AmqpConnectionLike, consumer: Consumer) {
    for (let attempt = 1; !this.stop.signal.aborted && this.connection === connection; attempt++) {
      await this.wait(this.backoff(attempt), this.stop.signal);
      if (this.stop.signal.aborted || this.connection !== connection) return;
      try {
        await this.attach(connection, consumer);
        return;
      } catch (error) {
        this.log.warn(`Cannot re-attach consumer of "${consumer.queue}": ${String(error)}`);
      }
    }
  }

  private async process(consumer: Consumer, channel: AmqpChannelLike, message: AmqpMessage) {
    const id = message.properties.messageId ?? randomUUID();
    const attempt = Number(message.properties.headers?.[ATTEMPT_HEADER] ?? 1) || 1;
    let payload: unknown;
    try {
      payload = JSON.parse(message.content.toString('utf8'));
    } catch {
      // not ours / corrupted: no retry can fix it, the dead-letter exchange keeps it for inspection
      this.log.warn(`Message ${id} of "${consumer.queue}" is not valid JSON; dead-lettering`);
      settle(() => channel.nack(message, false, false));
      return;
    }
    try {
      await consumer.handler(payload, { id, attempt });
      settle(() => channel.ack(message));
      return;
    } catch (error) {
      await this.fail(consumer, channel, message, { id, attempt }, error);
    }
  }

  private async fail(
    consumer: Consumer,
    channel: AmqpChannelLike,
    message: AmqpMessage,
    { id, attempt }: { id: string; attempt: number },
    error: unknown,
  ) {
    const reason = error instanceof Error ? error.message : String(error);
    const publisher = this.publisher;
    try {
      if (!publisher) throw new QueueUnavailableError('RabbitMQ is not connected');
      if (error instanceof PermanentQueueError || attempt >= consumer.policy.maxAttempts) {
        await send((callback) =>
          publisher.publish(
            DEAD_LETTER_EXCHANGE,
            consumer.queue,
            message.content,
            {
              ...properties(id, attempt),
              headers: { [ATTEMPT_HEADER]: attempt, [ERROR_HEADER]: reason },
            },
            callback,
          ),
        );
        this.log.warn(
          `Message ${id} of "${consumer.queue}" dead-lettered after ${attempt} attempt(s): ${reason}`,
        );
      } else {
        const delay = retryDelay(consumer.policy, attempt);
        await send((callback) =>
          publisher.sendToQueue(
            retryQueueName(consumer.queue, delay),
            message.content,
            {
              ...properties(id, attempt + 1),
              headers: { [ATTEMPT_HEADER]: attempt + 1, [ERROR_HEADER]: reason },
            },
            callback,
          ),
        );
      }
      settle(() => channel.ack(message));
    } catch (publishError) {
      // could not park the message: give it back, the broker redelivers it
      this.log.warn(`Message ${id} of "${consumer.queue}" is requeued: ${String(publishError)}`);
      settle(() => channel.nack(message, false, true));
    }
  }
}

const mainQueue = (queue: string) => ({
  durable: true,
  arguments: {
    'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
    'x-dead-letter-routing-key': queue,
  },
});

/** Holds a failed message for `delay` ms, then the TTL dead-letters it back into the work queue. */
const retryQueue = (queue: string, delay: number) => ({
  durable: true,
  arguments: {
    'x-message-ttl': delay,
    'x-dead-letter-exchange': EXCHANGE,
    'x-dead-letter-routing-key': queue,
  },
});

const properties = (messageId: string, attempt: number): PublishProperties => ({
  persistent: true,
  contentType: 'application/json',
  messageId,
  headers: { [ATTEMPT_HEADER]: attempt },
});

/** amqplib's confirm callbacks as a promise. */
const send = (publish: (callback: (error: Error | null) => void) => unknown) =>
  new Promise<void>((resolve, reject) => {
    try {
      publish((error) => (error ? reject(error) : resolve()));
    } catch (error) {
      reject(error);
    }
  });

/** ack/nack on a channel that died meanwhile throws; the broker redelivers anyway. */
function settle(action: () => void) {
  try {
    action();
  } catch {
    // channel closed: the unacked message returns to the queue
  }
}
