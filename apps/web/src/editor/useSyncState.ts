import { useSyncExternalStore } from 'react';
import type { SyncClient, SyncState } from '../sync/syncClient';

export function useSyncState(client: SyncClient): SyncState {
  return useSyncExternalStore(client.subscribe, client.getState, client.getState);
}
