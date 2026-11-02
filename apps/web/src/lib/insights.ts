import { LOCALE } from './locale';
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const share = count / max;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}

export interface HeatCell {
  date: string | null;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export function heatmapCells(activity: readonly { date: string; count: number }[]): HeatCell[] {
  if (activity.length === 0) return [];
  const max = Math.max(...activity.map((day) => day.count));
  const [year, month, day] = activity[0]!.date.split('-').map(Number) as [number, number, number];
  const mondayFirst = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  const padding: HeatCell[] = Array.from({ length: mondayFirst }, () => ({
    date: null,
    count: 0,
    level: 0,
  }));
  return [
    ...padding,
    ...activity.map((entry) => ({
      date: entry.date,
      count: entry.count,
      level: heatLevel(entry.count, max),
    })),
  ];
}

export function weekLabel(weekStart: string): string {
  const [year, month, day] = weekStart.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
