import { useState, type FormEvent } from 'react';
import { Dialog, Field } from '../../components/ui';
import { toLocalInput } from '../../lib/calendar';
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '../../lib/types';
import type { TaskPatch } from './useTasks';

/** Edit an existing card, or (without `task`) make a new one in `status`. */
export function TaskDialog({
  task,
  status: initialStatus = 'TODO',
  onClose,
  onSave,
  onDelete,
}: {
  task?: Task;
  status?: TaskStatus;
  onClose: () => void;
  onSave: (patch: TaskPatch & { title: string; status: TaskStatus }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? initialStatus);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'MEDIUM');
  const [due, setDue] = useState(task?.dueDate ? toLocalInput(new Date(task.dueDate)) : '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await action();
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong');
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    void run(() =>
      onSave({
        title: trimmed,
        description: description.trim() || null,
        status,
        priority,
        dueDate: due ? new Date(due).toISOString() : null,
      }),
    );
  };

  return (
    <Dialog
      title={task ? 'Edit card' : 'New card'}
      onClose={onClose}
      wide
      footer={
        confirming ? (
          <>
            <span className="modal__ask">Delete this card for good?</span>
            <button key="keep" type="button" className="btn" onClick={() => setConfirming(false)}>
              Keep it
            </button>
            <button
              key="confirm"
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void run(() => onDelete!())}
            >
              Yes, delete
            </button>
          </>
        ) : (
          <>
            {task && onDelete && (
              <button
                key="delete"
                type="button"
                className="btn btn--danger"
                onClick={() => setConfirming(true)}
              >
                Delete
              </button>
            )}
            <button key="cancel" type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              key="save"
              type="submit"
              form="task-form"
              className="btn btn--primary"
              disabled={busy || !title.trim()}
            >
              {task ? 'Save' : 'Create'}
            </button>
          </>
        )
      }
    >
      <form id="task-form" onSubmit={submit}>
        <Field label="Title" htmlFor="task-title">
          <input
            id="task-title"
            className="input"
            value={title}
            maxLength={200}
            required
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Notes" htmlFor="task-notes">
          <textarea
            id="task-notes"
            className="input"
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <div className="field-row">
          <Field label="Status" htmlFor="task-status">
            <select
              id="task-status"
              className="input"
              value={status}
              onChange={(event) => setStatus(event.target.value as TaskStatus)}
            >
              {TASK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority" htmlFor="task-priority">
            <select
              id="task-priority"
              className="input"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
            >
              {TASK_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABEL[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Due"
          htmlFor="task-due"
          hint="Optional. Cards with a due date also appear in the calendar."
        >
          <input
            id="task-due"
            type="datetime-local"
            className="input"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
        </Field>
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
      </form>
    </Dialog>
  );
}
