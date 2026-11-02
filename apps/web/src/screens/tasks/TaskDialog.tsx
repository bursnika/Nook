import { useState, type FormEvent } from 'react';
import { Dialog, Field } from '../../components/ui';
import { toLocalInput } from '../../lib/calendar';
import { useMe } from '../../lib/session';
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Member,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '../../lib/types';
import { Avatar } from './members';
import { TaskComments } from './TaskComments';
import { TaskFiles } from './TaskFiles';
import type { TaskPatch } from './useTasks';
import { stamp } from './when';
import '../../styles/task-view.css';

export function TaskDialog({
  task,
  workspaceId,
  members = [],
  canModerate = false,
  status: initialStatus = 'TODO',
  onClose,
  onSave,
  onDelete,
  onChanged,
}: {
  task?: Task;
  workspaceId: string;
  members?: readonly Member[];
  canModerate?: boolean;
  status?: TaskStatus;
  onClose: () => void;
  onSave: (patch: TaskPatch & { title: string; status: TaskStatus }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onChanged?: () => void;
}) {
  const me = useMe();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? initialStatus);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'MEDIUM');
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? '');
  const [due, setDue] = useState(task?.dueDate ? toLocalInput(new Date(task.dueDate)) : '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const assignee = members.find((member) => member.user.id === assigneeId)?.user;
  const iAmMember = members.some((member) => member.user.id === me.id);

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
        assigneeId: assigneeId || null,
        dueDate: due ? new Date(due).toISOString() : null,
      }),
    );
  };

  return (
    <Dialog
      title={task ? 'Edit card' : 'New card'}
      onClose={onClose}
      size="issue"
      footer={
        confirming ? (
          <>
            <span className="modal__ask">Delete this card with its comments and files?</span>
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
      <div className="issue">
        <form id="task-form" className="issue__main" onSubmit={submit}>
          <label htmlFor="task-title" className="sr-only">
            Title
          </label>
          <input
            id="task-title"
            className="input issue__title"
            value={title}
            maxLength={200}
            required
            autoFocus={!task}
            placeholder="What needs doing?"
            onChange={(event) => setTitle(event.target.value)}
          />
          <Field label="Description" htmlFor="task-description">
            <textarea
              id="task-description"
              className="input"
              rows={4}
              maxLength={5000}
              placeholder="Add a description…"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          {problem && (
            <p className="form-error" role="alert">
              {problem}
            </p>
          )}
        </form>

        <aside className="issue__side" aria-label="Details">
          <Field label="Status" htmlFor="task-status">
            <select
              id="task-status"
              className={`input issue__status issue__status--${status.toLowerCase()}`}
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
          <Field label="Assignee" htmlFor="task-assignee">
            <div className="issue__assignee">
              <Avatar person={assignee} size={28} />
              <select
                id="task-assignee"
                className="input"
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.user.id} value={member.user.id}>
                    {member.user.name}
                  </option>
                ))}
                {/* assignee may have left the workspace */}
                {assigneeId && !assignee && <option value={assigneeId}>Former member</option>}
              </select>
            </div>
            {iAmMember && assigneeId !== me.id && (
              <button type="button" className="link-btn" onClick={() => setAssigneeId(me.id)}>
                Assign to me
              </button>
            )}
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
          <Field
            label="Due date"
            htmlFor="task-due"
            hint="Cards with a due date show in the calendar."
          >
            <input
              id="task-due"
              type="datetime-local"
              className="input"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </Field>
          {task?.createdAt && (
            <dl className="issue__dates">
              <dt>Created</dt>
              <dd>{stamp(task.createdAt)}</dd>
              {task.updatedAt && (
                <>
                  <dt>Updated</dt>
                  <dd>{stamp(task.updatedAt)}</dd>
                </>
              )}
              {task.completedAt && (
                <>
                  <dt>Completed</dt>
                  <dd>{stamp(task.completedAt)}</dd>
                </>
              )}
            </dl>
          )}
        </aside>

        {task ? (
          <div className="issue__activity">
            <TaskFiles workspaceId={workspaceId} taskId={task.id} onChanged={() => onChanged?.()} />
            <TaskComments
              workspaceId={workspaceId}
              taskId={task.id}
              canModerate={canModerate}
              onChanged={() => onChanged?.()}
            />
          </div>
        ) : (
          <p className="muted issue__activity">
            Attachments and comments can be added once the card is created.
          </p>
        )}
      </div>
    </Dialog>
  );
}
