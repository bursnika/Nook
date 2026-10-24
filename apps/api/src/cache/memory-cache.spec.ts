import { describe, expect, it } from 'vitest';
import { MemoryCache } from './memory-cache.js';

describe('MemoryCache', () => {
  const clock = () => {
    let now = 1_000_000;
    return { now: () => now, advance: (seconds: number) => (now += seconds * 1000) };
  };

  it('stores values until their TTL runs out', async () => {
    const time = clock();
    const cache = new MemoryCache(100, time.now);
    await cache.set('a', '1', 10);
    expect(await cache.get('a')).toBe('1');
    time.advance(9.9);
    expect(await cache.get('a')).toBe('1');
    time.advance(0.2);
    expect(await cache.get('a')).toBeNull();
    expect(cache.size).toBe(0); // the expired entry is dropped when it is read
  });

  it('overwriting a key restarts its TTL', async () => {
    const time = clock();
    const cache = new MemoryCache(100, time.now);
    await cache.set('a', '1', 10);
    time.advance(8);
    await cache.set('a', '2', 10);
    time.advance(8);
    expect(await cache.get('a')).toBe('2');
  });

  it('ignores a TTL of zero or less', async () => {
    const cache = new MemoryCache();
    await cache.set('a', '1', 0);
    expect(await cache.get('a')).toBeNull();
  });

  it('deletes by prefix and nothing else', async () => {
    const cache = new MemoryCache();
    await cache.set('ws:1:tasks:{}', 'a', 60);
    await cache.set('ws:1:pages:{}', 'b', 60);
    await cache.set('ws:10:tasks:{}', 'c', 60); // "ws:1" is a prefix of it, "ws:1:" is not
    await cache.set('ws:2:tasks:{}', 'd', 60);
    await cache.deleteByPrefix('ws:1:');
    expect(await cache.get('ws:1:tasks:{}')).toBeNull();
    expect(await cache.get('ws:1:pages:{}')).toBeNull();
    expect(await cache.get('ws:10:tasks:{}')).toBe('c');
    expect(await cache.get('ws:2:tasks:{}')).toBe('d');
  });

  it('stays bounded: expired entries go first, then the oldest', async () => {
    const time = clock();
    const cache = new MemoryCache(3, time.now);
    await cache.set('old', '1', 1);
    await cache.set('b', '2', 100);
    await cache.set('c', '3', 100);
    time.advance(5); // "old" has expired
    await cache.set('d', '4', 100);
    expect(cache.size).toBe(3);
    expect(await cache.get('old')).toBeNull();

    await cache.set('e', '5', 100); // nothing expired: the oldest ("b") makes room
    expect(cache.size).toBe(3);
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('e')).toBe('5');
  });
});
