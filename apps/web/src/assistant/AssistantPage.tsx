import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { PixelIcon } from '../components/PixelIcon';
import { EmptyState } from '../components/ui';
import { ApiError } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { streamChat } from './client';
import { RichText } from './RichText';
import {
  applyEvent,
  historyFor,
  MAX_MESSAGE_CHARS,
  newTurn,
  summarizeInput,
  type TimelineItem,
  type Turn,
} from './turns';
import '../styles/assistant.css';

const SUGGESTIONS = [
  'What is due this week?',
  'Plan my day from my open tasks',
  'Add a task: prepare slides for Friday, high priority',
];

/** The Pro-only planning assistant: a chat whose answer streams in together with the steps it takes. */
export default function AssistantPage() {
  const { workspace, isOwner, features, changePlan } = useWorkspace();
  const featureOff = features.some(
    (feature) => feature.key === 'ai-assistant' && !feature.available,
  );

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [blocked, setBlocked] = useState<'gate' | 'unconfigured'>();
  const nextId = useRef(1);
  const abort = useRef<AbortController>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inputId = useId();

  const last = turns.at(-1);
  const streaming = last?.status === 'streaming';

  useEffect(() => {
    textarea.current?.focus();
    return () => abort.current?.abort();
  }, []);

  // follow the answer as it grows, unless the reader scrolled up to look at something
  useEffect(() => {
    const el = thread.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [last?.text, last?.timeline, last?.status, blocked]);

  const update = (id: number, change: (turn: Turn) => Turn) =>
    setTurns((all) => all.map((turn) => (turn.id === id ? change(turn) : turn)));

  const run = async (prompt: string, previous: Turn[]) => {
    const id = nextId.current++;
    const controller = new AbortController();
    abort.current = controller;
    stickToBottom.current = true;
    setBlocked(undefined);
    setTurns([...previous, newTurn(id, prompt)]);
    try {
      for await (const event of streamChat({
        workspaceId: workspace.id,
        messages: historyFor(previous, prompt),
        signal: controller.signal,
      })) {
        update(id, (turn) => applyEvent(turn, event));
      }
      update(id, (turn) =>
        turn.status === 'streaming'
          ? {
              ...turn,
              status: 'error',
              error: 'The connection closed before the answer was finished.',
            }
          : turn,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        update(id, (turn) => (turn.status === 'streaming' ? { ...turn, status: 'stopped' } : turn));
      } else if (error instanceof ApiError && error.status === 403 && featureCode(error)) {
        // the plan changed since the page loaded: show the gate and give the question back
        setTurns(previous);
        setDraft(prompt);
        setBlocked('gate');
      } else if (error instanceof ApiError && error.status === 503) {
        setBlocked('unconfigured');
        update(id, (turn) => ({ ...turn, status: 'error', error: error.message }));
      } else {
        update(id, (turn) => ({
          ...turn,
          status: 'error',
          error:
            error instanceof ApiError
              ? error.message
              : 'The connection was lost before the answer was finished.',
        }));
      }
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  const submit = (text = draft) => {
    const prompt = text.trim();
    if (!prompt || streaming) return;
    setDraft('');
    void run(prompt, turns);
  };

  const stop = () => {
    abort.current?.abort();
    textarea.current?.focus();
  };

  const retry = () => {
    if (!last || streaming) return;
    void run(last.prompt, turns.slice(0, -1));
    textarea.current?.focus();
  };

  const reset = () => {
    abort.current?.abort();
    setTurns([]);
    setBlocked(undefined);
    textarea.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks the line; Enter that confirms an IME composition is left alone
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  if (blocked === 'gate' || featureOff) {
    return (
      <ProGate
        free={workspace.plan === 'FREE'}
        isOwner={isOwner}
        onUpgrade={() => changePlan('PRO')}
        reason={features.find((feature) => feature.key === 'ai-assistant')?.reason}
      />
    );
  }

  if (blocked === 'unconfigured') {
    return (
      <div className="state assistant__unconfigured" role="alert">
        <PixelIcon name="warning" size={44} />
        <p className="state__title">The AI assistant is not set up yet</p>
        <p className="state__text">
          This server has no AI key. {isOwner ? 'Set' : 'Ask the person who runs Nook to set'}{' '}
          <code>ANTHROPIC_API_KEY</code> in the API settings and restart it.
        </p>
        <button type="button" className="btn" onClick={retry}>
          Check again
        </button>
      </div>
    );
  }

  return (
    <div className="assistant">
      <div className="assistant__head">
        <p className="muted">
          Ask about tasks, events and pages in <strong>{workspace.name}</strong>. The assistant
          reads your real data and can create tasks and events. Nothing is saved on the server.
        </p>
        <button
          type="button"
          className="btn btn--small"
          disabled={turns.length === 0}
          onClick={reset}
        >
          New chat
        </button>
      </div>

      <div
        className="assistant__thread"
        ref={thread}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {turns.length === 0 ? (
          <EmptyState title="What shall we plan?" icon="heart">
            <ul className="assistant__suggestions" aria-label="Ideas">
              {SUGGESTIONS.map((text) => (
                <li key={text}>
                  <button
                    type="button"
                    className="btn btn--blue btn--small"
                    onClick={() => {
                      setDraft(text);
                      textarea.current?.focus();
                    }}
                  >
                    {text}
                  </button>
                </li>
              ))}
            </ul>
          </EmptyState>
        ) : (
          turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              canRetry={turn === last && turn.status === 'error'}
              onRetry={retry}
            />
          ))
        )}
      </div>

      <p className="sr-only" role="status">
        {statusText(last)}
      </p>

      <form
        className="assistant__composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Message to the assistant
        </label>
        <textarea
          id={inputId}
          ref={textarea}
          className="input assistant__input"
          rows={Math.min(6, Math.max(2, draft.split('\n').length))}
          maxLength={MAX_MESSAGE_CHARS}
          value={draft}
          placeholder="Ask about your plans…"
          aria-describedby={`${inputId}-hint`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {streaming ? (
          <button type="button" className="btn btn--danger" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
            Send
          </button>
        )}
        <p id={`${inputId}-hint`} className="assistant__hint">
          Enter sends, Shift+Enter adds a line.
        </p>
      </form>
    </div>
  );
}

function featureCode(error: ApiError): boolean {
  return (error.body as { code?: string } | undefined)?.code === 'FEATURE_NOT_AVAILABLE';
}

/** What a screen reader hears about the answer: the steps while it works, then how it ended. */
function statusText(turn: Turn | undefined): string {
  if (!turn) return '';
  switch (turn.status) {
    case 'streaming': {
      const item = turn.timeline.at(-1);
      if (!item) return 'The assistant is working.';
      return item.kind === 'step'
        ? `Step ${item.n}: ${item.label}.`
        : item.result
          ? `${item.name}: ${item.result.summary}.`
          : `Running ${item.name}.`;
    }
    case 'done':
      return 'The answer is complete.';
    case 'stopped':
      return 'Stopped.';
    case 'error':
      return `Error: ${turn.error ?? 'something went wrong'}`;
  }
}

function TurnView({
  turn,
  canRetry,
  onRetry,
}: {
  turn: Turn;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const streaming = turn.status === 'streaming';
  return (
    <article className="turn">
      <div className="bubble bubble--user">
        <span className="bubble__who">You</span>
        <p className="bubble__prompt">{turn.prompt}</p>
      </div>
      <div className="bubble bubble--bot">
        <span className="bubble__who">Nook assistant</span>
        {turn.timeline.length > 0 && <Steps timeline={turn.timeline} streaming={streaming} />}
        {/* aria-busy holds back the announcement until the answer is complete */}
        <div className="bubble__answer" aria-live="polite" aria-busy={streaming}>
          {turn.text ? (
            <RichText text={turn.text} />
          ) : (
            streaming && <p className="muted">Thinking…</p>
          )}
          {streaming && <span className="caret" aria-hidden="true" />}
        </div>
        {turn.status === 'stopped' && <p className="bubble__note">Stopped.</p>}
        {turn.status === 'error' && (
          <div className="form-error assistant__error" role="alert">
            <span>{turn.error}</span>
            {canRetry && (
              <button type="button" className="btn btn--small" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** The timeline of the answer: each model step and each tool call with what it returned. */
function Steps({ timeline, streaming }: { timeline: TimelineItem[]; streaming: boolean }) {
  const [chosen, setChosen] = useState<boolean>();
  const open = chosen ?? streaming; // open while it works, tidy afterwards, unless the reader decided
  const id = useId();
  const calls = timeline.filter((item) => item.kind === 'tool').length;
  return (
    <div className="steps">
      <button
        type="button"
        className="steps__toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setChosen(!open)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> Steps
        <span className="steps__count">
          {calls} tool {calls === 1 ? 'call' : 'calls'}
        </span>
      </button>
      {open && (
        <ol id={id} className="steps__list" aria-label="Steps of the answer">
          {timeline.map((item) => (
            <TimelineRow key={item.kind === 'step' ? `s${item.n}` : `t${item.id}`} item={item} />
          ))}
        </ol>
      )}
    </div>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (item.kind === 'step') {
    return (
      <li className="step step--model">
        <span className="step__tag">Step {item.n}</span> {item.label}
      </li>
    );
  }
  const summary = summarizeInput(item.input);
  return (
    <li className="step step--tool">
      <button
        type="button"
        className="step__head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <code className="step__name">{item.name}</code>
        {summary && <span className="step__input">{summary}</span>}
      </button>
      <p
        className={`step__result ${
          item.result ? (item.result.ok ? 'step__result--ok' : 'step__result--bad') : ''
        }`}
      >
        {item.result ? (
          <>
            <span aria-hidden="true">{item.result.ok ? '✓' : '✗'}</span>{' '}
            <span className="sr-only">{item.result.ok ? 'Done: ' : 'Failed: '}</span>
            {item.result.summary}
          </>
        ) : (
          'Running…'
        )}
      </p>
      {open && (
        <pre id={id} className="step__json">
          {JSON.stringify(item.input, null, 2)}
        </pre>
      )}
    </li>
  );
}

/** The Insights pattern: say what Pro adds and let an owner switch the plan. */
function ProGate({
  free,
  isOwner,
  onUpgrade,
  reason,
}: {
  free: boolean;
  isOwner: boolean;
  onUpgrade: () => Promise<void>;
  reason?: string;
}) {
  const [switching, setSwitching] = useState(false);
  const [problem, setProblem] = useState<string>();
  const upgrade = async () => {
    setSwitching(true);
    setProblem(undefined);
    try {
      await onUpgrade();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not switch the plan');
      setSwitching(false);
    }
  };
  return (
    <div className="gate">
      <PixelIcon name="lock" size={44} />
      <h2>{free ? 'The AI assistant is a Pro feature' : 'The AI assistant is switched off'}</h2>
      <p className="muted">
        {free
          ? 'Ask in plain words what is due, let it plan your day, and have it add tasks and events for you. It comes with the Pro plan.'
          : (reason ?? 'An administrator has turned this feature off.')}
      </p>
      {free &&
        (isOwner ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={switching}
            onClick={() => void upgrade()}
          >
            {switching ? 'Switching…' : 'Switch this workspace to Pro'}
          </button>
        ) : (
          <p>Ask a workspace owner to switch the plan.</p>
        ))}
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
