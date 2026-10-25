import type { TransportKind } from '../lib/settings';
import { applyOp, applyOps, sortBlocks } from './ops';
import { defaultStore, loadDoc, saveDoc, type KeyValueStore } from './storage';
import {
  backoffMs,
  realScheduler,
  TransportError,
  type Scheduler,
  type Transport,
  type TransportHandlers,
} from './transport';
import {
  normaliseContent,
  type Block,
  type BlockContent,
  type BlockOp,
  type BlockType,
  type ConnectionStatus,
  type OpsMessage,
  type PresenceMessage,
  type Snapshot,
} from './types';

export interface RemotePresence {
  clientId: string;
  userId: string;
  name: string;
  blockId: string | null;
  caret: number | null;
}

/** Who changed a block last (somebody else), for the flash and its tooltip. `nonce` restarts the animation. */
export interface RecentChange {
  userId: string;
  name: string;
  at: string;
  nonce: number;
}

export type SaveState = 'saved' | 'saving' | 'offline';

export interface SyncState {
  /** Blocks are on screen: from the local copy, from the server, or both. */
  loaded: boolean;
  /** The server snapshot has been received and reconciled. */
  synced: boolean;
  blocks: Block[];
  title: string;
  icon: string | null;
  status: ConnectionStatus;
  transport: TransportKind;
  /** Unsent operations plus an unsent title. */
  pending: number;
  saveState: SaveState;
  presence: RemotePresence[];
  recent: Record<string, RecentChange>;
  notice: string | null;
  /** The server says there is no such page for this person (deleted, or never theirs): nothing will load. */
  missing: boolean;
}

export interface SyncClientOptions {
  pageId: string;
  clientId: string;
  loadSnapshot(): Promise<Snapshot>;
  createTransport(kind: TransportKind): Transport;
  transportKind: TransportKind;
  saveTitle?(title: string): Promise<void>;
  /** `null` disables persistence. Defaults to localStorage. */
  store?: KeyValueStore | null;
  scheduler?: Scheduler;
  now?: () => number;
  /** Typing is batched into one `update` this long after the last keystroke (default 300 ms). */
  debounceMs?: number;
  /** ...but never held back longer than this (default 1500 ms). */
  maxWaitMs?: number;
  uuid?: () => string;
}

const MAX_BATCH = 100;
const PRESENCE_THROTTLE_MS = 250;
const PRESENCE_KEEPALIVE_MS = 8000;
const PRESENCE_EXPIRY_MS = 30_000;
const TITLE_DEBOUNCE_MS = 600;

type Listener = () => void;

/**
 * The framework-free heart of the editor. It applies local edits at once (optimistic), keeps unsent
 * operations in an outbox that survives a closed browser, sends them in batches through whichever Transport
 * is selected, and applies other people's operations with last-writer-wins per block.
 */
export class SyncClient {
  private readonly o: Required<
    Pick<SyncClientOptions, 'debounceMs' | 'maxWaitMs' | 'scheduler' | 'now' | 'uuid'>
  > &
    SyncClientOptions;
  private readonly store: KeyValueStore | null;
  private readonly listeners = new Set<Listener>();
  private state: SyncState;

  private blocks: Block[] = [];
  private outbox: BlockOp[] = [];
  private inflight = 0;
  private lastSeq = 0;
  private dirtyTitle: string | null = null;
  private titleSending = false;

  private transport: Transport | null = null;
  private transportGen = 0;
  private transportStatus: ConnectionStatus = 'connecting';
  private browserOnline = true;
  private started = false;
  private stopped = false;
  private synced = false;
  private title = '';
  private icon: string | null = null;
  private loaded = false;

  private flushTimer: unknown;
  private burstStart = 0;
  private flushUrgent = false;
  private retryTimer: unknown;
  private sendFailures = 0;
  private titleTimer: unknown;
  private snapshotTimer: unknown;
  private snapshotFailures = 0;
  private sweepTimer: unknown;

  private presence = new Map<string, RemotePresence & { receivedAt: number }>();
  private names = new Map<string, string>();
  private recent: Record<string, RecentChange> = {};
  private nonce = 0;
  private notice: string | null = null;
  private missing = false;

  private cursor: { blockId: string | null; caret: number | null } = { blockId: null, caret: null };
  private lastSentCursor = '';
  private presenceTimer: unknown;
  private keepAliveTimer: unknown;

