import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, LoadingState, Window, Badge, EmptyState } from '../components/ui';
import { api } from '../lib/api';
import { track } from '../lib/analytics';
import { dayKey, formatTime, gridDays, gridRange, itemsByDay, monthStart } from '../lib/calendar';
import { useResource } from '../lib/hooks';
import { useMe } from '../lib/session';
import type { CalendarData, Overview, TaskCard } from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import '../styles/home.css';
import { LOCALE } from '../lib/locale';

function greeting(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function dueLabel(task: TaskCard): string {
  if (!task.dueDate) return '';
  const due = new Date(task.dueDate);
  const sameDay = dayKey(due) === dayKey(new Date());
  return sameDay
    ? formatTime(due)
    : due.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }) + ' ' + formatTime(due);
}

export default function HomePage() {
  const { workspace } = useWorkspace();
  const me = useMe();
  const overview = useResource(
    () => api<Overview>(`/workspaces/${workspace.id}/overview`),
    workspace.id,
  );
  const { data, setData, reload } = overview;

  if (overview.loading) return <LoadingState label="Setting up your desktop" />;
  if (overview.error || !data) {
    return (
      <ErrorState error={overview.error ?? new Error('No data')} onRetry={() => void reload()} />
    );
  }

  const complete = async (task: TaskCard) => {
    const without = (list: TaskCard[]) => list.filter((item) => item.id !== task.id);
    setData({
      ...data,
      dueSoon: without(data.dueSoon),
      priority: without(data.priority),
      openTasks: without(data.openTasks),
      openTotal: Math.max(0, data.openTotal - 1),
    });
    try {
      await api(`/workspaces/${workspace.id}/tasks/${task.id}`, {
        method: 'PATCH',
        json: { status: 'DONE' },
      });
      track('task_completed', { source: 'home' });
    } catch {
      /* reload below restores the state */
    }
    void reload();
  };

  const today = new Date();
  const base = `/w/${workspace.id}`;
  const nothing = data.dueSoon.length === 0 && data.upcomingEvents.length === 0;

  return (
    <div className="home">
      <header className="home__hello">
        <p className="label">
          {today.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h2>
          {greeting(today.getHours())}, {me.name.split(' ')[0] || 'friend'}
        </h2>
        <p className="muted">
          {data.openTotal === 0
            ? 'No open tasks. Enjoy the quiet.'
            : `${data.openTotal} open ${data.openTotal === 1 ? 'task' : 'tasks'} across the workspace.`}
        </p>
      </header>

      <div className="home__grid">
        <Window title="Today.exe" icon="tasks" className="home__widget home__widget--wide">
          <div className="window__content home__body">
            <p className="label">Next {data.dueSoonHours} hours</p>
            {nothing ? (
              <p className="muted">Nothing is due and nothing is scheduled. A free day.</p>
            ) : (
              <ul className="plain-list">
                {data.dueSoon.map((task) => (
                  <li key={task.id}>
                    <label className="task">
                      <input type="checkbox" checked={false} onChange={() => void complete(task)} />
                      <span>
                        <span className="sr-only">Mark as done: </span>
                        {task.title}
                      </span>
                      <span className="task__when">{dueLabel(task)}</span>
                      {task.isOverdue && <Badge tone="late">Overdue</Badge>}
                    </label>
                  </li>
                ))}
                {data.upcomingEvents.map((event) => (
                  <li key={event.id} className="event-row">
                    <span className="event-row__time">
                      {formatTime(new Date(event.startsAt))}–{formatTime(new Date(event.endsAt))}
                    </span>
                    <span>{event.title}</span>
                    {event.isRunning && <Badge tone="doing">Now</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Window>

        <Window title="Priority" icon="sparkle" tone="blue" className="home__widget">
          <div className="window__content home__body">
            {data.priority.length === 0 ? (
              <p className="muted">No high-priority tasks open.</p>
            ) : (
              <ul className="plain-list">
                {data.priority.map((task) => (
                  <li key={task.id}>
                    <label className="task">
                      <input type="checkbox" checked={false} onChange={() => void complete(task)} />
                      <span>
                        <span className="sr-only">Mark as done: </span>
                        {task.title}
                      </span>
                      {task.isOverdue && <Badge tone="late">Overdue</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p>
              <Link to={`${base}/tasks`}>Open the board</Link>
            </p>
          </div>
        </Window>

        <QuickNote onSaved={() => void reload()} />

        <MiniCalendar />

        <Window title="Recent pages" icon="folder" tone="lavender" className="home__widget">
          <div className="window__content home__body">
            {data.recentPages.length === 0 ? (
              <EmptyState title="No pages yet" icon="page">
                Write a quick note, or create a page from the sidebar.
              </EmptyState>
            ) : (
              <ul className="plain-list">
                {data.recentPages.map((page) => (
                  <li key={page.id}>
                    <Link to={`${base}/pages/${page.id}`} className="page-link">
                      <span aria-hidden="true">{page.icon || '▫'}</span>
                      {page.title || 'Untitled'}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Window>
      </div>
    </div>
  );
}

function QuickNote({ onSaved }: { onSaved: () => void }) {
  const { workspace, createPage } = useWorkspace();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ id: string; title: string }>();
  const [problem, setProblem] = useState<string>();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const title = lines[0]!.slice(0, 60);
      const page = await createPage({ title });
      for (const line of lines) {
        await api(`/workspaces/${workspace.id}/pages/${page.id}/blocks`, {
          method: 'POST',
          json: { type: 'PARAGRAPH', content: { text: line } },
        });
      }
      setSaved({ id: page.id, title });
      setText('');
      onSaved();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save the note');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Window title="Quick note" icon="page" tone="lavender" className="home__widget">
      <form className="window__content home__body" onSubmit={(event) => void save(event)}>
        <label htmlFor="quick-note" className="label">
          Jot something down
        </label>
        <textarea
          id="quick-note"
          className="input home__note"
          rows={4}
          value={text}
          maxLength={4000}
          placeholder="The first line becomes the title"
          onChange={(event) => setText(event.target.value)}
        />
        <div className="home__note-actions">
          <button type="submit" className="btn btn--primary" disabled={busy || !text.trim()}>
            {busy ? 'Saving…' : 'Save as page'}
          </button>
          {saved && (
            <span role="status">
              Saved. <Link to={`/w/${workspace.id}/pages/${saved.id}`}>Open “{saved.title}”</Link>
            </span>
          )}
        </div>
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
      </form>
    </Window>
  );
}

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function MiniCalendar() {
  const { workspace } = useWorkspace();
  const month = monthStart(new Date());
  const range = gridRange(month);
  const calendar = useResource(
    () =>
      api<CalendarData>(
        `/workspaces/${workspace.id}/calendar?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
      ),
    `${workspace.id}:${dayKey(month)}`,
  );
  const busy = calendar.data ? itemsByDay(calendar.data.events, calendar.data.tasks) : new Map();
  const todayKey = dayKey(new Date());

  return (
    <Window title="Calendar" icon="calendar" tone="blue" className="home__widget">
      <div className="window__content home__body">
        <p className="label">
          <Link to={`/w/${workspace.id}/calendar`} className="mini-cal__link">
            {month.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })} · open calendar
          </Link>
        </p>
        <div className="mini-cal" role="grid" aria-label="This month">
          <div role="row" className="mini-cal__row">
            {DOW.map((name) => (
              <span key={name} role="columnheader" className="mini-cal__dow">
                {name}
              </span>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, week) => (
            <div role="row" className="mini-cal__row" key={week}>
              {gridDays(month)
                .slice(week * 7, week * 7 + 7)
                .map((day) => {
                  const key = dayKey(day);
                  const classes = [
                    'mini-cal__day',
                    day.getMonth() !== month.getMonth() ? 'is-other' : '',
                    busy.has(key) ? 'has-items' : '',
                    key === todayKey ? 'is-today' : '',
                  ].join(' ');
                  return (
                    <span
                      key={key}
                      role="gridcell"
                      className={classes}
                      aria-current={key === todayKey ? 'date' : undefined}
                      aria-label={`${day.toLocaleDateString(LOCALE, { dateStyle: 'full' })}${busy.has(key) ? `, ${busy.get(key)?.length} items` : ''}`}
                    >
                      {day.getDate()}
                    </span>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </Window>
  );
}
