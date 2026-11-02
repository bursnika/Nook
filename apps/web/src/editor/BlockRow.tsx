import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'framer-motion';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { colorFor } from '../sync/colors';
import type { RecentChange, RemotePresence } from '../sync/syncClient';
import type { Block } from '../sync/types';
import type { CaretTarget, EditorActions } from './actions';
import { measureCaret, onFirstLine, onLastLine } from './caret';
import { filterCommands, slashQuery } from './slash';
import { optionId, SlashMenu } from './SlashMenu';

export interface FocusRequest {
  id: string;
  caret: CaretTarget;
  nonce: number;
}

interface Props {
  block: Block;
  number: number;
  peers: readonly RemotePresence[];
  recent: RecentChange | undefined;
  focus: FocusRequest | null;
  actions: EditorActions;
  dragging: boolean;
  onCaret(id: string, caret: number | null): void;
}

const PLACEHOLDERS: Record<Block['type'], string> = {
  PARAGRAPH: "Type '/' for commands",
  HEADING_1: 'Heading 1',
  HEADING_2: 'Heading 2',
  HEADING_3: 'Heading 3',
  BULLETED_LIST: 'List item',
  NUMBERED_LIST: 'List item',
  TODO: 'To-do',
  QUOTE: 'Quote',
  CODE: 'Code',
  DIVIDER: '',
};

