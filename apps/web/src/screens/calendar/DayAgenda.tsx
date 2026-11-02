import { useState, type FormEvent } from 'react';
import { Badge } from '../../components/ui';
import { formatTime, fromDayKey, type DayItem } from '../../lib/calendar';
import { blankForm, toPayload, type EventForm, type EventPayload } from '../../lib/eventForm';
import type { CalendarEvent, GoogleRights } from '../../lib/types';
import { LOCALE } from '../../lib/locale';

export function DayAgenda({
  dayKeyValue,
  items,
  google,
  onOpen,
  onQuickAdd,
  onMoreOptions,
}: {
  dayKeyValue: string;
  items: DayItem[];
  google: GoogleRights;
  onOpen: (item: DayItem) => void;
  onQuickAdd: (payload: EventPayload, google: boolean) => Promise<void>;
  onMoreOptions: (draft: EventForm) => void;
}) {
  const day = fromDayKey(dayKeyValue);
  const googleOk = google.twoWay && google.editGranted;
  const [form, setForm] = useState<EventForm>(() => blankForm(day));
  const [toGoogle, setToGoogle] = useState(googleOk);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [formDay, setFormDay] = useState(dayKeyValue);
  if (formDay !== dayKeyValue) {
    setFormDay(dayKeyValue);
    setForm(blankForm(day));
    setProblem(undefined);
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = toPayload(form);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      await onQuickAdd(result.value, googleOk && toGoogle);
      setForm(blankForm(day));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save the event');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="agenda" aria-labelledby="agenda-title">
      <h3 id="agenda-title">{day.toLocaleDateString(LOCALE, { dateStyle: 'full' })}</h3>
      {items.length === 0 ? (
        <p className="muted">Nothing planned for this day.</p>
      ) : (
        <ul className="agenda__list">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="agenda__row">
              {item.kind === 'event' ? (
                <>
                  <Badge tone="doing">Event</Badge>
                  <span className="agenda__when">{eventWhen(item.event)}</span>
                </>
              ) : (
                <>
                  <Badge tone={item.task.priority === 'HIGH' ? 'high' : 'low'}>Task</Badge>
                  <span className="agenda__when">
                    {item.task.dueDate ? formatTime(new Date(item.task.dueDate)) : ''}
                  </span>
                </>
              )}
              <button
                type="button"
                className={`agenda__open ${item.kind === 'task' && item.task.status === 'DONE' ? 'is-done' : ''}`}
                onClick={() => onOpen(item)}
              >
                {item.title}
              </button>
              {item.kind === 'event' && item.event.imported && (
                <Badge tone="done">{item.event.calendarName || 'Google'}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="agenda__form" onSubmit={(event) => void submit(event)} noValidate>
        <label htmlFor="quick-title" className="label">
          New event on this day
        </label>
        <input
          id="quick-title"
          className="input"
          value={form.title}
          maxLength={200}
          placeholder="Title"
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
        <div className="field-row">
          <div>
            <label htmlFor="quick-start" className="label">
              Starts
            </label>
            <input
              id="quick-start"
              type="datetime-local"
              className="input"
              value={form.startsAt}
              onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor="quick-end" className="label">
              Ends
            </label>
            <input
              id="quick-end"
              type="datetime-local"
              className="input"
              value={form.endsAt}
              onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
            />
          </div>
        </div>
        {googleOk && (
          <label className="check">
            <input
              type="checkbox"
              checked={toGoogle}
              onChange={(event) => setToGoogle(event.target.checked)}
            />
            Also add to my Google Calendar
          </label>
        )}
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
        <div className="agenda__actions">
          <button
            type="submit"
            className="btn btn--primary btn--small"
            disabled={busy || !form.title.trim()}
          >
            Add event
          </button>
          <button type="button" className="btn btn--small" onClick={() => onMoreOptions(form)}>
            More options
          </button>
        </div>
      </form>
    </section>
  );
}

function eventWhen(event: CalendarEvent): string {
  return event.allDay
    ? 'All day'
    : `${formatTime(new Date(event.startsAt))}–${formatTime(new Date(event.endsAt))}`;
}
