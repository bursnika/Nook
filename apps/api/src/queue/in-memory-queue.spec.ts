import { Logger } from '@nestjs/common';
import { InMemoryQueue } from './in-memory-queue.js';
import { PermanentQueueError, retryDelay, retryDelays } from './message-queue.js';

describe('InMemoryQueue', () => {
  let queue: InMemoryQueue;

  beforeEach(() => {
    Logger.overrideLogger(false);
    queue = new InMemoryQueue({ manualRetries: true });
  });
  afterEach(() => queue.close());

  it('delivers messages in order and acks when the handler resolves', async () => {
    const seen: number[] = [];
    await queue.subscribe<{ n: number }>('q', async ({ n }) => void seen.push(n));
    for (const n of [1, 2, 3]) await queue.publish('q', { n });
    await queue.flush();
    expect(seen).toEqual([1, 2, 3]);
    expect(await queue.status()).toMatchObject({
      driver: 'memory',
      queues: [{ name: 'q', messages: 0, consumers: 1, retrying: 0, dead: 0 }],
    });
  });

  it('keeps messages published before anyone subscribed', async () => {
    await queue.publish('q', 'early');
    expect((await queue.status()).queues[0]).toMatchObject({ messages: 1, consumers: 0 });
    const seen: string[] = [];
    await queue.subscribe<string>('q', async (text) => void seen.push(text));
    await queue.flush();
    expect(seen).toEqual(['early']);
  });

  it('hands the handler a copy, never the publisher object', async () => {
    const original = { list: [1] };
    let received: { list: number[] } | undefined;
    await queue.subscribe<{ list: number[] }>('q', async (payload) => void (received = payload));
    await queue.publish('q', original);
    await queue.flush();
    expect(received).toEqual(original);
    expect(received).not.toBe(original);
  });

  it('does not start the handler inside publish()', async () => {
    const handler = vi.fn(async () => undefined);
    await queue.subscribe('q', handler);
    const published = queue.publish('q', 1);
    expect(handler).not.toHaveBeenCalled();
    await published;
    await queue.flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('nacks a failing message, retries it after the backoff and acks the second try', async () => {
    const attempts: number[] = [];
    await queue.subscribe<string>(
      'q',
      async (_payload, { attempt }) => {
        attempts.push(attempt);
        if (attempt === 1) throw new Error('boom');
      },
      { retryDelayMs: 1_000 },
    );
    await queue.publish('q', 'x');
    await queue.flush();
    expect(attempts).toEqual([1]);
    expect((await queue.status()).queues[0]).toMatchObject({ retrying: 1, dead: 0 });

    await queue.advance(999);
    expect(attempts).toEqual([1]);
    await queue.advance(1);
    expect(attempts).toEqual([1, 2]);
    expect((await queue.status()).queues[0]).toMatchObject({ retrying: 0, dead: 0 });
  });

  it('doubles the delay per attempt and dead-letters after maxAttempts', async () => {
    const attempts: number[] = [];
    await queue.subscribe<string>(
      'q',
      async (_payload, { attempt }) => {
        attempts.push(attempt);
        throw new Error(`fail ${attempt}`);
      },
      { maxAttempts: 3, retryDelayMs: 100 },
    );
    await queue.publish('q', 'x', { messageId: 'm-1' });
    await queue.flush();
    await queue.advance(100); // 2nd attempt
    await queue.advance(199); // the next delay is 200
    expect(attempts).toEqual([1, 2]);
    await queue.advance(1);
    expect(attempts).toEqual([1, 2, 3]);
    expect(queue.deadLetters('q')).toEqual([
      { id: 'm-1', payload: 'x', attempts: 3, error: 'fail 3' },
    ]);
    expect((await queue.status()).queues[0]).toMatchObject({ retrying: 0, dead: 1, messages: 0 });
  });

  it('drain() runs retries to the end without real time passing', async () => {
    const handler = vi.fn(async () => {
      throw new Error('never works');
    });
    await queue.subscribe('q', handler, { maxAttempts: 4, retryDelayMs: 60_000 });
    await queue.publish('q', 1);
    await queue.drain();
    expect(handler).toHaveBeenCalledTimes(4);
    expect(queue.deadLetters('q')).toHaveLength(1);
  });

  it('dead-letters a permanent failure at once', async () => {
    const handler = vi.fn(async () => {
      throw new PermanentQueueError('bad message');
    });
    await queue.subscribe('q', handler);
    await queue.publish('q', 1);
    await queue.flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(queue.deadLetters('q')[0]).toMatchObject({ attempts: 1, error: 'bad message' });
  });

  it('respects prefetch: at most that many handlers run at once', async () => {
    let running = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    await queue.subscribe<number>(
      'q',
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => release.push(resolve));
        running -= 1;
      },
      { prefetch: 2 },
    );
    for (let i = 0; i < 5; i++) await queue.publish('q', i);
    await Promise.resolve();
    await Promise.resolve();
    expect(running).toBe(2);
    expect((await queue.status()).queues[0].messages).toBe(3);

    while (release.length || running > 0) {
      release.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    await queue.flush();
    expect(peak).toBe(2);
  });

  it('with prefetch 1 a retried message goes behind the ones that were waiting', async () => {
    const order: string[] = [];
    await queue.subscribe<string>(
      'q',
      async (name, { attempt }) => {
        order.push(`${name}${attempt}`);
        if (name === 'a' && attempt === 1) throw new Error('later');
      },
      { retryDelayMs: 10 },
    );
    await queue.publish('q', 'a');
    await queue.publish('q', 'b');
    await queue.drain();
    expect(order).toEqual(['a1', 'b1', 'a2']);
  });

  it('keeps queues apart and allows one consumer per queue', async () => {
    const a: number[] = [];
    const b: number[] = [];
    await queue.subscribe<number>('a', async (n) => void a.push(n));
    await queue.subscribe<number>('b', async (n) => void b.push(n));
    await queue.publish('a', 1);
    await queue.publish('b', 2);
    await queue.flush();
    expect([a, b]).toEqual([[1], [2]]);
    await expect(queue.subscribe('a', async () => undefined)).rejects.toThrow(/already/);
  });

  it('uses real, unref-ed timers for retries unless told to be manual', async () => {
    vi.useFakeTimers();
    try {
      const live = new InMemoryQueue();
      const seen: number[] = [];
      await live.subscribe<string>(
        'q',
        async (_payload, { attempt }) => {
          seen.push(attempt);
          if (attempt === 1) throw new Error('once');
        },
        { retryDelayMs: 50 },
      );
      await live.publish('q', 'x');
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([1]);
      await vi.advanceTimersByTimeAsync(50);
      expect(seen).toEqual([1, 2]);
      await live.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() cancels pending retries and refuses new messages', async () => {
    vi.useFakeTimers();
    try {
      const live = new InMemoryQueue();
      await live.subscribe('q', async () => {
        throw new Error('no');
      });
      await live.publish('q', 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      await live.close();
      expect(vi.getTimerCount()).toBe(0);
      await expect(live.publish('q', 2)).rejects.toThrow(/closed/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('retry policy', () => {
  const policy = { maxAttempts: 5, retryDelayMs: 1_000, maxRetryDelayMs: 3_000 };

  it('doubles the delay and caps it', () => {
    expect([1, 2, 3, 4].map((attempt) => retryDelay(policy, attempt))).toEqual([
      1_000, 2_000, 3_000, 3_000,
    ]);
  });

  it('lists each distinct delay once (one retry queue per delay)', () => {
    expect(retryDelays(policy)).toEqual([1_000, 2_000, 3_000]);
  });
});
