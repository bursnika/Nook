import { ApiError } from '../lib/api';
import { toAssistantEvent, type AssistantEvent, type ChatMessage } from './events';
import { readSse } from './parseSse';

/** POSTs the conversation and yields the answer's events as they arrive. Throws ApiError for a non-200 reply. */
export async function* streamChat({
  workspaceId,
  messages,
  signal,
}: {
  workspaceId: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}): AsyncGenerator<AssistantEvent> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/assistant/chat`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ messages }),
      signal,
    },
  );
  if (!response.ok) throw await errorOf(response);
  if (!response.body) throw new Error('The browser gave no response stream');
  for await (const message of readSse(response.body)) {
    const event = toAssistantEvent(message);
    if (event) yield event;
  }
}

async function errorOf(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '');
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  const message = (body as { message?: string | string[] } | undefined)?.message;
  return new ApiError(
    response.status,
    Array.isArray(message) ? message.join(', ') : (message ?? response.statusText),
    body,
  );
}
