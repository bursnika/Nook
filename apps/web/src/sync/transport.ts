import type { TransportKind } from '../lib/settings';
import type { BlockOp, ConnectionStatus, OpsMessage, PresenceMessage } from './types';

/** Callbacks a transport uses to hand server events to the SyncClient. */
export interface TransportHandlers {
  /** An ops batch in log order (it may be our own echo: the client filters by clientId and seq). */
  onOps(message: OpsMessage): void;
  /** One person's cursor moved. */
  onPresence(message: PresenceMessage): void;
  /** Everyone who is currently here (replaces what we knew). */
  onPresenceSnapshot(entries: PresenceMessage[]): void;
  onLeave(clientId: string): void;
  onStatus(status: ConnectionStatus): void;
}

/**
 * The one abstraction behind WebSocket, long poll and adaptive polling. The SyncClient only talks to this
 * interface, so a transport can be swapped while the editor is open.
 */
export interface Transport {
  readonly kind: TransportKind;
  /** Start delivering everything after log position `since`; reconnects by itself until `close()`. */
  connect(since: number, handlers: TransportHandlers): void;
  /** Resolves once the server has accepted the batch; rejects (TransportError) when it could not. */
  sendOps(ops: BlockOp[]): Promise<void>;
  sendPresence(blockId: string | null, caret: number | null): void;
  close(): void;
}

export class TransportError extends Error {
  constructor(
    message: string,
    /** HTTP status when the server answered; undefined for network failures. */
    readonly status?: number,
  ) {
    super(message);
  }
  /** A 4xx (other than timeouts, rate limits and expired sessions) will not get better by retrying. */
  get permanent(): boolean {
    const s = this.status;
    return s !== undefined && s >= 400 && s < 500 && ![401, 408, 429].includes(s);
  }
}

export interface TransportContext {
  workspaceId: string;
  pageId: string;
  clientId: string;
}

/** Timers behind an interface so tests can drive time. */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

export const pagePath = ({ workspaceId, pageId }: TransportContext) =>
  `/workspaces/${workspaceId}/pages/${pageId}/sync`;

/** Retry delay: 1 s, 2 s, 4 s … capped at 15 s. */
export const backoffMs = (failures: number) =>
  Math.min(15_000, 1000 * 2 ** Math.max(0, failures - 1));

/** The body of changes / poll replies. */
export interface ChangesReply {
  messages: OpsMessage[];
  more: boolean;
  presence: PresenceMessage[];
  seq?: number;
  nextPollMs?: number;
}
