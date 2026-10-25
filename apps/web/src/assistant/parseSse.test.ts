import { readSse, SseParser, type SseMessage } from './parseSse';

const parse = (...chunks: string[]) => {
  const parser = new SseParser();
  return chunks.flatMap((chunk) => parser.push(chunk));
};

describe('SseParser', () => {
  it('parses an event with a name and JSON data', () => {
    expect(parse('event: text\ndata: {"delta":"Hi"}\n\n')).toEqual([
      { event: 'text', data: '{"delta":"Hi"}' },
    ]);
  });

  it('defaults the event name to "message" and strips one leading space only', () => {
    expect(parse('data:  two spaces\n\n')).toEqual([{ event: 'message', data: ' two spaces' }]);
    expect(parse('data:tight\n\n')).toEqual([{ event: 'message', data: 'tight' }]);
  });

  it('joins several data lines with a line break', () => {
    expect(parse('event: x\ndata: one\ndata: two\ndata:\ndata: four\n\n')).toEqual([
      { event: 'x', data: 'one\ntwo\n\nfour' },
    ]);
  });

  it('ignores comments (keep-alive) and fields it does not know', () => {
    expect(parse(': keep-alive\n\nretry: 3000\nfoo: bar\nevent: a\n: inside\ndata: 1\n\n')).toEqual(
      [{ event: 'a', data: '1' }],
    );
  });

  it('survives a chunk boundary anywhere, even inside a field name or a line break', () => {
    const stream = 'event: step\r\ndata: {"n":1}\r\n\r\nevent: text\ndata: {"delta":"é"}\n\n';
    const expected = [
      { event: 'step', data: '{"n":1}' },
      { event: 'text', data: '{"delta":"é"}' },
    ];
    expect(parse(stream)).toEqual(expected);
    for (let cut = 1; cut < stream.length; cut++) {
      expect(parse(stream.slice(0, cut), stream.slice(cut))).toEqual(expected);
    }
    // one character at a time
    expect(parse(...stream)).toEqual(expected);
  });

  it('accepts \\r, \\n and \\r\\n as line breaks', () => {
    expect(parse('event: a\rdata: 1\r\r')).toEqual([]); // the final \r may still become \r\n
    expect(parse('event: a\rdata: 1\r\rdata: 2\n\n')).toEqual([
      { event: 'a', data: '1' },
      { event: 'message', data: '2' },
    ]);
  });

  it('only dispatches on the blank line and keeps the id', () => {
    const parser = new SseParser();
    expect(parser.push('event: a\ndata: 1\n')).toEqual([]);
    expect(parser.push('id: 7\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'a', data: '1', id: '7' }]);
  });

  it('does not dispatch a block without data, and forgets its event name', () => {
    expect(parse('event: lonely\n\ndata: x\n\n')).toEqual([{ event: 'message', data: 'x' }]);
  });
});

describe('readSse', () => {
  const streamOf = (...parts: Uint8Array[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    });

  it('decodes a UTF-8 character split across chunks', async () => {
    const bytes = new TextEncoder().encode('event: text\ndata: "привіт"\n\n');
    const messages: SseMessage[] = [];
    for await (const message of readSse(streamOf(bytes.slice(0, 20), bytes.slice(20)))) {
      messages.push(message);
    }
    expect(messages).toEqual([{ event: 'text', data: '"привіт"' }]);
  });

  it('drops an event the stream ended in the middle of', async () => {
    const messages: SseMessage[] = [];
    const text = new TextEncoder().encode('event: a\ndata: 1\n\nevent: b\ndata: 2');
    for await (const message of readSse(streamOf(text))) messages.push(message);
    expect(messages).toEqual([{ event: 'a', data: '1' }]);
  });

  it('cancels the stream when the consumer stops early', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\ndata: 2\n\n'));
      },
      cancel,
    });
    for await (const message of readSse(body)) {
      expect(message.data).toBe('1');
      break;
    }
    expect(cancel).toHaveBeenCalled();
  });
});
