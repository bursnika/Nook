import { useCallback, useEffect, useRef } from 'react';
import { api, ApiError } from '../../lib/api';
import { dayKey, gridRange } from '../../lib/calendar';
import { useEventChanges, useTaskChanges, type LiveStatus } from '../../lib/graphql';
import { useResource } from '../../lib/hooks';
import { applyEventChange } from '../../lib/merge';
import type { EventPayload } from '../../lib/eventForm';
import type { CalendarData, CalendarEvent } from '../../lib/types';

export interface CalendarApi {
  data: CalendarData | undefined;
  loading: boolean;
  error: Error | undefined;
  live: LiveStatus;
  reload: () => Promise<void>;
  /** Creates (no `existing`) or updates an event; Google events go through the Google routes. */
  save: (
    payload: EventPayload,
    options: { existing?: CalendarEvent; google?: boolean },
  ) => Promise<void>;
  remove: (event: CalendarEvent) => Promise<void>;
}

const eventPath = (workspaceId: string, event: CalendarEvent) =>
  event.imported
    ? `/workspaces/${workspaceId}/google-calendar/events/${event.id}`
    : `/workspaces/${workspaceId}/events/${event.id}`;

/** The month's events and task deadlines, kept fresh by live changes. */
export function useCalendar(workspaceId: string, month: Date): CalendarApi {
  const { from, to } = gridRange(month);
  const resource = useResource<CalendarData>(
    () =>
      api<CalendarData>(
        `/workspaces/${workspaceId}/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      ),
    `${workspaceId}:${dayKey(month)}`,
  );
  const { reload, setData } = resource;

  // changes that add things (or move task deadlines) are simplest to take from the server, in one go
  const timer = useRef<number | undefined>(undefined);
  const refreshSoon = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void reload(), 300);
  }, [reload]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const live = useEventChanges(workspaceId, {
    onData: (change) => {
      if (change.kind === 'created') refreshSoon();
      else {
        setData((current) =>
          current ? { ...current, events: applyEventChange(current.events, change) } : current,
        );
      }
    },
    onReconnect: () => void reload(),
  });
  useTaskChanges(workspaceId, { onData: refreshSoon, onReconnect: () => void reload() });

  const save = useCallback<CalendarApi['save']>(
    async (payload, { existing, google }) => {
      if (existing) {
        await api(eventPath(workspaceId, existing), { method: 'PATCH', json: payload });
      } else {
        await api(
          google
            ? `/workspaces/${workspaceId}/google-calendar/events`
            : `/workspaces/${workspaceId}/events`,
          { method: 'POST', json: payload },
        );
      }
      await reload();
    },
    [workspaceId, reload],
  );

  const remove = useCallback<CalendarApi['remove']>(
    async (event) => {
      try {
        await api(eventPath(workspaceId, event), { method: 'DELETE' });
      } catch (error) {
        // 410: it is already gone in Google, so there is nothing left to delete here either
        if (!(error instanceof ApiError && error.status === 410)) throw error;
      }
      await reload();
    },
    [workspaceId, reload],
  );

  return {
    data: resource.data,
    loading: resource.loading,
    error: resource.error,
    live,
    reload,
    save,
    remove,
  };
}
