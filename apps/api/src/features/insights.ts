const DAY = 24 * 60 * 60 * 1000;

export const WEEKS = 8;
export const ACTIVITY_DAYS = 84;

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export function weekStart(date: Date): Date {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  return new Date(midnight - sinceMonday * DAY);
}

export function weeklyCompleted(completedAt: Date[], now: Date) {
  const first = weekStart(now).getTime() - (WEEKS - 1) * 7 * DAY;
  const counts = new Array<number>(WEEKS).fill(0);
  for (const date of completedAt) {
    const index = Math.floor((weekStart(date).getTime() - first) / (7 * DAY));
    if (index >= 0 && index < WEEKS) counts[index] += 1;
  }
  return counts.map((completed, i) => ({
    weekStart: dayKey(new Date(first + i * 7 * DAY)),
    completed,
  }));
}

export function activityByDay(timestamps: Date[], now: Date) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const counts = new Map<string, number>();
  for (const date of timestamps) counts.set(dayKey(date), (counts.get(dayKey(date)) ?? 0) + 1);
  return Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
    const date = dayKey(new Date(today - (ACTIVITY_DAYS - 1 - i) * DAY));
    return { date, count: counts.get(date) ?? 0 };
  });
}

export const insightsSince = (now: Date) =>
  new Date(
    Math.min(weekStart(now).getTime() - (WEEKS - 1) * 7 * DAY, now.getTime() - ACTIVITY_DAYS * DAY),
  );
