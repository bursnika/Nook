import { useState } from 'react';
import { Badge, Window } from '../components/ui';
import { api } from '../lib/api';
import { useResource } from '../lib/hooks';

/** A personal token for home-screen widgets. Shown once, because the server keeps only its hash. */
export function WidgetCard() {
  const status = useResource(() => api<{ exists: boolean }>('/widget/token'), 'widget');
  const [token, setToken] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const base = window.location.origin;

  const create = async () => {
    setProblem(undefined);
    try {
      const reply = await api<{ token: string }>('/widget/token', { method: 'POST' });
      setToken(reply.token);
      status.reload();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not create a token');
    }
  };

  const revoke = async () => {
    await api('/widget/token', { method: 'DELETE' });
    setToken(undefined);
    status.reload();
  };

  return (
    <Window title="Widgets" icon="heart" tone="lavender" className="settings__card">
      <div className="window__content">
        <p>
          Show today&apos;s plan on your phone or desktop (Scriptable, KWGT, Übersicht). The token
          can only read the plan.{' '}
          <Badge tone={status.data?.exists ? 'done' : 'todo'}>
            {status.data?.exists ? 'Token active' : 'No token'}
          </Badge>
        </p>
        {token && (
          <div role="status">
            <p className="muted">Copy it now: it is shown only once.</p>
            <input
              className="input"
              readOnly
              value={token}
              aria-label="Widget token"
              onFocus={(event) => event.currentTarget.select()}
              style={{ width: '100%' }}
            />
            <p className="muted">
              Endpoint: <code>{base}/api/widget/today</code> with{' '}
              <code>Authorization: Bearer …</code>
            </p>
          </div>
        )}
        <p className="settings__actions">
          <button type="button" className="btn btn--primary" onClick={() => void create()}>
            {status.data?.exists ? 'Replace token' : 'Create token'}
          </button>
          {status.data?.exists && (
            <button type="button" className="btn" onClick={() => void revoke()}>
              Revoke
            </button>
          )}
        </p>
        {(problem || status.error) && (
          <p role="alert" className="muted">
            {problem ?? status.error?.message}
          </p>
        )}
      </div>
    </Window>
  );
}
