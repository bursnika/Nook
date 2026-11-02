import { Logger } from '@nestjs/common';
import { PermanentQueueError } from './message-queue.js';
import {
  DEAD_LETTER_EXCHANGE,
  EXCHANGE,
  RabbitMqQueue,
  type AmqpChannelLike,
  type AmqpConfirmChannelLike,
  type AmqpConnectionLike,
  type AmqpMessage,
} from './rabbitmq-queue.js';

type Listener = (error?: Error) => void;

class FakeChannel implements AmqpConfirmChannelLike {
  exchanges: { name: string; type: string; durable: boolean }[] = [];
  queues = new Map<string, { durable: boolean; arguments?: Record<string, unknown> }>();
  bindings: { queue: string; exchange: string; key: string }[] = [];
  prefetchCount?: number;
  published: {
    exchange: string;
    key: string;
    content: Buffer;
    headers: Record<string, unknown>;
    persistent: boolean;
    messageId: string;
  }[] = [];
  acked: AmqpMessage[] = [];
  nacked: { message: AmqpMessage; requeue: boolean }[] = [];
  cancelled: string[] = [];
  closed = false;
  onMessage?: (message: AmqpMessage | null) => void;
  counts = new Map<string, { messageCount: number; consumerCount: number }>();
  failPublish?: Error;
  private readonly listeners = new Map<string, Listener[]>();

  async assertExchange(name: string, type: string, options: { durable: boolean }) {
    this.exchanges.push({ name, type, durable: options.durable });
  }
  async assertQueue(
    name: string,
    options: { durable: boolean; arguments?: Record<string, unknown> },
  ) {
    this.queues.set(name, options);
    return this.counts.get(name) ?? { messageCount: 0, consumerCount: 0 };
  }
  async bindQueue(queue: string, exchange: string, key: string) {
    this.bindings.push({ queue, exchange, key });
  }
  async prefetch(count: number) {
    this.prefetchCount = count;
  }
  async consume(_queue: string, onMessage: (message: AmqpMessage | null) => void) {
    this.onMessage = onMessage;
    return { consumerTag: `tag-${_queue}` };
  }
  async cancel(tag: string) {
    this.cancelled.push(tag);
  }
  ack(message: AmqpMessage) {
    this.acked.push(message);
  }
  nack(message: AmqpMessage, _all: boolean, requeue: boolean) {
    this.nacked.push({ message, requeue });
  }
  async close() {
    this.closed = true;
    this.emit('close');
  }
  publish(
    exchange: string,
    key: string,
    content: Buffer,
    options: {
      persistent: boolean;
      messageId: string;
      headers: Record<string, unknown>;
    },
    callback: (error: Error | null) => void,
  ) {
    this.record(exchange, key, content, options, callback);
  }
  sendToQueue(
    queue: string,
    content: Buffer,
    options: { persistent: boolean; messageId: string; headers: Record<string, unknown> },
    callback: (error: Error | null) => void,
  ) {
    this.record('', queue, content, options, callback);
  }
  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  emit(event: string, error?: Error) {
    for (const listener of this.listeners.get(event) ?? []) listener(error);
  }
  deliver(payload: unknown, properties: AmqpMessage['properties'] = {}) {
    const message: AmqpMessage = {
      content: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
      fields: { deliveryTag: this.acked.length + this.nacked.length + 1 },
      properties,
    };
    this.onMessage!(message);
    return message;
  }
  private record(
    exchange: string,
    key: string,
    content: Buffer,
    options: { persistent: boolean; messageId: string; headers: Record<string, unknown> },
    callback: (error: Error | null) => void,
  ) {
    if (this.failPublish) return callback(this.failPublish);
    this.published.push({ exchange, key, content, ...options });
    callback(null);
  }
}

