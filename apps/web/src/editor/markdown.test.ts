import { parseShortcut } from './markdown';

describe('parseShortcut', () => {
  it.each([
    ['# ', 'HEADING_1', ''],
    ['## Title', 'HEADING_2', 'Title'],
    ['### x', 'HEADING_3', 'x'],
    ['- item', 'BULLETED_LIST', 'item'],
    ['* item', 'BULLETED_LIST', 'item'],
    ['1. first', 'NUMBERED_LIST', 'first'],
    ['42. answer', 'NUMBERED_LIST', 'answer'],
    ['> wise words', 'QUOTE', 'wise words'],
    ['```', 'CODE', ''],
    ['---', 'DIVIDER', ''],
  ] as const)('%j becomes %s', (text, type, rest) => {
    expect(parseShortcut(text)).toMatchObject({ type, text: rest });
  });

  it('turns [] and [ ] into an open to-do and [x] into a ticked one', () => {
    expect(parseShortcut('[] buy milk')).toEqual({
      type: 'TODO',
      text: 'buy milk',
      checked: false,
    });
    expect(parseShortcut('[ ] ')).toEqual({ type: 'TODO', text: '', checked: false });
    expect(parseShortcut('[x] done')).toEqual({ type: 'TODO', text: 'done', checked: true });
  });

  it.each([
    '#',
    '#hash',
    '#### four',
    '-',
    '-no space',
    '1.',
    'a - b',
    '--',
    '``',
    'hello',
    '',
    '[]x',
    '>quote',
  ])('leaves %j alone', (text) => {
    expect(parseShortcut(text)).toBeNull();
  });
});
