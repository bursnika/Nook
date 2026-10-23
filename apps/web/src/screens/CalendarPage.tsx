import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorState } from '../components/ui';
import { api } from '../lib/api';
import { track } from '../lib/analytics';
import {
  addMonths,
  dayKey,
  fromDayKey,
  itemsByDay,
  monthStart,
  type DayItem,
} from '../lib/calendar';
import type { EventForm } from '../lib/eventForm';
import { useResource } from '../lib/hooks';
import type { CalendarEvent, GoogleStatus, TaskCard } from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import { DayAgenda } from './calendar/DayAgenda';
import { EventDialog, TaskDialog } from './calendar/EventDialog';
import { GoogleBar } from './calendar/GoogleBar';
import { MonthGrid } from './calendar/MonthGrid';
import { useCalendar } from './calendar/useCalendar';
import '../styles/calendar.css';
import { LOCALE } from '../lib/locale';

type Dialog =
  { kind: 'event'; event?: CalendarEvent; draft?: EventForm } | { kind: 'task'; task: TaskCard };

const NO_GOOGLE = { connected: false, editGranted: false, twoWay: false };

export default function CalendarPage() {
  const { workspace } = useWorkspace();
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [dialog, setDialog] = useState<Dialog>();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const calendar = useCalendar(workspace.id, month);
  const google = useResource(
    () => api<GoogleStatus>(`/workspaces/${workspace.id}/google-calendar`),
    workspace.id,
  );
  const { reload: reloadGoogle } = google;

  // coming back from Google's consent screen
  useEffect(() => {
    const flash = params.get('flash');
    const problem = params.get('problem');
    if (!flash && !problem) return;
    if (flash === 'connected') {
      track('calendar_connected');
      setNotice({
        text: 'Google Calendar is connected. Press “Sync now” to bring your events in.',
      });
      void reloadGoogle();
    } else if (problem === 'calendar') {
      setNotice({
        text: 'Google did not give Nook access to your calendar, so nothing was connected.',
        error: true,
      });
    }
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('flash');
        next.delete('problem');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams, reloadGoogle]);

  const data = calendar.data;
  const days = useMemo(
    () => (data ? itemsByDay(data.events, data.tasks) : new Map<string, DayItem[]>()),
    [data],
  );
  const rights = data?.google ?? NO_GOOGLE;

  const open = (item: DayItem) =>
    setDialog(
      item.kind === 'event'
        ? { kind: 'event', event: item.event }
        : { kind: 'task', task: item.task },
    );

  const go = (to: Date) => {
    setMonth(to);
    const current = fromDayKey(selected);
    if (current.getMonth() !== to.getMonth() || current.getFullYear() !== to.getFullYear()) {
      setSelected(dayKey(to));
    }
  };
  const goToday = () => {
    setMonth(monthStart(new Date()));
    setSelected(dayKey(new Date()));
  };
  const select = (key: string) => {
    setSelected(key);
    const picked = fromDayKey(key);
    if (picked.getMonth() !== month.getMonth()) setMonth(monthStart(picked));
  };

  return (
    <div className="calendar">
      <div className="cal-bar">
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Previous month"
          onClick={() => go(addMonths(month, -1))}
        >
          ◀
        </button>
        <h2 aria-live="polite">
          {month.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })}
        </h2>
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Next month"
          onClick={() => go(addMonths(month, 1))}
        >
          ▶
        </button>
        <button type="button" className="btn btn--small" onClick={goToday}>
          Today
        </button>
        <span className={`live live--${calendar.live}`} role="status">
          {calendar.loading ? 'Loading' : calendar.live === 'live' ? 'Live' : 'Offline'}
        </span>
        <button
          type="button"
          className="btn btn--primary btn--small cal-bar__new"
          onClick={() => setDialog({ kind: 'event' })}
        >
          New event
        </button>
      </div>

      {notice && (
        <p
          className={notice.error ? 'form-error' : 'notice'}
          role={notice.error ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
      {google.data && (
        <GoogleBar
          workspaceId={workspace.id}
          status={google.data}
          onChanged={() => {
            void reloadGoogle();
            void calendar.reload();
          }}
        />
      )}
      {calendar.error && (
        <ErrorState error={calendar.error} onRetry={() => void calendar.reload()} />
      )}

      <div className="cal-layout">
        <MonthGrid month={month} days={days} selected={selected} onSelect={select} onOpen={open} />
        <DayAgenda
          dayKeyValue={selected}
          items={days.get(selected) ?? []}
          google={rights}
          onOpen={open}
          onQuickAdd={(payload, toGoogle) => calendar.save(payload, { google: toGoogle })}
          onMoreOptions={(draft) => setDialog({ kind: 'event', draft })}
        />
      </div>

      {dialog?.kind === 'event' && (
        <EventDialog
          key={dialog.event?.id ?? 'new'}
          event={dialog.event}
          draft={dialog.draft}
          day={fromDayKey(selected)}
          google={rights}
          workspaceId={workspace.id}
          onClose={() => setDialog(undefined)}
          onSave={calendar.save}
          onDelete={calendar.remove}
        />
      )}
      {dialog?.kind === 'task' && (
        <TaskDialog
          task={dialog.task}
          workspaceId={workspace.id}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  );
}
