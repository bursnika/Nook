import { api } from './api';
import { track } from './analytics';

/** The API refuses Markdown above this size; checking first gives a clearer message than a 413. */
export const MAX_MARKDOWN_BYTES = 1_000_000;

const MARKDOWN_NAME = /\.(md|markdown|txt)$/i;

export function isMarkdownFile(file: File) {
  return (
    MARKDOWN_NAME.test(file.name) || file.type === 'text/markdown' || file.type === 'text/plain'
  );
}

/** Reads a dropped or chosen file with the File API. */
export function readTextFile(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsText(file);
  });
}

export interface ImportedPage {
  id: string;
  title: string;
}

/** Turns a Markdown file into a new page: the first `# heading` becomes its title. */
export async function importMarkdownFile(workspaceId: string, file: File): Promise<ImportedPage> {
  if (!isMarkdownFile(file)) throw new Error(`“${file.name}” is not a Markdown or text file.`);
  if (file.size > MAX_MARKDOWN_BYTES) throw new Error('The file is larger than 1 MB.');
  const markdown = await readTextFile(file);
  if (!markdown.trim()) throw new Error('The file is empty.');
  const fallbackTitle =
    file.name.replace(MARKDOWN_NAME, '').trim().slice(0, 200) || 'Imported page';
  const page = await api<ImportedPage>(`/workspaces/${workspaceId}/pages/import`, {
    method: 'POST',
    json: { markdown, ...(/^\s*# /.test(markdown) ? {} : { title: fallbackTitle }) },
  });
  track('page_created', { source: 'markdown_import' });
  window.dispatchEvent(new Event('nook:pages-changed'));
  return page;
}

/** The file name the server suggests, or a safe one made from the title. */
export function filenameFrom(disposition: string | null, title: string) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  if (match) return match[1];
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'page'}.md`;
}

/** Downloads a page as a `.md` file: fetch the Markdown, hand it to the browser as a Blob. */
export async function exportMarkdownFile(workspaceId: string, page: { id: string; title: string }) {
  const response = await fetch(`/api/workspaces/${workspaceId}/pages/${page.id}/export.md`, {
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`Could not export the page (${response.status}).`);
  const blob = new Blob([await response.text()], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFrom(response.headers.get('Content-Disposition'), page.title);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
