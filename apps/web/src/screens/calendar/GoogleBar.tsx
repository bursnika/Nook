import { useState } from 'react';
import { api } from '../../lib/api';
import type { GoogleStatus } from '../../lib/types';
import { LOCALE } from '../../lib/locale';

interface SyncResult {
  created?: number;
  updated?: number;
  removed?: number;
}

/** Connect, sync and disconnect Google Calendar for this person. */
export function GoogleBar({
  workspaceId,
  status,
  onChanged,
}: {
  workspaceId: string;
  status: GoogleStatus;
  /** Called after a sync or a disconnect so the calendar can reload. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'sync' | 'disconnect'>();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const returnTo = encodeURIComponent(`/app/w/${workspaceId}/calendar`);

  const run = async (kind: 'sync' | 'disconnect', action: () => Promise<string>) => {
    setBusy(kind);
    setMessage(undefined);
    try {
      setMessage({ text: await action() });
      onChanged();
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Something went wrong',
        error: true,
      });
    } finally {
      setBusy(undefined);
    }
  };

  const sync = () =>
    run('sync', async () => {
      const result = await api<SyncResult>(`/workspaces/${workspaceId}/google-calendar/sync`, {
        method: 'POST',
      });
      return `Synced: ${result.created ?? 0} new, ${result.updated ?? 0} updated, ${result.removed ?? 0} removed.`;
    });

  const disconnect = () =>
    run('disconnect', async () => {
      await api('/google-calendar', { method: 'DELETE' });
      return 'Google Calendar is disconnected. Imported events stay until you sync again.';
    });

  return (
    <div className="gbar">
      <div className="gbar__row">
        <span className="gbar__title">Google Calendar</span>
        {!status.configured ? (
          <span className="muted">Not set up on this server.</span>
        ) : !status.connected ? (
          <>
            <span className="muted">Bring your events into Nook.</span>
            <a
              className="btn btn--blue btn--small"
              href={`/api/google-calendar/connect?returnTo=${returnTo}`}
            >
              Connect
            </a>
          </>
        ) : (
          <>
            <span className="muted">
              Connected
              {status.lastSyncAt
                ? `, last synced ${new Date(status.lastSyncAt).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })}`
                : ', not synced yet'}
              .
            </span>
            <button
              type="button"
              className="btn btn--blue btn--small"
              disabled={busy !== undefined}
              onClick={() => void sync()}
            >
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
            {status.twoWay && !status.editGranted && (
              <a
                className="btn btn--small"
                href={`/api/google-calendar/connect?edit=1&returnTo=${returnTo}`}
              >
                Allow editing
              </a>
            )}
            <button
              type="button"
              className="btn btn--small"
              disabled={busy !== undefined}
              onClick={() => void disconnect()}
            >
              Disconnect
            </button>
          </>
        )}
      </div>
      {status.connected && !status.twoWay && (
        <p className="gbar__note">
          Editing Google events from Nook is a Pro feature. Reading them is free.
        </p>
      )}
      {message && (
        <p
          className={message.error ? 'form-error' : 'gbar__note'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
