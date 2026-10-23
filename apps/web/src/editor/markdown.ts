import type { BlockType } from '../sync/types';

export interface Shortcut {
  type: BlockType;
  /** What is left of the text once the marker is removed. */
  text: string;
  checked?: boolean;
}

/**
 * Markdown typed at the start of a paragraph turns it into a block:
 * `# `, `## `, `### `, `- `/`* `, `1. `, `[] `/`[ ] `/`[x] `, `> `, three backticks, `---`.
 * Returns null when the text is not a shortcut.
 */
export function parseShortcut(text: string): Shortcut | null {
  if (text === '---') return { type: 'DIVIDER', text: '' };
  if (text === '```') return { type: 'CODE', text: '' };
  let match = /^(#{1,3}) (.*)$/s.exec(text);
  if (match) {
    const level = match[1]!.length as 1 | 2 | 3;
    return { type: `HEADING_${level}`, text: match[2]! };
  }
  match = /^[-*] (.*)$/s.exec(text);
  if (match) return { type: 'BULLETED_LIST', text: match[1]! };
  match = /^\d+\. (.*)$/s.exec(text);
  if (match) return { type: 'NUMBERED_LIST', text: match[1]! };
  match = /^\[([ xX]?)\] (.*)$/s.exec(text);
  if (match) return { type: 'TODO', text: match[2]!, checked: match[1]!.toLowerCase() === 'x' };
  match = /^> (.*)$/s.exec(text);
  if (match) return { type: 'QUOTE', text: match[1]! };
  return null;
}
