import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export interface Me {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isPlatformAdmin?: boolean;
}

const SessionContext = createContext<Me | null>(null);

/** The signed-in person. Anonymous visitors are sent to Google; they come back to the page they wanted. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api<Me>('/auth/me')
      .then(setMe)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          const back = window.location.pathname + window.location.search;
          window.location.assign(`/api/auth/google?returnTo=${encodeURIComponent(back)}`);
        } else setProblem(error instanceof Error ? error.message : 'Cannot reach the server');
      });
  }, []);

  if (problem)
    return (
      <p role="alert" className="boot">
        {problem}
      </p>
    );
  if (!me) return <p className="boot">Loading…</p>;
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useMe must be used inside SessionProvider');
  return me;
}

export async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.assign('/app/');
}
