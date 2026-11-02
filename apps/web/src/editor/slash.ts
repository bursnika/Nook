import type { BlockType } from '../sync/types';

export interface SlashCommand {
  type: BlockType;
  label: string;
  hint: string;
  keywords: string[];
  glyph: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    type: 'PARAGRAPH',
    label: 'Text',
    hint: 'Plain paragraph',
    keywords: ['paragraph', 'p', 'plain'],
    glyph: 'Aa',
  },
  {
    type: 'HEADING_1',
    label: 'Heading 1',
    hint: 'Big section title',
    keywords: ['h1', 'title', '#'],
    glyph: 'H1',
  },
  {
    type: 'HEADING_2',
    label: 'Heading 2',
    hint: 'Medium title',
    keywords: ['h2', 'subtitle', '##'],
    glyph: 'H2',
  },
  {
    type: 'HEADING_3',
    label: 'Heading 3',
    hint: 'Small title',
    keywords: ['h3', '###'],
    glyph: 'H3',
  },
  {
    type: 'BULLETED_LIST',
    label: 'Bulleted list',
    hint: 'A simple list',
    keywords: ['bullet', 'ul', 'list', '-'],
    glyph: '•',
  },
  {
    type: 'NUMBERED_LIST',
    label: 'Numbered list',
    hint: 'A list with numbers',
    keywords: ['number', 'ol', 'list', '1.'],
    glyph: '1.',
  },
  {
    type: 'TODO',
    label: 'To-do',
    hint: 'A checkbox you can tick',
    keywords: ['task', 'checkbox', 'check', '[]'],
    glyph: '[ ]',
  },
  {
    type: 'QUOTE',
    label: 'Quote',
    hint: 'Set a thought apart',
    keywords: ['blockquote', 'cite', '>'],
    glyph: '"',
  },
  {
    type: 'CODE',
    label: 'Code',
    hint: 'Monospace snippet',
    keywords: ['snippet', 'pre', 'mono', '```'],
    glyph: '</>',
  },
  {
    type: 'DIVIDER',
    label: 'Divider',
    hint: 'A horizontal line',
    keywords: ['line', 'hr', 'rule', 'separator', '---'],
    glyph: '--',
  },
];

export function slashQuery(text: string): string | null {
  const match = /^\/(\S*)$/.exec(text);
  return match ? match[1]! : null;
}

export function filterCommands(
  query: string,
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  const scored: { command: SlashCommand; score: number }[] = [];
  for (const command of commands) {
    const label = command.label.toLowerCase();
    const words = [label, command.type.toLowerCase().replace('_', ' '), ...command.keywords];
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (label.split(' ').some((w) => w.startsWith(q))) score = 1;
    else if (words.some((w) => w.startsWith(q))) score = 2;
    else if (words.some((w) => w.includes(q))) score = 3;
    if (score >= 0) scored.push({ command, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.command);
}
