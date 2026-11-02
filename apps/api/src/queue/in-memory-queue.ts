import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_POLICY,
  PermanentQueueError,
  retryDelay,
  type MessageQueue,
  type PublishOptions,
  type QueueHandler,
  type QueueStatus,
  type RetryPolicy,
  type SubscribeOptions,
} from './message-queue.js';

interface Entry {
  id: string;
  body: string;
  attempt: number;
}

export interface DeadLetter {
  id: string;
  payload: unknown;
  attempts: number;
  error: string;
}

interface Waiting {
  entry: Entry;
  dueAt: number;
  timer?: NodeJS.Timeout;
}

interface Consumer {
  handler: QueueHandler<unknown>;
  prefetch: number;
  policy: RetryPolicy;
}

interface QueueState {
  ready: Entry[];
  active: number;
  waiting: Waiting[];
  dead: DeadLetter[];
  consumer?: Consumer;
  pumpScheduled: boolean;
}

export interface InMemoryQueueOptions {
  // fake clock for tests, moved by advance()/drain()
  manualRetries?: boolean;
}

export class InMemoryQueue implements MessageQueue {
  readonly name = 'memory';
  private readonly log = new Logger('Queue');
  private readonly queues = new Map<string, QueueState>();
  private readonly inflight = new Set<Promise<void>>();
  private clock = 0;
  private closed = false;

  constructor(private readonly options: InMemoryQueueOptions = {}) {}

  async start() {}

  async publish<T>(queue: string, payload: T, options: PublishOptions = {}) {
    if (this.closed) throw new Error('The queue is closed');
    const state = this.state(queue);
    state.ready.push({
      id: options.messageId ?? randomUUID(),
      body: JSON.stringify(payload),
      attempt: 1,
    });
    this.schedulePump(state);
  }

  async subscribe<T>(queue: string, handler: QueueHandler<T>, options: SubscribeOptions = {}) {
    const state = this.state(queue);
    if (state.consumer) throw new Error(`"${queue}" already has a consumer`);
    state.consumer = {
      handler: handler as QueueHandler<unknown>,
      prefetch: Math.max(1, options.prefetch ?? 1),
      policy: { ...DEFAULT_POLICY, ...options },
    };
    this.schedulePump(state);
  }

  async status(): Promise<QueueStatus> {
    return {
      driver: 'memory',
      connected: !this.closed,
      queues: [...this.queues].map(([name, state]) => ({
        name,
        messages: state.ready.length,
        consumers: state.consumer ? 1 : 0,
        retrying: state.waiting.length,
        dead: state.dead.length,
      })),
    };
  }

  async close() {
    this.closed = true;
    for (const state of this.queues.values()) {
      for (const waiting of state.waiting) clearTimeout(waiting.timer);
      state.waiting = [];
    }
    await Promise.allSettled([...this.inflight]);
  }

  async clear() {
    await this.flush();
    for (const state of this.queues.values()) {
      for (const waiting of state.waiting) clearTimeout(waiting.timer);
      state.ready = [];
      state.waiting = [];
      state.dead = [];
    }
  }

  deadLetters(queue: string): readonly DeadLetter[] {
    return this.queues.get(queue)?.dead ?? [];
  }

  async flush() {
    while (this.busy()) {
      await Promise.allSettled([...this.inflight]);
      await Promise.resolve();
    }
  }

  async advance(ms: number) {
    this.clock += ms;
    for (const state of this.queues.values()) {
      const due = state.waiting
        .filter((waiting) => waiting.dueAt <= this.clock)
        .sort((a, b) => a.dueAt - b.dueAt);
      for (const waiting of due) this.release(state, waiting);
    }
    await this.flush();
  }

  async drain() {
    await this.flush();
    for (;;) {
      const next = Math.min(
        ...[...this.queues.values()]
          .filter((state) => state.consumer)
          .flatMap((state) => state.waiting.map((waiting) => waiting.dueAt)),
      );
      if (!Number.isFinite(next)) return;
      await this.advance(Math.max(0, next - this.clock));
    }
  }

  private state(queue: string) {
    let state = this.queues.get(queue);
    if (!state) {
      state = { ready: [], active: 0, waiting: [], dead: [], pumpScheduled: false };
      this.queues.set(queue, state);
    }
    return state;
  }

  private busy() {
    return [...this.queues.values()].some(
      (state) =>
        state.pumpScheduled || state.active > 0 || (state.consumer && state.ready.length > 0),
    );
  }

  // deliver on a microtask, like a real broker
  private schedulePump(state: QueueState) {
    if (state.pumpScheduled) return;
    state.pumpScheduled = true;
    queueMicrotask(() => {
      state.pumpScheduled = false;
      this.pump(state);
    });
  }

  private pump(state: QueueState) {
    const { consumer } = state;
    while (!this.closed && consumer && state.active < consumer.prefetch && state.ready.length > 0) {
      const entry = state.ready.shift()!;
      state.active += 1;
      const run = this.handle(state, consumer, entry).finally(() => {
        this.inflight.delete(run);
        state.active -= 1;
        this.pump(state);
      });
      this.inflight.add(run);
    }
  }

  private async handle(state: QueueState, consumer: Consumer, entry: Entry) {
    try {
      await consumer.handler(JSON.parse(entry.body), { id: entry.id, attempt: entry.attempt });
    } catch (error) {
      this.fail(state, consumer, entry, error);
    }
  }

  private fail(state: QueueState, consumer: Consumer, entry: Entry, error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof PermanentQueueError || entry.attempt >= consumer.policy.maxAttempts) {
      state.dead.push({
        id: entry.id,
        payload: JSON.parse(entry.body),
        attempts: entry.attempt,
        error: reason,
      });
      this.log.warn(
        `Message ${entry.id} dead-lettered after ${entry.attempt} attempt(s): ${reason}`,
      );
      return;
    }
    const delay = retryDelay(consumer.policy, entry.attempt);
    const waiting: Waiting = {
      entry: { ...entry, attempt: entry.attempt + 1 },
      dueAt: this.clock + delay,
    };
    if (!this.options.manualRetries) {
      waiting.timer = setTimeout(() => this.release(state, waiting), delay);
      waiting.timer.unref();
    }
    state.waiting.push(waiting);
  }

  private release(state: QueueState, waiting: Waiting) {
    const index = state.waiting.indexOf(waiting);
    if (index === -1) return;
    clearTimeout(waiting.timer);
    state.waiting.splice(index, 1);
    state.ready.push(waiting.entry);
    this.schedulePump(state);
  }
}
