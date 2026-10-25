import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { STATUS_LABEL, type Task, type TaskStatus } from '../../lib/types';
import { SortableCard } from './Card';

export function Column({
  status,
  tasks,
  animate,
  onOpen,
  onMove,
  onCreate,
}: {
  status: TaskStatus;
  /** In display order. */
  tasks: Task[];
  animate: boolean;
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
  onCreate: (status: TaskStatus, title: string) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const headingId = `col-${status}`;
  return (
    <section
      className={`column column--${status.toLowerCase()} ${isOver ? 'is-over' : ''}`}
      aria-labelledby={headingId}
    >
      <header className="column__head">
        <h3 id={headingId}>{STATUS_LABEL[status]}</h3>
        <span className="column__count" aria-label={`${tasks.length} cards`}>
          {tasks.length}
        </span>
      </header>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="column__list">
          {tasks.map((task) => (
            <SortableCard
              key={task.id}
              task={task}
              animate={animate}
              onOpen={onOpen}
              onMove={onMove}
            />
          ))}
          {tasks.length === 0 && <li className="column__empty">Drop a card here</li>}
        </ul>
      </SortableContext>
      <AddCard status={status} onCreate={onCreate} />
    </section>
  );
}

function AddCard({
  status,
  onCreate,
}: {
  status: TaskStatus;
  onCreate: (status: TaskStatus, title: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  // the "+ Add card" button is not on screen while the form is open, so focus goes back to it after closing
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (open) input.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      opener.current?.focus();
    }
  }, [open]);

  const close = () => {
    restoreFocus.current = true;
    setOpen(false);
    setTitle('');
    setProblem(undefined);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await onCreate(status, trimmed);
      setTitle('');
      input.current?.focus();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not add the card');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        ref={opener}
        className="btn btn--small column__add"
        onClick={() => setOpen(true)}
      >
        + Add card
      </button>
    );
  }
  return (
    <form
      className="column__form"
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <label htmlFor={`add-${status}`} className="sr-only">
        New card in {STATUS_LABEL[status]}
      </label>
      <input
        id={`add-${status}`}
        ref={input}
        className="input"
        value={title}
        maxLength={200}
        placeholder="What needs doing?"
        onChange={(event) => setTitle(event.target.value)}
      />
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
      <div className="column__form-actions">
        <button
          type="submit"
          className="btn btn--small btn--primary"
          disabled={busy || !title.trim()}
        >
          Add
        </button>
        <button type="button" className="btn btn--small" onClick={close}>
          Done
        </button>
      </div>
    </form>
  );
}
