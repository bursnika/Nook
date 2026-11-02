export interface CacheDriver {
  readonly name: 'memory' | 'redis';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
  close(): Promise<void>;
}

export const CACHE_DRIVER = Symbol('CACHE_DRIVER');
