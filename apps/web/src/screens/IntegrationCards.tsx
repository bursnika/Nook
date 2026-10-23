import { useState } from 'react';
import { Badge, Window } from '../components/ui';
import { api } from '../lib/api';
import { useResource } from '../lib/hooks';

interface TelegramStatus {
  configured: boolean;
  linked: boolean;
  botUsername: string | null;
  digestHourUtc: number;
}

interface LinkCode {
  code: string;
  url: string | null;
  expiresInSeconds: number;
}

/** Links a Telegram chat to the person: the bot then sends the morning plan and answers /today. */
export function TelegramCard() {
  const status = useResource(() => api<TelegramStatus>('/telegram'), 'telegram');
  const [link, setLink] = useState<LinkCode>();
  const [problem, setProblem] = useState<string>();

  const connect = async () => {
    setProblem(undefined);
    try {
      setLink(await api<LinkCode>('/telegram/link', { method: 'POST' }));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not create a link');
    }
  };

  const unlink = async () => {
    await api('/telegram', { method: 'DELETE' });
    setLink(undefined);
    status.reload();
  };

  const data = status.data;
  return (
    <Window title="Telegram" icon="sparkle" tone="blue" className="settings__card">
      <div className="window__content">
        {status.loading && <p className="muted">Loading…</p>}
        {data && !data.configured && (
          <p className="muted">
            The bot is not set up on this server (needs <code>TELEGRAM_BOT_TOKEN</code>).
          </p>
        )}
        {data?.configured && (
          <>
            <p>
              Get your plan every morning at {String(data.digestHourUtc).padStart(2, '0')}:00 UTC
              and ask the bot <code>/today</code> any time.{' '}
              <Badge tone={data.linked ? 'done' : 'todo'}>
                {data.linked ? 'Linked' : 'Not linked'}
              </Badge>
            </p>
            {link && (
              <p role="status">
                {link.url ? (
                  <>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      Open the bot in Telegram
                    </a>{' '}
                    and press Start.
                  </>
                ) : (
                  <>
                    Send <code>/start {link.code}</code> to the bot.
                  </>
                )}{' '}
                <span className="muted">
                  The link works for {Math.round(link.expiresInSeconds / 60)} minutes.
                </span>
              </p>
            )}
            <p className="settings__actions">
              <button type="button" className="btn btn--primary" onClick={() => void connect()}>
                {data.linked ? 'Link another chat' : 'Connect Telegram'}
              </button>
              {data.linked && (
                <button type="button" className="btn" onClick={() => void unlink()}>
                  Unlink
                </button>
              )}
              <button type="button" className="btn" onClick={() => status.reload()}>
                Refresh status
              </button>
            </p>
          </>
        )}
        {(problem || status.error) && (
          <p role="alert" className="muted">
            {problem ?? status.error?.message}
          </p>
        )}
      </div>
    </Window>
  );
}

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
