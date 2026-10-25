import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getTransport } from '../lib/settings';
import type { RemotePresence, SyncClient } from '../sync/syncClient';
import { NotFound } from '../components/Gate';
import { createActions, type CaretTarget } from './actions';
import { BlockRow, type FocusRequest } from './BlockRow';
import { useEditorEnv } from './env';
import { Participants } from './Participants';
import { StatusBar } from './StatusBar';
import { useSyncState } from './useSyncState';
import './editor.css';

const NO_PEERS: readonly RemotePresence[] = [];

/** The block editor of one page: title, blocks (drag to reorder), people on the page and the sync status. */
export default function EditorPage() {
  const { workspaceId, pageId } = useParams<{ workspaceId: string; pageId: string }>();
  if (!workspaceId || !pageId) return <p className="boot">No page selected.</p>;
  return <EditorSession key={pageId} workspaceId={workspaceId} pageId={pageId} />;
}

function EditorSession({ workspaceId, pageId }: { workspaceId: string; pageId: string }) {
  const env = useEditorEnv();
  const [client] = useState<SyncClient>(() => env.createClient(workspaceId, pageId));
  const state = useSyncState(client);

  // ---- lifecycle: network, tab visibility, the transport setting changing under us
  useEffect(() => {
    client.start();
    const online = () => client.setBrowserOnline(true);
    const offline = () => client.setBrowserOnline(false);
    const syncTransport = () => client.setTransportKind(getTransport());
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('storage', syncTransport);
    window.addEventListener('focus', syncTransport);
    window.addEventListener('nook:transport', syncTransport);
    const timer = window.setInterval(syncTransport, 1000);
    if (!navigator.onLine) client.setBrowserOnline(false);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('storage', syncTransport);
      window.removeEventListener('focus', syncTransport);
      window.removeEventListener('nook:transport', syncTransport);
      window.clearInterval(timer);
      client.stop();
    };
  }, [client]);

  // ---- focus requests from actions
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const nonce = useRef(0);
  const requestFocus = useCallback((id: string, caret: CaretTarget) => {
    setFocus({ id, caret, nonce: ++nonce.current });
  }, []);
  const actions = useMemo(() => createActions(client, requestFocus), [client, requestFocus]);

  // ---- cursor presence: the caret of the focused block, cleared when focus leaves the editor
  const onCaret = useCallback(
    (id: string, caret: number | null) => client.setCursor(id, caret),
    [client],
  );
  const surface = useRef<HTMLDivElement>(null);
  const onBlur = (event: React.FocusEvent) => {
    if (!surface.current?.contains(event.relatedTarget as Node | null))
      client.setCursor(null, null);
  };

  // ---- derived per-block data (stable identities so memoised rows skip work)
  const peersByBlock = useMemo(() => {
    const map = new Map<string, RemotePresence[]>();
    for (const p of state.presence) {
      if (!p.blockId) continue;
      const list = map.get(p.blockId);
      if (list) list.push(p);
      else map.set(p.blockId, [p]);
    }
    return map;
  }, [state.presence]);
  const numbers = useMemo(() => {
    const result = new Map<string, number>();
    let run = 0;
    for (const block of state.blocks) {
      run = block.type === 'NUMBERED_LIST' ? run + 1 : 0;
      result.set(block.id, run);
    }
    return result;
  }, [state.blocks]);
  const ids = useMemo(() => state.blocks.map((b) => b.id), [state.blocks]);

  // ---- drag and drop
  const [dragging, setDragging] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false);
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    actions.dropAt(String(active.id), arrayMove(ids, from, to).indexOf(String(active.id)));
  };

  // announce other people's edits to screen readers
  const lastChange = useMemo(() => {
    const entries = Object.values(state.recent);
    return entries.sort((a, b) => b.nonce - a.nonce)[0];
  }, [state.recent]);

  const titleRef = useRef<HTMLInputElement>(null);

  if (state.missing) return <NotFound what="page" home={`/w/${workspaceId}/pages`} />;

  return (
    <MotionConfig reducedMotion="user">
      <div className="editor" ref={surface} onBlur={onBlur}>
        <header className="editor__head">
          <div className="editor__titlebar">
            {state.icon && (
              <span className="editor__icon" aria-hidden="true">
                {state.icon}
              </span>
            )}
            <input
              ref={titleRef}
              className="editor__title"
              value={state.title}
              placeholder="Untitled"
              aria-label="Page title"
              maxLength={200}
              onChange={(event) => client.setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'ArrowDown') {
                  const first = state.blocks[0];
                  if (first) {
                    event.preventDefault();
                    requestFocus(first.id, 0);
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    actions.appendOrFocusLast();
                  }
                }
              }}
            />
          </div>
          <Participants presence={state.presence} />
        </header>

        {state.notice && (
          <div className="editor__notice pixel-border" role="status">
            <span>{state.notice}</span>
            <button type="button" className="btn" onClick={() => client.dismissNotice()}>
              OK
            </button>
          </div>
        )}

        <div className="editor__body">
          {!state.loaded ? (
            <p className="editor__loading">Loading…</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={() => setDragging(true)}
              onDragCancel={() => setDragging(false)}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <div className="blocks" role="group" aria-label="Page content">
                  <AnimatePresence initial={false}>
                    {state.blocks.map((block) => (
                      <BlockRow
                        key={block.id}
                        block={block}
                        number={numbers.get(block.id) ?? 0}
                        peers={peersByBlock.get(block.id) ?? NO_PEERS}
                        recent={state.recent[block.id]}
                        focus={focus?.id === block.id ? focus : null}
                        actions={actions}
                        dragging={dragging}
                        onCaret={onCaret}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </SortableContext>
            </DndContext>
          )}
          {state.loaded && (
            <button
              type="button"
              className="editor__append"
              onClick={() => actions.appendOrFocusLast()}
              aria-label="Add a block at the end"
            >
              {state.blocks.length === 0 ? 'Click to start writing' : '+'}
            </button>
          )}
        </div>

        <p className="sr-only" aria-live="polite">
          {lastChange ? `${lastChange.name} changed a block` : ''}
        </p>
        <StatusBar state={state} onTransport={(kind) => client.setTransportKind(kind)} />
      </div>
    </MotionConfig>
  );
}
