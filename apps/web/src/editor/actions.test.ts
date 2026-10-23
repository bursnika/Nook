import { FakeTransport } from '../sync/fakeTransport';
import { SyncClient } from '../sync/syncClient';
import type { Snapshot } from '../sync/types';
import { createActions, type CaretTarget } from './actions';

function setup(blocks: Snapshot['blocks']) {
  const transport = new FakeTransport();
  let n = 0;
  const client = new SyncClient({
    pageId: 'p',
    clientId: 'me',
    transportKind: 'websocket',
    store: null,
    uuid: () => `new-${++n}`,
    loadSnapshot: async () => ({ page: { id: 'p', title: 't', icon: null }, blocks, seq: 1 }),
    createTransport: () => transport,
  });
  const focus: { id: string; caret: CaretTarget }[] = [];
  const actions = createActions(client, (id, caret) => focus.push({ id, caret }));
  return {
    client,
    actions,
    focus,
    texts: () => client.getState().blocks.map((b) => b.content.text),
  };
}

const para = (id: string, text: string, position: number, type = 'PARAGRAPH' as const) => ({
  id,
  type,
  content: { text },
  position,
});

async function ready(blocks: Snapshot['blocks']) {
  const ctx = setup(blocks);
  ctx.client.start();
  await Promise.resolve();
  await Promise.resolve();
  return ctx;
}

describe('editor actions', () => {
  it('splits a block at the caret and continues lists', async () => {
    const { actions, client, focus } = await ready([
      para('a', 'hello world', 1024, 'PARAGRAPH'),
      para('b', 'item', 2048),
    ]);
    actions.enter('a', 5, 5);
    expect(client.getState().blocks.map((b) => b.content.text)).toEqual([
      'hello',
      ' world',
      'item',
    ]);
    expect(focus.at(-1)).toEqual({ id: 'new-1', caret: 0 });
    client.updateBlock('b', { type: 'BULLETED_LIST' });
    actions.enter('b', 4, 4);
    expect(client.getState().blocks.at(-1)).toMatchObject({
      type: 'BULLETED_LIST',
      content: { text: '' },
    });
    client.stop();
  });

  it('turns an empty list item back into a paragraph instead of adding another', async () => {
    const { actions, client } = await ready([{ ...para('a', '', 1024), type: 'TODO' }]);
    actions.enter('a', 0, 0);
    expect(client.getState().blocks).toHaveLength(1);
    expect(client.getState().blocks[0]!.type).toBe('PARAGRAPH');
    client.stop();
  });

  it('backspace at the start: heading becomes a paragraph, then merges into the previous block', async () => {
    const { actions, client, texts, focus } = await ready([
      para('a', 'one', 1024),
      { ...para('b', 'two', 2048), type: 'HEADING_2' },
    ]);
    expect(actions.backspaceAtStart('b')).toBe(true);
    expect(client.getBlock('b')!.type).toBe('PARAGRAPH');
    expect(actions.backspaceAtStart('b')).toBe(true);
    expect(texts()).toEqual(['onetwo']);
    expect(focus.at(-1)).toEqual({ id: 'a', caret: 3 });
    expect(actions.backspaceAtStart('a')).toBe(false); // first block: nothing to merge into
    client.stop();
  });

  it('backspace after a divider removes the divider', async () => {
    const { actions, client } = await ready([
      { ...para('d', '', 1024), type: 'DIVIDER' },
      para('b', 'x', 2048),
    ]);
    actions.backspaceAtStart('b');
    expect(client.getState().blocks.map((b) => b.id)).toEqual(['b']);
    client.stop();
  });

  it('markdown shortcuts convert a paragraph; --- adds a paragraph below', async () => {
    const { actions, client, focus } = await ready([para('a', '', 1024)]);
    actions.change('a', '## ');
    expect(client.getBlock('a')).toMatchObject({ type: 'HEADING_2', content: { text: '' } });
    const second = await ready([para('a', '', 1024)]);
    second.actions.change('a', '---');
    expect(second.client.getState().blocks.map((b) => b.type)).toEqual(['DIVIDER', 'PARAGRAPH']);
    expect(second.focus.at(-1)!.id).toBe('new-1');
    expect(focus).toHaveLength(1);
    client.stop();
    second.client.stop();
  });

  it('moves one block with a single fractional position and renumbers only when the gap collapsed', async () => {
    const { actions, client } = await ready([
      para('a', 'a', 1024),
      para('b', 'b', 2048),
      para('c', 'c', 3072),
    ]);
    actions.dropAt('c', 1);
    expect(client.getState().blocks.map((b) => b.id)).toEqual(['a', 'c', 'b']);
    expect(client.getBlock('c')!.position).toBe(1536);
    expect(client.getBlock('a')!.position).toBe(1024);
    client.stop();

    const tight = await ready([para('a', 'a', 1), para('b', 'b', 1 + 1e-9), para('c', 'c', 5)]);
    tight.actions.dropAt('c', 1);
    expect(tight.client.getState().blocks.map((b) => b.id)).toEqual(['a', 'c', 'b']);
    expect(tight.client.getState().blocks.map((b) => b.position)).toEqual([1024, 2048, 3072]);
    tight.client.stop();
  });

  it('keeps the column when moving the caret to a neighbour', async () => {
    const { actions, focus } = await ready([para('a', 'abcdef', 1024), para('b', 'xy', 2048)]);
    expect(actions.focusAdjacent('b', -1, 4)).toBe(true);
    expect(focus.at(-1)).toEqual({ id: 'a', caret: 4 });
    expect(actions.focusAdjacent('a', 1, 9)).toBe(true);
    expect(focus.at(-1)).toEqual({ id: 'b', caret: 2 });
    expect(actions.focusAdjacent('b', 1, 0)).toBe(false);
  });
});
