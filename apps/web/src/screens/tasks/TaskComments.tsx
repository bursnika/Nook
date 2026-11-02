import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { useResource } from '../../lib/hooks';
import { useMe } from '../../lib/session';
import type { TaskComment } from '../../lib/types';
import { Avatar } from './members';
import { stamp } from './when';

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const sendsOnKey = (event: KeyboardEvent, send: () => void) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    send();
  }
};

export function TaskComments({
  workspaceId,
  taskId,
  canModerate,
  onChanged,
}: {
  workspaceId: string;
  taskId: string;
  canModerate: boolean;
  onChanged: () => void;
}) {
  const me = useMe();
  const base = `/workspaces/${workspaceId}/tasks/${taskId}/comments`;
  const list = useResource<TaskComment[]>(() => api<TaskComment[]>(base), base);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string }>();
  const [confirming, setConfirming] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const comments = [...(list.data ?? [])].reverse();

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await action();
    } catch (error) {
      setProblem(message(error, fallback));
    } finally {
      setBusy(false);
    }
  };

  const post = (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    void run(async () => {
      const comment = await api<TaskComment>(base, { method: 'POST', json: { body } });
      list.setData((current) => [...(current ?? []), comment]);
      setDraft('');
      onChanged();
    }, 'Could not post the comment');
  };

  const save = () => {
    if (!editing) return;
    const body = editing.text.trim();
    if (!body || busy) return;
    void run(async () => {
      const comment = await api<TaskComment>(`${base}/${editing.id}`, {
        method: 'PATCH',
        json: { body },
      });
      list.setData((current) => current?.map((c) => (c.id === comment.id ? comment : c)));
      setEditing(undefined);
    }, 'Could not save the comment');
  };

  const remove = (id: string) =>
    void run(async () => {
      await api<void>(`${base}/${id}`, { method: 'DELETE' });
      list.setData((current) => current?.filter((c) => c.id !== id));
      setConfirming(undefined);
      onChanged();
    }, 'Could not delete the comment');

  return (
    <section className="issue__section" aria-labelledby="comments-heading">
      <h3 id="comments-heading" className="issue__heading">
        Comments
        {comments.length > 0 && <span className="issue__count">{comments.length}</span>}
      </h3>
      <form className="comment-new" onSubmit={post}>
        <Avatar person={me} size={32} />
        <div className="comment-new__box">
          <label htmlFor="comment-new" className="sr-only">
            Add a comment
          </label>
          <textarea
            id="comment-new"
            className="input"
            rows={2}
            maxLength={10000}
            placeholder="Add a comment or a note…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => sendsOnKey(event, post)}
          />
          {draft.trim() && (
            <div className="comment__actions">
              <button type="submit" className="btn btn--small btn--primary" disabled={busy}>
                Comment
              </button>
              <button type="button" className="btn btn--small" onClick={() => setDraft('')}>
                Cancel
              </button>
              <span className="muted comment__tip">Ctrl+Enter to send</span>
            </div>
          )}
        </div>
      </form>
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
      {list.loading && <p className="muted">Loading comments…</p>}
      {list.error && (
        <p className="form-error" role="alert">
          {list.error.message}
        </p>
      )}
      {!list.loading && !list.error && comments.length === 0 && (
        <p className="muted">No comments yet. Notes, links and questions about the card go here.</p>
      )}
      <ol className="comments">
        {comments.map((comment) => {
          const mine = comment.author.id === me.id;
          const edited = comment.updatedAt !== comment.createdAt;
          return (
            <li key={comment.id} className="comment">
              <Avatar person={comment.author} size={32} />
              <div className="comment__main">
                <p className="comment__head">
                  <strong>{mine ? `${comment.author.name} (you)` : comment.author.name}</strong>{' '}
                  <time dateTime={comment.createdAt}>{stamp(comment.createdAt)}</time>
                  {edited && <span className="muted"> · edited</span>}
                </p>
                {editing?.id === comment.id ? (
                  <div>
                    <label htmlFor={`comment-${comment.id}`} className="sr-only">
                      Edit the comment
                    </label>
                    <textarea
                      id={`comment-${comment.id}`}
                      className="input comment__edit"
                      rows={3}
                      maxLength={10000}
                      autoFocus
                      value={editing.text}
                      onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditing(undefined);
                        }
                        sendsOnKey(event, save);
                      }}
                    />
                    <div className="comment__actions">
                      <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={busy || !editing.text.trim()}
                        onClick={save}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => setEditing(undefined)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="comment__body">{comment.body}</p>
                )}
                {editing?.id !== comment.id && (mine || canModerate) && (
                  <div className="comment__links">
                    {confirming === comment.id ? (
                      <>
                        <span>Delete this comment?</span>
                        <button
                          type="button"
                          className="link-btn link-btn--danger"
                          disabled={busy}
                          onClick={() => remove(comment.id)}
                        >
                          Yes, delete
                        </button>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setConfirming(undefined)}
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        {mine && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setEditing({ id: comment.id, text: comment.body })}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setConfirming(comment.id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
