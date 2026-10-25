/** What a handler learns about the message it got. `attempt` starts at 1 and grows with every retry. */
export interface Delivery {
  id: string;
  attempt: number;
}

/** Resolving acks the message; throwing nacks it, so it is retried later or, when out of attempts, dead-lettered. */
export type QueueHandler<T> = (payload: T, delivery: Delivery) => Promise<void>;

export interface PublishOptions {
  /** Stable id for tracing and de-duplication in logs; a random one is used when omitted. */
  messageId?: string;
}

export interface RetryPolicy {
  /** Deliveries in total (the first one included) before the message goes to the dead-letter queue. */
  maxAttempts: number;
  /** Delay before the second attempt; it doubles with every further one. */
  retryDelayMs: number;
  maxRetryDelayMs: number;
}

export interface SubscribeOptions extends Partial<RetryPolicy> {
  /** How many messages may be in the handler at once. */
  prefetch?: number;
}

export const DEFAULT_POLICY: RetryPolicy = {
  maxAttempts: 5,
  retryDelayMs: 5_000,
  maxRetryDelayMs: 5 * 60_000,
};

/** Backoff after the `attempt`-th failed delivery (1-based). */
export const retryDelay = (policy: RetryPolicy, attempt: number) =>
  Math.min(policy.retryDelayMs * 2 ** (attempt - 1), policy.maxRetryDelayMs);

/** Every delay a message of this policy can wait, for drivers that need a queue per delay. */
export const retryDelays = (policy: RetryPolicy) => [
  ...new Set(Array.from({ length: policy.maxAttempts - 1 }, (_, i) => retryDelay(policy, i + 1))),
];

/** Throw it from a handler when retrying cannot help: the message goes straight to the dead-letter queue. */
export class PermanentQueueError extends Error {
  override name = 'PermanentQueueError';
}

/** The broker cannot take messages right now (the driver is reconnecting). Callers decide how to degrade. */
export class QueueUnavailableError extends Error {
  override name = 'QueueUnavailableError';
}

/** `null` means the driver cannot tell. */
export interface QueueStats {
  name: string;
  /** Ready to be delivered (not counting messages being handled or waiting for a retry). */
  messages: number | null;
  consumers: number | null;
  /** Waiting for their retry delay to pass. */
  retrying: number | null;
  /** In the dead-letter queue. */
  dead: number | null;
}

export interface QueueStatus {
  driver: 'rabbitmq' | 'memory';
  connected: boolean;
  queues: QueueStats[];
}

/**
 * The queue Nook talks to. Delivery is at-least-once, so handlers must be idempotent. Queues are created
 * on first use, together with their retry and dead-letter plumbing.
 */
export interface MessageQueue {
  readonly name: QueueStatus['driver'];
  /** Connects in the background; never rejects, because the app should boot without its broker. */
  start(): Promise<void>;
  publish<T>(queue: string, payload: T, options?: PublishOptions): Promise<void>;
  /** One consumer per queue and process. Messages published before it subscribed are delivered to it. */
  subscribe<T>(queue: string, handler: QueueHandler<T>, options?: SubscribeOptions): Promise<void>;
  status(): Promise<QueueStatus>;
  /** Stops consuming, lets running handlers finish, closes connections. */
  close(): Promise<void>;
}

export const MESSAGE_QUEUE = Symbol('MESSAGE_QUEUE');