class FakeConnection implements AmqpConnectionLike {
  channels: FakeChannel[] = [];
  confirmChannels: FakeChannel[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  async createChannel(): Promise<AmqpChannelLike> {
    const channel = new FakeChannel();
    this.channels.push(channel);
    return channel;
  }
  async createConfirmChannel() {
    const channel = new FakeChannel();
    this.confirmChannels.push(channel);
    return channel;
  }
  async close() {
    this.closed = true;
  }
  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  drop() {
    for (const listener of this.listeners.get('close') ?? []) listener();
  }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('RabbitMqQueue (mocked amqplib)', () => {
  let connections: FakeConnection[];
  let failures: number;
  let waits: number[];
  let queue: RabbitMqQueue;

  const make = (deps: { shutdownGraceMs?: number } = {}) =>
    new RabbitMqQueue('amqp://broker.test', {
      connect: async () => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('ECONNREFUSED');
        }
        const connection = new FakeConnection();
        connections.push(connection);
        return connection;
      },
      backoffMs: (attempt) => attempt * 100,
      wait: async (ms) => void waits.push(ms),
      ...deps,
    });
  const publisher = () => connections.at(-1)!.confirmChannels[0];
  const consumerChannel = () => connections.at(-1)!.channels[0];

  beforeEach(() => {
    Logger.overrideLogger(false);
    connections = [];
    failures = 0;
    waits = [];
    queue = make();
  });
  afterEach(() => queue.close());

  it('declares durable topology with a dead-letter exchange and retry queues', async () => {
    await queue.start();
    await queue.subscribe('jobs', async () => undefined, { maxAttempts: 4, retryDelayMs: 1_000 });

    const pub = publisher();
    expect(pub.exchanges).toEqual([
      { name: EXCHANGE, type: 'direct', durable: true },
      { name: DEAD_LETTER_EXCHANGE, type: 'direct', durable: true },
    ]);
    expect(consumerChannel().queues.get('jobs')).toEqual({
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
        'x-dead-letter-routing-key': 'jobs',
      },
    });
    expect(consumerChannel().queues.get('jobs.dead')).toEqual({ durable: true });
    expect(consumerChannel().bindings).toEqual(
      expect.arrayContaining([
        { queue: 'jobs', exchange: EXCHANGE, key: 'jobs' },
        { queue: 'jobs.dead', exchange: DEAD_LETTER_EXCHANGE, key: 'jobs' },
      ]),
    );
    // one ttl queue per delay (1s, 2s, 4s)
    for (const delay of [1_000, 2_000, 4_000]) {
      expect(consumerChannel().queues.get(`jobs.retry.${delay}`)).toEqual({
        durable: true,
        arguments: {
          'x-message-ttl': delay,
          'x-dead-letter-exchange': EXCHANGE,
          'x-dead-letter-routing-key': 'jobs',
        },
      });
    }
    expect(consumerChannel().prefetchCount).toBe(1);
  });

  it('sets the prefetch of the consumer', async () => {
    await queue.start();
    await queue.subscribe('jobs', async () => undefined, { prefetch: 7 });
    expect(consumerChannel().prefetchCount).toBe(7);
  });

  it('publishes persistent JSON through the exchange and waits for the broker confirm', async () => {
    await queue.start();
    await queue.publish('jobs', { n: 1 }, { messageId: 'm-1' });
    expect(publisher().published).toHaveLength(1);
    expect(publisher().published[0]).toMatchObject({
      exchange: EXCHANGE,
      key: 'jobs',
      persistent: true,
      messageId: 'm-1',
      headers: { 'x-attempt': 1 },
    });
    expect(JSON.parse(publisher().published[0].content.toString())).toEqual({ n: 1 });
    expect(publisher().queues.has('jobs')).toBe(true);

    publisher().failPublish = new Error('nack from broker');
    await expect(queue.publish('jobs', { n: 2 })).rejects.toThrow('nack from broker');
  });

  it('refuses to publish while the broker is away', async () => {
    await expect(queue.publish('jobs', 1)).rejects.toThrow(/not connected/);
  });

