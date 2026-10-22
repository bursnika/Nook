import { describe, expect, it } from 'vitest';
import { dayBounds, dayOf } from './today.js';

describe('days', () => {
  it('uses UTC days', () => {
    expect(dayOf(new Date('2030-01-02T23:59:59Z'))).toBe('2030-01-02');
    expect(dayBounds('2030-01-02').from.toISOString()).toBe('2030-01-02T00:00:00.000Z');
    expect(dayBounds('2030-01-02').to.toISOString()).toBe('2030-01-02T23:59:59.999Z');
  });
});
