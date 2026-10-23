import { getChanges, toTransportError } from './http';
import {
  backoffMs,
  realScheduler,
  TransportError,
  type Scheduler,
  type Transport,
  type TransportContext,
  type TransportHandlers,
} from './transport';
import type { BlockOp, OpsMessage, PresenceMessage } from './types';

/** The part of the browser WebSocket we use, so tests can pass a fake class. */
export interface SocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}
export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;
const ACK_TIMEOUT_MS = 10_000;
const PING_MS = 25_000;

export interface WebSocketOptions {
  scheduler?: Scheduler;
  createSocket?: SocketFactory;
  /** Base such as `wss://host`; defaults to the page origin. */
  origin?: string;
}

type Frame =
  | { type: 'hello'; seq: number; presence: PresenceMessage[] }
  | ({ type: 'ops' } & Omit<OpsMessage, 'type'>)
  | PresenceMessage
  | { type: 'leave'; clientId: string }
  | { type: 'ack'; seq: number }
  | { type: 'error'; message: string };

interface PendingAck {
  resolve(): void;
  reject(error: TransportError): void;
  timer: unknown;
}

/**
 * One WebSocket per page. After every (re)connect it first catches up over HTTP (`changes?since=`) while
 * buffering pushed frames, then delivers the buffered ones that are newer, so nothing is lost or reordered.
 */
export class WebSocketTransport implements Transport {
  readonly kind = 'websocket' as const;
  private readonly scheduler: Scheduler;
  private readonly createSocket: SocketFactory;
  private readonly origin: string;
  private handlers?: TransportHandlers;
  private socket?: SocketLike;
  private since = 0;
  private failures = 0;
  private closed = true;
  private live = false;
  private buffer: Frame[] = [];
  private acks: PendingAck[] = [];
  private reconnectTimer: unknown;
  private pingTimer: unknown;
  private generation = 0;

  constructor(
    private readonly ctx: TransportContext,
    options: WebSocketOptions = {},
  ) {
    this.scheduler = options.scheduler ?? realScheduler;
    this.origin =
      options.origin ??
      `${globalThis.location?.protocol === 'https:' ? 'wss' : 'ws'}://${globalThis.location?.host ?? 'localhost'}`;
    this.createSocket =
      options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
  }

  connect(since: number, handlers: TransportHandlers) {
    this.since = since;
    this.handlers = handlers;
    this.closed = false;
    this.failures = 0;
    this.open();
  }

  sendOps(ops: BlockOp[]): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN || !this.live) {
      return Promise.reject(new TransportError('Not connected'));
    }
    return new Promise<void>((resolve, reject) => {
      const entry: PendingAck = {
        resolve,
        reject,
        timer: this.scheduler.setTimeout(() => {
          this.acks = this.acks.filter((e) => e !== entry);
          reject(new TransportError('No acknowledgement from the server'));
        }, ACK_TIMEOUT_MS),
      };
      this.acks.push(entry);
      try {
        socket.send(JSON.stringify({ type: 'ops', ops }));
      } catch (error) {
        this.acks = this.acks.filter((e) => e !== entry);
        this.scheduler.clearTimeout(entry.timer);
        reject(toTransportError(error));
      }
    });
  }

  sendPresence(blockId: string | null, caret: number | null) {
    const socket = this.socket;
    if (socket && socket.readyState === OPEN) {
      socket.send(JSON.stringify({ type: 'presence', blockId, caret }));
    }
  }

  close() {
    this.closed = true;
    this.generation += 1;
    this.scheduler.clearTimeout(this.reconnectTimer);
    this.scheduler.clearTimeout(this.pingTimer);
    this.failAcks('Closed');
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onclose = socket.onmessage = socket.onerror = socket.onopen = null;
      socket.close();
    }
  }

  private open() {
    if (this.closed) return;
    const generation = ++this.generation;
    this.live = false;
    this.buffer = [];
    this.handlers?.onStatus('connecting');
    const { workspaceId, pageId, clientId } = this.ctx;
    const url = `${this.origin}/ws?workspaceId=${workspaceId}&pageId=${pageId}&clientId=${encodeURIComponent(clientId)}`;
    let socket: SocketLike;
    try {
      socket = this.createSocket(url);
    } catch {
      this.lost(generation);
      return;
    }
    this.socket = socket;
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      let frame: Frame;
      try {
        frame = JSON.parse(String(event.data)) as Frame;
      } catch {
        return;
      }
      this.onFrame(frame, generation);
    };
    socket.onclose = () => this.lost(generation);
    socket.onerror = () => undefined; // `close` follows and does the work
  }

  private onFrame(frame: Frame, generation: number) {
    switch (frame.type) {
      case 'hello':
        this.handlers?.onPresenceSnapshot(frame.presence ?? []);
        void this.catchUp(generation);
        return;
      case 'ack': {
        const entry = this.acks.shift();
        if (entry) {
          this.scheduler.clearTimeout(entry.timer);
          entry.resolve();
        }
        return;
      }
      case 'error': {
        const entry = this.acks.shift();
        if (entry) {
          this.scheduler.clearTimeout(entry.timer);
          entry.reject(new TransportError(frame.message, 400));
        }
        return;
      }
      default:
        if (!this.live) this.buffer.push(frame);
        else this.deliver(frame);
    }
  }

  private async catchUp(generation: number) {
    try {
      for (;;) {
        const reply = await getChanges(this.ctx, this.since, 'changes');
        if (generation !== this.generation) return;
        this.handlers?.onPresenceSnapshot(reply.presence);
        for (const message of reply.messages) this.deliverOps(message);
        if (!reply.more) break;
      }
      const buffered = this.buffer;
      this.buffer = [];
      this.live = true;
      for (const frame of buffered) this.deliver(frame);
      this.failures = 0;
      this.handlers?.onStatus('online');
      this.startPing(generation);
    } catch {
      if (generation === this.generation) {
        this.socket?.close();
        this.lost(generation);
      }
    }
  }

  private deliver(frame: Frame) {
    if (frame.type === 'ops') this.deliverOps(frame);
    else if (frame.type === 'presence') this.handlers?.onPresence(frame);
    else if (frame.type === 'leave') this.handlers?.onLeave(frame.clientId);
  }

  private deliverOps(message: OpsMessage) {
    if (message.seq <= this.since) return; // already delivered by the catch-up
    this.since = message.seq;
    this.handlers?.onOps({ ...message, type: 'ops' });
  }

  private startPing(generation: number) {
    this.scheduler.clearTimeout(this.pingTimer);
    this.pingTimer = this.scheduler.setTimeout(() => {
      if (generation !== this.generation || this.closed) return;
      if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify({ type: 'ping' }));
      this.startPing(generation);
    }, PING_MS);
  }

  private lost(generation: number) {
    if (generation !== this.generation || this.closed) return;
    this.live = false;
    this.scheduler.clearTimeout(this.pingTimer);
    this.failAcks('Connection lost');
    this.socket = undefined;
    this.failures += 1;
    this.handlers?.onStatus('offline');
    this.scheduler.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = this.scheduler.setTimeout(() => this.open(), backoffMs(this.failures));
  }

  private failAcks(message: string) {
    const pending = this.acks;
    this.acks = [];
    for (const entry of pending) {
      this.scheduler.clearTimeout(entry.timer);
      entry.reject(new TransportError(message));
    }
  }
}
