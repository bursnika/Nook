import { describe, expect, it, vi } from 'vitest';
import { RedisCache, type RedisClientLike } from './redis-cache.js';

function fakeClient() {
  const store = new Map<string, string>();
  const listeners: ((error: Error) => void)[] = [];
  const client = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    // two keys per call; the cursor says "more" until the matching keys run out
    scan: vi.fn(async (_cursor: string, _match: 'MATCH', pattern: string) => {
      const prefix = pattern.slice(0, -1).replace(/\\(.)/g, '$1');
      const keys = [...store.keys()].filter((key) => key.startsWith(prefix));
      return [keys.length > 2 ? '1' : '0', keys.slice(0, 2)] as [string, string[]];
    }),
    unlink: vi.fn(async (...keys: string[]) => {
      for (const key of keys) store.delete(key);
      return keys.length;
    }),
    quit: vi.fn(async () => 'OK'),
    disconnect: vi.fn(),
    on: vi.fn((_event: 'error', listener: (error: Error) => void) => {
      listeners.push(listener);
    }),
  } satisfies RedisClientLike;
  return { client, store, emitError: (error: Error) => listeners.forEach((l) => l(error)) };
}

describe('RedisCache', () => {
  it('stores values under a namespaced key with an expiry in seconds', async () => {
    const { client, store } = fakeClient();
    const cache = new RedisCache(client);
    await cache.set('ws:1:tasks:{}', '{"a":1}', 60);
    expect(client.set).toHaveBeenCalledWith('nook:cache:ws:1:tasks:{}', '{"a":1}', 'EX', 60);
    expect([...store.keys()]).toEqual(['nook:cache:ws:1:tasks:{}']);
    expect(await cache.get('ws:1:tasks:{}')).toBe('{"a":1}');
    expect(await cache.get('missing')).toBeNull();
  });

  it('rounds a fractional TTL up and skips a zero one', async () => {
    const { client } = fakeClient();
    const cache = new RedisCache(client);
    await cache.set('a', '1', 0.4);
    expect(client.set).toHaveBeenCalledWith('nook:cache:a', '1', 'EX', 1);
    client.set.mockClear();
    await cache.set('b', '1', 0);
    expect(client.set).not.toHaveBeenCalled();
  });

  it('deletes by prefix with SCAN + UNLINK across several batches, leaving other keys alone', async () => {
    const { client, store } = fakeClient();
    const cache = new RedisCache(client);
    for (const key of ['ws:1:a', 'ws:1:b', 'ws:1:c', 'ws:1:d', 'ws:1:e', 'ws:2:a', 'ws:10:a']) {
      await cache.set(key, 'x', 60);
    }
    await cache.deleteByPrefix('ws:1:');
    expect([...store.keys()].sort()).toEqual(['nook:cache:ws:10:a', 'nook:cache:ws:2:a']);
    expect(client.scan.mock.calls.length).toBeGreaterThan(1);
    expect(client.scan.mock.calls[0].slice(1, 4)).toEqual(['MATCH', 'nook:cache:ws:1:*', 'COUNT']);
  });

  it('takes glob characters in a prefix literally', async () => {
    const { client } = fakeClient();
    await new RedisCache(client).deleteByPrefix('a*b[c]?');
    expect(client.scan.mock.calls[0][2]).toBe('nook:cache:a\\*b\\[c\\]\\?*');
  });

  it('lets driver failures through (the CacheService turns them into misses)', async () => {
    const { client } = fakeClient();
    client.get.mockRejectedValueOnce(new Error('Connection is closed.'));
    await expect(new RedisCache(client).get('a')).rejects.toThrow('Connection is closed.');
  });

  it('logs connection errors at most once per interval', () => {
    const { client, emitError } = fakeClient();
    let now = 0;
    const cache = new RedisCache(client, () => now);
    const warn = vi.spyOn(
      (cache as unknown as { logger: { warn(message: string): void } }).logger,
      'warn',
    );
    emitError(new Error('ECONNREFUSED'));
    emitError(new Error('ECONNREFUSED'));
    expect(warn).toHaveBeenCalledTimes(1);
    now = 31_000;
    emitError(new Error('ECONNREFUSED'));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('closes politely, and hard when QUIT fails', async () => {
    const { client } = fakeClient();
    await new RedisCache(client).close();
    expect(client.quit).toHaveBeenCalled();
    client.quit.mockRejectedValueOnce(new Error('closed'));
    await new RedisCache(client).close();
    expect(client.disconnect).toHaveBeenCalled();
  });
});