  constructor(options: SyncClientOptions) {
    this.o = {
      debounceMs: 300,
      maxWaitMs: 1500,
      scheduler: realScheduler,
      now: () => Date.now(),
      uuid: () => crypto.randomUUID(),
      ...options,
    };
    this.store = options.store === undefined ? defaultStore() : options.store;
    this.state = this.build();
    // the local copy is available straight away, before anything touches the network
    const cached = loadDoc(this.store, options.pageId);
    if (cached) {
      this.blocks = sortBlocks(cached.blocks);
      this.outbox = cached.outbox;
      this.lastSeq = cached.seq;
      this.dirtyTitle = cached.dirtyTitle;
      this.title = cached.dirtyTitle ?? cached.page?.title ?? '';
      this.icon = cached.page?.icon ?? null;
      this.loaded = true;
    }
    this.state = this.build();
  }

  // ---------------------------------------------------------------- subscription

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): SyncState => this.state;

  // ---------------------------------------------------------------- lifecycle

  start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.emit();
    void this.loadSnapshot();
    this.sweepTimer = this.o.scheduler.setTimeout(() => this.sweep(), 5000);
  }

  stop() {
    this.stopped = true;
    this.started = false;
    this.persist();
    this.closeTransport();
    for (const timer of [
      this.flushTimer,
      this.retryTimer,
      this.titleTimer,
      this.snapshotTimer,
      this.sweepTimer,
      this.presenceTimer,
      this.keepAliveTimer,
    ]) {
      this.o.scheduler.clearTimeout(timer);
    }
    this.flushTimer = this.retryTimer = this.titleTimer = this.snapshotTimer = undefined;
    this.sweepTimer = this.presenceTimer = this.keepAliveTimer = undefined;
  }

  /** Switch the transport while the editor is open; the log position carries over. */
  setTransportKind(kind: TransportKind) {
    if (kind === this.o.transportKind && (this.transport || !this.synced)) return;
    this.o.transportKind = kind;
    if (!this.synced || this.stopped) {
      this.emit();
      return;
    }
    this.closeTransport();
    this.connectTransport();
  }

  /** The browser's online/offline events: show it immediately, reconnect as soon as the network is back. */
  setBrowserOnline(online: boolean) {
    if (this.browserOnline === online) return;
    this.browserOnline = online;
    this.emit();
    if (!online || this.stopped || !this.started) return;
    if (!this.synced) {
      this.o.scheduler.clearTimeout(this.snapshotTimer);
      void this.loadSnapshot();
    } else {
      this.closeTransport();
      this.connectTransport();
    }
  }

  dismissNotice() {
    if (this.notice === null) return;
    this.notice = null;
    this.emit();
  }

  // ---------------------------------------------------------------- local edits

  getBlock(id: string): Block | undefined {
    return this.blocks.find((block) => block.id === id);
  }

  insertBlock(input: {
    id?: string;
    type?: BlockType;
    content?: BlockContent;
    position: number;
  }): string {
    const id = input.id ?? this.o.uuid();
    this.enqueue(
      {
        type: 'insert',
        id,
        blockType: input.type ?? 'PARAGRAPH',
        content: input.content ?? { text: '' },
        position: input.position,
      },
      true,
    );
    return id;
  }

  updateBlock(id: string, patch: { type?: BlockType; content?: BlockContent }) {
    const op: BlockOp = { type: 'update', id };
    if (patch.type) op.blockType = patch.type;
    if (patch.content) op.content = patch.content;
    this.enqueue(op, patch.type !== undefined);
  }

  moveBlock(id: string, position: number) {
    this.enqueue({ type: 'move', id, position }, true);
  }

  /** Several moves as one batch (used when positions are renormalised). */
  moveBlocks(moves: { id: string; position: number }[]) {
    for (const move of moves)
      this.enqueue({ type: 'move', id: move.id, position: move.position }, true);
  }

  deleteBlock(id: string) {
    this.enqueue({ type: 'delete', id }, true);
  }

  setTitle(title: string) {
    if (title === this.title && this.dirtyTitle === null) return;
    this.title = title;
    this.dirtyTitle = title;
    this.persist();
    this.emit();
    this.o.scheduler.clearTimeout(this.titleTimer);
    this.titleTimer = this.o.scheduler.setTimeout(() => void this.flushTitle(), TITLE_DEBOUNCE_MS);
  }

  /** The caret moved (blockId null: the editor lost focus). Sent throttled; refreshed while focused. */
  setCursor(blockId: string | null, caret: number | null) {
    this.cursor = { blockId, caret };
    if (this.presenceTimer !== undefined) return;
    this.presenceTimer = this.o.scheduler.setTimeout(() => {
      this.presenceTimer = undefined;
      this.sendCursor(false);
    }, PRESENCE_THROTTLE_MS);
  }

  /** Try to send now (used by tests and the "retry" affordance). */
  flush(): Promise<void> {
    return this.flushNow();
  }

  // ---------------------------------------------------------------- outbox

  private enqueue(op: BlockOp, immediate: boolean) {
    const before = this.blocks;
    this.blocks = applyOp(this.blocks, op);
    // nothing changed locally (e.g. an update to the same text): nothing to send either
    if (this.blocks === before && (op.type === 'update' || op.type === 'move')) return;
    this.pushOp(op);
    this.persist();
    this.emit();
    this.scheduleFlush(immediate);
  }

  /** Adds to the outbox, folding into not-yet-sent operations on the same block. */
  private pushOp(op: BlockOp) {
    const first = this.inflight;
    const mine: number[] = [];
    for (let i = first; i < this.outbox.length; i += 1)
      if (this.outbox[i]!.id === op.id) mine.push(i);

    if (op.type === 'delete') {
      const neverSent = mine.some((i) => this.outbox[i]!.type === 'insert');
      this.outbox = this.outbox.filter((_, i) => !mine.includes(i));
      if (!neverSent) this.outbox.push(op);
      return;
    }
    if (op.type === 'update') {
      const target = [...mine]
        .reverse()
        .map((i) => this.outbox[i]!)
        .find((c) => c.type === 'update' || c.type === 'insert');
      if (target) {
        if (op.blockType) target.blockType = op.blockType;
        if (op.content) target.content = op.content;
        return;
      }
    } else if (op.type === 'move') {
      const target = [...mine]
        .reverse()
        .map((i) => this.outbox[i]!)
        .find((c) => c.type === 'move' || c.type === 'insert');
      if (target) {
        target.position = op.position;
        return;
      }
    }
    this.outbox.push(op);
  }

  private scheduleFlush(immediate: boolean) {
    const { scheduler, now, debounceMs, maxWaitMs } = this.o;
    if (this.flushTimer === undefined) this.burstStart = now();
    else if (this.flushUrgent && !immediate) return; // an urgent send is already about to go out
    this.flushUrgent = immediate;
    scheduler.clearTimeout(this.flushTimer);
    const delay = immediate
      ? 0
      : Math.max(0, Math.min(debounceMs, maxWaitMs - (now() - this.burstStart)));
    this.flushTimer = scheduler.setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushNow();
    }, delay);
  }

  private async flushNow(): Promise<void> {
    if (this.inflight > 0 || this.outbox.length === 0 || this.stopped) return;
    const transport = this.transport;
    if (!transport || this.effectiveStatus() !== 'online') return;
    const batch = this.outbox.slice(0, MAX_BATCH).map((op) => ({ ...op }));
    this.inflight = batch.length;
    this.o.scheduler.clearTimeout(this.retryTimer);
    try {
      await transport.sendOps(batch);
      this.sendFailures = 0;
      this.outbox.splice(0, batch.length);
      this.inflight = 0;
      this.persist();
      this.emit();
      if (this.outbox.length) this.scheduleFlush(true);
    } catch (error) {
      this.inflight = 0;
      if (this.stopped) return;
      const permanent = error instanceof TransportError && error.permanent;
      if (permanent) {
        this.outbox.splice(0, batch.length);
        this.notice = 'Some changes were rejected by the server and could not be saved.';
        this.persist();
        this.emit();
        if (this.outbox.length) this.scheduleFlush(true);
        return;
      }
      this.sendFailures += 1;
      this.retryTimer = this.o.scheduler.setTimeout(
        () => void this.flushNow(),
        backoffMs(this.sendFailures),
      );
      this.emit();
    }
  }

  private async flushTitle() {
    const title = this.dirtyTitle;
    if (title === null || this.titleSending || !this.o.saveTitle) return;
    if (this.effectiveStatus() !== 'online') return;
    this.titleSending = true;
    try {
      await this.o.saveTitle(title);
      if (this.dirtyTitle === title) this.dirtyTitle = null;
      this.persist();
    } catch {
      this.titleTimer = this.o.scheduler.setTimeout(() => void this.flushTitle(), 5000);
    } finally {
      this.titleSending = false;
      this.emit();
      if (this.dirtyTitle !== null && this.dirtyTitle !== title) void this.flushTitle();
    }
  }

  // ---------------------------------------------------------------- snapshot & transport

  private async loadSnapshot() {
    if (this.stopped) return;
    try {
      const snapshot = await this.o.loadSnapshot();
      if (this.stopped) return;
      this.snapshotFailures = 0;
      this.reconcile(snapshot);
      this.connectTransport();
    } catch (error) {
      if (this.stopped) return;
      // a page that does not exist will not appear by asking again: say so instead of loading forever
      if (isMissing(error)) {
        this.missing = true;
        this.transportStatus = 'offline';
        this.emit();
        return;
      }
      this.snapshotFailures += 1;
      this.transportStatus = 'offline';
      this.emit();
      this.snapshotTimer = this.o.scheduler.setTimeout(
        () => void this.loadSnapshot(),
        backoffMs(this.snapshotFailures),
      );
    }
  }

  /** Server state is the truth; what we have not sent yet is laid on top of it. */
  private reconcile(snapshot: Snapshot) {
    const server: Block[] = snapshot.blocks.map((b) => ({
      id: b.id,
      type: b.type,
      content: normaliseContent(b.content),
      position: b.position,
    }));
    this.blocks = sortBlocks(applyOps(sortBlocks(server), this.outbox));
    this.lastSeq = snapshot.seq;
    this.icon = snapshot.page.icon;
    if (this.dirtyTitle === null) this.title = snapshot.page.title;
    this.loaded = true;
    this.synced = true;
    this.persist();
    this.emit();
  }

  private connectTransport() {
    if (this.stopped || !this.synced) return;
    const gen = ++this.transportGen;
    const transport = this.o.createTransport(this.o.transportKind);
    this.transport = transport;
    this.transportStatus = 'connecting';
    const alive = () => gen === this.transportGen && !this.stopped;
    const handlers: TransportHandlers = {
      onOps: (message) => alive() && this.onOps(message),
      onPresence: (message) => alive() && this.onPresence(message),
      onPresenceSnapshot: (entries) => alive() && this.onPresenceSnapshot(entries),
      onLeave: (clientId) => {
        if (alive() && this.presence.delete(clientId)) this.emit();
      },
      onStatus: (status) => alive() && this.onStatus(status),
    };
    this.emit();
    transport.connect(this.lastSeq, handlers);
  }

  private closeTransport() {
    this.transportGen += 1;
    this.transport?.close();
    this.transport = null;
    this.inflight = 0;
    this.transportStatus = 'connecting';
    this.lastSentCursor = '';
  }

  private onStatus(status: ConnectionStatus) {
    const previous = this.effectiveStatus();
    this.transportStatus = status;
    if (status === 'online') this.sendFailures = 0;
    this.emit();
    if (status === 'online' && previous !== 'online') {
      this.lastSentCursor = '';
      this.sendCursor(true);
      if (this.outbox.length) void this.flushNow();
      if (this.dirtyTitle !== null) void this.flushTitle();
    }
  }

  private effectiveStatus(): ConnectionStatus {
    return this.browserOnline ? this.transportStatus : 'offline';
  }

  // ---------------------------------------------------------------- remote events

  private onOps(message: OpsMessage) {
    if (message.seq <= this.lastSeq) return; // seen already (catch-up overlap, resent frame)
    this.lastSeq = message.seq;
    const mine = message.clientId === this.o.clientId;
    let blocks = this.blocks;
    const recent = { ...this.recent };
    let changedRecent = false;
    for (const op of message.ops) {
      const pending = this.outbox.some((queued) => queued.id === op.id);
      if (op.type === 'delete') {
        if (pending && !mine) {
          this.notice = `${this.nameFor(message.authorId)} deleted a block you were editing.`;
        }
        if (recent[op.id]) {
          delete recent[op.id];
          changedRecent = true;
        }
      } else if (op.type === 'insert') {
        const deletedLocally = this.outbox.some((q) => q.id === op.id && q.type === 'delete');
        if (deletedLocally) continue;
      } else if (pending) {
        // our own newer change to this block is still on its way; it will win on the server anyway
        continue;
      }
      const next = applyOp(blocks, op);
      if (next !== blocks && !mine && op.type !== 'delete') {
        recent[op.id] = {
          userId: message.authorId,
          name: this.nameFor(message.authorId),
          at: message.at,
          nonce: ++this.nonce,
        };
        changedRecent = true;
      }
      blocks = next;
    }
    if (changedRecent) this.recent = recent;
    this.blocks = blocks;
    this.persist();
    this.emit();
  }

  private onPresence(message: PresenceMessage) {
    this.names.set(message.userId, message.name);
    this.presence.set(message.clientId, this.toPresence(message));
    this.emit();
  }

  private onPresenceSnapshot(entries: PresenceMessage[]) {
    this.presence = new Map(entries.map((entry) => [entry.clientId, this.toPresence(entry)]));
    for (const entry of entries) this.names.set(entry.userId, entry.name);
    this.emit();
  }

  private toPresence(message: PresenceMessage) {
    return {
      clientId: message.clientId,
      userId: message.userId,
      name: message.name,
      blockId: message.blockId,
      caret: message.caret,
      receivedAt: this.o.now(),
    };
  }

  private nameFor(userId: string): string {
    return this.names.get(userId) ?? 'Someone';
  }

  private sweep() {
    if (this.stopped) return;
    const limit = this.o.now() - PRESENCE_EXPIRY_MS;
    let removed = false;
    for (const [id, entry] of this.presence) {
      if (entry.receivedAt < limit) {
        this.presence.delete(id);
        removed = true;
      }
    }
    if (removed) this.emit();
    this.sweepTimer = this.o.scheduler.setTimeout(() => this.sweep(), 5000);
  }

  private sendCursor(force: boolean) {
    const transport = this.transport;
    this.o.scheduler.clearTimeout(this.keepAliveTimer);
    if (!transport || this.effectiveStatus() !== 'online') return;
    const { blockId, caret } = this.cursor;
    const key = `${blockId ?? ''}:${caret ?? ''}`;
    if (force || key !== this.lastSentCursor) {
      this.lastSentCursor = key;
      transport.sendPresence(blockId, caret);
    }
    if (blockId) {
      // the server forgets a silent tab after 20 s
      this.keepAliveTimer = this.o.scheduler.setTimeout(
        () => this.sendCursor(true),
        PRESENCE_KEEPALIVE_MS,
      );
    }
  }

  // ---------------------------------------------------------------- state

  private persist() {
    saveDoc(this.store, this.o.pageId, {
      v: 1,
      blocks: this.blocks,
      outbox: this.outbox,
      seq: this.lastSeq,
      page: { id: this.o.pageId, title: this.title, icon: this.icon },
      dirtyTitle: this.dirtyTitle,
      savedAt: this.o.now(),
    });
  }

  private emit() {
    this.state = this.build();
    for (const listener of this.listeners) listener();
  }

  private build(): SyncState {
    const status = this.effectiveStatus();
    const pending = this.outbox.length + (this.dirtyTitle !== null ? 1 : 0);
    const previous = this.state as SyncState | undefined;
    const presence = [...this.presence.values()]
      .map((entry) => ({
        clientId: entry.clientId,
        userId: entry.userId,
        name: entry.name,
        blockId: entry.blockId,
        caret: entry.caret,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.clientId.localeCompare(b.clientId));
    return {
      loaded: this.loaded,
      synced: this.synced,
      blocks: this.blocks,
      title: this.title,
      icon: this.icon,
      status,
      transport: this.o.transportKind,
      pending,
      saveState: status !== 'online' ? 'offline' : pending > 0 ? 'saving' : 'saved',
      presence:
        previous && samePresence(previous.presence, presence) ? previous.presence : presence,
      recent: this.recent,
      notice: this.notice,
      missing: this.missing,
    };
  }
}

/** An API error that says the page is not there (bad id, not found, not allowed), whatever the transport. */
function isMissing(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 400 || status === 403 || status === 404;
}

function samePresence(a: RemotePresence[], b: RemotePresence[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i]!;
      return (
        x.clientId === y.clientId &&
        x.userId === y.userId &&
        x.name === y.name &&
        x.blockId === y.blockId &&
        x.caret === y.caret
      );
    })
  );
}
