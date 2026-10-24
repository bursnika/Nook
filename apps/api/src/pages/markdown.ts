import { BlockType } from '../generated/prisma/enums.js';

/** What the editor stores in `Block.content` for the types Markdown can express. */
export interface MarkdownBlock {
  type: BlockType;
  content: { text: string; checked?: boolean; language?: string };
}

/** The part of a stored block the exporter reads. */
export interface ExportableBlock {
  type: string;
  content: unknown;
}

export const MAX_TITLE_LENGTH = 200;
export const FALLBACK_TITLE = 'Untitled';

const HEADING_PREFIX = { HEADING_1: '#', HEADING_2: '##', HEADING_3: '###' } as const;

const contentOf = (content: unknown) => (content ?? {}) as Record<string, unknown>;
const textOf = (content: unknown): string => {
  const text = contentOf(content).text;
  return typeof text === 'string' ? text : '';
};

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();

/** A fence one backtick longer than the longest run inside the code, so the code cannot close it early. */
function fenceFor(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * Page to Markdown: the title as `# `, then one construct per block. Items of the same list stay
 * together, and numbered items are counted again from 1 in every run. Empty text blocks are dropped
 * (Markdown has no way to say "an empty paragraph").
 */
export function blocksToMarkdown(title: string, blocks: ExportableBlock[]): string {
  const chunks: { text: string; group: string | null }[] = [
    { text: `# ${oneLine(title) || FALLBACK_TITLE}`, group: null },
  ];
  let number = 0;
  for (const block of blocks) {
    const text = textOf(block.content);
    switch (block.type) {
      case BlockType.HEADING_1:
      case BlockType.HEADING_2:
      case BlockType.HEADING_3: {
        const line = oneLine(text);
        if (line) chunks.push({ text: `${HEADING_PREFIX[block.type]} ${line}`, group: null });
        break;
      }
      case BlockType.BULLETED_LIST:
        chunks.push({
          text: `${bulletMarker(oneLine(text))} ${oneLine(text)}`.trimEnd(),
          group: block.type,
        });
        break;
      case BlockType.NUMBERED_LIST:
        // a dropped empty block does not end a run, or the next export of the result would count differently
        number = chunks[chunks.length - 1].group === block.type ? number + 1 : 1;
        chunks.push({ text: `${number}. ${oneLine(text)}`.trimEnd(), group: block.type });
        break;
      case BlockType.TODO: {
        const box = contentOf(block.content).checked === true ? '[x]' : '[ ]';
        chunks.push({ text: `- ${box} ${oneLine(text)}`.trimEnd(), group: block.type });
        break;
      }
      case BlockType.QUOTE:
        if (text.trim()) {
          const lines = text.trim().split('\n');
          chunks.push({
            text: lines.map((line) => `> ${line.trim()}`.trimEnd()).join('\n'),
            group: null,
          });
        }
        break;
      case BlockType.CODE: {
        const fence = fenceFor(text);
        const language = contentOf(block.content).language;
        const info = typeof language === 'string' ? language.replace(/[\s`]/g, '') : '';
        chunks.push({ text: `${fence}${info}\n${text}\n${fence}`, group: null });
        break;
      }
      case BlockType.DIVIDER:
        chunks.push({ text: '---', group: null });
        break;
      default:
        if (text.trim()) chunks.push({ text: paragraphLines(text), group: null });
    }
  }
  let out = '';
  chunks.forEach((chunk, index) => {
    // items of one list sit on consecutive lines; everything else is a paragraph apart
    if (index > 0) out += chunk.group && chunk.group === chunks[index - 1].group ? '\n' : '\n\n';
    out += chunk.text;
  });
  return `${out}\n`;
}

/** `- ---` would read back as a divider, so a bullet whose text is only dashes (or stars) takes another marker. */
function bulletMarker(text: string): string {
  return ['-', '*', '+'].find((marker) => !DIVIDER.test(`${marker} ${text}`)) ?? '+';
}

const paragraphLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

// A thematic break: three or more of the same of - * _, spaces allowed between them.
const DIVIDER = /^([-*_])(?:\s*\1){2,}$/;
const FENCE_OPEN = /^(`{3,}|~{3,})\s*([^`]*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const TODO = /^[-*+]\s+\[([ xX])\](?:\s+(.*))?$/;
const BULLET = /^[-*+](?:\s+(.*))?$/;
const NUMBERED = /^\d+[.)](?:\s+(.*))?$/;
const QUOTE = /^>\s?(.*)$/;

const HEADING_TYPES = [BlockType.HEADING_1, BlockType.HEADING_2, BlockType.HEADING_3] as const;

export interface ParsedMarkdown {
  /** Text of a leading `# ` line, which is lifted out of the body; undefined when there is none. */
  title: string | undefined;
  blocks: MarkdownBlock[];
}

/**
 * Markdown to blocks, line by line (a line never needs more than the lines of its own construct).
 * Recognised: `#`..`######` (levels 4-6 become heading 3), bullets, numbered items, `- [ ]` todos,
 * `>` quotes, fenced code, and dividers. List nesting is flattened. Everything else (tables, images,
 * HTML, front matter) is kept as paragraphs rather than rejected; consecutive plain lines are one
 * paragraph. Only a `# ` line that opens the document is taken as the title (unless `liftTitle` is off,
 * when the caller already has one and the line stays a heading).
 */
export function markdownToBlocks(
  markdown: string,
  { liftTitle = true }: { liftTitle?: boolean } = {},
): ParsedMarkdown {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let title: string | undefined;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push(text(BlockType.PARAGRAPH, paragraph.join('\n')));
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length) blocks.push(text(BlockType.QUOTE, quote.join('\n')));
    quote = [];
  };
  const flush = () => {
    flushParagraph();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      flush();
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      flush();
      const [, marker, info] = fence;
      const code: string[] = [];
      for (i++; i < lines.length; i++) {
        const closing = lines[i].trim();
        if (closing.length >= marker.length && closing === marker[0].repeat(closing.length)) break;
        code.push(lines[i]);
      }
      const language = info.trim().split(/\s+/)[0];
      blocks.push({
        type: BlockType.CODE,
        content: { text: code.join('\n'), ...(language ? { language } : {}) },
      });
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      flushParagraph();
      quote.push(quoted[1].trim());
      continue;
    }
    flushQuote();

    if (DIVIDER.test(line)) {
      flushParagraph();
      blocks.push({ type: BlockType.DIVIDER, content: { text: '' } });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      // a single `#` that opens the document is its title, not a block
      if (liftTitle && blocks.length === 0 && title === undefined && heading[1].length === 1) {
        title = clampTitle(heading[2]);
      } else {
        blocks.push(text(HEADING_TYPES[Math.min(heading[1].length, 3) - 1], heading[2].trim()));
      }
      continue;
    }
    const todo = TODO.exec(line);
    if (todo) {
      flushParagraph();
      blocks.push({
        type: BlockType.TODO,
        content: { text: (todo[2] ?? '').trim(), checked: todo[1] !== ' ' },
      });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      blocks.push(text(BlockType.BULLETED_LIST, (bullet[1] ?? '').trim()));
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      flushParagraph();
      blocks.push(text(BlockType.NUMBERED_LIST, (numbered[1] ?? '').trim()));
      continue;
    }
    paragraph.push(line);
  }
  flush();

  return { title, blocks };
}

function text(type: BlockType, value: string): MarkdownBlock {
  return { type, content: { text: value } };
}

export function clampTitle(title: string): string {
  const clean = oneLine(title) || FALLBACK_TITLE;
  return clean.length > MAX_TITLE_LENGTH ? `${clean.slice(0, MAX_TITLE_LENGTH - 1)}…` : clean;
}

const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ie',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'iu',
  я: 'ia',
  ы: 'y',
  э: 'e',
  ъ: '',
};

/** A file-name friendly form of a title: Latin letters and digits joined by dashes (Cyrillic is transliterated). */
export function slugify(title: string, fallback = 'page'): string {
  const slug = [...title.toLowerCase()]
    .map((char) => CYRILLIC[char] ?? char)
    .join('')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || fallback;
}
