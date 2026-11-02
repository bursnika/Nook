import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { CacheDriver } from './cache.driver.js';

export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  scan(
    cursor: string,
    match: 'MATCH',
    pattern: string,
    count: 'COUNT',
    hint: number,
  ): Promise<[cursor: string, keys: string[]]>;
  unlink(...keys: string[]): Promise<number>;
  quit(): Promise<unknown>;
  disconnect(): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

const KEY_PREFIX = 'nook:cache:';
const SCAN_BATCH = 200;
const ERROR_LOG_INTERVAL_MS = 30_000;

// escape glob chars for SCAN MATCH
const escapeGlob = (text: string) => text.replace(/[\\*?[\]]/g, '\\$&');

export class RedisCache implements CacheDriver {
  readonly name = 'redis';
  private readonly logger = new Logger(RedisCache.name);
  private lastErrorLog = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly client: RedisClientLike,
    private readonly now: () => number = Date.now,
  ) {
    // without a listener ioredis logs every reconnect error
    client.on('error', (error) => {
      if (this.now() - this.lastErrorLog < ERROR_LOG_INTERVAL_MS) return;
      this.lastErrorLog = this.now();
      this.logger.warn(`Redis is unavailable, caching is off until it is back: ${error.message}`);
    });
  }

  static connect(url: string) {
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
      commandTimeout: 1_000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
    });
    return new RedisCache(client);
  }

  get(key: string) {
    return this.client.get(KEY_PREFIX + key);
  }

  async set(key: string, value: string, ttlSeconds: number) {
    if (ttlSeconds <= 0) return;
    await this.client.set(KEY_PREFIX + key, value, 'EX', Math.ceil(ttlSeconds));
  }

  async deleteByPrefix(prefix: string) {
    const pattern = `${escapeGlob(KEY_PREFIX + prefix)}*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_BATCH);
      cursor = next;
      if (keys.length) await this.client.unlink(...keys);
    } while (cursor !== '0');
  }

  async close() {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
