import { heatLevel, heatmapCells } from './insights';

describe('heatLevel', () => {
  it('is 0 for no activity', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(5, 0)).toBe(0);
  });

  it('grows with the share of the busiest day', () => {
    expect([1, 3, 6, 8, 10].map((count) => heatLevel(count, 10))).toEqual([1, 2, 3, 4, 4]);
  });
});

describe('heatmapCells', () => {
  it('pads the first week so each day sits under its weekday (Monday first)', () => {
    // 2026-11-04 is a Wednesday: two blank cells before it
    const cells = heatmapCells([
      { date: '2026-11-04', count: 2 },
      { date: '2026-11-05', count: 0 },
    ]);
    expect(cells.map((cell) => cell.date)).toEqual([null, null, '2026-11-04', '2026-11-05']);
  });

  it('needs no padding when the period starts on a Monday', () => {
    expect(heatmapCells([{ date: '2026-11-02', count: 1 }])[0]?.date).toBe('2026-11-02');
  });

  it('rates every day against the busiest one', () => {
    const cells = heatmapCells([
      { date: '2026-11-02', count: 4 },
      { date: '2026-11-03', count: 1 },
    ]);
    expect(cells.map((cell) => cell.level)).toEqual([4, 1]);
  });

  it('handles an empty history', () => {
    expect(heatmapCells([])).toEqual([]);
  });
});
