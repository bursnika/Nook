/** One dispatched server-sent event. */
export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/**
 * Incremental parser of the text/event-stream format (WHATWG HTML, "Server-sent events"). EventSource only
 * does GET, and the assistant endpoint is a POST, so the stream is read with fetch and parsed here.
 * Chunks may end anywhere, even between the `\r` and `\n` of a line break.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private id: string | undefined;

  /** Feeds a piece of text and returns the events it completed. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const char = this.buffer[i];
      if (char !== '\n' && char !== '\r') continue;
      // a lone `\r` at the end may be the first half of `\r\n`: wait for the next chunk
      if (char === '\r' && i === this.buffer.length - 1) break;
      const line = this.buffer.slice(start, i);
      if (char === '\r' && this.buffer[i + 1] === '\n') i++;
      start = i + 1;
      const message = this.line(line);
      if (message) messages.push(message);
    }
    this.buffer = this.buffer.slice(start);
    return messages;
  }

  private line(line: string): SseMessage | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null; // a comment, e.g. the server's keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    // `retry` and unknown fields are ignored
    return null;
  }

  private dispatch(): SseMessage | null {
    const message: SseMessage | null =
      this.data.length === 0
        ? null
        : {
            event: this.event || 'message',
            data: this.data.join('\n'),
            ...(this.id === undefined ? {} : { id: this.id }),
          };
    this.event = '';
    this.data = [];
    return message;
  }
}

/** Reads a response body as server-sent events; stops (and cancels the request) when the consumer stops. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    // an event that was not closed by a blank line is dropped, as the specification says
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
