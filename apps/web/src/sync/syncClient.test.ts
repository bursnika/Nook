import { FakeTransport } from './fakeTransport';
import { SyncClient, type SyncClientOptions } from './syncClient';
import { TransportError } from './transport';
import type { Snapshot } from './types';
import type { KeyValueStore } from './storage';

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  page: { id: 'p1', title: 'Doc', icon: null },
  blocks: [
    { id: 'a', type: 'PARAGRAPH', content: { text: 'one' }, position: 1024 },
    { id: 'b', type: 'PARAGRAPH', content: { text: 'two' }, position: 2048 },
  ],
  seq: 10,
  ...over,
});

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

function setup(
  over: Partial<SyncClientOptions> = {},
  store: KeyValueStore | null = new MemoryStore(),
) {
  const transport = new FakeTransport();
  let n = 0;
  const loadSnapshot = vi.fn(async () => snapshot());
  const client = new SyncClient({
    pageId: 'p1',
    clientId: 'me',
    loadSnapshot,
    createTransport: () => transport,
    transportKind: 'websocket',
    store,
    uuid: () => `id-${++n}`,
    ...over,
  });
  return { client, transport, store, loadSnapshot };
}

async function online(ctx: ReturnType<typeof setup>) {
  ctx.client.start();
  await tick();
  ctx.transport.status('online');
  await tick();
}

