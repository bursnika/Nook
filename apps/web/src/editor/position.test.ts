import { between, gapCollapsed, MIN_GAP, positionAt, POSITION_STEP, renormalise } from './position';

describe('between', () => {
  it('uses the API step at the ends of the list', () => {
    expect(between(null, null)).toBe(POSITION_STEP);
    expect(between(undefined, 1024)).toBe(0);
    expect(between(2048, undefined)).toBe(3072);
  });

  it('returns the middle of two neighbours', () => {
    expect(between(1024, 2048)).toBe(1536);
    expect(between(-4, 4)).toBe(0);
  });

  it('keeps splitting a gap many times, always strictly inside it', () => {
    let low = 1024;
    const high = 2048;
    for (let i = 0; i < 30; i += 1) {
      const mid = between(low, high);
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(high);
      low = mid;
    }
  });
});

describe('gapCollapsed / renormalise / positionAt', () => {
  it('detects when there is no room left', () => {
    expect(gapCollapsed(1, 2)).toBe(false);
    expect(gapCollapsed(1, 1 + MIN_GAP / 2)).toBe(true);
    expect(gapCollapsed(1, 1)).toBe(true);
    expect(gapCollapsed(null, 5)).toBe(false);
  });

  it('renumbers a list evenly in its order', () => {
    expect(renormalise([{ id: 'x' }, { id: 'y' }])).toEqual([
      { id: 'x', position: 1024 },
      { id: 'y', position: 2048 },
    ]);
  });

  it('finds the slot among the other blocks and reports collapsed gaps', () => {
    const others = [{ position: 1024 }, { position: 2048 }];
    expect(positionAt(others, 0)).toBe(0);
    expect(positionAt(others, 1)).toBe(1536);
    expect(positionAt(others, 2)).toBe(3072);
    expect(positionAt([{ position: 1 }, { position: 1 }], 1)).toBeNull();
  });
});
