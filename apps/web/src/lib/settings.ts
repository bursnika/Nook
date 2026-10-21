/** How the editor receives live changes. The three options are compared in docs/c10-comparison.md. */
export type TransportKind = 'websocket' | 'longpoll' | 'polling';

export const TRANSPORTS: { kind: TransportKind; label: string; hint: string }[] = [
  { kind: 'websocket', label: 'WebSocket', hint: 'One open connection, changes arrive at once.' },
  {
    kind: 'longpoll',
    label: 'Long poll',
    hint: 'The server holds each request until something changes.',
  },
  {
    kind: 'polling',
    label: 'Adaptive polling',
    hint: 'Asks often while people type, rarely while it is quiet.',
  },
];

const KEY = 'nook.transport';

export function getTransport(): TransportKind {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'websocket' || value === 'longpoll' || value === 'polling') return value;
  } catch {
    // storage can be blocked; the default is fine
  }
  return 'websocket';
}

export function setTransport(kind: TransportKind) {
  try {
    localStorage.setItem(KEY, kind);
  } catch {
    // ignored: the choice then lasts until the page is reloaded
  }
}
