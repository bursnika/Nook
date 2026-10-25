export const ASSISTANT_RATE_LIMITER = Symbol('ASSISTANT_RATE_LIMITER');

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest request leaves the window (only when not allowed). */
  retryAfterSeconds: number;
}

/**
 * A sliding window in memory: at most `limit` requests per `windowMs` for each key. Fine for one API
 * process; with several instances each one counts on its own (a shared store would be the next step).
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(key: string): RateLimitResult {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000)),
      };
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.sweep(now);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Forgets users who have been quiet for a whole window, so the map cannot grow forever. */
  private sweep(now: number) {
    if (this.hits.size < 1000) return;
    for (const [key, times] of this.hits) {
      if (times.every((at) => now - at >= this.windowMs)) this.hits.delete(key);
    }
  }
}
