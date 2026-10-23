import { TRANSPORTS, setTransport, type TransportKind } from '../lib/settings';
import type { SyncState } from '../sync/syncClient';

const LABEL: Record<TransportKind, string> = {
  websocket: 'WebSocket',
  longpoll: 'Long poll',
  polling: 'Polling',
};

export function saveText(state: Pick<SyncState, 'saveState' | 'pending' | 'synced'>): string {
  if (state.saveState === 'offline') {
    return state.pending > 0
      ? `Offline - ${state.pending} change${state.pending === 1 ? '' : 's'} waiting`
      : 'Offline - nothing waiting';
  }
  if (!state.synced) return 'Loading…';
  return state.saveState === 'saving' ? 'Saving…' : 'Saved';
}

interface Props {
  state: SyncState;
  onTransport(kind: TransportKind): void;
}

/** Bottom bar of the editor: whether everything is saved, and how (and whether) we are connected. */
export function StatusBar({ state, onTransport }: Props) {
  const text = saveText(state);
  return (
    <footer className="status" aria-label="Sync status">
      <span
        className={`status__save status__save--${state.saveState}`}
        role="status"
        aria-live="polite"
        data-testid="save-indicator"
      >
        <span className="status__dot" aria-hidden="true" />
        {text}
      </span>
      <span className="status__right">
        <span
          className={`badge badge--${state.status}`}
          data-testid="connection-badge"
          title="How this page receives other people's changes"
        >
          <span className="status__dot" aria-hidden="true" />
          {LABEL[state.transport]} · {state.status}
        </span>
        <label className="status__pick">
          <span className="sr-only">Connection type</span>
          <select
            value={state.transport}
            onChange={(event) => {
              const kind = event.target.value as TransportKind;
              setTransport(kind);
              onTransport(kind);
            }}
          >
            {TRANSPORTS.map((t) => (
              <option key={t.kind} value={t.kind}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </span>
    </footer>
  );
}
