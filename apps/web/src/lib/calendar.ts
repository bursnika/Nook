import type { CalendarEvent, TaskCard } from './types';

export const DAY_MS = 86_400_000;
export const GRID_DAYS = 42;

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// all-day events are stored as utc midnight
export function utcDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function fromDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function gridStart(month: Date): Date {
  const first = monthStart(month);
  return addDays(first, -((first.getDay() + 6) % 7));
}

export function gridDays(month: Date): Date[] {
  const start = gridStart(month);
  return Array.from({ length: GRID_DAYS }, (_, i) => addDays(start, i));
}

// the api allows at most 100 days
export function gridRange(month: Date): { from: Date; to: Date } {
  const from = gridStart(month);
  return { from, to: addDays(from, GRID_DAYS) };
}

export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toLocalInput(date: Date): string {
  return `${dayKey(date)}T${formatTime(date)}`;
}

export function eventDays(event: Pick<CalendarEvent, 'startsAt' | 'endsAt' | 'allDay'>): string[] {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const keys: string[] = [];
  if (event.allDay) {
    const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    for (
      let t = first;
      (t < end.getTime() || keys.length === 0) && keys.length <= GRID_DAYS;
      t += DAY_MS
    ) {
      keys.push(utcDayKey(new Date(t)));
    }
    return keys;
  }
  // ending exactly at midnight doesn't spill into the next day
  const last = dayKey(new Date(Math.max(start.getTime(), end.getTime() - 1)));
  for (
    let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    dayKey(day) <= last && keys.length <= GRID_DAYS;
    day = addDays(day, 1)
  ) {
    keys.push(dayKey(day));
  }
  return keys;
}

export type DayItem =
  | { kind: 'event'; id: string; title: string; at: number; event: CalendarEvent }
  | { kind: 'task'; id: string; title: string; at: number; task: TaskCard };

export function itemsByDay(
  events: readonly CalendarEvent[],
  tasks: readonly TaskCard[],
): Map<string, DayItem[]> {
  const days = new Map<string, DayItem[]>();
  const put = (key: string, item: DayItem) => {
    const list = days.get(key);
    if (list) list.push(item);
    else days.set(key, [item]);
  };
  for (const event of events) {
    for (const key of eventDays(event)) {
      put(key, {
        kind: 'event',
        id: event.id,
        title: event.title,
        at: new Date(event.startsAt).getTime(),
        event,
      });
    }
  }
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const due = new Date(task.dueDate);
    put(dayKey(due), { kind: 'task', id: task.id, title: task.title, at: due.getTime(), task });
  }
  for (const list of days.values()) list.sort((a, b) => a.at - b.at);
  return days;
}

export interface EventRights {
  edit: boolean;
  reason?: string;
  canGrant?: boolean;
}

export function eventRights(
  event: Pick<CalendarEvent, 'imported' | 'editable' | 'mine'>,
  google: { twoWay: boolean; editGranted: boolean },
): EventRights {
  if (!event.imported) return { edit: true };
  if (!event.editable) {
    return {
      edit: false,
      reason:
        'This calendar is read-only for you in Google Calendar (a holiday or birthday calendar, or one shared with you for viewing).',
    };
  }
  if (!event.mine) {
    return {
      edit: false,
      reason: 'This event came from another person’s Google Calendar, so only they can change it.',
    };
  }
  if (!google.twoWay) {
    return {
      edit: false,
      reason:
        'Changing synced events from Nook is a Pro feature. You can still change it in Google Calendar.',
    };
  }
  if (!google.editGranted) {
    return {
      edit: false,
      reason: 'Nook can only read your Google Calendar so far.',
      canGrant: true,
    };
  }
  return { edit: true };
}
