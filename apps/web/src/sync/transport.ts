import type { TransportKind } from '../lib/settings';
import type { BlockOp, ConnectionStatus, OpsMessage, PresenceMessage } from './types';

export interface TransportHandlers {
  onOps(message: OpsMessage): void;
  onPresence(message: PresenceMessage): void;
  onPresenceSnapshot(entries: PresenceMessage[]): void;
  onLeave(clientId: string): void;
  onStatus(status: ConnectionStatus): void;
}

export interface Transport {
  readonly kind: TransportKind;
  connect(since: number, handlers: TransportHandlers): void;
  sendOps(ops: BlockOp[]): Promise<void>;
  sendPresence(blockId: string | null, caret: number | null): void;
  close(): void;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
  // most 4xx won't get better by retrying
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

export const backoffMs = (failures: number) =>
  Math.min(15_000, 1000 * 2 ** Math.max(0, failures - 1));

export interface ChangesReply {
  messages: OpsMessage[];
  more: boolean;
  presence: PresenceMessage[];
  seq?: number;
  nextPollMs?: number;
}
