import { dayKey, gridDays, type DayItem } from '../../lib/calendar';
import { LOCALE } from '../../lib/locale';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PILLS = 3;

export function MonthGrid({
  month,
  days,
  selected,
  onSelect,
  onOpen,
}: {
  month: Date;
  days: Map<string, DayItem[]>;
  selected: string;
  onSelect: (key: string) => void;
  onOpen: (item: DayItem) => void;
}) {
  const today = dayKey(new Date());
  return (
    <div className="cal">
      <ul className="cal__dows" aria-hidden="true">
        {WEEKDAYS.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <ol className="cal__grid">
        {gridDays(month).map((day) => {
          const key = dayKey(day);
          const items = days.get(key) ?? [];
          const classes = [
            'cal__cell',
            day.getMonth() !== month.getMonth() ? 'is-other' : '',
            key === today ? 'is-today' : '',
            key === selected ? 'is-selected' : '',
          ].join(' ');
          return (
            <li key={key} className={classes} onClick={() => onSelect(key)}>
              <button
                type="button"
                className="cal__num"
                aria-pressed={key === selected}
                aria-current={key === today ? 'date' : undefined}
                aria-label={`${day.toLocaleDateString(LOCALE, { dateStyle: 'full' })}, ${items.length === 0 ? 'nothing planned' : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(key);
                }}
              >
                {day.getDate()}
              </button>
              {items.slice(0, MAX_PILLS).map((item) => (
                <button
                  type="button"
                  key={`${item.kind}-${item.id}`}
                  className={`pill pill--${item.kind} ${item.kind === 'task' && item.task.status === 'DONE' ? 'is-done' : ''}`}
                  title={item.title}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(item);
                  }}
                >
                  <span className="sr-only">{item.kind === 'task' ? 'Task: ' : 'Event: '}</span>
                  {item.title}
                </button>
              ))}
              {items.length > MAX_PILLS && (
                <button
                  type="button"
                  className="pill pill--more"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(key);
                  }}
                >
                  +{items.length - MAX_PILLS} more
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
