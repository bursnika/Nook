import type { TransportKind } from '../lib/settings';
import { LongPollTransport } from './longpoll';
import { AdaptivePollingTransport } from './polling';
import type { Transport, TransportContext } from './transport';
import { WebSocketTransport } from './websocket';

export function createTransport(kind: TransportKind, ctx: TransportContext): Transport {
  switch (kind) {
    case 'websocket':
      return new WebSocketTransport(ctx);
    case 'longpoll':
      return new LongPollTransport(ctx);
    case 'polling':
      return new AdaptivePollingTransport(ctx);
  }
}
