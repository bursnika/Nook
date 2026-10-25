import { formatSse, formatSseComment } from './sse.js';

describe('formatSse', () => {
  it('writes the event name, one data line of JSON and a blank line', () => {
    expect(formatSse({ event: 'text', data: { delta: 'Hello' } })).toBe(
      'event: text\ndata: {"delta":"Hello"}\n\n',
    );
  });

  it('keeps line breaks and quotes inside the JSON string, never in the frame', () => {
    const frame = formatSse({ event: 'text', data: { delta: 'a\nb "c"\r\n\n' } });
    expect(frame.split('\n')).toHaveLength(4); // event, data, blank, trailing
    expect(frame).toContain('"a\\nb \\"c\\"\\r\\n\\n"');
    const data = frame.split('\n')[1].replace('data: ', '');
    expect(JSON.parse(data)).toEqual({ delta: 'a\nb "c"\r\n\n' });
  });

  it('handles an event without payload fields', () => {
    expect(formatSse({ event: 'done', data: {} })).toBe('event: done\ndata: {}\n\n');
  });

  it('formats comments on one line', () => {
    expect(formatSseComment('keep-alive')).toBe(': keep-alive\n\n');
    expect(formatSseComment('two\nlines')).toBe(': two lines\n\n');
  });
});
