import { describe, expect, it } from 'vitest';
import { ACTIVITY_DAYS, WEEKS, activityByDay, weekStart, weeklyCompleted } from './insights.js';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('weekStart', () => {
  it('is the Monday at midnight UTC', () => {
    expect(weekStart(at('2026-11-01')).toISOString()).toBe('2026-10-26T00:00:00.000Z'); // Sunday
    expect(weekStart(at('2026-10-26')).toISOString()).toBe('2026-10-26T00:00:00.000Z'); // Monday
    expect(weekStart(at('2026-10-28')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
});

describe('weeklyCompleted', () => {
  const now = at('2026-11-01');

  it('has one bucket per week, oldest first, with empty weeks as zero', () => {
    const weeks = weeklyCompleted([], now);
    expect(weeks).toHaveLength(WEEKS);
    expect(weeks.at(-1)?.weekStart).toBe('2026-10-26');
    expect(weeks[0].weekStart).toBe('2026-09-07');
    expect(weeks.every((w) => w.completed === 0)).toBe(true);
  });

  it('counts a task in the week it was completed and ignores older ones', () => {
    const weeks = weeklyCompleted(
      [at('2026-10-26'), at('2026-11-01'), at('2026-10-20'), at('2026-01-01')],
      now,
    );
    expect(weeks.at(-1)?.completed).toBe(2);
    expect(weeks.at(-2)?.completed).toBe(1);
    expect(weeks.reduce((sum, w) => sum + w.completed, 0)).toBe(3);
  });
});

describe('activityByDay', () => {
  it('lists every day of the window ending today and counts events per day', () => {
    const days = activityByDay(
      [at('2026-11-01'), at('2026-11-01'), at('2026-10-31'), at('2025-01-01')],
      at('2026-11-01'),
    );
    expect(days).toHaveLength(ACTIVITY_DAYS);
    expect(days.at(-1)).toEqual({ date: '2026-11-01', count: 2 });
    expect(days.at(-2)).toEqual({ date: '2026-10-31', count: 1 });
    expect(days.reduce((sum, d) => sum + d.count, 0)).toBe(3);
  });
});
