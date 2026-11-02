import { DAY_MS, dayKey, formatTime, toLocalInput, utcDayKey } from './calendar';
import type { CalendarEvent } from './types';
import { LOCALE } from './locale';

export interface EventForm {
  title: string;
  description: string;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  firstDay: string;
  lastDay: string;
}

export interface EventPayload {
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

export function formFromEvent(
  event: Pick<CalendarEvent, 'title' | 'description' | 'startsAt' | 'endsAt' | 'allDay'>,
): EventForm {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  if (event.allDay) {
    // all-day: utc midnight dates, end is exclusive (like google)
    const firstDay = utcDayKey(start);
    const lastDay = utcDayKey(new Date(end.getTime() - DAY_MS));
    return {
      title: event.title,
      description: event.description ?? '',
      allDay: true,
      firstDay,
      lastDay: lastDay < firstDay ? firstDay : lastDay,
      startsAt: `${firstDay}T09:00`,
      endsAt: `${firstDay}T10:00`,
    };
  }
  return {
    title: event.title,
    description: event.description ?? '',
    allDay: false,
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(end),
    firstDay: dayKey(start),
    lastDay: dayKey(new Date(Math.max(start.getTime(), end.getTime() - 1))),
  };
}

export function blankForm(day: Date, title = ''): EventForm {
  const key = dayKey(day);
  return {
    title,
    description: '',
    allDay: false,
    startsAt: `${key}T09:00`,
    endsAt: `${key}T10:00`,
    firstDay: key,
    lastDay: key,
  };
}

export function setAllDay(form: EventForm, allDay: boolean): EventForm {
  if (allDay === form.allDay) return form;
  return allDay
    ? { ...form, allDay, firstDay: form.startsAt.slice(0, 10), lastDay: form.endsAt.slice(0, 10) }
    : {
        ...form,
        allDay,
        startsAt: `${form.firstDay}T09:00`,
        endsAt: `${form.lastDay}T10:00`,
      };
}

export function toPayload(
  form: EventForm,
): { ok: true; value: EventPayload } | { ok: false; error: string } {
  const title = form.title.trim();
  if (!title) return { ok: false, error: 'Give the event a title.' };
  let startsAt: Date;
  let endsAt: Date;
  if (form.allDay) {
    startsAt = new Date(`${form.firstDay}T00:00:00Z`);
    endsAt = new Date(new Date(`${form.lastDay}T00:00:00Z`).getTime() + DAY_MS);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return { ok: false, error: 'Pick the first and the last day.' };
    }
    if (endsAt <= startsAt)
      return { ok: false, error: 'The last day cannot be before the first day.' };
  } else {
    startsAt = new Date(form.startsAt);
    endsAt = new Date(form.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return { ok: false, error: 'Pick when the event starts and ends.' };
    }
    if (endsAt <= startsAt) return { ok: false, error: 'The event must end after it starts.' };
  }
  return {
    ok: true,
    value: {
      title,
      description: form.description.trim() || null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      allDay: form.allDay,
    },
  };
}

export function describeWhen(event: CalendarEvent): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  if (event.allDay) {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    };
    const last = new Date(end.getTime() - DAY_MS);
    const first = start.toLocaleDateString(LOCALE, options);
    return last.getTime() > start.getTime()
      ? `${first} – ${last.toLocaleDateString(LOCALE, options)}`
      : first;
  }
  const long: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  const sameDay = dayKey(start) === dayKey(new Date(Math.max(start.getTime(), end.getTime() - 1)));
  return sameDay
    ? `${start.toLocaleDateString(LOCALE, long)} · ${formatTime(start)} – ${formatTime(end)}`
    : `${start.toLocaleDateString(LOCALE, long)} ${formatTime(start)} – ${end.toLocaleDateString(LOCALE, long)} ${formatTime(end)}`;
}
