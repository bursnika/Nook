import { LongPollTransport } from './longpoll';
import { AdaptivePollingTransport } from './polling';
import type { TransportContext, TransportHandlers } from './transport';
import { WebSocketTransport, type SocketLike } from './websocket';
import type { OpsMessage, PresenceMessage } from './types';

const ctx: TransportContext = { workspaceId: 'w1', pageId: 'p1', clientId: 'tab-1' };

const ops = (seq: number, clientId = 'other'): OpsMessage => ({
  type: 'ops',
  seq,
  clientId,
  authorId: 'u2',
  at: '2026-01-01T00:00:00.000Z',
  ops: [{ type: 'update', id: 'a', content: { text: `v${seq}` } }],
});
const person: PresenceMessage = {
  type: 'presence',
  clientId: 'other',
  userId: 'u2',
  name: 'Ann',
  blockId: 'a',
  caret: 1,
  at: '2026-01-01T00:00:00.000Z',
};

function recorder() {
  const log: string[] = [];
  const handlers: TransportHandlers = {
    onOps: (m) => log.push(`ops:${m.seq}`),
    onPresence: (m) => log.push(`presence:${m.name}`),
    onPresenceSnapshot: (list) => log.push(`snapshot:${list.length}`),
    onLeave: (id) => log.push(`leave:${id}`),
    onStatus: (s) => log.push(`status:${s}`),
  };
  return { log, handlers };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const calls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(
    ([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`,
  );

describe('AdaptivePollingTransport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('polls /changes from `since`, delivers messages and waits the interval the server suggests', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          messages: [ops(11), ops(12)],
          more: false,
          presence: [person],
          seq: 12,
          nextPollMs: 400,
        }),
      )
      .mockResolvedValue(json({ messages: [], more: false, presence: [], nextPollMs: 2500 }));
    const { log, handlers } = recorder();
    const transport = new AdaptivePollingTransport(ctx, {
      isHidden: () => false,
      onVisible: () => () => undefined,
    });
    transport.connect(10, handlers);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(fetchMock)[0]).toBe(
      'GET /api/workspaces/w1/pages/p1/sync/changes?since=10&clientId=tab-1',
    );
    expect(log).toEqual(['status:connecting', 'status:online', 'snapshot:1', 'ops:11', 'ops:12']);

    await vi.advanceTimersByTimeAsync(399);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls(fetchMock)[1]).toContain('since=12');
    // quiet now: the next ask is 2.5 s away
    await vi.advanceTimersByTimeAsync(2400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    transport.close();
  });

  it('asks again at once when the server says there is more', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ messages: [ops(11)], more: true, presence: [] }))
      .mockResolvedValue(json({ messages: [], more: false, presence: [], nextPollMs: 5000 }));
    const transport = new AdaptivePollingTransport(ctx, {
      isHidden: () => false,
      onVisible: () => () => undefined,
    });
    transport.connect(10, recorder().handlers);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    transport.close();
  });

  it('backs off on errors, reports offline and recovers', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network'))
      .mockRejectedValueOnce(new TypeError('network'));
    fetchMock.mockResolvedValue(
      json({ messages: [], more: false, presence: [], nextPollMs: 1000 }),
    );
    const { log, handlers } = recorder();
    const transport = new AdaptivePollingTransport(ctx, {
      isHidden: () => false,
      onVisible: () => () => undefined,
    });
    transport.connect(0, handlers);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toContain('status:offline');
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2); // 1 s backoff
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2001); // 2 s backoff
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(log.at(-2)).toBe('status:online');
    transport.close();
  });

  it('pauses while the tab is hidden and resumes when it becomes visible', async () => {
    let hidden = true;
    let wake: () => void = () => undefined;
    fetchMock.mockResolvedValue(
      json({ messages: [], more: false, presence: [], nextPollMs: 1000 }),
    );
    const transport = new AdaptivePollingTransport(ctx, {
      isHidden: () => hidden,
      onVisible: (fn) => {
        wake = fn;
        return () => undefined;
      },
    });
    transport.connect(0, recorder().handlers);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    hidden = false;
    wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    transport.close();
  });

  it('sends ops and presence over HTTP and leaves on close', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/changes')
        ? json({ messages: [], more: false, presence: [] })
        : json({ seq: 5 }),
    );
    const transport = new AdaptivePollingTransport(ctx, {
      isHidden: () => false,
      onVisible: () => () => undefined,
    });
    transport.connect(0, recorder().handlers);
    await transport.sendOps([{ type: 'delete', id: 'a' }]);
    const post = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/sync/ops'))!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({
      clientId: 'tab-1',
      ops: [{ type: 'delete', id: 'a' }],
    });
    transport.sendPresence('a', 3);
    transport.close();
    const all = calls(fetchMock);
    expect(all).toContain('POST /api/workspaces/w1/pages/p1/sync/presence');
    expect(all).toContain('DELETE /api/workspaces/w1/pages/p1/sync/presence?clientId=tab-1');
  });

  it('turns a rejected batch into a TransportError with the status', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/ops')
        ? json({ message: 'bad' }, 400)
        : json({ messages: [], more: false, presence: [] }),
    );
    const transport = new AdaptivePollingTransport(ctx, {
      isHidden: () => false,
      onVisible: () => () => undefined,
    });
    transport.connect(0, recorder().handlers);
    await expect(transport.sendOps([{ type: 'delete', id: 'a' }])).rejects.toMatchObject({
      status: 400,
      permanent: true,
    });
    transport.close();
  });
});

describe('LongPollTransport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loops on /poll with the last seq, delivering each reply and re-asking immediately', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ messages: [ops(11)], more: false, presence: [person] }))
      .mockResolvedValueOnce(json({ messages: [], more: false, presence: [person] }))
      .mockImplementation(() => new Promise(() => undefined)); // held open
    const { log, handlers } = recorder();
    const transport = new LongPollTransport(ctx);
    transport.connect(10, handlers);
    await vi.advanceTimersByTimeAsync(0);
    const urls = calls(fetchMock);
    // the first request is an immediate catch-up, the following ones are held by the server
    expect(urls[0]).toBe('GET /api/workspaces/w1/pages/p1/sync/changes?since=10&clientId=tab-1');
    expect(urls[1]).toBe(
      'GET /api/workspaces/w1/pages/p1/sync/poll?since=11&clientId=tab-1&timeout=25',
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(log).toEqual([
      'status:connecting',
      'status:online',
      'snapshot:1',
      'ops:11',
      'status:online',
      'snapshot:1',
    ]);
    transport.close();
  });

  it('retries after an error with backoff and aborts the held request on close', async () => {
    let signal: AbortSignal | undefined;
    fetchMock
      .mockRejectedValueOnce(new TypeError('network'))
      .mockImplementation((_url: string, init: RequestInit) => {
        signal ??= init.signal ?? undefined;
        return new Promise(() => undefined);
      });
    const { log, handlers } = recorder();
    const transport = new LongPollTransport(ctx);
    transport.connect(0, handlers);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toContain('status:offline');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    transport.close();
    expect(signal?.aborted).toBe(true);
  });

  it('sends ops with a plain POST', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).endsWith('/ops')
        ? Promise.resolve(json({ seq: 3 }))
        : new Promise(() => undefined),
    );
    const transport = new LongPollTransport(ctx);
    transport.connect(0, recorder().handlers);
    await transport.sendOps([{ type: 'delete', id: 'a' }]);
    expect(calls(fetchMock)).toContain('POST /api/workspaces/w1/pages/p1/sync/ops');
    transport.close();
  });
});

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: unknown[] = [];
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  // server side
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

describe('WebSocketTransport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const make = () =>
    new WebSocketTransport(ctx, {
      origin: 'ws://nook.test',
      createSocket: (url) => new FakeSocket(url),
    });

  it('connects with the page and client ids, catches up over HTTP, then goes live', async () => {
    fetchMock.mockResolvedValue(json({ messages: [ops(11), ops(12)], more: false, presence: [] }));
    const { log, handlers } = recorder();
    const transport = make();
    transport.connect(10, handlers);
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe('ws://nook.test/ws?workspaceId=w1&pageId=p1&clientId=tab-1');
    socket.open();
    // a push that arrives while the catch-up is still running is held back, and de-duplicated
    socket.push({ type: 'hello', seq: 12, presence: [person] });
    socket.push({ ...ops(12) });
    socket.push({ ...ops(13) });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(fetchMock)[0]).toContain('/sync/changes?since=10&clientId=tab-1');
    expect(log).toEqual([
      'status:connecting',
      'snapshot:1',
      'snapshot:0',
      'ops:11',
      'ops:12',
      'ops:13',
      'status:online',
    ]);
    socket.push({ ...person, name: 'Ann' });
    socket.push({ type: 'leave', clientId: 'other' });
    expect(log.slice(-2)).toEqual(['presence:Ann', 'leave:other']);
    transport.close();
  });

  it('sends ops as frames and resolves on the ack, rejects on an error frame', async () => {
    fetchMock.mockResolvedValue(json({ messages: [], more: false, presence: [] }));
    const transport = make();
    transport.connect(0, recorder().handlers);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.push({ type: 'hello', seq: 0, presence: [] });
    await vi.advanceTimersByTimeAsync(0);

    const first = transport.sendOps([{ type: 'delete', id: 'a' }]);
    expect(socket.sent.at(-1)).toEqual({ type: 'ops', ops: [{ type: 'delete', id: 'a' }] });
    socket.push({ type: 'ack', seq: 5 });
    await expect(first).resolves.toBeUndefined();

    const second = transport.sendOps([{ type: 'delete', id: 'b' }]);
    socket.push({ type: 'error', message: 'nope' });
    await expect(second).rejects.toMatchObject({ message: 'nope' });

    transport.sendPresence('a', 4);
    expect(socket.sent.at(-1)).toEqual({ type: 'presence', blockId: 'a', caret: 4 });
    transport.close();
  });

  it('rejects sends when not connected and times out a missing ack', async () => {
    fetchMock.mockResolvedValue(json({ messages: [], more: false, presence: [] }));
    const transport = make();
    transport.connect(0, recorder().handlers);
    await expect(transport.sendOps([])).rejects.toThrow('Not connected');
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.push({ type: 'hello', seq: 0, presence: [] });
    await vi.advanceTimersByTimeAsync(0);
    const pending = transport.sendOps([{ type: 'delete', id: 'a' }]);
    const caught = pending.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(caught).resolves.toMatch(/acknowledgement/);
    transport.close();
  });

  it('reconnects with backoff after the socket drops and resumes from the last delivered seq', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ messages: [ops(11)], more: false, presence: [] }))
      .mockResolvedValue(json({ messages: [ops(12)], more: false, presence: [] }));
    const { log, handlers } = recorder();
    const transport = make();
    transport.connect(10, handlers);
    const first = FakeSocket.instances[0]!;
    first.open();
    first.push({ type: 'hello', seq: 11, presence: [] });
    await vi.advanceTimersByTimeAsync(0);
    first.drop();
    expect(log.at(-1)).toBe('status:offline');
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(FakeSocket.instances).toHaveLength(2);
    const second = FakeSocket.instances[1]!;
    second.open();
    second.push({ type: 'hello', seq: 12, presence: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(fetchMock)[1]).toContain('since=11');
    expect(log).toContain('ops:12');
    expect(log.at(-1)).toBe('status:online');
    transport.close();
  });

  it('answers nothing after close', async () => {
    const transport = make();
    transport.connect(0, recorder().handlers);
    transport.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
