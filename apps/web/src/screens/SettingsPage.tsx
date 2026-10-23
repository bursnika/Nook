import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Window } from '../components/ui';
import { api } from '../lib/api';
import { useResource } from '../lib/hooks';
import { getTransport, setTransport, TRANSPORTS, type TransportKind } from '../lib/settings';
import { signOut, useMe } from '../lib/session';
import type { GoogleStatus, Plan } from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import '../styles/settings.css';
import { LOCALE } from '../lib/locale';

export default function SettingsPage() {
  const { workspace, features, isOwner, role, changePlan } = useWorkspace();
  const me = useMe();
  const [transport, setTransportState] = useState<TransportKind>(getTransport);
  const [switching, setSwitching] = useState(false);
  const [problem, setProblem] = useState<string>();
  const google = useResource(
    () => api<GoogleStatus>(`/workspaces/${workspace.id}/google-calendar`),
    workspace.id,
  );

  const switchPlan = async (plan: Plan) => {
    setSwitching(true);
    setProblem(undefined);
    try {
      await changePlan(plan);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not switch the plan');
    } finally {
      setSwitching(false);
    }
  };

  const other: Plan = workspace.plan === 'PRO' ? 'FREE' : 'PRO';

  return (
    <div className="settings">
      <Window title="Plan" icon="sparkle" tone="pink" className="settings__card">
        <div className="window__content">
          <p>
            <strong>{workspace.name}</strong> is on the{' '}
            <Badge tone={workspace.plan === 'PRO' ? 'doing' : 'todo'}>{workspace.plan}</Badge> plan.
            {role && <span className="muted"> Your role: {role.toLowerCase()}.</span>}
          </p>
          <ul className="features">
            {features.map((feature) => (
              <li key={feature.key}>
                <Badge tone={feature.available ? 'done' : 'todo'}>
                  {feature.available ? 'On' : 'Off'}
                </Badge>
                <span>
                  <strong>{feature.key}</strong>
                  <span className="muted"> {feature.description}</span>
                  {!feature.available && feature.reason && (
                    <span className="features__reason"> {feature.reason}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {isOwner ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={switching}
              onClick={() => void switchPlan(other)}
            >
              {switching ? 'Switching…' : `Switch to ${other === 'PRO' ? 'Pro' : 'Free'}`}
            </button>
          ) : (
            <p className="muted">Only a workspace owner can change the plan.</p>
          )}
          {problem && (
            <p className="form-error" role="alert">
              {problem}
            </p>
          )}
        </div>
      </Window>

      <Window title="Editor live updates" icon="page" tone="blue" className="settings__card">
        <div className="window__content">
          <fieldset className="radios">
            <legend className="label">How the editor receives changes from others</legend>
            {TRANSPORTS.map((option) => (
              <label key={option.kind} className="radio">
                <input
                  type="radio"
                  name="transport"
                  value={option.kind}
                  checked={transport === option.kind}
                  onChange={() => {
                    setTransport(option.kind);
                    setTransportState(option.kind);
                  }}
                />
                <span>
                  <strong>{option.label}</strong>
                  <span className="muted"> {option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="muted">Applies the next time you open a page.</p>
        </div>
      </Window>

      <Window title="Google Calendar" icon="calendar" tone="lavender" className="settings__card">
        <div className="window__content">
          {google.loading ? (
            <p role="status">Checking…</p>
          ) : google.error || !google.data ? (
            <p className="form-error" role="alert">
              {google.error?.message ?? 'Could not read the Google Calendar status.'}
            </p>
          ) : (
            <ul className="plain-list">
              <li>
                Server setup:{' '}
                <Badge tone={google.data.configured ? 'done' : 'late'}>
                  {google.data.configured ? 'Ready' : 'Missing'}
                </Badge>
              </li>
              <li>
                Your link:{' '}
                <Badge tone={google.data.connected ? 'done' : 'todo'}>
                  {google.data.connected ? 'Connected' : 'Not connected'}
                </Badge>
              </li>
              {google.data.connected && (
                <>
                  <li>
                    Editing Google events:{' '}
                    <Badge tone={google.data.editGranted ? 'done' : 'todo'}>
                      {google.data.editGranted ? 'Allowed' : 'Read only'}
                    </Badge>
                    {!google.data.twoWay && (
                      <span className="muted"> (two-way sync needs Pro)</span>
                    )}
                  </li>
                  <li>
                    Last sync:{' '}
                    {google.data.lastSyncAt
                      ? new Date(google.data.lastSyncAt).toLocaleString(LOCALE, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : 'never'}
                  </li>
                </>
              )}
            </ul>
          )}
          <p>
            <Link to={`/w/${workspace.id}/calendar`}>Connect or sync in the calendar</Link>
          </p>
        </div>
      </Window>

      <Window title="Account" icon="heart" tone="gray" className="settings__card">
        <div className="window__content">
          <p>
            Signed in as <strong>{me.name}</strong> <span className="muted">({me.email})</span>.
          </p>
          <p className="settings__actions">
            <button type="button" className="btn" onClick={() => void signOut()}>
              Sign out
            </button>
            <a className="btn btn--blue" href="/admin">
              Classic admin
            </a>
          </p>
        </div>
      </Window>
    </div>
  );
}
