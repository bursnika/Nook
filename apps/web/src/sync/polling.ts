import { deletePresence, getChanges, postOps, postPresence } from './http';
import {
  backoffMs,
  realScheduler,
  type Scheduler,
  type Transport,
  type TransportContext,
  type TransportHandlers,
} from './transport';
import type { BlockOp } from './types';

const MIN_INTERVAL_MS = 250;
const MAX_INTERVAL_MS = 10_000;

export interface PollingOptions {
  scheduler?: Scheduler;
  isHidden?: () => boolean;
  onVisible?: (fn: () => void) => () => void;
}

export class AdaptivePollingTransport implements Transport {
  readonly kind = 'polling' as const;
  private readonly scheduler: Scheduler;
  private readonly isHidden: () => boolean;
  private readonly onVisible: (fn: () => void) => () => void;
  private handlers?: TransportHandlers;
  private since = 0;
  private failures = 0;
  private timer: unknown;
  private closed = true;
  private running = false;
  private unsubscribeVisible?: () => void;

  constructor(
    private readonly ctx: TransportContext,
    options: PollingOptions = {},
  ) {
    this.scheduler = options.scheduler ?? realScheduler;
    this.isHidden = options.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
    this.onVisible =
      options.onVisible ??
      ((fn) => {
        const listener = () => {
          if (!document.hidden) fn();
        };
        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
      });
  }

  connect(since: number, handlers: TransportHandlers) {
    this.since = since;
    this.handlers = handlers;
    this.closed = false;
    this.failures = 0;
    handlers.onStatus('connecting');
    this.unsubscribeVisible = this.onVisible(() => this.pollNow());
    this.pollNow();
  }

  sendOps(ops: BlockOp[]) {
    return postOps(this.ctx, ops);
  }

  sendPresence(blockId: string | null, caret: number | null) {
    postPresence(this.ctx, blockId, caret);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.scheduler.clearTimeout(this.timer);
    this.unsubscribeVisible?.();
    deletePresence(this.ctx);
  }

  private pollNow() {
    if (this.closed || this.running) return;
    this.scheduler.clearTimeout(this.timer);
    void this.poll();
  }

  private schedule(ms: number) {
    this.scheduler.clearTimeout(this.timer);
    if (this.closed) return;
    this.timer = this.scheduler.setTimeout(() => this.pollNow(), ms);
  }

  private async poll() {
    if (this.isHidden()) return; // resumed by the visibility listener
    this.running = true;
    try {
      const reply = await getChanges(this.ctx, this.since, 'changes');
      if (this.closed) return;
      this.failures = 0;
      this.handlers?.onStatus('online');
      this.handlers?.onPresenceSnapshot(reply.presence);
      for (const message of reply.messages) {
        this.since = Math.max(this.since, message.seq);
        this.handlers?.onOps(message);
      }
      const wait = reply.more
        ? 0
        : Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, reply.nextPollMs ?? 1000));
      this.running = false;
      this.schedule(wait);
    } catch {
      if (this.closed) return;
      this.failures += 1;
      this.handlers?.onStatus('offline');
      this.running = false;
      this.schedule(backoffMs(this.failures));
    } finally {
      this.running = false;
    }
  }
}
