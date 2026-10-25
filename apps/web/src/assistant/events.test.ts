import { toAssistantEvent } from './events';

const event = (name: string, data: unknown) =>
  toAssistantEvent({ event: name, data: JSON.stringify(data) });

describe('toAssistantEvent', () => {
  it('reads every event of the protocol', () => {
    expect(event('step', { n: 1, label: 'Reading' })).toEqual({
      type: 'step',
      n: 1,
      label: 'Reading',
    });
    expect(event('text', { delta: 'x' })).toEqual({ type: 'text', delta: 'x' });
    expect(event('tool_call', { id: 'a', name: 'list_tasks', input: { status: 'TODO' } })).toEqual({
      type: 'tool_call',
      id: 'a',
      name: 'list_tasks',
      input: { status: 'TODO' },
    });
    expect(event('tool_result', { id: 'a', name: 'list_tasks', ok: false, summary: 's' })).toEqual({
      type: 'tool_result',
      id: 'a',
      name: 'list_tasks',
      ok: false,
      summary: 's',
    });
    expect(event('error', { message: 'bad' })).toEqual({ type: 'error', message: 'bad' });
    expect(event('done', { usage: { inputTokens: 1, outputTokens: 2 } })).toEqual({
      type: 'done',
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    expect(event('done', {})).toEqual({ type: 'done' });
  });

  it('skips unknown events, bad shapes and bad JSON', () => {
    expect(event('ping', {})).toBeNull();
    expect(event('text', { delta: 5 })).toBeNull();
    expect(event('step', { n: '1' })).toBeNull();
    expect(event('text', ['x'])).toBeNull();
    expect(toAssistantEvent({ event: 'text', data: '{oops' })).toBeNull();
  });
});
