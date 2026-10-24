import type { CacheDriver } from './cache.driver.js';

interface Entry {
  value: string;
  expiresAt: number;
}

/** In-process cache: the default, and what the tests use. Entries expire lazily when read. */
export class MemoryCache implements CacheDriver {
  readonly name = 'memory';
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxEntries = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    if (ttlSeconds <= 0) return;
    this.entries.delete(key); // re-insert so the Map keeps oldest-written first
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    if (this.entries.size > this.maxEntries) this.evict();
  }

  async deleteByPrefix(prefix: string) {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  async close() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  /** Drops expired entries first, then the oldest ones, until the cache fits again. */
  private evict() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(key);
    }
  }
}