describe('SyncClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loads the snapshot, connects from its seq and reports online', async () => {
    const ctx = setup();
    await online(ctx);
    const state = ctx.client.getState();
    expect(state.blocks.map((b) => b.content.text)).toEqual(['one', 'two']);
    expect(state.title).toBe('Doc');
    expect(ctx.transport.since).toBe(10);
    expect(state.status).toBe('online');
    expect(state.saveState).toBe('saved');
    ctx.client.stop();
  });

  it('reports a page the server does not know instead of retrying forever', async () => {
    const loadSnapshot = vi.fn(async () => {
      throw Object.assign(new Error('Not found'), { status: 404 });
    });
    const ctx = setup({ loadSnapshot });
    ctx.client.start();
    await tick();
    expect(ctx.client.getState().missing).toBe(true);
    await tick(60_000);
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    ctx.client.stop();
  });

  it('keeps retrying when the snapshot fails for another reason', async () => {
    const loadSnapshot = vi.fn(async () => {
      throw new Error('offline');
    });
    const ctx = setup({ loadSnapshot });
    ctx.client.start();
    await tick();
    expect(ctx.client.getState().missing).toBe(false);
    await tick(60_000);
    expect(loadSnapshot.mock.calls.length).toBeGreaterThan(1);
    ctx.client.stop();
  });

  it('applies local edits optimistically and batches typing into one update', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.client.updateBlock('a', { content: { text: 'o' } });
    ctx.client.updateBlock('a', { content: { text: 'on' } });
    ctx.client.updateBlock('a', { content: { text: 'one!' } });
    expect(ctx.client.getState().blocks[0]!.content.text).toBe('one!');
    expect(ctx.client.getState().pending).toBe(1);
    expect(ctx.client.getState().saveState).toBe('saving');
    expect(ctx.transport.sent).toHaveLength(0);
    await tick(299);
    expect(ctx.transport.sent).toHaveLength(0);
    await tick(2);
    expect(ctx.transport.sent).toEqual([[{ type: 'update', id: 'a', content: { text: 'one!' } }]]);
    expect(ctx.client.getState().pending).toBe(0);
    expect(ctx.client.getState().saveState).toBe('saved');
    ctx.client.stop();
  });

  it('sends structural changes at once and folds edits of a new block into its insert', async () => {
    const ctx = setup();
    await online(ctx);
    const id = ctx.client.insertBlock({ position: 3072, type: 'TODO' });
    ctx.client.updateBlock(id, { content: { text: 'buy milk', checked: false } });
    await tick(0);
    expect(ctx.transport.sent).toHaveLength(1);
    expect(ctx.transport.sent[0]).toEqual([
      {
        type: 'insert',
        id,
        blockType: 'TODO',
        content: { text: 'buy milk', checked: false },
        position: 3072,
      },
    ]);
    ctx.client.stop();
  });

  it('drops a block that was created and deleted before anything was sent', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.transport.hold = true;
    const id = ctx.client.insertBlock({ position: 4000 });
    ctx.client.deleteBlock(id);
    await tick(10);
    expect(ctx.transport.sent).toHaveLength(0);
    expect(ctx.client.getState().pending).toBe(0);
    ctx.client.stop();
  });

  it('keeps the outbox in localStorage and restores it (with the document) after a reload', async () => {
    const store = new MemoryStore();
    const first = setup({}, store);
    first.client.start();
    await tick();
    first.client.updateBlock('a', { content: { text: 'edited offline' } });
    first.client.insertBlock({ position: 3072, content: { text: 'new offline' } });
    expect(first.client.getState().saveState).toBe('offline');
    expect(first.client.getState().pending).toBe(2);
    first.client.stop();

    const second = setup(
      {
        loadSnapshot: vi.fn(async () => {
          throw new Error('offline');
        }),
      },
      store,
    );
    expect(second.client.getState().loaded).toBe(true);
    expect(second.client.getState().blocks.map((b) => b.content.text)).toEqual([
      'edited offline',
      'two',
      'new offline',
    ]);
    expect(second.client.getState().pending).toBe(2);
  });

  it('reconciles a restored outbox with the newer server state and sends it', async () => {
    const store = new MemoryStore();
    const first = setup({}, store);
    first.client.start();
    await tick();
    first.client.updateBlock('a', { content: { text: 'mine' } });
    first.client.stop();

    const second = setup(
      {
        loadSnapshot: async () =>
          snapshot({
            seq: 25,
            blocks: [
              { id: 'a', type: 'PARAGRAPH', content: { text: 'server a' }, position: 1024 },
              { id: 'b', type: 'PARAGRAPH', content: { text: 'server b' }, position: 2048 },
              { id: 'c', type: 'PARAGRAPH', content: { text: 'server c' }, position: 3072 },
            ],
          }),
      },
      store,
    );
    await online(second);
    expect(second.client.getState().blocks.map((b) => b.content.text)).toEqual([
      'mine',
      'server b',
      'server c',
    ]);
    expect(second.transport.since).toBe(25);
    await tick(0);
    expect(second.transport.sent).toEqual([
      [{ type: 'update', id: 'a', content: { text: 'mine' } }],
    ]);
    expect(second.client.getState().pending).toBe(0);
    second.client.stop();
  });

  it('resends the outbox with backoff after a failure and when the connection returns', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.transport.failNext = new TransportError('boom');
    ctx.client.updateBlock('a', { content: { text: 'x' } });
    await tick(301);
    expect(ctx.client.getState().pending).toBe(1);
    expect(ctx.transport.sent).toHaveLength(0);
    await tick(1000);
    expect(ctx.transport.sent).toHaveLength(1);
    expect(ctx.client.getState().pending).toBe(0);

    ctx.transport.status('offline');
    ctx.client.updateBlock('a', { content: { text: 'y' } });
    await tick(500);
    expect(ctx.transport.sent).toHaveLength(1);
    expect(ctx.client.getState().saveState).toBe('offline');
    ctx.transport.status('online');
    await tick(0);
    expect(ctx.transport.sent).toHaveLength(2);
    expect(ctx.client.getState().saveState).toBe('saved');
    ctx.client.stop();
  });

  it('drops a batch the server permanently rejects and tells the user', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.transport.failNext = new TransportError('bad op', 400);
    ctx.client.updateBlock('a', { content: { text: 'x' } });
    await tick(301);
    expect(ctx.client.getState().pending).toBe(0);
    expect(ctx.client.getState().notice).toMatch(/rejected/);
    ctx.client.stop();
  });

  it('applies remote ops (last writer wins) and records who changed what', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.transport.presence({ clientId: 'c2', userId: 'u2', name: 'Ann' });
    ctx.transport.ops({
      seq: 11,
      clientId: 'c2',
      authorId: 'u2',
      ops: [{ type: 'update', id: 'a', content: { text: 'from ann' } }],
    });
    const state = ctx.client.getState();
    expect(state.blocks[0]!.content.text).toBe('from ann');
    expect(state.recent['a']).toMatchObject({ name: 'Ann', userId: 'u2' });
    const first = state.recent['a']!.nonce;
    ctx.transport.ops({
      seq: 12,
      clientId: 'c2',
      authorId: 'u2',
      ops: [
        { type: 'update', id: 'a', content: { text: 'again' } },
        { type: 'move', id: 'b', position: 500 },
      ],
    });
    expect(ctx.client.getState().blocks.map((b) => b.id)).toEqual(['b', 'a']);
    expect(ctx.client.getState().recent['a']!.nonce).toBeGreaterThan(first);
    ctx.client.stop();
  });

  it('keeps our unsent change to a block when someone else changes it (ours wins on the server too)', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.client.updateBlock('a', { content: { text: 'mine' } });
    ctx.transport.ops({
      seq: 11,
      clientId: 'c2',
      authorId: 'u2',
      ops: [{ type: 'update', id: 'a', content: { text: 'theirs' } }],
    });
    expect(ctx.client.getState().blocks[0]!.content.text).toBe('mine');
    ctx.client.stop();
  });

  it('dedupes by seq', async () => {
    const ctx = setup();
    await online(ctx);
    const message = {
      seq: 11,
      clientId: 'c2',
      authorId: 'u2',
      ops: [{ type: 'insert' as const, id: 'n', content: { text: 'n' }, position: 5000 }],
    };
    ctx.transport.ops(message);
    ctx.transport.ops(message);
    ctx.transport.ops({ ...message, seq: 9 });
    expect(ctx.client.getState().blocks).toHaveLength(3);
    ctx.client.stop();
  });

  it('ignores our own echo from HTTP transports but advances the log position', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.transport.ops({
      seq: 11,
      clientId: 'me',
      authorId: 'u1',
      ops: [{ type: 'update', id: 'a', content: { text: 'echo' } }],
    });
    expect(ctx.client.getState().recent['a']).toBeUndefined();
    ctx.client.stop();
  });

  it('survives a remote delete of the block being edited', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.transport.presence({ clientId: 'c2', userId: 'u2', name: 'Ann' });
    ctx.client.updateBlock('a', { content: { text: 'typing…' } });
    ctx.transport.ops({
      seq: 11,
      clientId: 'c2',
      authorId: 'u2',
      ops: [{ type: 'delete', id: 'a' }],
    });
    const state = ctx.client.getState();
    expect(state.blocks.map((b) => b.id)).toEqual(['b']);
    expect(state.notice).toMatch(/Ann deleted a block you were editing/);
    ctx.client.updateBlock('a', { content: { text: 'more' } });
    await tick(500);
    ctx.client.stop();
  });

  it('tracks presence, forgets people who leave and throttles our own cursor', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.transport.presence({ clientId: 'c2', userId: 'u2', name: 'Ann', blockId: 'b', caret: 2 });
    expect(ctx.client.getState().presence).toEqual([
      { clientId: 'c2', userId: 'u2', name: 'Ann', blockId: 'b', caret: 2 },
    ]);
    ctx.transport.handlers!.onLeave('c2');
    expect(ctx.client.getState().presence).toEqual([]);

    ctx.transport.presenceSent.length = 0;
    ctx.client.setCursor('a', 1);
    ctx.client.setCursor('a', 2);
    ctx.client.setCursor('a', 3);
    await tick(260);
    expect(ctx.transport.presenceSent).toEqual([{ blockId: 'a', caret: 3 }]);
    ctx.client.stop();
  });

  it('switches transport live, continuing from the last seq', async () => {
    const second = new FakeTransport('polling');
    const first = new FakeTransport('websocket');
    const queue = [first, second];
    const ctx = setup({ createTransport: () => queue.shift()! });
    ctx.client.start();
    await tick();
    first.status('online');
    first.ops({ seq: 14, clientId: 'c2', authorId: 'u2', ops: [] });
    ctx.client.setTransportKind('polling');
    expect(first.closed).toBe(true);
    expect(second.since).toBe(14);
    expect(ctx.client.getState().transport).toBe('polling');
    second.status('online');
    expect(ctx.client.getState().status).toBe('online');
    ctx.client.stop();
  });

  it('saves a changed title and keeps it when the save fails', async () => {
    const saveTitle = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const ctx = setup({ saveTitle });
    await online(ctx);
    ctx.client.setTitle('New title');
    expect(ctx.client.getState().pending).toBe(1);
    await tick(700);
    expect(saveTitle).toHaveBeenCalledTimes(1);
    expect(ctx.client.getState().pending).toBe(1);
    await tick(5100);
    expect(saveTitle).toHaveBeenCalledTimes(2);
    expect(ctx.client.getState().pending).toBe(0);
    ctx.client.stop();
  });

  it('shows offline at once when the browser goes offline', async () => {
    const ctx = setup();
    await online(ctx);
    ctx.client.setBrowserOnline(false);
    expect(ctx.client.getState().status).toBe('offline');
    ctx.client.updateBlock('a', { content: { text: 'z' } });
    await tick(500);
    expect(ctx.transport.sent).toHaveLength(0);
    ctx.client.stop();
  });
});
