import { describe, expect, it } from 'vitest';
import { BlockType } from '../generated/prisma/enums.js';
import {
  blocksToMarkdown,
  clampTitle,
  markdownToBlocks,
  slugify,
  type MarkdownBlock,
} from './markdown.js';

const block = (type: BlockType, text: string, extra: object = {}) => ({
  type,
  content: { text, ...extra },
});

describe('blocksToMarkdown', () => {
  it('writes the title as a heading and every block type in its Markdown form', () => {
    const md = blocksToMarkdown('Plan', [
      block(BlockType.HEADING_1, 'One'),
      block(BlockType.HEADING_2, 'Two'),
      block(BlockType.HEADING_3, 'Three'),
      block(BlockType.PARAGRAPH, 'Just text'),
      block(BlockType.BULLETED_LIST, 'a'),
      block(BlockType.BULLETED_LIST, 'b'),
      block(BlockType.TODO, 'open', { checked: false }),
      block(BlockType.TODO, 'done', { checked: true }),
      block(BlockType.QUOTE, 'wise words'),
      block(BlockType.DIVIDER, ''),
      block(BlockType.CODE, 'const x = 1;', { language: 'ts' }),
    ]);
    expect(md).toBe(
      [
        '# Plan',
        '',
        '# One',
        '',
        '## Two',
        '',
        '### Three',
        '',
        'Just text',
        '',
        '- a',
        '- b',
        '',
        '- [ ] open',
        '- [x] done',
        '',
        '> wise words',
        '',
        '---',
        '',
        '```ts',
        'const x = 1;',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('numbers list items again from 1 in every run', () => {
    const md = blocksToMarkdown('N', [
      block(BlockType.NUMBERED_LIST, 'a'),
      block(BlockType.NUMBERED_LIST, 'b'),
      block(BlockType.PARAGRAPH, 'break'),
      block(BlockType.NUMBERED_LIST, 'c'),
      block(BlockType.BULLETED_LIST, 'x'),
      block(BlockType.NUMBERED_LIST, 'd'),
    ]);
    expect(md).toContain('1. a\n2. b\n\nbreak\n\n1. c\n\n- x\n\n1. d\n');
  });

  it('keeps unusual input well-formed: empty blocks, multi-line text, backticks in code', () => {
    const md = blocksToMarkdown('  ', [
      block(BlockType.PARAGRAPH, ''),
      block(BlockType.HEADING_2, ''),
      block(BlockType.BULLETED_LIST, 'two\nlines'),
      block(BlockType.BULLETED_LIST, ''),
      block(BlockType.QUOTE, 'a\nb'),
      block(BlockType.CODE, 'before\n```\nafter'),
    ]);
    expect(md).toBe(
      [
        '# Untitled',
        '',
        '- two lines',
        '-',
        '',
        '> a',
        '> b',
        '',
        '````',
        'before',
        '```',
        'after',
        '````',
        '',
      ].join('\n'),
    );
  });

  it('treats blocks with a missing or odd content as empty', () => {
    const md = blocksToMarkdown('T', [
      { type: BlockType.PARAGRAPH, content: null },
      { type: BlockType.BULLETED_LIST, content: { text: 5 } },
      { type: 'SOMETHING_NEW', content: { text: 'future block' } },
    ]);
    expect(md).toBe('# T\n\n-\n\nfuture block\n');
  });
});

describe('markdownToBlocks', () => {
  const types = (blocks: MarkdownBlock[]) => blocks.map((b) => b.type);

  it('lifts a leading # line out as the title', () => {
    const { title, blocks } = markdownToBlocks('# My page\n\nHello\n');
    expect(title).toBe('My page');
    expect(blocks).toEqual([block(BlockType.PARAGRAPH, 'Hello')]);
  });

  it('keeps every # line as a block when the caller already has a title', () => {
    const { title, blocks } = markdownToBlocks('# Heading\n\ntext', { liftTitle: false });
    expect(title).toBeUndefined();
    expect(blocks[0]).toEqual(block(BlockType.HEADING_1, 'Heading'));
  });

  it('does not take a # line in the middle, a deeper heading or later # lines as the title', () => {
    expect(markdownToBlocks('intro\n\n# Later').title).toBeUndefined();
    expect(markdownToBlocks('## Not a title').title).toBeUndefined();
    const second = markdownToBlocks('# First\n# Second');
    expect(second.title).toBe('First');
    expect(second.blocks).toEqual([block(BlockType.HEADING_1, 'Second')]);
  });

  it('recognises every construct', () => {
    const { blocks } = markdownToBlocks(
      [
        '## Two',
        '### Three',
        '###### Six',
        '- bullet',
        '* star',
        '+ plus',
        '1. one',
        '2) two',
        '- [ ] todo',
        '- [x] done',
        '- [X] DONE',
        '> quote',
        '---',
        '***',
        '- - -',
        '```js',
        'let a = 1;',
        '```',
        'plain',
      ].join('\n'),
    );
    expect(blocks).toEqual([
      block(BlockType.HEADING_2, 'Two'),
      block(BlockType.HEADING_3, 'Three'),
      block(BlockType.HEADING_3, 'Six'),
      block(BlockType.BULLETED_LIST, 'bullet'),
      block(BlockType.BULLETED_LIST, 'star'),
      block(BlockType.BULLETED_LIST, 'plus'),
      block(BlockType.NUMBERED_LIST, 'one'),
      block(BlockType.NUMBERED_LIST, 'two'),
      block(BlockType.TODO, 'todo', { checked: false }),
      block(BlockType.TODO, 'done', { checked: true }),
      block(BlockType.TODO, 'DONE', { checked: true }),
      block(BlockType.QUOTE, 'quote'),
      block(BlockType.DIVIDER, ''),
      block(BlockType.DIVIDER, ''),
      block(BlockType.DIVIDER, ''),
      block(BlockType.CODE, 'let a = 1;', { language: 'js' }),
      block(BlockType.PARAGRAPH, 'plain'),
    ]);
  });

  it('keeps fenced code as one block, whatever looks like Markdown inside', () => {
    const { blocks } = markdownToBlocks('~~~\n# not a heading\n- not a list\n\n> nor a quote\n~~~');
    expect(blocks).toEqual([
      block(BlockType.CODE, '# not a heading\n- not a list\n\n> nor a quote'),
    ]);
  });

  it('closes a fence only with an equal or longer one, and tolerates a missing closing fence', () => {
    expect(markdownToBlocks('````\n```\nstill code\n````\nafter').blocks).toEqual([
      block(BlockType.CODE, '```\nstill code'),
      block(BlockType.PARAGRAPH, 'after'),
    ]);
    expect(markdownToBlocks('```\nnever closed\n- x').blocks).toEqual([
      block(BlockType.CODE, 'never closed\n- x'),
    ]);
  });

  it('turns unknown constructs into paragraphs instead of failing', () => {
    const { blocks } = markdownToBlocks(
      '| a | b |\n|---|---|\n| 1 | 2 |\n\n![img](x.png)\n\n<div>html</div>\n\n[link]: http://x',
    );
    expect(types(blocks).filter((type) => type !== BlockType.PARAGRAPH)).toEqual([]);
    expect(blocks.map((b) => b.content.text)).toContain('![img](x.png)');
    expect(blocks.map((b) => b.content.text)).toContain('<div>html</div>');
  });

  it('joins consecutive plain lines into one paragraph and splits at blank lines', () => {
    const { blocks } = markdownToBlocks('one\ntwo\n\nthree');
    expect(blocks).toEqual([
      block(BlockType.PARAGRAPH, 'one\ntwo'),
      block(BlockType.PARAGRAPH, 'three'),
    ]);
  });

  it('groups consecutive quote lines, and flattens list nesting', () => {
    const { blocks } = markdownToBlocks('> a\n> b\n\n> c\n\n- top\n  - nested\n    - deeper');
    expect(blocks).toEqual([
      block(BlockType.QUOTE, 'a\nb'),
      block(BlockType.QUOTE, 'c'),
      block(BlockType.BULLETED_LIST, 'top'),
      block(BlockType.BULLETED_LIST, 'nested'),
      block(BlockType.BULLETED_LIST, 'deeper'),
    ]);
  });

  it('handles Windows line endings, a BOM and empty input', () => {
    expect(markdownToBlocks('\uFEFF# T\r\n\r\n- a\r\n- b\r\n').blocks).toHaveLength(2);
    expect(markdownToBlocks('\uFEFF# T\r\n').title).toBe('T');
    expect(markdownToBlocks('')).toEqual({ title: undefined, blocks: [] });
    expect(markdownToBlocks('\n\n  \n')).toEqual({ title: undefined, blocks: [] });
  });

  it('keeps text that merely contains Markdown characters', () => {
    const { blocks } = markdownToBlocks('2024-01-01 is a date\n\n*not bold\n\n#hashtag\n\n-dash');
    expect(types(blocks)).toEqual(Array(4).fill(BlockType.PARAGRAPH));
  });

  it('allows empty list items and todos', () => {
    expect(markdownToBlocks('-\n1.\n- [ ]').blocks).toEqual([
      block(BlockType.BULLETED_LIST, ''),
      block(BlockType.NUMBERED_LIST, ''),
      block(BlockType.TODO, '', { checked: false }),
    ]);
  });
});

describe('clampTitle and slugify', () => {
  it('limits and tidies titles', () => {
    expect(clampTitle('  a \n b ')).toBe('a b');
    expect(clampTitle('')).toBe('Untitled');
    expect(clampTitle('x'.repeat(300))).toHaveLength(200);
    expect(clampTitle('x'.repeat(300)).endsWith('…')).toBe(true);
  });

  it('makes file names from titles, transliterating Cyrillic', () => {
    expect(slugify('Weekly plan: Q4 / 2026!')).toBe('weekly-plan-q4-2026');
    expect(slugify('Лабораторна робота №1')).toBe('laboratorna-robota-no1');
    expect(slugify('Їжак і щука')).toBe('izhak-i-shchuka');
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
    expect(slugify('!!!')).toBe('page');
    expect(slugify('★', 'note')).toBe('note');
    expect(slugify('a'.repeat(100))).toHaveLength(60);
  });
});

describe('round trip', () => {
  const roundTrip = (md: string) => {
    const { title, blocks } = markdownToBlocks(md);
    return blocksToMarkdown(title ?? 'Untitled', blocks);
  };

  it('leaves a canonical document unchanged', () => {
    const canonical = [
      '# Title',
      '',
      '# Heading',
      '',
      '## Sub',
      '',
      'Paragraph line one',
      'line two',
      '',
      '- a',
      '- b',
      '',
      '1. first',
      '2. second',
      '',
      '- [ ] open',
      '- [x] closed',
      '',
      '> quoted',
      '> twice',
      '',
      '---',
      '',
      '```python',
      'print("hi")',
      '',
      '',
      '    indented',
      '```',
      '',
    ].join('\n');
    expect(roundTrip(canonical)).toBe(canonical);
  });

  it('normalises the document once, then stays put (export of import is stable)', () => {
    const messy = [
      '#   Messy   ',
      'text right under it',
      '* star item',
      '  + nested',
      '7. seven',
      '9) nine',
      '#### deep',
      '***',
      '> a',
      'lazy',
      '```',
      'open fence',
    ].join('\r\n');
    const once = roundTrip(messy);
    expect(roundTrip(once)).toBe(once);
    expect(once).toContain('1. seven\n2. nine');
    expect(once).toContain('### deep');
  });

  it('is stable for blocks written by the editor too', () => {
    const blocks = [
      block(BlockType.HEADING_1, 'H'),
      block(BlockType.NUMBERED_LIST, 'a'),
      block(BlockType.NUMBERED_LIST, 'b'),
      block(BlockType.TODO, 'x', { checked: true }),
      block(BlockType.QUOTE, 'q'),
      block(BlockType.CODE, 'a\n\nb', { language: 'sh' }),
      block(BlockType.DIVIDER, ''),
      block(BlockType.PARAGRAPH, 'end'),
    ];
    const md = blocksToMarkdown('Doc', blocks);
    const parsed = markdownToBlocks(md);
    expect(parsed.title).toBe('Doc');
    expect(parsed.blocks).toEqual(blocks);
  });

  // seeded so a failure can be replayed
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const MARKERS = [
    '# ',
    '## ',
    '#### ',
    '- ',
    '* ',
    '+ ',
    '1. ',
    '12) ',
    '- [ ] ',
    '- [x] ',
    '> ',
    '>',
    '```',
    '````',
    '~~~',
    '---',
    '***',
    '- - -',
    '    ',
    '\t- ',
    '',
  ];
  const WORDS = ['text', 'Текст', '`code`', '| a | b |', '--- x', '- - x', '[ ]x', '', ''];

  it('is stable for 400 random documents', () => {
    const random = rng(2026);
    for (let n = 0; n < 400; n++) {
      const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
      const lines = Array.from({ length: 1 + Math.floor(random() * 14) }, () =>
        random() < 0.15 ? '' : `${pick(MARKERS)}${pick(WORDS)}`,
      );
      const md = lines.join(random() < 0.2 ? '\r\n' : '\n');
      const once = roundTrip(md);
      const twice = roundTrip(once);
      expect(twice, `source:\n${JSON.stringify(md)}`).toBe(once);
      expect(once.endsWith('\n')).toBe(true);
    }
  });
});
