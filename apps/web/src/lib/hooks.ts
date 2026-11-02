import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface Resource<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (update: T | ((current: T | undefined) => T | undefined)) => void;
}

// an older, slower response never overwrites a newer one
export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const run = useCallback(async (initial: boolean) => {
    const mine = ++seq.current;
    if (initial) setLoading(true);
    try {
      const result = await loadRef.current();
      if (mine !== seq.current) return;
      setData(result);
      setError(undefined);
    } catch (problem) {
      if (mine !== seq.current) return;
      setError(problem instanceof Error ? problem : new Error(String(problem)));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(undefined);
    setError(undefined);
    void run(true);
    return () => {
      seq.current++;
    };
  }, [key, run]);

  const reload = useCallback(() => run(false), [run]);
  return { data, error, loading, reload, setData };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      query?.addEventListener('change', notify);
      return () => query?.removeEventListener('change', notify);
    },
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    () => false,
  );
}

export function useIsNarrow(query = '(max-width: 860px)'): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener('change', notify);
      return () => list?.removeEventListener('change', notify);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

export function useNow(ms = 10_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
