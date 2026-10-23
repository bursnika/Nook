import { createClient, type Client } from 'graphql-ws';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { EventChange, TaskChange } from './merge';

export type LiveStatus = 'connecting' | 'live' | 'offline';

const TASK_FIELDS =
  'id workspaceId title description status priority dueDate position pageId assigneeId';
const EVENT_FIELDS = 'id workspaceId title description startsAt endsAt allDay';

export const TASK_CHANGED = (workspaceId: string) =>
  `subscription { taskChanged(workspaceId: ${JSON.stringify(workspaceId)}) { kind taskId task { ${TASK_FIELDS} } } }`;
export const EVENT_CHANGED = (workspaceId: string) =>
  `subscription { eventChanged(workspaceId: ${JSON.stringify(workspaceId)}) { kind eventId event { ${EVENT_FIELDS} } } }`;

let client: Client | undefined;
let status: LiveStatus = 'connecting';
let hadConnection = false;
const statusListeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();

function setStatus(next: LiveStatus) {
  if (next === status) return;
  status = next;
  statusListeners.forEach((listener) => listener());
}

/** One socket for the whole app; graphql-ws reconnects it with backoff and resubscribes by itself. */
function getClient(): Client {
  if (client) return client;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  client = createClient({
    url: `${scheme}://${window.location.host}/graphql`,
    // the sign-in cookie travels with the upgrade request
    lazy: true,
    lazyCloseTimeout: 3_000,
    retryAttempts: Infinity,
    shouldRetry: () => true,
    on: {
      connecting: () => setStatus('connecting'),
      connected: () => {
        setStatus('live');
        // after a drop, changes may have been missed: let screens fetch again
        if (hadConnection) reconnectListeners.forEach((listener) => listener());
        hadConnection = true;
      },
      closed: () => setStatus('offline'),
    },
  });
  return client;
}

interface SubscriptionOptions<T> {
  /** Pass false to stay disconnected (no workspace yet). */
  enabled?: boolean;
  onData: (data: T) => void;
  /** The connection came back after a drop: refetch what may have changed meanwhile. */
  onReconnect?: () => void;
}

/** Subscribes while mounted. `query` must be a complete `subscription { ... }` document. */
export function useSubscription<T>(
  field: 'taskChanged' | 'eventChanged',
  query: string,
  { enabled = true, onData, onReconnect }: SubscriptionOptions<T>,
) {
  const latest = useRef({ onData, onReconnect });
  latest.current = { onData, onReconnect };

  useEffect(() => {
    if (!enabled) return;
    const stop = getClient().subscribe<Record<string, T>>(
      { query },
      {
        next: (result) => {
          const data = result.data?.[field];
          if (data) latest.current.onData(data);
        },
        error: () => setStatus('offline'),
        complete: () => undefined,
      },
    );
    const resync = () => latest.current.onReconnect?.();
    reconnectListeners.add(resync);
    return () => {
      reconnectListeners.delete(resync);
      stop();
    };
  }, [enabled, field, query]);

  return useLiveStatus();
}

export const useTaskChanges = (workspaceId: string, options: SubscriptionOptions<TaskChange>) =>
  useSubscription<TaskChange>('taskChanged', TASK_CHANGED(workspaceId), options);

export const useEventChanges = (workspaceId: string, options: SubscriptionOptions<EventChange>) =>
  useSubscription<EventChange>('eventChanged', EVENT_CHANGED(workspaceId), options);

/** Whether the live connection is up, for the small LIVE badge. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (notify) => {
      statusListeners.add(notify);
      return () => statusListeners.delete(notify);
    },
    () => status,
    () => 'connecting',
  );
}
