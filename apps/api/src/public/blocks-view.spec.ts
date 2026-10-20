import { describe as suite, expect, it } from 'vitest';
import { describe, safeJson, toViewNodes } from './blocks-view.js';

const block = (type: string, text = '', extra: object = {}) => ({
  type,
  content: { text, ...extra },
});

suite('toViewNodes', () => {
  it('maps block types to nodes and keeps unknown ones as paragraphs', () => {
    expect(
      toViewNodes([
        block('HEADING_1', 'Title'),
        block('HEADING_3', 'Small'),
        block('PARAGRAPH', 'Text'),
        block('QUOTE', 'Said'),
        block('CODE', 'a < b'),
        block('DIVIDER'),
        block('SOMETHING_NEW', 'fallback'),
      ]),
    ).toEqual([
      { kind: 'h1', text: 'Title' },
      { kind: 'h3', text: 'Small' },
      { kind: 'p', text: 'Text' },
      { kind: 'quote', text: 'Said' },
      { kind: 'code', text: 'a < b' },
      { kind: 'hr' },
      { kind: 'p', text: 'fallback' },
    ]);
  });

  it('groups consecutive list items and splits groups of different kinds', () => {
    expect(
      toViewNodes([
        block('BULLETED_LIST', 'a'),
        block('BULLETED_LIST', 'b'),
        block('NUMBERED_LIST', 'one'),
        block('BULLETED_LIST', 'c'),
        block('TODO', 'done', { checked: true }),
        block('TODO', 'open'),
      ]),
    ).toEqual([
      { kind: 'ul', items: ['a', 'b'] },
      { kind: 'ol', items: ['one'] },
      { kind: 'ul', items: ['c'] },
      {
        kind: 'todo',
        items: [
          { text: 'done', checked: true },
          { text: 'open', checked: false },
        ],
      },
    ]);
  });

  it('survives content that is not an object', () => {
    expect(toViewNodes([{ type: 'PARAGRAPH', content: null }])).toEqual([{ kind: 'p', text: '' }]);
  });
});

suite('describe', () => {
  it('joins the text and cuts long text at a word', () => {
    expect(describe([block('PARAGRAPH', 'Hello'), block('PARAGRAPH', ' world ')])).toBe(
      'Hello world',
    );
    const long = describe([block('PARAGRAPH', 'word '.repeat(100))], 60);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/wor…$/);
  });
});

suite('safeJson', () => {
  it('never lets the text close the script tag', () => {
    expect(safeJson({ t: '</script><b>' })).not.toContain('<');
    expect(JSON.parse(safeJson({ t: '</script>' }))).toEqual({ t: '</script>' });
  });
});
