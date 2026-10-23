import {
  addMonths,
  dayKey,
  eventDays,
  eventRights,
  fromDayKey,
  gridDays,
  gridRange,
  gridStart,
  itemsByDay,
} from './calendar';
import { makeEvent } from './testing';

describe('month grid', () => {
  it('starts on the Monday before the 1st, and shows six weeks', () => {
    // 1 November 2026 is a Sunday
    const november = new Date(2026, 10, 1);
    expect(dayKey(gridStart(november))).toBe('2026-10-26');
    const days = gridDays(november);
    expect(days).toHaveLength(42);
    expect(dayKey(days[0]!)).toBe('2026-10-26');
    expect(dayKey(days[41]!)).toBe('2026-12-06');
  });

  it('starts on the 1st when the month begins on a Monday', () => {
    // 1 June 2026 is a Monday
    expect(dayKey(gridStart(new Date(2026, 5, 17)))).toBe('2026-06-01');
  });

  it('every row of seven begins on a Monday', () => {
    for (const month of [0, 1, 4, 8, 11]) {
      const days = gridDays(new Date(2026, month, 1));
      for (let week = 0; week < 6; week++) expect(days[week * 7]!.getDay()).toBe(1);
    }
  });

  it('asks the API for a window inside its 100-day limit', () => {
    const { from, to } = gridRange(new Date(2026, 10, 1));
    expect((to.getTime() - from.getTime()) / 86_400_000).toBeLessThanOrEqual(43);
  });

  it('moves between months across a year boundary', () => {
    expect(dayKey(addMonths(new Date(2026, 11, 20), 1))).toBe('2027-01-01');
    expect(dayKey(addMonths(new Date(2026, 0, 20), -1))).toBe('2025-12-01');
  });

  it('round-trips day keys', () => {
    expect(dayKey(fromDayKey('2026-02-28'))).toBe('2026-02-28');
  });
});

describe('eventDays', () => {
  it('puts an all-day event on its UTC dates, the end being exclusive', () => {
    const days = eventDays({
      allDay: true,
      startsAt: '2026-11-03T00:00:00.000Z',
      endsAt: '2026-11-05T00:00:00.000Z',
    });
    expect(days).toEqual(['2026-11-03', '2026-11-04']);
  });

  it('puts a one-day all-day event on one day', () => {
    expect(
      eventDays({
        allDay: true,
        startsAt: '2026-11-03T00:00:00.000Z',
        endsAt: '2026-11-04T00:00:00.000Z',
      }),
    ).toEqual(['2026-11-03']);
  });

  it('spreads a timed event over every local day it touches', () => {
    const start = new Date(2026, 10, 3, 22, 0);
    const end = new Date(2026, 10, 5, 8, 0);
    expect(
      eventDays({ allDay: false, startsAt: start.toISOString(), endsAt: end.toISOString() }),
    ).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
  });

  it('does not spill into the next day when an event ends at midnight', () => {
    const start = new Date(2026, 10, 3, 20, 0);
    const end = new Date(2026, 10, 4, 0, 0);
    expect(
      eventDays({ allDay: false, startsAt: start.toISOString(), endsAt: end.toISOString() }),
    ).toEqual(['2026-11-03']);
  });
});

describe('itemsByDay', () => {
  it('lists events and task deadlines per day, earliest first', () => {
    const early = makeEvent({
      title: 'Early',
      startsAt: new Date(2026, 10, 3, 8, 0).toISOString(),
      endsAt: new Date(2026, 10, 3, 9, 0).toISOString(),
    });
    const late = makeEvent({
      title: 'Late',
      startsAt: new Date(2026, 10, 3, 18, 0).toISOString(),
      endsAt: new Date(2026, 10, 3, 19, 0).toISOString(),
    });
    const task = {
      id: 't1',
      title: 'Deadline',
      status: 'TODO' as const,
      priority: 'HIGH' as const,
      dueDate: new Date(2026, 10, 3, 12, 0).toISOString(),
    };
    const items = itemsByDay([late, early], [task]).get('2026-11-03');
    expect(items?.map((item) => item.title)).toEqual(['Early', 'Deadline', 'Late']);
    expect(items?.map((item) => item.kind)).toEqual(['event', 'task', 'event']);
  });

  it('skips tasks without a due date', () => {
    const task = {
      id: 't',
      title: 'x',
      status: 'TODO' as const,
      priority: 'LOW' as const,
      dueDate: null,
    };
    expect(itemsByDay([], [task]).size).toBe(0);
  });
});

describe('eventRights', () => {
  const google = { twoWay: true, editGranted: true };

  it('lets anyone edit a native event', () => {
    expect(eventRights({ imported: false }, { twoWay: false, editGranted: false })).toEqual({
      edit: true,
    });
  });

  it('explains a read-only Google calendar', () => {
    const rights = eventRights({ imported: true, editable: false, mine: true }, google);
    expect(rights.edit).toBe(false);
    expect(rights.reason).toMatch(/read-only/);
  });

  it('keeps other people’s Google events read-only', () => {
    expect(eventRights({ imported: true, editable: true, mine: false }, google).edit).toBe(false);
  });

  it('needs the Pro plan for two-way editing', () => {
    const rights = eventRights(
      { imported: true, editable: true, mine: true },
      { twoWay: false, editGranted: true },
    );
    expect(rights.edit).toBe(false);
    expect(rights.reason).toMatch(/Pro/);
  });

  it('offers to ask for write permission when only that is missing', () => {
    const rights = eventRights(
      { imported: true, editable: true, mine: true },
      { twoWay: true, editGranted: false },
    );
    expect(rights).toMatchObject({ edit: false, canGrant: true });
  });

  it('allows editing a Google event with every right in place', () => {
    expect(eventRights({ imported: true, editable: true, mine: true }, google).edit).toBe(true);
  });
});
