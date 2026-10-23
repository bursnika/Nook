import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, Field, Badge } from '../../components/ui';
import { eventRights } from '../../lib/calendar';
import {
  blankForm,
  describeWhen,
  formFromEvent,
  setAllDay,
  toPayload,
  type EventForm,
  type EventPayload,
} from '../../lib/eventForm';
import { ApiError } from '../../lib/api';
import type { CalendarEvent, GoogleRights, TaskCard } from '../../lib/types';
import { PRIORITY_LABEL, STATUS_LABEL } from '../../lib/types';
import { LOCALE } from '../../lib/locale';

export interface EventDialogProps {
  /** Absent when creating. */
  event?: CalendarEvent;
  /** The day a new event starts on. */
  day: Date;
  /** Prefilled values for a new event (from the quick form). */
  draft?: EventForm;
  google: GoogleRights;
  workspaceId: string;
  onClose: () => void;
  onSave: (
    payload: EventPayload,
    options: { existing?: CalendarEvent; google?: boolean },
  ) => Promise<void>;
  onDelete: (event: CalendarEvent) => Promise<void>;
}

const canCreateInGoogle = (google: GoogleRights) => google.twoWay && google.editGranted;

/** An event as a small window: read it, edit it or delete it, depending on what the viewer may do. */
export function EventDialog(props: EventDialogProps) {
  const { event, day, draft, google, workspaceId, onClose, onSave, onDelete } = props;
  const creating = !event;
  const [editing, setEditing] = useState(creating);
  const [confirming, setConfirming] = useState(false);
  const [form, setForm] = useState<EventForm>(() =>
    event ? formFromEvent(event) : (draft ?? blankForm(day)),
  );
  const [toGoogle, setToGoogle] = useState(creating && canCreateInGoogle(google));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const rights = event ? eventRights(event, google) : { edit: true };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await action();
      onClose();
    } catch (error) {
      // 410 means Google no longer has it; the calendar reloads and the event disappears
      if (error instanceof ApiError && error.status === 410) {
        onClose();
        return;
      }
      setProblem(error instanceof Error ? error.message : 'Something went wrong');
      setBusy(false);
    }
  };

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const result = toPayload(form);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    void run(() => onSave(result.value, { existing: event, google: creating && toGoogle }));
  };

  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  if (!editing && event) {
    return (
      <Dialog
        key="view"
        title="Event"
        tone="blue"
        wide
        onClose={onClose}
        footer={
          confirming ? (
            <>
              <span className="modal__ask">
                {event.imported ? 'Delete it from Google Calendar too?' : 'Delete this event?'}
                {event.recurring && event.imported ? ' Only this occurrence goes.' : ''}
              </span>
              <button key="keep" type="button" className="btn" onClick={() => setConfirming(false)}>
                Keep it
              </button>
              <button
                key="confirm"
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void run(() => onDelete(event))}
              >
                Yes, delete
              </button>
            </>
          ) : (
            <>
              {rights.edit && (
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => setConfirming(true)}
                >
                  Delete
                </button>
              )}
              {rights.edit && (
                <button type="button" className="btn btn--primary" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </>
          )
        }
      >
        <h3 className="event-view__title">{event.title}</h3>
        <p className="muted">{describeWhen(event)}</p>
        {event.recurring && (
          <p className="muted">Repeats. Changes apply to this occurrence only.</p>
        )}
        {event.imported && (
          <p>
            <Badge tone="done">{event.calendarName || 'Google Calendar'}</Badge>{' '}
            {event.url && (
              <a href={event.url} target="_blank" rel="noopener noreferrer">
                Open in Google Calendar
              </a>
            )}
          </p>
        )}
        {event.description && <p className="event-view__desc">{event.description}</p>}
        {rights.reason && (
          <p className="notice">
            {rights.reason}{' '}
            {rights.canGrant && (
              <a
                href={`/api/google-calendar/connect?edit=1&returnTo=${encodeURIComponent(`/app/w/${workspaceId}/calendar`)}`}
              >
                Allow editing Google events
              </a>
            )}
          </p>
        )}
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      key="edit"
      title={creating ? 'New event' : event.imported ? 'Edit in Google Calendar' : 'Edit event'}
      tone="blue"
      wide
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => (creating ? onClose() : setEditing(false))}
          >
            Cancel
          </button>
          <button type="submit" form="event-form" className="btn btn--primary" disabled={busy}>
            {event?.imported || (creating && toGoogle) ? 'Save to Google Calendar' : 'Save'}
          </button>
        </>
      }
    >
      <form id="event-form" onSubmit={submit} noValidate>
        <Field label="Title" htmlFor="ev-title">
          <input
            id="ev-title"
            className="input"
            value={form.title}
            maxLength={200}
            required
            autoFocus
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={form.allDay}
            onChange={(e) => setForm((current) => setAllDay(current, e.target.checked))}
          />
          All day
        </label>
        {form.allDay ? (
          <div className="field-row">
            <Field label="First day" htmlFor="ev-first">
              <input
                id="ev-first"
                type="date"
                className="input"
                value={form.firstDay}
                required
                onChange={(e) => set('firstDay', e.target.value)}
              />
            </Field>
            <Field label="Last day" htmlFor="ev-last">
              <input
                id="ev-last"
                type="date"
                className="input"
                value={form.lastDay}
                required
                onChange={(e) => set('lastDay', e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <div className="field-row">
            <Field label="Starts" htmlFor="ev-start">
              <input
                id="ev-start"
                type="datetime-local"
                className="input"
                value={form.startsAt}
                required
                onChange={(e) => set('startsAt', e.target.value)}
              />
            </Field>
            <Field label="Ends" htmlFor="ev-end">
              <input
                id="ev-end"
                type="datetime-local"
                className="input"
                value={form.endsAt}
                required
                onChange={(e) => set('endsAt', e.target.value)}
              />
            </Field>
          </div>
        )}
        <Field label="Description" htmlFor="ev-desc">
          <textarea
            id="ev-desc"
            className="input"
            rows={3}
            maxLength={5000}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
        {event?.recurring && <p className="muted">Repeats. Only this occurrence changes.</p>}
        {creating && canCreateInGoogle(google) && (
          <label className="check">
            <input
              type="checkbox"
              checked={toGoogle}
              onChange={(e) => setToGoogle(e.target.checked)}
            />
            Also add to my Google Calendar
          </label>
        )}
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** A task deadline in the calendar: details and a way back to the board. */
export function TaskDialog({
  task,
  workspaceId,
  onClose,
}: {
  task: TaskCard;
  workspaceId: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Task"
      tone="pink"
      onClose={onClose}
      footer={
        <Link className="btn btn--primary" to={`/w/${workspaceId}/tasks`}>
          Open the board
        </Link>
      }
    >
      <h3 className="event-view__title">{task.title}</h3>
      {task.dueDate && (
        <p className="muted">
          Due{' '}
          {new Date(task.dueDate).toLocaleString(LOCALE, { dateStyle: 'full', timeStyle: 'short' })}
        </p>
      )}
      <p>
        <Badge
          tone={task.status === 'DONE' ? 'done' : task.status === 'IN_PROGRESS' ? 'doing' : 'todo'}
        >
          {STATUS_LABEL[task.status]}
        </Badge>{' '}
        <Badge
          tone={task.priority === 'HIGH' ? 'high' : task.priority === 'MEDIUM' ? 'medium' : 'low'}
        >
          {PRIORITY_LABEL[task.priority]}
        </Badge>
        {task.assignee && <span> Assigned to {task.assignee.name}</span>}
      </p>
    </Dialog>
  );
}
