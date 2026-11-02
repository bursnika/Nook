import { arrayMove } from '@dnd-kit/sortable';
import { between, fits, STEP } from './position';
import { TASK_STATUSES, type Task, type TaskStatus } from './types';

export type Columns = Record<TaskStatus, string[]>;

export interface Placement {
  id: string;
  status: TaskStatus;
  position: number;
}

export function columnsOf(tasks: readonly Task[]): Columns {
  const sorted = [...tasks].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const columns: Columns = { TODO: [], IN_PROGRESS: [], ON_HOLD: [], DONE: [] };
  for (const task of sorted) columns[task.status].push(task.id);
  return columns;
}

const isStatus = (id: string): id is TaskStatus =>
  (TASK_STATUSES as readonly string[]).includes(id);

// dropping on an empty column gives the column id itself
export function findColumn(columns: Columns, id: string): TaskStatus | undefined {
  if (isStatus(id)) return id;
  return TASK_STATUSES.find((status) => columns[status].includes(id));
}

export function dragOver(
  columns: Columns,
  activeId: string,
  overId: string,
  isBelowOver: boolean,
): Columns {
  const from = findColumn(columns, activeId);
  const to = findColumn(columns, overId);
  if (!from || !to || from === to) return columns;
  const target = columns[to];
  const overIndex = target.indexOf(overId);
  const index =
    isStatus(overId) || overIndex < 0 ? target.length : overIndex + (isBelowOver ? 1 : 0);
  return {
    ...columns,
    [from]: columns[from].filter((id) => id !== activeId),
    [to]: [...target.slice(0, index), activeId, ...target.slice(index)],
  };
}

export function dragEnd(columns: Columns, activeId: string, overId: string): Columns {
  const from = findColumn(columns, activeId);
  const to = findColumn(columns, overId);
  if (!from || from !== to || isStatus(overId)) return columns;
  const oldIndex = columns[from].indexOf(activeId);
  const newIndex = columns[from].indexOf(overId);
  if (oldIndex === newIndex || newIndex < 0) return columns;
  return { ...columns, [from]: arrayMove(columns[from], oldIndex, newIndex) };
}

export function placements(columns: Columns, tasks: readonly Task[], id: string): Placement[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const status = findColumn(columns, id);
  if (!status || isStatus(id)) return [];
  const ids = columns[status];
  const index = ids.indexOf(id);
  const prev = index > 0 ? (byId.get(ids[index - 1]!)?.position ?? null) : null;
  const next = index < ids.length - 1 ? (byId.get(ids[index + 1]!)?.position ?? null) : null;
  const position = between(prev, next);
  if (fits(position, prev, next)) return [{ id, status, position }];
  return ids.flatMap((taskId, i): Placement[] => {
    const task = byId.get(taskId);
    const wanted = (i + 1) * STEP;
    return task && (task.position !== wanted || task.id === id)
      ? [{ id: taskId, status, position: wanted }]
      : [];
  });
}

export function moveToColumn(tasks: readonly Task[], id: string, status: TaskStatus): Placement[] {
  const columns = columnsOf(tasks);
  const from = findColumn(columns, id);
  if (!from || from === status) return [];
  const moved: Columns = {
    ...columns,
    [from]: columns[from].filter((taskId) => taskId !== id),
    [status]: [...columns[status], id],
  };
  return placements(moved, tasks, id);
}

export function applyPlacements(tasks: readonly Task[], changes: readonly Placement[]): Task[] {
  const byId = new Map(changes.map((change) => [change.id, change]));
  return tasks.map((task) => {
    const change = byId.get(task.id);
    return change ? { ...task, status: change.status, position: change.position } : task;
  });
}

export function endOf(tasks: readonly Task[], status: TaskStatus, ignoreId?: string): number {
  const positions = tasks
    .filter((task) => task.status === status && task.id !== ignoreId)
    .map((task) => task.position);
  return positions.length ? Math.max(...positions) + STEP : STEP;
}
