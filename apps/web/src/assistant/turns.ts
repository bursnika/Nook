import type { AssistantEvent, ChatMessage } from './events';

export type TimelineItem =
  | { kind: 'step'; n: number; label: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      input: unknown;
      result?: { ok: boolean; summary: string };
    };

/** One question and the answer to it, as it builds up. */
export interface Turn {
  id: number;
  prompt: string;
  text: string;
  timeline: TimelineItem[];
  status: 'streaming' | 'done' | 'stopped' | 'error';
  error?: string;
}

export function newTurn(id: number, prompt: string): Turn {
  return { id, prompt, text: '', timeline: [], status: 'streaming' };
}

/** Folds one event of the stream into the turn. */
export function applyEvent(turn: Turn, event: AssistantEvent): Turn {
  switch (event.type) {
    case 'step':
      return {
        ...turn,
        timeline: [...turn.timeline, { kind: 'step', n: event.n, label: event.label }],
      };
    case 'text':
      return { ...turn, text: turn.text + event.delta };
    case 'tool_call':
      return {
        ...turn,
        timeline: [
          ...turn.timeline,
          { kind: 'tool', id: event.id, name: event.name, input: event.input },
        ],
      };
    case 'tool_result':
      return {
        ...turn,
        timeline: turn.timeline.map((item) =>
          item.kind === 'tool' && item.id === event.id
            ? { ...item, result: { ok: event.ok, summary: event.summary } }
            : item,
        ),
      };
    case 'error':
      return { ...turn, status: 'error', error: event.message };
    case 'done':
      // an error event is followed by done: the error stays
      return turn.status === 'streaming' ? { ...turn, status: 'done' } : turn;
  }
}

export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 8000;

/**
 * What the API receives: the earlier questions and answers plus the new question, within its limits
 * (40 messages, 8000 characters each, starting with a question). The server keeps no conversation.
 */
export function historyFor(turns: Turn[], prompt: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    messages.push({ role: 'user', content: turn.prompt.slice(0, MAX_MESSAGE_CHARS) });
    if (turn.text.trim()) {
      messages.push({ role: 'assistant', content: turn.text.slice(0, MAX_MESSAGE_CHARS) });
    }
  }
  messages.push({ role: 'user', content: prompt.slice(0, MAX_MESSAGE_CHARS) });
  const recent = messages.slice(-MAX_MESSAGES);
  while (recent.length > 1 && recent[0].role !== 'user') recent.shift();
  return recent;
}

/** `key: value` pairs of a tool input in one short line, for the timeline. */
export function summarizeInput(input: unknown, max = 90): string {
  if (typeof input !== 'object' || input === null) return input === undefined ? '' : String(input);
  const parts = Object.entries(input).map(
    ([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
  );
  const line = parts.join(', ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
