import { useRef, useState, type DragEvent } from 'react';
import { api, apiAll } from '../../lib/api';
import { useResource } from '../../lib/hooks';
import type { Attachment } from '../../lib/types';
import { fileSize, stamp } from './when';

// same limits as the api: no svg/html, max 10 MB
const TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
];
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = [...TYPES, '.md'].join(',');

export function rejectReason(file: File): string | undefined {
  if (!TYPES.includes(file.type) && !file.name.toLowerCase().endsWith('.md'))
    return `${file.name}: only images, PDF, text and Markdown files can be attached`;
  if (file.size > MAX_BYTES) return `${file.name} is larger than 10 MB`;
  return undefined;
}

const extension = (name: string) => name.split('.').pop()?.slice(0, 4).toUpperCase() ?? 'FILE';

export function TaskFiles({
  workspaceId,
  taskId,
  onChanged,
}: {
  workspaceId: string;
  taskId: string;
  onChanged: () => void;
}) {
  const base = `/workspaces/${workspaceId}/attachments`;
  const key = `${base}?taskId=${taskId}`;
  const list = useResource<Attachment[]>(() => apiAll<Attachment>(key), key);
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const [confirming, setConfirming] = useState<string>();
  const [problems, setProblems] = useState<string[]>([]);
  const files = list.data ?? [];

  const upload = async (chosen: readonly File[]) => {
    const errors: string[] = [];
    const accepted = chosen.filter((file) => {
      const reason = rejectReason(file);
      if (reason) errors.push(reason);
      return !reason;
    });
    setProblems(errors);
    if (!accepted.length) return;
    setUploading((n) => n + accepted.length);
    await Promise.all(
      accepted.map(async (file) => {
        const form = new FormData();
        form.append('taskId', taskId);
        // .md files often come without a type
        form.append(
          'file',
          file.type ? file : new Blob([file], { type: 'text/markdown' }),
          file.name,
        );
        try {
          const saved = await api<Attachment>(base, { method: 'POST', body: form });
          list.setData((current) => [saved, ...(current ?? [])]);
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : 'upload failed'}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
    setProblems([...errors]);
    onChanged();
  };

  const remove = async (id: string) => {
    setProblems([]);
    try {
      await api<void>(`${base}/${id}`, { method: 'DELETE' });
      list.setData((current) => current?.filter((file) => file.id !== id));
      setConfirming(undefined);
      onChanged();
    } catch (error) {
      setProblems([error instanceof Error ? error.message : 'Could not remove the file']);
    }
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    void upload([...event.dataTransfer.files]);
  };

  return (
    <section
      className={`issue__section files ${over ? 'is-over' : ''}`}
      aria-labelledby="files-heading"
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes('Files')) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={drop}
    >
      <div className="issue__heading-row">
        <h3 id="files-heading" className="issue__heading">
          Attachments
          {files.length > 0 && <span className="issue__count">{files.length}</span>}
        </h3>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => picker.current?.click()}
          disabled={uploading > 0}
        >
          {uploading > 0 ? 'Uploading…' : '+ Attach'}
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to attach"
          onChange={(event) => {
            const chosen = [...(event.target.files ?? [])];
            event.target.value = '';
            void upload(chosen);
          }}
        />
      </div>
      {problems.map((problem) => (
        <p key={problem} className="form-error" role="alert">
          {problem}
        </p>
      ))}
      {list.error && (
        <p className="form-error" role="alert">
          {list.error.message}
        </p>
      )}
      {files.length === 0 && !list.loading && (
        <p className="files__drop muted">
          Drop files here or use “+ Attach”. Images, PDF, text and Markdown, up to 10 MB.
        </p>
      )}
      {files.length > 0 && (
        <ul className="files__list">
          {files.map((file) => (
            <li key={file.id} className="file">
              <a
                className="file__preview"
                href={file.url}
                target="_blank"
                rel="noreferrer"
                tabIndex={-1}
                aria-hidden="true"
              >
                {file.mimeType.startsWith('image/') ? (
                  <img src={file.url} alt="" loading="lazy" />
                ) : (
                  <span className="file__ext">{extension(file.filename)}</span>
                )}
              </a>
              <div className="file__info">
                <a className="file__name" href={file.url} target="_blank" rel="noreferrer">
                  {file.filename}
                </a>
                <span className="file__meta">
                  {fileSize(file.size)} · {stamp(file.createdAt)}
                </span>
                {confirming === file.id ? (
                  <span className="comment__links">
                    <button
                      type="button"
                      className="link-btn link-btn--danger"
                      onClick={() => void remove(file.id)}
                    >
                      Yes, remove
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setConfirming(undefined)}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className="comment__links">
                    <button
                      type="button"
                      className="link-btn"
                      aria-label={`Remove “${file.filename}”`}
                      onClick={() => setConfirming(file.id)}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
