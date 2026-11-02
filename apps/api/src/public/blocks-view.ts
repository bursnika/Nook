export interface PublicBlock {
  type: string;
  content: unknown;
}

export type ViewNode =
  | { kind: 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'code'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'todo'; items: { text: string; checked: boolean }[] }
  | { kind: 'hr' };

const textOf = (content: unknown): string => {
  const text = (content as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text : '';
};

const HEADINGS = { HEADING_1: 'h1', HEADING_2: 'h2', HEADING_3: 'h3' } as const;

export function toViewNodes(blocks: PublicBlock[]): ViewNode[] {
  const nodes: ViewNode[] = [];
  for (const block of blocks) {
    const text = textOf(block.content);
    const last = nodes[nodes.length - 1];
    switch (block.type) {
      case 'BULLETED_LIST':
      case 'NUMBERED_LIST': {
        const kind = block.type === 'BULLETED_LIST' ? 'ul' : 'ol';
        if (last?.kind === kind) last.items.push(text);
        else nodes.push({ kind, items: [text] });
        break;
      }
      case 'TODO': {
        const checked = (block.content as { checked?: unknown } | null)?.checked === true;
        if (last?.kind === 'todo') last.items.push({ text, checked });
        else nodes.push({ kind: 'todo', items: [{ text, checked }] });
        break;
      }
      case 'DIVIDER':
        nodes.push({ kind: 'hr' });
        break;
      case 'QUOTE':
        nodes.push({ kind: 'quote', text });
        break;
      case 'CODE':
        nodes.push({ kind: 'code', text });
        break;
      default: {
        const heading = HEADINGS[block.type as keyof typeof HEADINGS];
        nodes.push({ kind: heading ?? 'p', text });
      }
    }
  }
  return nodes;
}

export function describe(blocks: PublicBlock[], max = 160): string {
  const text = blocks
    .map((block) => textOf(block.content).trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

// escape < so the json can't close the script tag
export const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
