import { between, fits, STEP } from './position';

describe('between', () => {
  it('numbers an empty column with one step', () => {
    expect(between(null, null)).toBe(STEP);
  });

  it('goes below the last card and above the first one', () => {
    expect(between(2048, null)).toBe(2048 + STEP);
    expect(between(null, 1024)).toBe(1024 - STEP);
  });

  it('lands in the middle of two neighbours', () => {
    expect(between(1024, 2048)).toBe(1536);
    expect(between(0, 1)).toBe(0.5);
  });

  it('stays strictly between neighbours over many insertions at the same spot', () => {
    let prev = 1024;
    const next = 2048;
    for (let i = 0; i < 40; i++) {
      const position = between(prev, next);
      expect(position).toBeGreaterThan(prev);
      expect(position).toBeLessThan(next);
      prev = position;
    }
  });

  it('keeps the order when cards are inserted one after another at the top', () => {
    const positions: number[] = [];
    let first: number | null = null;
    for (let i = 0; i < 5; i++) {
      first = between(null, first);
      positions.unshift(first);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe('fits', () => {
  it('accepts a position between neighbours', () => {
    expect(fits(5, 1, 10)).toBe(true);
    expect(fits(5, null, null)).toBe(true);
  });

  it('rejects one that collides with a neighbour', () => {
    expect(fits(1, 1, 10)).toBe(false);
    expect(fits(10, 1, 10)).toBe(false);
    expect(fits(5, 5, 5)).toBe(false);
  });

  it('notices when float precision has run out', () => {
    const prev = 1;
    const next = 1 + Number.EPSILON;
    expect(fits(between(prev, next), prev, next)).toBe(false);
  });
});
