import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filenameFrom,
  importMarkdownFile,
  isMarkdownFile,
  MAX_MARKDOWN_BYTES,
  readTextFile,
} from './markdownFile';

const file = (content: string, name: string, type = 'text/markdown') =>
  new File([content], name, { type });

afterEach(() => vi.unstubAllGlobals());

describe('isMarkdownFile', () => {
  it('accepts markdown and text by extension or type', () => {
    expect(isMarkdownFile(file('', 'notes.md', ''))).toBe(true);
    expect(isMarkdownFile(file('', 'NOTES.MARKDOWN', ''))).toBe(true);
    expect(isMarkdownFile(file('', 'readme', 'text/plain'))).toBe(true);
    expect(isMarkdownFile(file('', 'photo.png', 'image/png'))).toBe(false);
  });
});

describe('readTextFile', () => {
  it('reads the content of a file', async () => {
    expect(await readTextFile(file('# Hi\n\nthere', 'a.md'))).toBe('# Hi\n\nthere');
  });
});

describe('filenameFrom', () => {
  it('prefers the name the server suggests', () => {
    expect(filenameFrom('attachment; filename="laboratorna-no1.md"', 'Лабораторна')).toBe(
      'laboratorna-no1.md',
    );
  });

  it('falls back to a safe name from the title', () => {
    expect(filenameFrom(null, 'My Trip, 2030!')).toBe('my-trip-2030.md');
    expect(filenameFrom(null, '???')).toBe('page.md');
  });
});

describe('importMarkdownFile', () => {
  const stubApi = () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ id: 'p1', title: 'Imported' }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('sends the markdown and lets the first heading be the title', async () => {
    const fetchMock = stubApi();
    const page = await importMarkdownFile('ws1', file('# Plan\n\n- one', 'plan.md'));
    expect(page).toEqual({ id: 'p1', title: 'Imported' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/workspaces/ws1/pages/import');
    expect(JSON.parse(String(init?.body))).toEqual({ markdown: '# Plan\n\n- one' });
  });

  it('names the page after the file when the text has no heading', async () => {
    const fetchMock = stubApi();
    await importMarkdownFile('ws1', file('just text', 'My notes.md'));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      markdown: 'just text',
      title: 'My notes',
    });
  });

  it('refuses wrong, empty and oversized files without calling the server', async () => {
    const fetchMock = stubApi();
    const reason = async (candidate: File) =>
      importMarkdownFile('ws1', candidate).then(
        () => 'accepted',
        (error: Error) => error.message,
      );
    expect(await reason(file('x', 'a.png', 'image/png'))).toMatch(/not a Markdown/);
    expect(await reason(file('   ', 'a.md'))).toMatch(/empty/);
    const big = file('x', 'big.md');
    Object.defineProperty(big, 'size', { value: MAX_MARKDOWN_BYTES + 1 });
    expect(await reason(big)).toMatch(/1 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
