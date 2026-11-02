import { api, ApiError } from '../lib/api';
import { pagePath, TransportError, type ChangesReply, type TransportContext } from './transport';
import type { BlockOp } from './types';

export function toTransportError(error: unknown): TransportError {
  if (error instanceof TransportError) return error;
  if (error instanceof ApiError) return new TransportError(error.message, error.status);
  return new TransportError(error instanceof Error ? error.message : 'Network error');
}

export async function postOps(ctx: TransportContext, ops: BlockOp[]): Promise<void> {
  try {
    await api(`${pagePath(ctx)}/ops`, { method: 'POST', json: { clientId: ctx.clientId, ops } });
  } catch (error) {
    throw toTransportError(error);
  }
}

export async function getChanges(
  ctx: TransportContext,
  since: number,
  kind: 'changes' | 'poll',
  signal?: AbortSignal,
): Promise<ChangesReply> {
  const query = `since=${since}&clientId=${encodeURIComponent(ctx.clientId)}`;
  const path = kind === 'poll' ? `/poll?${query}&timeout=25` : `/changes?${query}`;
  const reply = await api<Partial<ChangesReply>>(`${pagePath(ctx)}${path}`, { signal });
  return {
    messages: reply.messages ?? [],
    more: reply.more === true,
    presence: reply.presence ?? [],
    seq: reply.seq,
    nextPollMs: reply.nextPollMs,
  };
}

export function postPresence(ctx: TransportContext, blockId: string | null, caret: number | null) {
  void api(`${pagePath(ctx)}/presence`, {
    method: 'POST',
    json: { clientId: ctx.clientId, blockId, ...(caret === null ? {} : { caret }) },
  }).catch(() => undefined);
}

export function deletePresence(ctx: TransportContext) {
  void api(`${pagePath(ctx)}/presence?clientId=${encodeURIComponent(ctx.clientId)}`, {
    method: 'DELETE',
    keepalive: true,
  }).catch(() => undefined);
}
