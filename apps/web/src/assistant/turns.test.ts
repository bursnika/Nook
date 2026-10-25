import { applyEvent, historyFor, newTurn, summarizeInput, type Turn } from './turns';

describe('applyEvent', () => {
  it('builds up the timeline, the text and the final status', () => {
    let turn = newTurn(1, 'hi');
    turn = applyEvent(turn, { type: 'step', n: 1, label: 'Reading' });
    turn = applyEvent(turn, { type: 'tool_call', id: 't1', name: 'list_tasks', input: {} });
    turn = applyEvent(turn, {
      type: 'tool_result',
      id: 't1',
      name: 'list_tasks',
      ok: true,
      summary: 'Found 2 tasks',
    });
    turn = applyEvent(turn, { type: 'text', delta: 'You ' });
    turn = applyEvent(turn, { type: 'text', delta: 'have two.' });
    expect(turn.status).toBe('streaming');
    turn = applyEvent(turn, { type: 'done' });
    expect(turn).toMatchObject({
      status: 'done',
      text: 'You have two.',
      timeline: [
        { kind: 'step', n: 1 },
        { kind: 'tool', id: 't1', result: { ok: true, summary: 'Found 2 tasks' } },
      ],
    });
  });

  it('keeps the error when done follows it', () => {
    let turn = newTurn(1, 'hi');
    turn = applyEvent(turn, { type: 'error', message: 'Provider busy' });
    turn = applyEvent(turn, { type: 'done' });
    expect(turn).toMatchObject({ status: 'error', error: 'Provider busy' });
  });
});

describe('historyFor', () => {
  const turn = (id: number, prompt: string, text: string): Turn => ({
    ...newTurn(id, prompt),
    text,
    status: 'done',
  });

  it('sends earlier questions and answers, then the new question', () => {
    expect(historyFor([turn(1, 'a', 'b'), turn(2, 'c', '')], 'd')).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'user', content: 'd' },
    ]);
  });

  it('stays within 40 messages of 8000 characters and starts with a question', () => {
    const turns = Array.from({ length: 30 }, (_, i) => turn(i, `q${i}`, 'x'.repeat(9000)));
    const messages = historyFor(turns, 'now');
    expect(messages.length).toBeLessThanOrEqual(40);
    expect(messages[0].role).toBe('user');
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'now' });
    expect(messages.every((message) => message.content.length <= 8000)).toBe(true);
  });
});

describe('summarizeInput', () => {
  it('writes key: value pairs and cuts long lines', () => {
    expect(summarizeInput({ status: 'TODO', n: 2 })).toBe('status: TODO, n: 2');
    expect(summarizeInput({})).toBe('');
    expect(summarizeInput({ text: 'x'.repeat(200) }).length).toBe(90);
  });
});
