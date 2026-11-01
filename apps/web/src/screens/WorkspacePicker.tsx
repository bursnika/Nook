import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CenteredWindow } from '../components/Gate';
import { PixelIcon } from '../components/PixelIcon';
import { ErrorState, Field, LoadingState } from '../components/ui';
import { api, apiAll, ApiError } from '../lib/api';
import { useResource } from '../lib/hooks';
import { signOut, useMe } from '../lib/session';
import { slugify, withSuffix } from '../lib/slug';
import type { Workspace } from '../lib/types';
import { readLastWorkspace, rememberWorkspace } from '../lib/workspace';

/** `/`: jumps to the last workspace, otherwise lists the workspaces and lets the person create one. */
export default function WorkspacePicker() {
  const me = useMe();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const list = useResource(() => apiAll<Workspace>('/workspaces'), 'mine');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const last = readLastWorkspace();
  if (list.data && last && !params.has('pick') && list.data.some((item) => item.id === last)) {
    return <Navigate to={`/w/${last}`} replace />;
  }

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const base = slugify(trimmed);
      let created: Workspace | undefined;
      // slugs are unique across the whole service, so a taken one gets a short random tail
      for (let attempt = 0; !created && attempt < 4; attempt++) {
        const slug =
          attempt === 0 ? base : withSuffix(base, Math.random().toString(36).slice(2, 6));
        try {
          created = await api<Workspace>('/workspaces', {
            method: 'POST',
            json: { name: trimmed, slug },
          });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
        }
      }
      if (!created)
        throw new Error('Could not find a free address for this workspace. Try another name.');
      rememberWorkspace(created.id);
      navigate(`/w/${created.id}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not create the workspace');
      setBusy(false);
    }
  };

  const items = list.data ?? [];
  return (
    <CenteredWindow title={`Welcome, ${me.name.split(' ')[0] || 'friend'}`}>
      {list.loading ? (
        <LoadingState label="Loading your workspaces" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.reload()} />
      ) : (
        <>
          {items.length > 0 ? (
            <>
              <p className="label" id="ws-heading">
                Open a workspace
              </p>
              <ul className="ws-list" aria-labelledby="ws-heading">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link to={`/w/${item.id}`} onClick={() => rememberWorkspace(item.id)}>
                      <PixelIcon name="desktop" size={24} />
                      <span>{item.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>You have no workspace yet. Create the first one, it takes a second.</p>
          )}
          <form className="picker__create" onSubmit={(event) => void create(event)}>
            <h2>New workspace</h2>
            <div className="picker__row">
              <Field label="Name" htmlFor="ws-name">
                <input
                  id="ws-name"
                  className="input"
                  value={name}
                  maxLength={100}
                  required
                  placeholder="My notes"
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <button
                type="submit"
                className="btn btn--primary picker__submit"
                disabled={busy || !name.trim()}
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
            {problem && (
              <p className="form-error" role="alert">
                {problem}
              </p>
            )}
          </form>
          <p className="picker__foot muted">
            Signed in as {me.email}.{' '}
            <button type="button" className="btn btn--small" onClick={() => void signOut()}>
              Sign out
            </button>
          </p>
        </>
      )}
    </CenteredWindow>
  );
}
