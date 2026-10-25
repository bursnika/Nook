import type { SseMessage } from './parseSse';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The events of one answer, as the API sends them (docs/c21-assistant.md). */
export type AssistantEvent =
  | { type: 'step'; n: number; label: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'error'; message: string }
  | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the shape of an incoming event; anything unexpected (a future event type, bad JSON) is skipped. */
export function toAssistantEvent(message: SseMessage): AssistantEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(message.data);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  switch (message.event) {
    case 'step':
      return typeof data.n === 'number' && typeof data.label === 'string'
        ? { type: 'step', n: data.n, label: data.label }
        : null;
    case 'text':
      return typeof data.delta === 'string' ? { type: 'text', delta: data.delta } : null;
    case 'tool_call':
      return typeof data.id === 'string' && typeof data.name === 'string'
        ? { type: 'tool_call', id: data.id, name: data.name, input: data.input }
        : null;
    case 'tool_result':
      return typeof data.id === 'string' &&
        typeof data.name === 'string' &&
        typeof data.ok === 'boolean' &&
        typeof data.summary === 'string'
        ? { type: 'tool_result', id: data.id, name: data.name, ok: data.ok, summary: data.summary }
        : null;
    case 'error':
      return typeof data.message === 'string' ? { type: 'error', message: data.message } : null;
    case 'done': {
      const usage = data.usage;
      return isRecord(usage) &&
        typeof usage.inputTokens === 'number' &&
        typeof usage.outputTokens === 'number'
        ? {
            type: 'done',
            usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
          }
        : { type: 'done' };
    }
    default:
      return null;
  }
}