  it('acks a message once the handler succeeded', async () => {
    const handler = vi.fn(async () => undefined);
    await queue.start();
    await queue.subscribe('jobs', handler);
    const message = consumerChannel().deliver({ n: 1 }, { messageId: 'm-1' });
    await settle();
    expect(handler).toHaveBeenCalledWith({ n: 1 }, { id: 'm-1', attempt: 1 });
    expect(consumerChannel().acked).toEqual([message]);
    expect(consumerChannel().nacked).toEqual([]);
  });

  it('parks a failed message in the retry queue for its delay and acks the original', async () => {
    await queue.start();
    await queue.subscribe(
      'jobs',
      async () => {
        throw new Error('flaky');
      },
      { retryDelayMs: 1_000, maxAttempts: 4 },
    );
    const message = consumerChannel().deliver({ n: 1 }, { messageId: 'm-1' });
    await settle();
    expect(publisher().published).toHaveLength(1);
    expect(publisher().published[0]).toMatchObject({
      exchange: '',
      key: 'jobs.retry.1000',
      persistent: true,
      messageId: 'm-1',
      headers: { 'x-attempt': 2, 'x-error': 'flaky' },
    });
    expect(consumerChannel().acked).toEqual([message]);

    consumerChannel().deliver({ n: 1 }, { messageId: 'm-1', headers: { 'x-attempt': 2 } });
    await settle();
    expect(publisher().published[1]).toMatchObject({ key: 'jobs.retry.2000' });
  });

  it('sends the message to the dead-letter exchange after the last attempt', async () => {
    await queue.start();
    await queue.subscribe(
      'jobs',
      async () => {
        throw new Error('still broken');
      },
      { maxAttempts: 3 },
    );
    const message = consumerChannel().deliver(
      { n: 1 },
      { messageId: 'm-1', headers: { 'x-attempt': 3 } },
    );
    await settle();
    expect(publisher().published).toHaveLength(1);
    expect(publisher().published[0]).toMatchObject({
      exchange: DEAD_LETTER_EXCHANGE,
      key: 'jobs',
      headers: { 'x-attempt': 3, 'x-error': 'still broken' },
    });
    expect(consumerChannel().acked).toEqual([message]);
  });

  it('dead-letters a permanent failure on the first attempt', async () => {
    await queue.start();
    await queue.subscribe('jobs', async () => {
      throw new PermanentQueueError('malformed');
    });
    consumerChannel().deliver({ n: 1 });
    await settle();
    expect(publisher().published[0]).toMatchObject({ exchange: DEAD_LETTER_EXCHANGE, key: 'jobs' });
  });

  it('nacks (without requeue, so the broker dead-letters it) what is not JSON', async () => {
    const handler = vi.fn(async () => undefined);
    await queue.start();
    await queue.subscribe('jobs', handler);
    const message = consumerChannel().deliver('{not json');
    await settle();
    expect(handler).not.toHaveBeenCalled();
    expect(consumerChannel().nacked).toEqual([{ message, requeue: false }]);
  });

  it('requeues the message when it cannot be parked', async () => {
    await queue.start();
    await queue.subscribe('jobs', async () => {
      throw new Error('flaky');
    });
    publisher().failPublish = new Error('channel gone');
    const message = consumerChannel().deliver({ n: 1 });
    await settle();
    expect(consumerChannel().acked).toEqual([]);
    expect(consumerChannel().nacked).toEqual([{ message, requeue: true }]);
  });

  it('retries the first connection with backoff', async () => {
    failures = 2;
    await queue.start();
    expect(waits).toEqual([100, 200]);
    expect(connections).toHaveLength(1);
    await queue.publish('jobs', 1);
    expect(publisher().published).toHaveLength(1);
  });

