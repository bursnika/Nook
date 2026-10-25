import type { ReactNode } from 'react';

/**
 * A small, safe renderer for the answer: paragraphs, headings (as bold lines), bullet and numbered lists,
 * fenced code, `code` and **bold**. It builds React elements from text, so nothing is ever parsed as HTML
 * and links are not made: whatever a page or a task title contains stays plain text.
 */

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+?\*\*)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{inline(part.slice(2, -2).replace(/\*\*/g, ''), key)}</strong>;
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,4})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const FENCE = /^\s*```/;

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | undefined;
  let code: string[] | undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `p${blocks.length}`;
    blocks.push(
      <p key={key}>
        {paragraph.flatMap((line, index) => [
          ...(index > 0 ? [<br key={`${key}-br${index}`} />] : []),
          ...inline(line, `${key}-${index}`),
        ])}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l${blocks.length}`;
    const items = list.items.map((item, index) => (
      <li key={index}>{inline(item, `${key}-${index}`)}</li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={key} start={list.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      ),
    );
    list = undefined;
  };

  for (const line of lines) {
    if (code) {
      if (FENCE.test(line)) {
        blocks.push(
          <pre key={`c${blocks.length}`}>
            <code>{code.join('\n')}</code>
          </pre>,
        );
        code = undefined;
      } else {
        code.push(line);
      }
      continue;
    }
    if (FENCE.test(line)) {
      flushParagraph();
      flushList();
      code = [];
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(
        <p key={`h${blocks.length}`} className="rt__heading">
          <strong>{inline(heading[1].replace(/\*\*/g, ''), `h${blocks.length}`)}</strong>
        </p>,
      );
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(bullet ? bullet[1] : numbered![2]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  // text still streaming: an unclosed fence shows what it has so far
  if (code) {
    blocks.push(
      <pre key={`c${blocks.length}`}>
        <code>{code.join('\n')}</code>
      </pre>,
    );
  }
  flushParagraph();
  flushList();
  return <div className="rt">{blocks}</div>;
}
