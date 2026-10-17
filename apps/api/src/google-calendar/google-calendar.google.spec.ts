import { toEvent } from './google-calendar.google.js';

describe('toEvent', () => {
  it('maps a timed event', () => {
    const event = toEvent({
      id: 'a',
      summary: 'Lecture',
      description: 'Room 4',
      start: { dateTime: '2030-05-01T10:00:00+03:00' },
      end: { dateTime: '2030-05-01T11:30:00+03:00' },
    });
    expect(event).toEqual({
      id: 'a',
      title: 'Lecture',
      description: 'Room 4',
      startsAt: new Date('2030-05-01T07:00:00Z'),
      endsAt: new Date('2030-05-01T08:30:00Z'),
      allDay: false,
    });
  });

  it('maps an all-day event to plain UTC dates with an exclusive end', () => {
    const event = toEvent({
      id: 'b',
      summary: 'Holiday',
      start: { date: '2030-05-01' },
      end: { date: '2030-05-03' },
    });
    expect(event).toMatchObject({
      allDay: true,
      startsAt: new Date('2030-05-01T00:00:00Z'),
      endsAt: new Date('2030-05-03T00:00:00Z'),
    });
  });

  it('skips cancelled and incomplete events', () => {
    const when = { dateTime: '2030-05-01T10:00:00Z' };
    expect(toEvent({ id: 'c', status: 'cancelled', start: when, end: when })).toBeNull();
    expect(toEvent({ id: 'c', start: when })).toBeNull();
    expect(toEvent({ id: 'c', start: { dateTime: 'nonsense' }, end: when })).toBeNull();
  });

  it('gives untitled and zero-length events something to show', () => {
    const at = { dateTime: '2030-05-01T10:00:00Z' };
    const event = toEvent({ id: 'd', start: at, end: at });
    expect(event?.title).toBe('(no title)');
    expect(event!.endsAt.getTime() - event!.startsAt.getTime()).toBe(60_000);
  });

  it('shortens very long titles', () => {
    const at = { dateTime: '2030-05-01T10:00:00Z' };
    const end = { dateTime: '2030-05-01T11:00:00Z' };
    expect(toEvent({ id: 'e', summary: 'x'.repeat(500), start: at, end })?.title).toHaveLength(200);
  });
});
