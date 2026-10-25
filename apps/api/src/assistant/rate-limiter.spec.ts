import { SlidingWindowRateLimiter } from './rate-limiter.js';

describe('SlidingWindowRateLimiter', () => {
  it('lets `limit` requests through per window and then refuses with a retry time', () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter(3, 60_000, () => now);
    expect(limiter.tryAcquire('u').allowed).toBe(true);
    now += 10_000;
    expect(limiter.tryAcquire('u').allowed).toBe(true);
    now += 10_000;
    expect(limiter.tryAcquire('u').allowed).toBe(true);
    now += 10_000;
    const refused = limiter.tryAcquire('u');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(30); // the first hit leaves the window in 30 s
  });

  it('slides: old requests stop counting', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(1, 1000, () => now);
    expect(limiter.tryAcquire('u').allowed).toBe(true);
    now = 999;
    expect(limiter.tryAcquire('u').allowed).toBe(false);
    now = 1000;
    expect(limiter.tryAcquire('u').allowed).toBe(true);
  });

  it('counts every key on its own and does not count refused requests', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(1, 1000, () => now);
    expect(limiter.tryAcquire('a').allowed).toBe(true);
    expect(limiter.tryAcquire('b').allowed).toBe(true);
    now = 500;
    expect(limiter.tryAcquire('a').allowed).toBe(false);
    now = 1000; // only the first, allowed, hit counted: the window has moved on
    expect(limiter.tryAcquire('a').allowed).toBe(true);
  });
});