  it('reconnects after the connection drops and re-attaches consumers and topology', async () => {
    const handler = vi.fn(async () => undefined);
    await queue.start();
    await queue.subscribe('jobs', handler);
    await queue.publish('jobs', 1);
    const first = connections[0];

    failures = 1;
    first.drop();
    await expect(queue.publish('jobs', 2)).rejects.toThrow(/not connected/);
    await settle();

    expect(connections).toHaveLength(2);
    expect(waits).toEqual([100]);
    const second = connections[1];
    expect(second.confirmChannels[0].queues.has('jobs')).toBe(true);
    expect(second.channels[0].prefetchCount).toBe(1);
    second.channels[0].deliver({ n: 1 }, { messageId: 'again' });
    await settle();
    expect(handler).toHaveBeenCalledWith({ n: 1 }, { id: 'again', attempt: 1 });
    await queue.publish('jobs', 3);
    expect(second.confirmChannels[0].published).toHaveLength(1);
  });

  it('re-attaches a consumer whose channel died while the connection lives', async () => {
    await queue.start();
    await queue.subscribe('jobs', async () => undefined);
    const dead = consumerChannel();
    dead.emit('close');
    await settle();
    expect(connections).toHaveLength(1);
    expect(connections[0].channels).toHaveLength(2);
    expect(connections[0].channels[1].onMessage).toBeDefined();
  });

  it('re-attaches when the broker cancels the consumer', async () => {
    await queue.start();
    await queue.subscribe('jobs', async () => undefined);
    consumerChannel().onMessage!(null);
    await settle();
    expect(connections[0].channels).toHaveLength(2);
  });

  it('attaches consumers that subscribed while the broker was unreachable', async () => {
    failures = 1;
    const started = queue.start();
    await queue.subscribe('jobs', async () => undefined);
    await started;
    expect(connections[0].channels[0].onMessage).toBeDefined();
  });

  it('reports message, consumer, retry and dead-letter counts', async () => {
    await queue.start();
    await queue.subscribe('jobs', async () => undefined, { maxAttempts: 2, retryDelayMs: 500 });
    const pub = publisher();
    pub.counts.set('jobs', { messageCount: 3, consumerCount: 1 });
    pub.counts.set('jobs.dead', { messageCount: 2, consumerCount: 0 });
    pub.counts.set('jobs.retry.500', { messageCount: 4, consumerCount: 0 });
    expect(await queue.status()).toEqual({
      driver: 'rabbitmq',
      connected: true,
      queues: [{ name: 'jobs', messages: 3, consumers: 1, retrying: 4, dead: 2 }],
    });
  });

  it('reports unknown counts while disconnected', async () => {
    await queue.subscribe('jobs', async () => undefined);
    expect(await queue.status()).toEqual({
      driver: 'rabbitmq',
      connected: false,
      queues: [{ name: 'jobs', messages: null, consumers: null, retrying: null, dead: null }],
    });
  });

  it('shuts down gracefully: stops consuming, waits for running handlers, then closes', async () => {
    let finish!: () => void;
    const order: string[] = [];
    await queue.start();
    await queue.subscribe('jobs', async () => {
      await new Promise<void>((resolve) => (finish = resolve));
      order.push('handler done');
    });
    const channel = consumerChannel();
    const message = channel.deliver({ n: 1 });
    await settle();

    const closing = queue.close().then(() => order.push('closed'));
    await settle();
    expect(channel.cancelled).toEqual(['tag-jobs']);
    expect(connections[0].closed).toBe(false);
    expect(order).toEqual([]);

    finish();
    await closing;
    expect(order).toEqual(['handler done', 'closed']);
    expect(channel.acked).toEqual([message]);
    expect(channel.closed).toBe(true);
    expect(connections[0].closed).toBe(true);
  });

  it('does not wait forever for a stuck handler', async () => {
    const stuck = make({ shutdownGraceMs: 5 });
    await stuck.start();
    await stuck.subscribe('jobs', () => new Promise<void>(() => undefined));
    connections[0].channels[0].deliver({ n: 1 });
    await settle();
    await stuck.close();
    expect(connections[0].closed).toBe(true);
  });

  it('does not reconnect once closed', async () => {
    await queue.start();
    const first = connections[0];
    await queue.close();
    first.drop();
    await settle();
    expect(connections).toHaveLength(1);
  });
});