function BlockRowImpl({ block, number, peers, recent, focus, actions, dragging, onCaret }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });
  const fieldRef = useRef<HTMLTextAreaElement | HTMLDivElement | null>(null);
  const { id, type } = block;
  const { text } = block.content;

  const style = { transform: CSS.Translate.toString(transform), transition };
  const isText = type !== 'DIVIDER';
  const menuId = useId();

  const query = isText && type !== 'CODE' ? slashQuery(text) : null;
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const menuOpen = query !== null && dismissedFor !== text;
  const commands = menuOpen ? filterCommands(query) : [];
  const activeIndex = Math.min(active, Math.max(0, commands.length - 1));
  useEffect(() => setActive(0), [query]);

  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!focus || !el) return;
    el.focus({ preventScroll: false });
    if (el instanceof HTMLTextAreaElement) {
      const at = focus.caret === 'end' ? el.value.length : Math.min(focus.caret, el.value.length);
      el.setSelectionRange(at, at);
    }
  }, [focus]);

  const area = fieldRef.current instanceof HTMLTextAreaElement ? fieldRef.current : null;
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!(el instanceof HTMLTextAreaElement)) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, type]);
  useEffect(() => {
    const el = fieldRef.current;
    if (!(el instanceof HTMLTextAreaElement) || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [type]);

  // remote edit: keep the caret where it was
  const selection = useRef<[number, number]>([0, 0]);
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!(el instanceof HTMLTextAreaElement) || document.activeElement !== el) return;
    const [start, end] = selection.current;
    if (el.selectionStart !== start || el.selectionEnd !== end) {
      el.setSelectionRange(Math.min(start, el.value.length), Math.min(end, el.value.length));
    }
  }, [text]);

  const reportCaret = useCallback(
    (el: HTMLTextAreaElement) => {
      selection.current = [el.selectionStart, el.selectionEnd];
      onCaret(id, el.selectionStart);
    },
    [id, onCaret],
  );

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    selection.current = [event.target.selectionStart, event.target.selectionEnd];
    actions.change(id, event.target.value);
  };

  const pick = (index: number) => {
    const command = commands[index];
    if (command) actions.applyCommand(id, command.type);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    if (event.nativeEvent.isComposing) return;

    if (menuOpen && commands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((activeIndex + 1) % commands.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((activeIndex - 1 + commands.length) % commands.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        pick(activeIndex);
        return;
      }
    }
    if (menuOpen && event.key === 'Escape') {
      event.preventDefault();
      setDismissedFor(text);
      return;
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      actions.moveBy(id, event.key === 'ArrowUp' ? -1 : 1);
      focusSoon();
      return;
    }

    const collapsed = el.selectionStart === el.selectionEnd;
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      if (type === 'CODE') {
        const atEnd = collapsed && el.selectionStart === el.value.length;
        if (atEnd && el.value.endsWith('\n')) {
          event.preventDefault();
          actions.leaveCode(id);
        }
        return;
      }
      event.preventDefault();
      actions.enter(id, el.selectionStart, el.selectionEnd);
      return;
    }
    if (event.key === 'Backspace' && collapsed && el.selectionStart === 0) {
      if (actions.backspaceAtStart(id)) event.preventDefault();
      return;
    }
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && collapsed) {
      if (event.key === 'ArrowUp' && onFirstLine(el)) {
        const column = el.selectionStart - (el.value.lastIndexOf('\n', el.selectionStart - 1) + 1);
        if (actions.focusAdjacent(id, -1, column)) event.preventDefault();
      } else if (event.key === 'ArrowDown' && onLastLine(el)) {
        const column = el.selectionStart - (el.value.lastIndexOf('\n', el.selectionStart - 1) + 1);
        if (actions.focusAdjacent(id, 1, column)) event.preventDefault();
      }
    }
  };

  // moving the node drops focus in some browsers
  const focusSoon = () => {
    const el = fieldRef.current;
    requestAnimationFrame(() => el?.focus());
  };

  const onDividerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      actions.removeDivider(id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      actions.addBelow(id);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (actions.focusAdjacent(id, event.key === 'ArrowUp' ? -1 : 1, 0)) event.preventDefault();
    }
  };

  const peer = peers[0];
  const rowStyle = {
    ...style,
    ...(peer ? { '--peer': colorFor(peer.userId) } : {}),
  } as CSSProperties;
  const changedAt = recent ? new Date(recent.at).toLocaleTimeString() : '';

  const marker =
    type === 'BULLETED_LIST' ? (
      <span className="block__marker block__marker--bullet" aria-hidden="true" />
    ) : type === 'NUMBERED_LIST' ? (
      <span className="block__marker block__marker--number" aria-hidden="true">
        {number}.
      </span>
    ) : type === 'TODO' ? (
      <input
        type="checkbox"
        className="block__check"
        checked={block.content.checked === true}
        aria-label="Done"
        onChange={(event) => actions.toggle(id, event.target.checked)}
      />
    ) : null;

  return (
    <div
      ref={setNodeRef}
      style={rowStyle}
      className={`row${isDragging ? ' row--dragging' : ''}${peer ? ' row--peer' : ''}`}
      data-block-id={id}
      data-type={type}
    >
      <motion.div
        className="row__inner"
        layout={dragging ? false : 'position'}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="row__handle"
          aria-label="Drag to reorder. Space picks up, arrows move, Space drops."
          {...attributes}
          {...listeners}
        >
          <svg
            width="10"
            height="16"
            viewBox="0 0 10 16"
            aria-hidden="true"
            shapeRendering="crispEdges"
          >
            {[0, 5, 10].flatMap((y) =>
              [0, 6].map((x) => (
                <rect key={`${x}-${y}`} x={x} y={y + 1} width="3" height="3" fill="currentColor" />
              )),
            )}
          </svg>
        </button>

        <div
          className={`block block--${type.toLowerCase()}`}
          title={recent ? `Changed by ${recent.name} at ${changedAt}` : undefined}
        >
          {marker}
          {isText ? (
            <div className="block__field">
              <textarea
                ref={(node) => {
                  fieldRef.current = node;
                }}
                className="block__text"
                rows={1}
                value={text}
                spellCheck={type !== 'CODE'}
                wrap={type === 'CODE' ? 'off' : 'soft'}
                placeholder={PLACEHOLDERS[type]}
                aria-label={`${type.replace('_', ' ').toLowerCase()} block`}
                {...(menuOpen
                  ? {
                      role: 'combobox',
                      'aria-expanded': true,
                      'aria-haspopup': 'listbox',
                      'aria-autocomplete': 'list',
                      'aria-controls': menuId,
                      'aria-activedescendant': commands[activeIndex]
                        ? optionId(menuId, commands[activeIndex])
                        : undefined,
                    }
                  : {})}
                data-done={type === 'TODO' && block.content.checked ? 'true' : undefined}
                onChange={onChange}
                onKeyDown={onKeyDown}
                onSelect={(event) => reportCaret(event.currentTarget)}
                onFocus={(event) => reportCaret(event.currentTarget)}
              />
              {peers.map(
                (p) =>
                  p.caret !== null && (
                    <RemoteCaret key={p.clientId} peer={p} area={area} text={text} />
                  ),
              )}
              {menuOpen && (
                <SlashMenu
                  id={menuId}
                  commands={commands}
                  active={activeIndex}
                  onPick={(command) => actions.applyCommand(id, command.type)}
                  onHover={setActive}
                />
              )}
            </div>
          ) : (
            <div
              ref={(node) => {
                fieldRef.current = node;
              }}
              role="separator"
              tabIndex={0}
              aria-label="Divider. Backspace removes it."
              className="block__divider"
              onKeyDown={onDividerKey}
              onFocus={() => onCaret(id, null)}
            />
          )}
        </div>

        <AnimatePresence>
          {recent && (
            <motion.span
              key={recent.nonce}
              className="row__flash"
              initial={{ opacity: 0.85 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
              aria-hidden="true"
            >
              <span className="row__flash-tag" style={{ background: colorFor(recent.userId) }}>
                {recent.name}
              </span>
            </motion.span>
          )}
        </AnimatePresence>

        <div className="row__peers" aria-label={peers.length ? 'Also here' : undefined}>
          {peers.map((p) => (
            <span
              hidden={p.caret !== null && isText}
              key={p.clientId}
              className="peer-flag"
              style={{ background: colorFor(p.userId) }}
            >
              {p.name}
            </span>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function RemoteCaret({
  peer,
  area,
  text,
}: {
  peer: RemotePresence;
  area: HTMLTextAreaElement | null;
  text: string;
}) {
  const [box, setBox] = useState<{ top: number; left: number; height: number } | null>(null);
  const offset = Math.min(peer.caret ?? 0, text.length);
  useLayoutEffect(() => {
    if (area) setBox(measureCaret(area, offset));
  }, [area, offset, text]);
  if (!box) return null;
  const color = colorFor(peer.userId);
  return (
    <span
      className="remote-caret"
      style={{ top: box.top, left: box.left, height: box.height, background: color }}
      aria-hidden="true"
    >
      <span className="remote-caret__flag" style={{ background: color }}>
        {peer.name}
      </span>
    </span>
  );
}

export const BlockRow = memo(BlockRowImpl);
