import { useCallback, useRef } from 'react';
import { api, apiAll } from '../../lib/api';
import { track } from '../../lib/analytics';
import { useTaskChanges, type LiveStatus } from '../../lib/graphql';
import { applyPlacements, type Placement } from '../../lib/kanban';
import { useResource } from '../../lib/hooks';
import { applyTaskChange } from '../../lib/merge';
import type { Task, TaskPriority, TaskStatus } from '../../lib/types';

export interface TaskPatch {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeId?: string | null;
  position?: number;
}

export interface TasksApi {
  tasks: Task[];
  loading: boolean;
  error: Error | undefined;
  live: LiveStatus;
  reload: () => Promise<void>;
  create: (draft: { title: string; status: TaskStatus } & TaskPatch) => Promise<void>;
  patch: (id: string, patch: TaskPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  place: (changes: readonly Placement[]) => Promise<void>;
  /** Reads one task again, e.g. after its comments or files changed. */
  refresh: (id: string) => Promise<void>;
}

/**
 * The tasks of a workspace, kept in sync with the server: writes are applied at once and confirmed or rolled
 * back, and live changes from other people are merged in. While one of our own writes to a task is in flight,
 * live echoes of that task are ignored so a card never jumps back and forth.
 */
export function useTasks(workspaceId: string): TasksApi {
  const list = useResource<Task[]>(
    () => apiAll<Task>(`/workspaces/${workspaceId}/tasks`),
    workspaceId,
  );
  const { setData, reload } = list;
  const inFlight = useRef(new Map<string, number>());
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = list.data ?? [];
  const base = `/workspaces/${workspaceId}/tasks`;

  const busy = (id: string, delta: 1 | -1) => {
    const next = (inFlight.current.get(id) ?? 0) + delta;
    if (next <= 0) inFlight.current.delete(id);
    else inFlight.current.set(id, next);
  };

  const live = useTaskChanges(workspaceId, {
    onData: (change) => {
      if (change.kind === 'updated' && inFlight.current.has(change.taskId)) return;
      setData((current) => (current ? applyTaskChange(current, change) : current));
    },
    onReconnect: () => void reload(),
  });

  const create = useCallback<TasksApi['create']>(
    async (draft) => {
      const task = await api<Task>(base, { method: 'POST', json: draft });
      setData((current) =>
        current ? applyTaskChange(current, { kind: 'created', taskId: task.id, task }) : current,
      );
    },
    [base, setData],
  );

  const write = useCallback(
    async (
      id: string,
      optimistic: (tasks: Task[]) => Task[],
      request: () => Promise<Task | void>,
    ) => {
      busy(id, 1);
      setData((current) => (current ? optimistic(current) : current));
      try {
        const saved = await request();
        if (saved) {
          setData((current) =>
            current
              ? applyTaskChange(current, { kind: 'updated', taskId: id, task: saved })
              : current,
          );
        }
      } catch (error) {
        void reload();
        throw error;
      } finally {
        busy(id, -1);
      }
    },
    [reload, setData],
  );

  const patch = useCallback<TasksApi['patch']>(
    (id, changes) => {
      const was = tasksRef.current.find((task) => task.id === id);
      return write(
        id,
        (tasks) => tasks.map((task) => (task.id === id ? { ...task, ...changes } : task)),
        () => api<Task>(`${base}/${id}`, { method: 'PATCH', json: changes }),
      ).then(() => {
        if (changes.status === 'DONE' && was?.status !== 'DONE') {
          track('task_completed', { source: 'board' });
        }
      });
    },
    [base, write],
  );

  const remove = useCallback<TasksApi['remove']>(
    (id) =>
      write(
        id,
        (tasks) => tasks.filter((task) => task.id !== id),
        () => api<void>(`${base}/${id}`, { method: 'DELETE' }),
      ),
    [base, write],
  );

  const place = useCallback<TasksApi['place']>(
    async (changes) => {
      const movedFrom = changes[0] && tasksRef.current.find((task) => task.id === changes[0]!.id);
      await Promise.all(
        changes.map((change) =>
          write(
            change.id,
            (tasks) => applyPlacements(tasks, [change]),
            () =>
              api<Task>(`${base}/${change.id}`, {
                method: 'PATCH',
                json: { status: change.status, position: change.position },
              }),
          ),
        ),
      );
      if (changes[0]?.status === 'DONE' && movedFrom && movedFrom.status !== 'DONE') {
        track('task_completed', { source: 'board' });
      }
    },
    [base, write],
  );

  const refresh = useCallback<TasksApi['refresh']>(
    async (id) => {
      const task = await api<Task>(`${base}/${id}`);
      setData((current) =>
        current ? applyTaskChange(current, { kind: 'updated', taskId: id, task }) : current,
      );
    },
    [base, setData],
  );

  return {
    tasks: list.data ?? [],
    loading: list.loading,
    error: list.error,
    live,
    reload,
    create,
    patch,
    remove,
    place,
    refresh,
  };
}
