import { HttpException } from '@nestjs/common';
import { type ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Request } from 'express';
import { Prisma } from '../generated/prisma/client.js';

export const PAGE_SIZE = 10;

export type FormErrors = Record<string, string>;

interface CleanOptions {
  /** Empty input becomes `null` (clears the column) instead of being dropped. */
  nullable?: string[];
  /** Fields that always arrive as arrays, even when a single value is selected. */
  arrays?: string[];
  /** Checkboxes: absent means false. */
  booleans?: string[];
}

/** Browser forms send '' for empty inputs, a bare string for one selected option and nothing for unchecked boxes. */
export function cleanForm(body: Record<string, unknown>, opts: CleanOptions = {}) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    if (typeof value === 'string' && value.trim() === '') {
      if (opts.nullable?.includes(key)) data[key] = null;
      continue;
    }
    data[key] = typeof value === 'string' ? value.trim() : value;
  }
  for (const key of opts.arrays ?? []) {
    const raw = body?.[key];
    data[key] = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((v) => v !== '');
  }
  for (const key of opts.booleans ?? []) {
    data[key] = body?.[key] === 'on' || body?.[key] === 'true';
  }
  return data;
}

export async function parseForm<T extends object>(
  cls: ClassConstructor<T>,
  body: Record<string, unknown>,
  opts: CleanOptions = {},
) {
  const value = plainToInstance(cls, cleanForm(body, opts));
  const errors: FormErrors = {};
  for (const error of await validate(value, { whitelist: true })) {
    errors[error.property] = Object.values(error.constraints ?? {})[0] ?? 'Invalid value';
  }
  return { value, errors, ok: Object.keys(errors).length === 0 };
}

/** Turns an expected business error into a message for the form banner; anything else is rethrown by the caller. */
export function toFormMessage(error: unknown): string | null {
  if (error instanceof HttpException && error.getStatus() < 500) {
    const response = error.getResponse();
    const message =
      typeof response === 'string' ? response : (response as { message?: unknown }).message;
    return Array.isArray(message) ? message.join(', ') : String(message ?? error.message);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return 'A record with these unique values already exists.';
    if (error.code === 'P2003') return 'A referenced record does not exist or is still in use.';
  }
  return null;
}

const FLASH_MESSAGES: Record<string, string> = {
  created: 'Created successfully.',
  updated: 'Changes saved.',
  deleted: 'Deleted.',
  connected: 'Google Calendar connected. Press “Sync now” to import your events.',
  synced: 'Google Calendar synced.',
  disconnected: 'Google Calendar disconnected and the events it imported were removed.',
};

const PROBLEM_MESSAGES: Record<string, string> = {
  calendar:
    'Google Calendar could not be connected. Allow access to your calendar on the Google screen and try again.',
  'calendar-sync': 'Google Calendar could not be synced. Connect it again or try later.',
};

/** The text after a Google sync: only numbers and known keys go in, so nothing in the URL can inject content. */
export function syncMessage(counts: { events?: number; tasks?: number; tasksNote?: string }) {
  const parts = [`${counts.events ?? 0} events`];
  if (counts.tasks !== undefined) parts.push(`${counts.tasks} tasks`);
  let text = `Google Calendar synced: ${parts.join(' and ')}.`;
  if (counts.tasksNote === 'not-granted') {
    text += ' Google Tasks were not imported: use Connect again and allow access to Google Tasks.';
  } else if (counts.tasksNote === 'unavailable') {
    text += ' Google Tasks could not be read: check that the Google Tasks API is enabled.';
  }
  return text;
}

/** Same idea for errors shown in the red banner. */
export const problemMessage = (key?: string) => (key ? PROBLEM_MESSAGES[key] : undefined);

/** Only known keys map to text, so a crafted `?flash=` can never inject content. */
export const flashMessage = (key?: string) => (key ? FLASH_MESSAGES[key] : undefined);

export function pager(req: Request, total: number, page: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const path = req.originalUrl.split('?')[0];
  const link = (target: number) => {
    const query = new URLSearchParams(req.query as Record<string, string>);
    query.set('page', String(target));
    return `${path}?${query.toString()}`;
  };
  return {
    page,
    pages,
    total,
    hasPrev: page > 1,
    hasNext: page < pages,
    prev: link(page - 1),
    next: link(page + 1),
    from: total ? (page - 1) * PAGE_SIZE + 1 : 0,
    to: Math.min(page * PAGE_SIZE, total),
  };
}

/** `<option>` models for an enum select. */
export function enumOptions(values: readonly string[], current?: string | null) {
  return values.map((value) => ({
    value,
    label: value.toLowerCase().replace(/_/g, ' '),
    selected: value === current,
  }));
}
