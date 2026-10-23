import type { SyncClient } from '../sync/syncClient';
import type { Block, BlockContent, BlockType } from '../sync/types';
import { parseShortcut } from './markdown';
import { between, gapCollapsed, positionAt, renormalise } from './position';

export type CaretTarget = number | 'end';

const LISTS: readonly BlockType[] = ['BULLETED_LIST', 'NUMBERED_LIST', 'TODO'];

/** Block types whose text can be edited. */
export const hasText = (type: BlockType) => type !== 'DIVIDER';

const contentOf = (type: BlockType, text: string, checked?: boolean): BlockContent =>
  type === 'TODO' ? { text, checked: checked ?? false } : { text };

/**
 * Everything the editor does to the document, as plain functions over a SyncClient. Rows call these;
 * keeping them out of the components makes them easy to test and keeps the rows memoisable.
 */
export function createActions(
  client: SyncClient,
  requestFocus: (id: string, caret: CaretTarget) => void,
) {
  const blocks = () => client.getState().blocks;

  /** Position for a new block right after `afterId` (null: at the top); renumbers the page if the gap is gone. */
  function positionAfter(afterId: string | null): number {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const list = blocks();
      const index = afterId === null ? -1 : list.findIndex((b) => b.id === afterId);
      const prev = list[index]?.position;
      const next = list[index + 1]?.position;
      if (!gapCollapsed(prev, next)) return between(prev, next);
      client.moveBlocks(renormalise(list));
    }
    return between(blocks().at(-1)?.position, undefined);
  }

  function insertAfter(afterId: string | null, type: BlockType, text = '', checked?: boolean) {
    return client.insertBlock({
      type,
      content: contentOf(type, text, checked),
      position: positionAfter(afterId),
    });
  }

  function convert(block: Block, type: BlockType, text: string) {
    client.updateBlock(block.id, { type, content: contentOf(type, text, block.content.checked) });
  }

  return {
    /** Typing in a block; a markdown shortcut at the start of a paragraph turns it into another block. */
    change(id: string, text: string) {
      const block = client.getBlock(id);
      if (!block) return;
      const shortcut = block.type === 'PARAGRAPH' ? parseShortcut(text) : null;
      if (shortcut) {
        client.updateBlock(id, {
          type: shortcut.type,
          content: contentOf(shortcut.type, shortcut.text, shortcut.checked),
        });
        if (shortcut.type === 'DIVIDER') requestFocus(insertAfter(id, 'PARAGRAPH'), 0);
        else requestFocus(id, 0);
        return;
      }
      client.updateBlock(id, {
        content:
          block.type === 'TODO' ? { text, checked: block.content.checked ?? false } : { text },
      });
    },

    toggle(id: string, checked: boolean) {
      const block = client.getBlock(id);
      if (block) client.updateBlock(id, { content: { text: block.content.text, checked } });
    },

    /** Choose a block type from the slash menu (the `/query` text is dropped). */
    applyCommand(id: string, type: BlockType) {
      const block = client.getBlock(id);
      if (!block) return;
      convert(block, type, '');
      if (type === 'DIVIDER') requestFocus(insertAfter(id, 'PARAGRAPH'), 0);
      else requestFocus(id, 0);
    },

    /** Enter: split at the caret. An empty list item turns back into a paragraph. */
    enter(id: string, start: number, end: number) {
      const block = client.getBlock(id);
      if (!block) return;
      const text = block.content.text;
      if (text === '' && LISTS.includes(block.type)) {
        convert(block, 'PARAGRAPH', '');
        requestFocus(id, 0);
        return;
      }
      const before = text.slice(0, start);
      const after = text.slice(end);
      const nextType: BlockType = LISTS.includes(block.type) ? block.type : 'PARAGRAPH';
      client.updateBlock(id, { content: contentOf(block.type, before, block.content.checked) });
      requestFocus(insertAfter(id, nextType, after, false), 0);
    },

    /** Enter at the end of a code block after an empty line leaves the block. */
    leaveCode(id: string) {
      const block = client.getBlock(id);
      if (!block) return;
      client.updateBlock(id, { content: { text: block.content.text.replace(/\n+$/, '') } });
      requestFocus(insertAfter(id, 'PARAGRAPH'), 0);
    },

    /** Enter on a divider adds a paragraph below it. */
    addBelow(id: string) {
      requestFocus(insertAfter(id, 'PARAGRAPH'), 0);
    },

    /** The empty space under the last block. */
    appendOrFocusLast() {
      const list = blocks();
      const last = list.at(-1);
      if (last && last.type === 'PARAGRAPH' && last.content.text === '') requestFocus(last.id, 0);
      else requestFocus(insertAfter(last?.id ?? null, 'PARAGRAPH'), 0);
    },

    /** Backspace at the very start. Returns true when it handled the key. */
    backspaceAtStart(id: string): boolean {
      const list = blocks();
      const index = list.findIndex((b) => b.id === id);
      const block = list[index];
      if (!block) return false;
      if (block.type !== 'PARAGRAPH') {
        convert(block, 'PARAGRAPH', block.content.text);
        requestFocus(id, 0);
        return true;
      }
      const previous = list[index - 1];
      if (!previous) return false;
      if (!hasText(previous.type)) {
        client.deleteBlock(previous.id);
        requestFocus(id, 0);
        return true;
      }
      const joined = previous.content.text.length;
      client.updateBlock(previous.id, {
        content: contentOf(
          previous.type,
          previous.content.text + block.content.text,
          previous.content.checked,
        ),
      });
      client.deleteBlock(id);
      requestFocus(previous.id, joined);
      return true;
    },

    /** Delete / Backspace on a divider removes it. */
    removeDivider(id: string) {
      const list = blocks();
      const index = list.findIndex((b) => b.id === id);
      const target = list[index - 1] ?? list[index + 1];
      client.deleteBlock(id);
      if (target) requestFocus(target.id, 'end');
    },

    /** Move the caret to the neighbouring block, keeping the column where possible. */
    focusAdjacent(id: string, direction: -1 | 1, column: number) {
      const list = blocks();
      const index = list.findIndex((b) => b.id === id);
      const target = list[index + direction];
      if (!target) return false;
      if (!hasText(target.type)) {
        requestFocus(target.id, 0);
        return true;
      }
      const text = target.content.text;
      if (direction === -1) {
        const lineStart = text.lastIndexOf('\n') + 1;
        requestFocus(target.id, lineStart + Math.min(column, text.length - lineStart));
      } else {
        const lineEnd = text.indexOf('\n');
        requestFocus(target.id, Math.min(column, lineEnd < 0 ? text.length : lineEnd));
      }
      return true;
    },

    /** Move a block one step up or down (keyboard alternative to dragging). */
    moveBy(id: string, delta: -1 | 1) {
      const list = blocks();
      const index = list.findIndex((b) => b.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= list.length) return;
      this.dropAt(id, target);
    },

    /** Put a block at `finalIndex` of the reordered list. Only that block gets a new position. */
    dropAt(id: string, finalIndex: number) {
      const list = blocks();
      const from = list.findIndex((b) => b.id === id);
      if (from < 0 || from === finalIndex) return;
      const others = list.filter((b) => b.id !== id);
      const position = positionAt(others, finalIndex);
      if (position !== null) client.moveBlock(id, position);
      else {
        const reordered = [...others];
        reordered.splice(finalIndex, 0, list[from]!);
        client.moveBlocks(renormalise(reordered));
      }
    },
  };
}

export type EditorActions = ReturnType<typeof createActions>;
