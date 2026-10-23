/** Shapes shared by the sync client, the transports and the editor. They mirror apps/api/src/realtime. */

export const BLOCK_TYPES = [
  'PARAGRAPH',
  'HEADING_1',
  'HEADING_2',
  'HEADING_3',
  'BULLETED_LIST',
  'NUMBERED_LIST',
  'TODO',
  'QUOTE',
  'CODE',
  'DIVIDER',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface BlockContent {
  text: string;
  checked?: boolean;
}

export interface Block {
  id: string;
  type: BlockType;
  content: BlockContent;
  position: number;
}

/** One change of one block, exactly as the server expects it. */
export interface BlockOp {
  type: 'insert' | 'update' | 'move' | 'delete';
  id: string;
  blockType?: BlockType;
  content?: BlockContent;
  position?: number;
}

export interface OpsMessage {
  type: 'ops';
  seq: number;
  clientId: string;
  authorId: string;
  at: string;
  ops: BlockOp[];
}

export interface PresenceMessage {
  type: 'presence';
  clientId: string;
  userId: string;
  name: string;
  blockId: string | null;
  caret: number | null;
  at: string;
}

export interface PageInfo {
  id: string;
  title: string;
  icon: string | null;
  updatedAt?: string;
}

/** What the server returns for GET .../sync. Blocks carry extra columns we do not need. */
export interface Snapshot {
  page: PageInfo;
  blocks: { id: string; type: BlockType; content: unknown; position: number }[];
  seq: number;
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && (BLOCK_TYPES as readonly string[]).includes(value);
}

/** Server content is free-form JSON: keep what we understand and never throw. */
export function normaliseContent(raw: unknown): BlockContent {
  if (!raw || typeof raw !== 'object') return { text: '' };
  const { text, checked } = raw as { text?: unknown; checked?: unknown };
  const content: BlockContent = { text: typeof text === 'string' ? text : '' };
  if (typeof checked === 'boolean') content.checked = checked;
  return content;
}
