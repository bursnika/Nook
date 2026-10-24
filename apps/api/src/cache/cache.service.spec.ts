import { describe, expect, it, vi } from 'vitest';
import type { CacheDriver } from './cache.driver.js';
import { CacheService, normalizeQuery } from './cache.service.js';
import { MemoryCache } from './memory-cache.js';

const brokenDriver = (): CacheDriver => {
  const fail = async () => {
    throw new Error('Redis is down');
  };
  return { name: 'redis', get: fail, set: fail, deleteByPrefix: fail, close: fail };
};

describe('normalizeQuery', () => {
  it('ignores key order and empty values, and writes dates as ISO text', () => {
    const a = normalizeQuery({ limit: 20, q: 'x', status: undefined, skip: 0 });
    const b = normalizeQuery({ skip: 0, q: 'x', limit: 20, status: null, pageId: '' });
    expect(a).toBe(b);
    expect(normalizeQuery({ from: new Date('2026-01-01T00:00:00Z') })).toBe(
      '{"from":"2026-01-01T00:00:00.000Z"}',
    );
    expect(normalizeQuery({})).toBe('{}');
  });

  it('tells different queries apart', () => {
    expect(normalizeQuery({ q: 'a' })).not.toBe(normalizeQuery({ q: 'b' }));
    expect(normalizeQuery({ skip: 0 })).not.toBe(normalizeQuery({ skip: 20 }));
  });
});

describe('CacheService', () => {
  it('keeps one workspace under one prefix, so a single delete clears it', async () => {
    const cache = new CacheService(new MemoryCache());
    const a = cache.listKey('ws-a', 'tasks', { limit: 20 });
    const b = cache.listKey('ws-b', 'tasks', { limit: 20 });
    expect(a).not.toBe(b);
    await cache.set(a, { n: 1 }, 60);
    await cache.set(cache.listKey('ws-a', 'pages'), { n: 2 }, 60);
    await cache.set(b, { n: 3 }, 60);
    await cache.invalidateWorkspace('ws-a');
    expect(await cache.get(a)).toBeUndefined();
    expect(await cache.get(cache.listKey('ws-a', 'pages'))).toBeUndefined();
    expect(await cache.get(b)).toEqual({ n: 3 });
  });

  it('remembers: the loader runs once until the entry is invalidated', async () => {
    const cache = new CacheService(new MemoryCache());
    const load = vi.fn(async () => ({ items: [1, 2], total: 2 }));
    const key = cache.listKey('w', 'tasks');
    expect(await cache.remember(key, 60, load)).toEqual({
      value: { items: [1, 2], total: 2 },
      hit: false,
    });
    expect((await cache.remember(key, 60, load)).hit).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.invalidateWorkspace('w');
    expect((await cache.remember(key, 60, load)).hit).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('returns the same JSON from a hit as from a miss (dates become text either way)', async () => {
    const cache = new CacheService(new MemoryCache());
    const load = async () => ({ at: new Date('2026-05-05T10:00:00Z') });
    const miss = await cache.remember('k', 60, load);
    const hit = await cache.remember('k', 60, load);
    expect(JSON.stringify(hit.value)).toBe(JSON.stringify(miss.value));
  });

  it('does not store a result that was loaded while a write invalidated the workspace', async () => {
    const cache = new CacheService(new MemoryCache());
    const key = cache.listKey('w', 'tasks');
    const stale = await cache.remember(key, 60, async () => {
      await cache.invalidateWorkspace('w'); // a write lands while the list is being read
      return 'old rows';
    });
    expect(stale).toEqual({ value: 'old rows', hit: false });
    expect(await cache.get(key)).toBeUndefined();
  });

  it('a failing driver means no cache, never an error', async () => {
    const cache = new CacheService(brokenDriver());
    const load = vi.fn(async () => 'fresh');
    expect(await cache.get('k')).toBeUndefined();
    await expect(cache.set('k', 1, 60)).resolves.toBeUndefined();
    await expect(cache.invalidateWorkspace('w')).resolves.toBeUndefined();
    expect(await cache.remember('k', 60, load)).toEqual({ value: 'fresh', hit: false });
    expect(await cache.remember('k', 60, load)).toEqual({ value: 'fresh', hit: false });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('treats a corrupt stored value as a miss', async () => {
    const driver = new MemoryCache();
    await driver.set('k', '{not json', 60);
    const cache = new CacheService(driver);
    expect((await cache.remember('k', 60, async () => 'ok')).hit).toBe(false);
  });
});
