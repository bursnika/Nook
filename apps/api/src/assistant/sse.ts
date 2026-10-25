import type { AssistantEvent } from './assistant.types.js';

/** One server-sent event. JSON has no raw line breaks, so the payload always fits one `data:` line. */
export function formatSse({ event, data }: AssistantEvent): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A comment line: ignored by EventSource and by our client, it only keeps proxies from closing an idle stream. */
export function formatSseComment(text: string): string {
  return `: ${text.replace(/[\r\n]+/g, ' ')}\n\n`;
}
