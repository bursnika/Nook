import type { CalendarEvent, Task } from './types';

let counter = 0;

export function makeTask(overrides: Partial<Task> = {}): Task {
  counter += 1;
  return {
    id: `task-${String(counter).padStart(3, '0')}`,
    workspaceId: 'ws-1',
    title: `Task ${counter}`,
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    dueDate: null,
    position: counter * 1024,
    pageId: null,
    assigneeId: null,
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  counter += 1;
  return {
    id: `event-${counter}`,
    title: `Event ${counter}`,
    description: null,
    startsAt: '2026-11-02T09:00:00.000Z',
    endsAt: '2026-11-02T10:00:00.000Z',
    allDay: false,
    ...overrides,
  };
}
