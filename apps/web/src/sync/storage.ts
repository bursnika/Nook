import { isBlockType, normaliseContent, type Block, type BlockOp, type PageInfo } from './types';

/** What is kept in localStorage per page, so a closed browser loses nothing. */
export interface StoredDoc {
  v: 1;
  blocks: Block[];
  outbox: BlockOp[];
  /** Last log position we applied. */
  seq: number;
  page: PageInfo | null;
  /** A title edit that the server has not confirmed yet. */
  dirtyTitle: string | null;
  savedAt: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const docKey = (pageId: string) => `nook.editor.${pageId}`;

export function loadDoc(store: KeyValueStore | null, pageId: string): StoredDoc | null {
  if (!store) return null;
  try {
    const raw = store.getItem(docKey(pageId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDoc>;
    if (parsed.v !== 1 || !Array.isArray(parsed.blocks) || !Array.isArray(parsed.outbox))
      return null;
    const blocks = parsed.blocks.flatMap((b): Block[] =>
      b && typeof b.id === 'string' && isBlockType(b.type) && typeof b.position === 'number'
        ? [{ id: b.id, type: b.type, content: normaliseContent(b.content), position: b.position }]
        : [],
    );
    return {
      v: 1,
      blocks,
      outbox: parsed.outbox.filter((op) => op && typeof op.id === 'string'),
      seq: typeof parsed.seq === 'number' ? parsed.seq : 0,
      page: parsed.page ?? null,
      dirtyTitle: typeof parsed.dirtyTitle === 'string' ? parsed.dirtyTitle : null,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveDoc(store: KeyValueStore | null, pageId: string, doc: StoredDoc): void {
  if (!store) return;
  try {
    store.setItem(docKey(pageId), JSON.stringify(doc));
  } catch {
    // quota or blocked storage: the server copy still exists
  }
}

export function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
