import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, apiAll } from './api';
import { track } from './analytics';
import { useResource } from './hooks';
import type { Feature, PageSummary, Plan, Role, Workspace } from './types';

const LAST_KEY = 'nook.lastWorkspace';

export function readLastWorkspace(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function rememberWorkspace(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // storage can be blocked; the picker then simply shows the list
  }
}

export function forgetWorkspace() {
  try {
    localStorage.removeItem(LAST_KEY);
  } catch {
    // nothing to forget
  }
}

/** Other parts of the app (the editor when a title changes) can announce that the page tree is stale. */
export const PAGES_CHANGED = 'nook:pages-changed';

interface WorkspaceState {
  workspace: Workspace;
  role: Role | undefined;
  isOwner: boolean;
  features: Feature[];
  pages: PageSummary[];
  pagesLoading: boolean;
  refreshPages: () => Promise<void>;
  /** Creates a page ("Untitled" unless titled), under `parentId` when given, and returns it. */
  createPage: (options?: { parentId?: string; title?: string }) => Promise<PageSummary>;
  deletePage: (id: string) => Promise<void>;
  changePlan: (plan: Plan) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

interface Loaded {
  workspace: Workspace;
  features: Feature[];
  role: Role | undefined;
}

export function WorkspaceProvider({
  workspaceId,
  children,
  fallback,
}: {
  workspaceId: string;
  children: ReactNode;
  /** What to show while loading or when the workspace cannot be opened. */
  fallback: (state: { loading: boolean; error?: Error; retry: () => void }) => ReactNode;
}) {
  const base = useResource<Loaded>(async () => {
    const [workspace, features, mine] = await Promise.all([
      api<Workspace>(`/workspaces/${workspaceId}`),
      api<{ plan: Plan; features: Feature[] }>(`/workspaces/${workspaceId}/features`),
      apiAll<Workspace>('/workspaces'),
    ]);
    const role = mine.find((item) => item.id === workspaceId)?.memberships?.[0]?.role;
    return { workspace: { ...workspace, plan: features.plan }, features: features.features, role };
  }, workspaceId);

  const pageList = useResource<PageSummary[]>(
    () => apiAll<PageSummary>(`/workspaces/${workspaceId}/pages`),
    workspaceId,
  );
  const { reload: reloadPages, setData: setPages } = pageList;
  const { setData: setBase } = base;

  useEffect(() => {
    if (base.data) rememberWorkspace(workspaceId);
  }, [base.data, workspaceId]);

  // the page tree follows edits made elsewhere (another tab, the editor renaming a page)
  useEffect(() => {
    const refresh = () => void reloadPages();
    window.addEventListener(PAGES_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(PAGES_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [reloadPages]);

  const createPage = useCallback(
    async ({ parentId, title = 'Untitled' }: { parentId?: string; title?: string } = {}) => {
      const page = await api<PageSummary>(`/workspaces/${workspaceId}/pages`, {
        method: 'POST',
        json: { title, ...(parentId ? { parentId } : {}) },
      });
      track('page_created', { nested: Boolean(parentId) });
      setPages((current) => [...(current ?? []), page]);
      void reloadPages();
      return page;
    },
    [workspaceId, setPages, reloadPages],
  );

  const deletePage = useCallback(
    async (id: string) => {
      await api(`/workspaces/${workspaceId}/pages/${id}`, { method: 'DELETE' });
      await reloadPages();
    },
    [workspaceId, reloadPages],
  );

  const changePlan = useCallback(
    async (plan: Plan) => {
      await api(`/workspaces/${workspaceId}/plan`, { method: 'POST', json: { plan } });
      const fresh = await api<{ plan: Plan; features: Feature[] }>(
        `/workspaces/${workspaceId}/features`,
      );
      setBase((current) =>
        current
          ? {
              ...current,
              workspace: { ...current.workspace, plan: fresh.plan },
              features: fresh.features,
            }
          : current,
      );
    },
    [workspaceId, setBase],
  );

  const value = useMemo<WorkspaceState | null>(
    () =>
      base.data
        ? {
            workspace: base.data.workspace,
            role: base.data.role,
            isOwner: base.data.role === 'OWNER',
            features: base.data.features,
            pages: pageList.data ?? [],
            pagesLoading: pageList.loading,
            refreshPages: reloadPages,
            createPage,
            deletePage,
            changePlan,
          }
        : null,
    [base.data, pageList.data, pageList.loading, reloadPages, createPage, deletePage, changePlan],
  );

  if (!value) {
    return fallback({ loading: base.loading, error: base.error, retry: () => void base.reload() });
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}

export interface PageNode {
  page: PageSummary;
  children: PageNode[];
}

/** Builds the sidebar tree: oldest first inside each level (the API lists newest first). */
export function buildPageTree(pages: readonly PageSummary[]): PageNode[] {
  const nodes = new Map<string, PageNode>(pages.map((page) => [page.id, { page, children: [] }]));
  const roots: PageNode[] = [];
  const ordered = [...pages].sort((a, b) => a.id.localeCompare(b.id));
  for (const page of ordered) {
    const node = nodes.get(page.id)!;
    const parent = page.parentId ? nodes.get(page.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}
