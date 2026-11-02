import { createContext, useContext } from 'react';
import { api } from '../lib/api';
import { getTransport } from '../lib/settings';
import { createTransport } from '../sync/createTransport';
import { SyncClient } from '../sync/syncClient';
import type { Snapshot } from '../sync/types';

export interface EditorEnv {
  createClient(workspaceId: string, pageId: string): SyncClient;
}

export const PAGE_RENAMED = 'nook:page-renamed';

export const defaultEnv: EditorEnv = {
  createClient(workspaceId, pageId) {
    const clientId = crypto.randomUUID();
    const ctx = { workspaceId, pageId, clientId };
    return new SyncClient({
      pageId,
      clientId,
      transportKind: getTransport(),
      loadSnapshot: () => api<Snapshot>(`/workspaces/${workspaceId}/pages/${pageId}/sync`),
      createTransport: (kind) => createTransport(kind, ctx),
      saveTitle: async (title) => {
        await api(`/workspaces/${workspaceId}/pages/${pageId}`, {
          method: 'PATCH',
          json: { title: title.trim() || 'Untitled' },
        });
        window.dispatchEvent(
          new CustomEvent(PAGE_RENAMED, { detail: { workspaceId, pageId, title } }),
        );
        window.dispatchEvent(new Event('nook:pages-changed'));
      },
    });
  },
};

const EnvContext = createContext<EditorEnv>(defaultEnv);
export const EditorEnvProvider = EnvContext.Provider;
export const useEditorEnv = () => useContext(EnvContext);
