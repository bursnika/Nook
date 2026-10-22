import { describe, expect, it } from 'vitest';
import { formatDigest } from './digest.js';

describe('formatDigest', () => {
  it('says so when nothing is planned', () => {
    expect(formatDigest('2030-01-02', [], [])).toContain('Nothing planned');
  });

  it('lists events first, then tasks, with times, priority marks and workspaces', () => {
    const text = formatDigest(
      '2030-01-02',
      [
        {
          title: 'Pay rent',
          priority: 'HIGH',
          dueDate: new Date('2030-01-02T15:30:00Z'),
          workspace: 'Home',
        },
        { title: 'Tidy', priority: 'LOW', dueDate: null, workspace: 'Home' },
      ],
      [
        {
          title: 'Standup',
          startsAt: new Date('2030-01-02T09:05:00Z'),
          allDay: false,
          workspace: 'Work',
        },
        {
          title: 'Holiday',
          startsAt: new Date('2030-01-02T00:00:00Z'),
          allDay: true,
          workspace: 'Work',
        },
      ],
    );
    expect(text.split('\n')).toEqual([
      'Your plan for 2030-01-02',
      '',
      'Events',
      '• 09:05 Standup (Work)',
      '• all day Holiday (Work)',
      '',
      'Tasks',
      '• ❗ Pay rent by 15:30 (Home)',
      '• Tidy (Home)',
    ]);
  });
});
