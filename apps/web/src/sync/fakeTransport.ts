import type { TransportKind } from '../lib/settings';
import { TransportError, type Transport, type TransportHandlers } from './transport';
import type { BlockOp, ConnectionStatus, OpsMessage, PresenceMessage } from './types';

/** A scriptable Transport for tests: the test plays the server. */
export class FakeTransport implements Transport {
  readonly kind: TransportKind;
  handlers?: TransportHandlers;
  since = -1;
  closed = false;
  sent: BlockOp[][] = [];
  presenceSent: { blockId: string | null; caret: number | null }[] = [];
  /** Set to make the next sendOps fail. */
  failNext: TransportError | null = null;
  /** Hold the reply of sendOps until `release()` is called. */
  hold = false;
  private waiting: { resolve(): void; reject(e: Error): void }[] = [];

  constructor(kind: TransportKind = 'websocket') {
    this.kind = kind;
  }

  connect(since: number, handlers: TransportHandlers) {
    this.since = since;
    this.handlers = handlers;
  }

  sendOps(ops: BlockOp[]): Promise<void> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      return Promise.reject(error);
    }
    this.sent.push(ops);
    if (!this.hold) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  release(error?: Error) {
    for (const w of this.waiting.splice(0)) {
      if (error) w.reject(error);
      else w.resolve();
    }
  }

  sendPresence(blockId: string | null, caret: number | null) {
    this.presenceSent.push({ blockId, caret });
  }

  close() {
    this.closed = true;
  }

  // ---- server side
  status(status: ConnectionStatus) {
    this.handlers?.onStatus(status);
  }
  ops(message: Omit<OpsMessage, 'type' | 'at'> & { at?: string }) {
    this.handlers?.onOps({ type: 'ops', at: '2026-01-01T00:00:00.000Z', ...message });
  }
  presence(message: Partial<PresenceMessage> & { clientId: string; userId: string; name: string }) {
    this.handlers?.onPresence({
      type: 'presence',
      blockId: null,
      caret: null,
      at: '2026-01-01T00:00:00.000Z',
      ...message,
    });
  }
}
