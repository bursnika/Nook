import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { forgetWorkspace } from '../lib/workspace';
import { PixelIcon } from './PixelIcon';
import { ErrorState, LoadingState, Window } from './ui';
import '../styles/picker.css';

export function CenteredWindow({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="center">
      <Window
        title={title}
        icon="heart"
        level={1}
        className={wide ? 'center__win center__win--wide' : 'center__win'}
      >
        <div className="window__content">{children}</div>
      </Window>
    </main>
  );
}

export function NotFound({ what = 'page', home = '/' }: { what?: string; home?: string }) {
  return (
    <div className="state" role="alert">
      <PixelIcon name="warning" size={44} />
      <p className="state__title">404: this {what} is not here</p>
      <p className="state__text">
        The link may be old, or the {what} was deleted. Nothing is lost, you can start again from
        the desktop.
      </p>
      <Link className="btn btn--primary" to={home}>
        Back to the desktop
      </Link>
    </div>
  );
}

export function WorkspaceGate({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error?: Error;
  retry: () => void;
}) {
  const missing = error instanceof ApiError && [400, 403, 404].includes(error.status);
  // so the picker doesn't jump back to it next time
  useEffect(() => {
    if (missing) forgetWorkspace();
  }, [missing]);
  if (missing) {
    return (
      <CenteredWindow title="Workspace not found">
        <NotFound what="workspace" />
      </CenteredWindow>
    );
  }
  return (
    <CenteredWindow title="Nook">
      {error ? (
        <ErrorState error={error} onRetry={retry} />
      ) : (
        <LoadingState label={loading ? 'Opening workspace' : 'Loading'} />
      )}
    </CenteredWindow>
  );
}
