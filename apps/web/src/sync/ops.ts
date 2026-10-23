import { isBlockType, normaliseContent, type Block, type BlockOp } from './types';

/** Stable order: by position, then id, so two blocks inserted at the same spot sort the same on every client. */
export function compareBlocks(a: Block, b: Block): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function sortBlocks(blocks: Block[]): Block[] {
  return [...blocks].sort(compareBlocks);
}

/**
 * Applies one operation the way the server does: replays are harmless (inserting an existing id and changing
 * a missing block are ignored). Untouched blocks keep their object identity so memoised rows do not re-render.
 */
export function applyOp(blocks: Block[], op: BlockOp): Block[] {
  const index = blocks.findIndex((block) => block.id === op.id);
  switch (op.type) {
    case 'insert': {
      if (index >= 0) return blocks;
      const block: Block = {
        id: op.id,
        type: isBlockType(op.blockType) ? op.blockType : 'PARAGRAPH',
        content: normaliseContent(op.content),
        position: typeof op.position === 'number' ? op.position : lastPosition(blocks) + 1024,
      };
      return sortBlocks([...blocks, block]);
    }
    case 'update': {
      if (index < 0) return blocks;
      const current = blocks[index]!;
      const next: Block = {
        ...current,
        type: isBlockType(op.blockType) ? op.blockType : current.type,
        content: op.content ? normaliseContent(op.content) : current.content,
      };
      if (next.type === current.type && sameContent(next.content, current.content)) return blocks;
      const copy = blocks.slice();
      copy[index] = next;
      return copy;
    }
    case 'move': {
      if (index < 0 || typeof op.position !== 'number') return blocks;
      if (blocks[index]!.position === op.position) return blocks;
      const copy = blocks.slice();
      copy[index] = { ...blocks[index]!, position: op.position };
      return sortBlocks(copy);
    }
    case 'delete':
      return index < 0 ? blocks : blocks.filter((block) => block.id !== op.id);
  }
}

export function applyOps(blocks: Block[], ops: readonly BlockOp[]): Block[] {
  return ops.reduce(applyOp, blocks);
}

function lastPosition(blocks: Block[]): number {
  return blocks.length ? blocks[blocks.length - 1]!.position : 0;
}

function sameContent(a: Block['content'], b: Block['content']): boolean {
  return a.text === b.text && a.checked === b.checked;
}
