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

/**
 * Long poll: after an immediate catch-up, GET .../poll is held by the server until something happens (or 25 s pass); the reply is
 * delivered and the next request goes out at once. Errors back off exponentially.
 */
export class LongPollTransport implements Transport {
  readonly kind = 'longpoll' as const;
  private handlers?: TransportHandlers;
  private since = 0;
  private failures = 0;
  private closed = true;
  private abort?: AbortController;
  private timer: unknown;

  constructor(
    private readonly ctx: TransportContext,
    private readonly scheduler: Scheduler = realScheduler,
  ) {}

  connect(since: number, handlers: TransportHandlers) {
    this.since = since;
    this.handlers = handlers;
    this.closed = false;
    this.failures = 0;
    handlers.onStatus('connecting');
    void this.loop();
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
    this.abort?.abort();
    this.scheduler.clearTimeout(this.timer);
    deletePresence(this.ctx);
  }

  private async loop() {
    let first = true;
    while (!this.closed) {
      const controller = (this.abort = new AbortController());
      try {
        // the very first request returns at once (catch-up + "we are online"); later ones are held
        const reply = await getChanges(
          this.ctx,
          this.since,
          first ? 'changes' : 'poll',
          controller.signal,
        );
        first = false;
        if (this.closed) return;
        this.failures = 0;
        this.handlers?.onStatus('online');
        this.handlers?.onPresenceSnapshot(reply.presence);
        for (const message of reply.messages) {
          this.since = Math.max(this.since, message.seq);
          this.handlers?.onOps(message);
        }
      } catch {
        if (this.closed) return;
        this.failures += 1;
        this.handlers?.onStatus('offline');
        await new Promise<void>((resolve) => {
          this.timer = this.scheduler.setTimeout(resolve, backoffMs(this.failures));
        });
      }
    }
  }
}
