import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useMemo, useState } from 'react';
import { useReducedMotion } from '../../lib/hooks';
import {
  columnsOf,
  dragEnd,
  dragOver,
  findColumn,
  moveToColumn,
  placements,
  type Columns,
  type Placement,
} from '../../lib/kanban';
import { TASK_STATUSES, STATUS_LABEL, type Task, type TaskStatus } from '../../lib/types';
import { CardPreview } from './Card';
import { Column } from './Column';

/** Three columns of cards. Dropping or moving a card reports the new places to save through `onPlace`. */
export function Board({
  tasks,
  onPlace,
  onOpen,
  onCreate,
  announce,
}: {
  tasks: Task[];
  onPlace: (changes: Placement[]) => void;
  onOpen: (task: Task) => void;
  onCreate: (status: TaskStatus, title: string) => Promise<void>;
  announce: (message: string) => void;
}) {
  const reduced = useReducedMotion();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  // while a card is in the air its column changes are only local; they are saved on drop
  const [dragging, setDragging] = useState<{ id: string; columns: Columns }>();
  const columns = dragging?.columns ?? columnsOf(tasks);
  const active = dragging ? byId.get(dragging.id) : undefined;
  /** Names for the screen-reader announcements: a card by its title, a column by its label. */
  const label = (id: string | number) =>
    byId.get(String(id))?.title ?? STATUS_LABEL[String(id) as TaskStatus] ?? 'the board';

  const start = ({ active: item }: DragStartEvent) => {
    setDragging({ id: String(item.id), columns: columnsOf(tasks) });
  };

  const over = ({ active: item, over: target }: DragOverEvent) => {
    if (!target) return;
    const below =
      (item.rect.current.translated?.top ?? 0) > target.rect.top + target.rect.height / 2;
    setDragging((current) =>
      current
        ? {
            ...current,
            columns: dragOver(current.columns, String(item.id), String(target.id), below),
          }
        : current,
    );
  };

  const end = ({ active: item, over: target }: DragEndEvent) => {
    const id = String(item.id);
    const original = columnsOf(tasks);
    let next = dragging?.columns ?? original;
    if (target) next = dragEnd(next, id, String(target.id));
    setDragging(undefined);
    const column = findColumn(next, id);
    const moved = byId.get(id);
    if (!column || !moved) return;
    if (column === moved.status && original[column].indexOf(id) === next[column].indexOf(id))
      return;
    onPlace(placements(next, tasks, id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={start}
      onDragOver={over}
      onDragEnd={end}
      onDragCancel={() => setDragging(undefined)}
      accessibility={{
        announcements: {
          onDragStart: ({ active: item }) => `Picked up ${label(item.id)}.`,
          onDragOver: ({ active: item, over: target }) =>
            target ? `${label(item.id)} is over ${label(target.id)}.` : undefined,
          onDragEnd: ({ active: item, over: target }) =>
            target
              ? `Dropped ${label(item.id)} on ${label(target.id)}.`
              : `${label(item.id)} was dropped outside the board and stays where it was.`,
          onDragCancel: ({ active: item }) =>
            `Move cancelled. ${label(item.id)} is back where it was.`,
        },
        screenReaderInstructions: {
          draggable:
            'To pick up a card, press space or enter on its grip. Use the arrow keys to move it, space to drop it, escape to cancel.',
        },
      }}
    >
      <div className="board">
        {TASK_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            animate={!reduced}
            tasks={columns[status].flatMap((id) => byId.get(id) ?? [])}
            onOpen={onOpen}
            onCreate={onCreate}
            onMove={(task, to) => {
              const changes = moveToColumn(tasks, task.id, to);
              if (changes.length) {
                announce(`Moved ${task.title} to ${STATUS_LABEL[to]}.`);
                onPlace(changes);
              }
            }}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={reduced ? null : undefined}>
        {active ? <CardPreview task={active} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
