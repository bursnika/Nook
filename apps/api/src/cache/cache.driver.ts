/** A key-value store with expiry. Values are already serialised, so every driver stores plain strings. */
export interface CacheDriver {
  readonly name: 'memory' | 'redis';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Removes every key that starts with `prefix`. */
  deleteByPrefix(prefix: string): Promise<void>;
  close(): Promise<void>;
}

export const CACHE_DRIVER = Symbol('CACHE_DRIVER');
