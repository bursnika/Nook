import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Response } from 'express';
import { CACHE_DRIVER, type CacheDriver } from './cache.driver.js';

export const CACHE_TTL_SECONDS = {
  pages: 60,
  tasks: 60,
  events: 60,
  // summary depends on the clock, so it expires sooner
  overview: 15,
} as const;

export type CacheKind = keyof typeof CACHE_TTL_SECONDS;

export const workspacePrefix = (workspaceId: string) => `ws:${workspaceId}:`;

export function normalizeQuery(query: object): string {
  const entries = Object.entries(query as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(Object.fromEntries(entries));
}

export function setCacheHeader(res: Response, hit: boolean) {
  res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
}

@Injectable()
export class CacheService implements OnApplicationShutdown {
  private readonly logger = new Logger(CacheService.name);
  // bumped on invalidate; a load that raced with it is not stored
  private epoch = 0;
  private lastLog = 0;

  constructor(@Inject(CACHE_DRIVER) private readonly driver: CacheDriver) {}

  get driverName() {
    return this.driver.name;
  }

  listKey(workspaceId: string, kind: CacheKind, query: object = {}) {
    return `${workspacePrefix(workspaceId)}${kind}:${normalizeQuery(query)}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.driver.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (error) {
      this.logFailure('read', error);
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    try {
      await this.driver.set(key, JSON.stringify(value), ttlSeconds);
    } catch (error) {
      this.logFailure('write', error);
    }
  }

  async deleteByPrefix(prefix: string) {
    this.epoch++;
    try {
      await this.driver.deleteByPrefix(prefix);
    } catch (error) {
      this.logFailure('invalidate', error);
    }
  }

  invalidateWorkspace(workspaceId: string) {
    return this.deleteByPrefix(workspacePrefix(workspaceId));
  }

  async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>) {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return { value: cached, hit: true };
    const epoch = this.epoch;
    const value = await load();
    if (epoch === this.epoch) await this.set(key, value, ttlSeconds);
    return { value, hit: false };
  }

  async onApplicationShutdown() {
    await this.driver.close().catch(() => undefined);
  }

  private logFailure(action: string, error: unknown) {
    const now = Date.now();
    if (now - this.lastLog < 30_000) return;
    this.lastLog = now;
    this.logger.warn(
      `Cache ${action} failed, continuing without cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
