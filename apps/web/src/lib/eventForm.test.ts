import { blankForm, formFromEvent, setAllDay, toPayload } from './eventForm';

describe('eventForm', () => {
  it('reads an all-day event back as an inclusive date range', () => {
    const form = formFromEvent({
      title: 'Trip',
      description: null,
      allDay: true,
      startsAt: '2026-11-03T00:00:00.000Z',
      endsAt: '2026-11-06T00:00:00.000Z',
    });
    expect(form).toMatchObject({ allDay: true, firstDay: '2026-11-03', lastDay: '2026-11-05' });
  });

  it('writes an all-day range as UTC midnights with an exclusive end', () => {
    const result = toPayload({
      ...blankForm(new Date(2026, 10, 3), 'Trip'),
      allDay: true,
      firstDay: '2026-11-03',
      lastDay: '2026-11-05',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        title: 'Trip',
        description: null,
        allDay: true,
        startsAt: '2026-11-03T00:00:00.000Z',
        endsAt: '2026-11-06T00:00:00.000Z',
      },
    });
  });

  it('rejects an event that ends before it starts', () => {
    const form = {
      ...blankForm(new Date(2026, 10, 3), 'x'),
      startsAt: '2026-11-03T10:00',
      endsAt: '2026-11-03T09:00',
    };
    expect(toPayload(form)).toEqual({ ok: false, error: 'The event must end after it starts.' });
  });

  it('rejects an empty title and a reversed all-day range', () => {
    expect(toPayload(blankForm(new Date(2026, 10, 3), '  ')).ok).toBe(false);
    const reversed = {
      ...blankForm(new Date(2026, 10, 3), 'x'),
      allDay: true,
      firstDay: '2026-11-05',
      lastDay: '2026-11-03',
    };
    expect(toPayload(reversed).ok).toBe(false);
  });

  it('trims the title and turns an empty description into null', () => {
    const result = toPayload({
      ...blankForm(new Date(2026, 10, 3), '  Lunch  '),
      description: '   ',
    });
    expect(result.ok && result.value.title).toBe('Lunch');
    expect(result.ok && result.value.description).toBeNull();
  });

  it('carries the dates over when toggling all day', () => {
    const timed = {
      ...blankForm(new Date(2026, 10, 3), 'x'),
      startsAt: '2026-11-03T14:00',
      endsAt: '2026-11-04T15:00',
    };
    const allDay = setAllDay(timed, true);
    expect(allDay).toMatchObject({ allDay: true, firstDay: '2026-11-03', lastDay: '2026-11-04' });
    expect(setAllDay(allDay, false)).toMatchObject({
      startsAt: '2026-11-03T09:00',
      endsAt: '2026-11-04T10:00',
    });
  });
});
