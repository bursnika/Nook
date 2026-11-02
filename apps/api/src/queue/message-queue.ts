export interface Delivery {
  id: string;
  attempt: number;
}

// resolve = ack, throw = nack (retry or dead-letter)
export type QueueHandler<T> = (payload: T, delivery: Delivery) => Promise<void>;

export interface PublishOptions {
  messageId?: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
}

export interface SubscribeOptions extends Partial<RetryPolicy> {
  prefetch?: number;
}

export const DEFAULT_POLICY: RetryPolicy = {
  maxAttempts: 5,
  retryDelayMs: 5_000,
  maxRetryDelayMs: 5 * 60_000,
};

export const retryDelay = (policy: RetryPolicy, attempt: number) =>
  Math.min(policy.retryDelayMs * 2 ** (attempt - 1), policy.maxRetryDelayMs);

export const retryDelays = (policy: RetryPolicy) => [
  ...new Set(Array.from({ length: policy.maxAttempts - 1 }, (_, i) => retryDelay(policy, i + 1))),
];

// throw to skip retries and dead-letter the message
export class PermanentQueueError extends Error {
  override name = 'PermanentQueueError';
}

export class QueueUnavailableError extends Error {
  override name = 'QueueUnavailableError';
}

export interface QueueStats {
  name: string;
  messages: number | null;
  consumers: number | null;
  retrying: number | null;
  dead: number | null;
}

export interface QueueStatus {
  driver: 'rabbitmq' | 'memory';
  connected: boolean;
  queues: QueueStats[];
}

// at-least-once delivery, handlers must be idempotent
export interface MessageQueue {
  readonly name: QueueStatus['driver'];
  start(): Promise<void>;
  publish<T>(queue: string, payload: T, options?: PublishOptions): Promise<void>;
  subscribe<T>(queue: string, handler: QueueHandler<T>, options?: SubscribeOptions): Promise<void>;
  status(): Promise<QueueStatus>;
  close(): Promise<void>;
}

export const MESSAGE_QUEUE = Symbol('MESSAGE_QUEUE');
