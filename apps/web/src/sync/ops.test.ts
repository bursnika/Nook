import { applyOp, applyOps } from './ops';
import type { Block } from './types';

const block = (id: string, position: number, text = ''): Block => ({
  id,
  type: 'PARAGRAPH',
  content: { text },
  position,
});

describe('applyOp', () => {
  const base = [block('a', 1024, 'A'), block('b', 2048, 'B')];

  it('inserts in position order and ignores a replayed insert', () => {
    const once = applyOp(base, {
      type: 'insert',
      id: 'c',
      blockType: 'TODO',
      content: { text: 'C' },
      position: 1500,
    });
    expect(once.map((b) => b.id)).toEqual(['a', 'c', 'b']);
    expect(once[1]!.type).toBe('TODO');
    expect(applyOp(once, { type: 'insert', id: 'c', position: 1 })).toBe(once);
  });

  it('updates content and type, ignores missing blocks, keeps identity of untouched blocks', () => {
    const next = applyOp(base, { type: 'update', id: 'a', content: { text: 'new' } });
    expect(next[0]!.content.text).toBe('new');
    expect(next[1]).toBe(base[1]);
    expect(applyOp(base, { type: 'update', id: 'zzz', content: { text: 'x' } })).toBe(base);
    expect(applyOp(base, { type: 'update', id: 'a', blockType: 'QUOTE' })[0]!.type).toBe('QUOTE');
  });

  it('moves and deletes', () => {
    expect(applyOp(base, { type: 'move', id: 'a', position: 3000 }).map((b) => b.id)).toEqual([
      'b',
      'a',
    ]);
    expect(applyOp(base, { type: 'delete', id: 'a' }).map((b) => b.id)).toEqual(['b']);
    expect(applyOp(base, { type: 'delete', id: 'nope' })).toBe(base);
  });

  it('breaks ties by id so every client sorts the same way', () => {
    const result = applyOps(
      [],
      [
        { type: 'insert', id: 'y', position: 5 },
        { type: 'insert', id: 'x', position: 5 },
      ],
    );
    expect(result.map((b) => b.id)).toEqual(['x', 'y']);
  });
});
