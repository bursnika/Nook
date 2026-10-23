import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '../../components/ui';
import { formatTime } from '../../lib/calendar';
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_STATUSES,
  type Task,
  type TaskStatus,
} from '../../lib/types';
import { LOCALE } from '../../lib/locale';

export function dueText(task: Task): { text: string; late: boolean } | undefined {
  if (!task.dueDate) return undefined;
  const due = new Date(task.dueDate);
  const hasTime = due.getHours() !== 0 || due.getMinutes() !== 0;
  const text =
    due.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }) +
    (hasTime ? ` ${formatTime(due)}` : '');
  return { text, late: task.status !== 'DONE' && due.getTime() < Date.now() };
}

function CardBody({
  task,
  handle,
  onOpen,
  onMove,
}: {
  task: Task;
  handle?: React.ReactNode;
  onOpen?: (task: Task) => void;
  onMove?: (task: Task, status: TaskStatus) => void;
}) {
  const due = dueText(task);
  const index = TASK_STATUSES.indexOf(task.status);
  const prev = TASK_STATUSES[index - 1];
  const next = TASK_STATUSES[index + 1];
  return (
    <>
      <div className="card__top">
        {handle}
        <button type="button" className="card__title" onClick={() => onOpen?.(task)}>
          {task.title}
        </button>
      </div>
      {task.description && <p className="card__desc">{task.description}</p>}
      <div className="card__meta">
        <Badge
          tone={task.priority === 'HIGH' ? 'high' : task.priority === 'MEDIUM' ? 'medium' : 'low'}
        >
          {PRIORITY_LABEL[task.priority]}
        </Badge>
        {due && (
          <Badge tone={due.late ? 'late' : 'todo'}>
            {due.late ? `Late ${due.text}` : due.text}
          </Badge>
        )}
        <span className="card__moves">
          {prev && (
            <button
              type="button"
              className="card__move"
              aria-label={`Move “${task.title}” to ${STATUS_LABEL[prev]}`}
              onClick={() => onMove?.(task, prev)}
            >
              ◀
            </button>
          )}
          {next && (
            <button
              type="button"
              className="card__move"
              aria-label={`Move “${task.title}” to ${STATUS_LABEL[next]}`}
              onClick={() => onMove?.(task, next)}
            >
              ▶
            </button>
          )}
        </span>
      </div>
    </>
  );
}

/** A card that can be dragged with the pointer from anywhere, or with the keyboard from its handle. */
export function SortableCard({
  task,
  animate,
  onOpen,
  onMove,
}: {
  task: Task;
  animate: boolean;
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, animateLayoutChanges: () => animate });
  return (
    <li
      ref={setNodeRef}
      className={`card card--${task.status.toLowerCase()} ${isDragging ? 'is-dragging' : ''}`}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: animate ? transition : undefined,
      }}
      {...listeners}
    >
      <CardBody
        task={task}
        onOpen={onOpen}
        onMove={onMove}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="card__grip"
            aria-label={`Reorder “${task.title}”. Space to pick up, arrow keys to move, Space to drop.`}
            {...attributes}
          >
            ⋮⋮
          </button>
        }
      />
    </li>
  );
}

/** The copy that follows the pointer while dragging. */
export function CardPreview({ task }: { task: Task }) {
  return (
    <div className={`card card--${task.status.toLowerCase()} card--overlay`}>
      <CardBody
        task={task}
        handle={
          <span className="card__grip" aria-hidden="true">
            ⋮⋮
          </span>
        }
      />
    </div>
  );
}
