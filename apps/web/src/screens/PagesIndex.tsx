import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PixelIcon } from '../components/PixelIcon';
import { Dialog, EmptyState, Field, LoadingState } from '../components/ui';
import type { PageSummary } from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import '../styles/pages.css';
import { LOCALE } from '../lib/locale';
import { exportMarkdownFile, importMarkdownFile } from '../lib/markdownFile';

export default function PagesIndex() {
  const { workspace, pages, pagesLoading, createPage, deletePage } = useWorkspace();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<PageSummary>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...pages]
      .filter((page) => !needle || page.title.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [pages, query]);

  const create = async () => {
    setProblem(undefined);
    setBusy(true);
    try {
      const page = await createPage();
      navigate(`/w/${workspace.id}/pages/${page.id}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not create the page');
      setBusy(false);
    }
  };

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setProblem(undefined);
    setBusy(true);
    try {
      let last;
      for (const file of list) last = await importMarkdownFile(workspace.id, file);
      if (last && list.length === 1) navigate(`/w/${workspace.id}/pages/${last.id}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not import the file');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void importFiles(event.dataTransfer.files);
  };

  const exportPage = async (page: PageSummary) => {
    setProblem(undefined);
    try {
      await exportMarkdownFile(workspace.id, page);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not export the page');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deletePage(deleting.id);
      setDeleting(undefined);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not delete the page');
      setDeleting(undefined);
    }
  };

  if (pagesLoading && pages.length === 0) return <LoadingState label="Loading pages" />;

  return (
    <div
      className={`pages${dragging ? ' pages--dragging' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="page-head">
        <h2>Pages</h2>
        <div className="pages__actions">
          <input
            ref={fileInput}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            multiple
            hidden
            aria-label="Markdown files to import"
            onChange={(event) => {
              void importFiles(event.target.files ?? []);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            Import .md
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void create()}
          >
            New page
          </button>
        </div>
      </div>
      <p className="muted pages__drop-hint">
        {dragging
          ? 'Drop Markdown files here to import them'
          : 'Tip: drag .md files onto this screen to import them.'}
      </p>
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
      {pages.length === 0 ? (
        <EmptyState title="No pages yet" icon="page">
          Pages are where notes, plans and checklists live. Create the first one.
        </EmptyState>
      ) : (
        <>
          <Field label="Search pages" htmlFor="page-search">
            <input
              id="page-search"
              type="search"
              className="input pages__search"
              value={query}
              placeholder="Type a title"
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
          {shown.length === 0 ? (
            <p className="muted" role="status">
              Nothing matches “{query}”.
            </p>
          ) : (
            <ul className="pages__list">
              {shown.map((page) => (
                <li key={page.id} className="pages__item">
                  <Link to={`/w/${workspace.id}/pages/${page.id}`} className="pages__link">
                    <span className="pages__icon" aria-hidden="true">
                      {page.icon || <PixelIcon name="page" size={20} />}
                    </span>
                    <span className="pages__title">{page.title || 'Untitled'}</span>
                    <span className="pages__meta">
                      Edited{' '}
                      {new Date(page.updatedAt).toLocaleDateString(LOCALE, {
                        day: 'numeric',
                        month: 'short',
                      })}
                      {page._count?.children ? ` · ${page._count.children} subpages` : ''}
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="btn btn--small"
                    aria-label={`Export ${page.title || 'Untitled'} as Markdown`}
                    onClick={() => void exportPage(page)}
                  >
                    Export .md
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--danger"
                    aria-label={`Delete ${page.title || 'Untitled'}`}
                    onClick={() => setDeleting(page)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {deleting && (
        <Dialog
          title="Warning"
          role="alertdialog"
          onClose={() => setDeleting(undefined)}
          footer={
            <>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void confirmDelete()}
              >
                Delete
              </button>
              <button
                type="button"
                className="btn"
                autoFocus
                onClick={() => setDeleting(undefined)}
              >
                Keep it
              </button>
            </>
          }
        >
          <div className="pages__warn">
            <PixelIcon name="warning" size={36} />
            <p>
              Delete “{deleting.title || 'Untitled'}”?
              {deleting._count?.children ? ' Its subpages are deleted with it.' : ''} This cannot be
              undone.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
