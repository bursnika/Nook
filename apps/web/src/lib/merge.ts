import type { CalendarEvent, Task } from './types';

export type ChangeKind = 'created' | 'updated' | 'deleted';

export interface TaskChange {
  kind: ChangeKind;
  taskId: string;
  task: Task | null;
}

export interface EventChange {
  kind: ChangeKind;
  eventId: string;
  event: (Omit<CalendarEvent, 'description'> & { description: string | null }) | null;
}

/** Folds one live task change into the local list. Replays and echoes of known state change nothing. */
export function applyTaskChange(tasks: readonly Task[], change: TaskChange): Task[] {
  if (change.kind === 'deleted') {
    return tasks.some((task) => task.id === change.taskId)
      ? tasks.filter((task) => task.id !== change.taskId)
      : (tasks as Task[]);
  }
  const incoming = change.task;
  if (!incoming) return tasks as Task[];
  const index = tasks.findIndex((task) => task.id === incoming.id);
  if (index < 0) return [...tasks, incoming];
  if (sameTask(tasks[index]!, incoming)) return tasks as Task[];
  return tasks.map((task, i) => (i === index ? incoming : task));
}

function sameTask(a: Task, b: Task): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.dueDate === b.dueDate &&
    a.position === b.position &&
    a.pageId === b.pageId &&
    a.assigneeId === b.assigneeId
  );
}

/** The GraphQL event has no Google fields, so a live update keeps the ones the calendar already knows. */
export function applyEventChange<E extends CalendarEvent>(
  events: readonly E[],
  change: EventChange,
): E[] {
  if (change.kind === 'deleted') return events.filter((event) => event.id !== change.eventId);
  const incoming = change.event;
  if (!incoming) return events as E[];
  const index = events.findIndex((event) => event.id === incoming.id);
  if (index < 0) return [...events, incoming as E];
  return events.map((event, i) => (i === index ? { ...event, ...incoming } : event));
}
