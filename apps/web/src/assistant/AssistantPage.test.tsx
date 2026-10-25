import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Feature, Plan } from '../lib/types';
import AssistantPage from './AssistantPage';

const workspace = vi.hoisted(() => ({
  plan: 'PRO' as Plan,
  isOwner: true,
  features: [] as Feature[],
  changePlan: vi.fn(),
}));

vi.mock('../lib/workspace', () => ({
  useWorkspace: () => ({
    workspace: { id: 'ws-1', name: 'Home', slug: 'home', plan: workspace.plan },
    isOwner: workspace.isOwner,
    features: workspace.features,
    changePlan: workspace.changePlan,
  }),
}));

const encoder = new TextEncoder();

/** A fetch whose answer the test writes by hand, piece by piece, like a server would. */
function streamingFetch() {
  const calls: {
    url: string;
    body: { messages: { role: string; content: string }[] };
    signal: AbortSignal;
  }[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const fetchMock = vi.fn((url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal;
    calls.push({ url, body: JSON.parse(init.body as string), signal });
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push(controller);
            // a real fetch fails its body stream when the request is aborted
            signal.addEventListener('abort', () =>
              controller.error(new DOMException('The operation was aborted.', 'AbortError')),
            );
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
  });
  const current = () => streams[streams.length - 1];
  return {
    fetchMock,
    calls,
    emit: (event: string, data: object) =>
      current().enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    close: () => current().close(),
  };
}

const jsonReply = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const input = () => screen.getByRole('textbox', { name: 'Message to the assistant' });

beforeEach(() => {
  workspace.plan = 'PRO';
  workspace.isOwner = true;
  workspace.features = [
    { key: 'ai-assistant', description: 'AI', minPlan: 'PRO', available: true },
  ];
  workspace.changePlan.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('Assistant chat', () => {
  it('shows the steps live, streams the answer and ends with the Send button again', async () => {
    const server = streamingFetch();
    vi.stubGlobal('fetch', server.fetchMock);
    const user = userEvent.setup();
    render(<AssistantPage />);

    expect(input()).toHaveFocus();
    await user.type(input(), 'What is due?{Enter}');

    // the question is sent with the whole conversation, to this workspace's endpoint
    expect(server.calls[0].url).toBe('/api/workspaces/ws-1/assistant/chat');
    expect(server.calls[0].body).toEqual({ messages: [{ role: 'user', content: 'What is due?' }] });
    expect(screen.getByText('What is due?')).toBeInTheDocument();
    expect(input()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();

    server.emit('step', { n: 1, label: 'Reading your request' });
    expect(await screen.findByText('Reading your request')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Step 1: Reading your request.');

    server.emit('tool_call', { id: 't1', name: 'list_tasks', input: { status: 'TODO' } });
    expect(await screen.findByText('list_tasks')).toBeInTheDocument();
    expect(screen.getByText('status: TODO')).toBeInTheDocument();
    expect(screen.getByText('Running…')).toBeInTheDocument();

    server.emit('tool_result', {
      id: 't1',
      name: 'list_tasks',
      ok: true,
      summary: 'Found 2 tasks',
    });
    const timeline = screen.getByRole('list', { name: 'Steps of the answer' });
    expect(await within(timeline).findByText(/Found 2 tasks/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('list_tasks: Found 2 tasks.');

    // text arrives in pieces and is on screen before the stream ends
    server.emit('text', { delta: 'You have **two** ' });
    expect(await screen.findByText('two')).toBeInTheDocument();
    expect(screen.getByText('two').tagName).toBe('STRONG');
    server.emit('text', { delta: 'tasks:\n\n- Lab 1\n- Essay' });
    expect(await screen.findByText('Lab 1')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').some((item) => item.textContent === 'Essay')).toBe(true);
    // the answer region is live and busy until the answer is complete
    const answer = screen.getByText('Lab 1').closest('[aria-live]');
    expect(answer).toHaveAttribute('aria-busy', 'true');

    server.emit('done', { usage: { inputTokens: 5, outputTokens: 5 } });
    server.close();
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(answer).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('The answer is complete.');
    // the finished timeline folds away, and opens again on request
    const toggle = screen.getByRole('button', { name: /Steps/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(input()).toHaveFocus();
    await user.click(toggle);
    expect(screen.getByText('list_tasks')).toBeInTheDocument();
  });

  it('sends the earlier conversation along with a follow-up', async () => {
    const server = streamingFetch();
    vi.stubGlobal('fetch', server.fetchMock);
    const user = userEvent.setup();
    render(<AssistantPage />);

    await user.type(input(), 'first{Enter}');
    server.emit('text', { delta: 'answer one' });
    server.emit('done', {});
    server.close();
    await screen.findByRole('button', { name: 'Send' });

    await user.type(input(), 'second{Enter}');
    expect(server.calls[1].body.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer one' },
      { role: 'user', content: 'second' },
    ]);
  });

  it('sends on Enter but only breaks the line on Shift+Enter', async () => {
    const server = streamingFetch();
    vi.stubGlobal('fetch', server.fetchMock);
    const user = userEvent.setup();
    render(<AssistantPage />);

    await user.type(input(), 'line one{Shift>}{Enter}{/Shift}line two');
    expect(server.fetchMock).not.toHaveBeenCalled();
    expect(input()).toHaveValue('line one\nline two');
    await user.keyboard('{Enter}');
    expect(server.calls[0].body.messages[0].content).toBe('line one\nline two');
  });

  it('does not send an empty message', async () => {
    const server = streamingFetch();
    vi.stubGlobal('fetch', server.fetchMock);
    const user = userEvent.setup();
    render(<AssistantPage />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(input(), '   {Enter}');
    expect(server.fetchMock).not.toHaveBeenCalled();
  });

  it('stops the answer with the Stop button, keeping what has arrived', async () => {
    const server = streamingFetch();
    vi.stubGlobal('fetch', server.fetchMock);
    const user = userEvent.setup();
    render(<AssistantPage />);

    await user.type(input(), 'long one{Enter}');
    server.emit('text', { delta: 'Partial answer' });
    expect(await screen.findByText('Partial answer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(server.calls[0].signal.aborted).toBe(true);
    expect(await screen.findByText('Stopped.', { selector: 'p.bubble__note' })).toBeInTheDocument();
    expect(screen.getByText('Partial answer')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(input()).toHaveFocus();
  });

  it('shows an error event with a retry that asks the same question again', async () => {
    const server = streamingFetch();
    vi.stubGlobal('fetch', server.fetchMock);
    const user = userEvent.setup();
    render(<AssistantPage />);

    await user.type(input(), 'plan{Enter}');
    server.emit('error', { message: 'The AI provider is busy right now.' });
    server.emit('done', {});
    server.close();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The AI provider is busy right now.');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1].body.messages).toEqual([{ role: 'user', content: 'plan' }]);
    // the failed attempt was replaced, not stacked
    expect(screen.getAllByText('plan')).toHaveLength(1);
    server.emit('text', { delta: 'ok now' });
    server.emit('done', {});
    server.close();
    expect(await screen.findByText('ok now')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a stream that ends without done', async () => {
    const server = streamingFetch();
    vi.stubGlobal('fetch', server.fetchMock);
    const user = userEvent.setup();
    render(<AssistantPage />);
    await user.type(input(), 'hi{Enter}');
    server.emit('text', { delta: 'cut of' });
    server.close();
    expect(await screen.findByRole('alert')).toHaveTextContent('connection closed');
    expect(screen.getByText('cut of')).toBeInTheDocument();
  });

  it('explains that the assistant is not configured (503) and can check again', async () => {
    const server = streamingFetch();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonReply(503, { statusCode: 503, message: 'The AI assistant is not configured' }),
      )
      .mockImplementation(server.fetchMock);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AssistantPage />);

    await user.type(input(), 'hi{Enter}');
    expect(await screen.findByText('The AI assistant is not set up yet')).toBeInTheDocument();
    expect(screen.getByText('ANTHROPIC_API_KEY')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    server.emit('text', { delta: 'configured now' });
    server.emit('done', {});
    server.close();
    expect(await screen.findByText('configured now')).toBeInTheDocument();
  });

  it('shows the server message for other failures, such as the rate limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonReply(429, {
          statusCode: 429,
          message: 'Too many assistant requests. Try again in 30 s',
        }),
      ),
    );
    const user = userEvent.setup();
    render(<AssistantPage />);
    await user.type(input(), 'hi{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many assistant requests');
  });

  it('explains Pro to a Free workspace and lets an owner switch the plan', async () => {
    workspace.plan = 'FREE';
    workspace.features = [
      {
        key: 'ai-assistant',
        description: 'AI',
        minPlan: 'PRO',
        available: false,
        reason: 'requires PRO',
      },
    ];
    workspace.changePlan.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AssistantPage />);

    expect(
      screen.getByRole('heading', { name: 'The AI assistant is a Pro feature' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch this workspace to Pro' }));
    expect(workspace.changePlan).toHaveBeenCalledWith('PRO');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tells a non-owner to ask an owner', () => {
    workspace.plan = 'FREE';
    workspace.isOwner = false;
    workspace.features = [
      { key: 'ai-assistant', description: 'AI', minPlan: 'PRO', available: false },
    ];
    render(<AssistantPage />);
    expect(screen.getByText('Ask a workspace owner to switch the plan.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch/ })).not.toBeInTheDocument();
  });

  it('shows the gate when the server answers 403 FEATURE_NOT_AVAILABLE, and returns the question', async () => {
    workspace.plan = 'FREE';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonReply(403, {
          statusCode: 403,
          code: 'FEATURE_NOT_AVAILABLE',
          message: 'requires PRO',
          feature: 'ai-assistant',
        }),
      ),
    );
    const user = userEvent.setup();
    render(<AssistantPage />);
    await user.type(input(), 'hello{Enter}');
    expect(
      await screen.findByRole('heading', { name: 'The AI assistant is a Pro feature' }),
    ).toBeInTheDocument();
  });

  it('starts over with New chat', async () => {
    const server = streamingFetch();
    vi.stubGlobal('fetch', server.fetchMock);
    const user = userEvent.setup();
    render(<AssistantPage />);
    expect(screen.getByRole('button', { name: 'New chat' })).toBeDisabled();
    await user.type(input(), 'hi{Enter}');
    server.emit('done', {});
    server.close();
    await screen.findByRole('button', { name: 'Send' });
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.queryByText('hi')).not.toBeInTheDocument();
    expect(screen.getByText('What shall we plan?')).toBeInTheDocument();
  });

  it('fills the input from a suggestion', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const user = userEvent.setup();
    render(<AssistantPage />);
    await user.click(screen.getByRole('button', { name: 'What is due this week?' }));
    expect(input()).toHaveValue('What is due this week?');
    expect(input()).toHaveFocus();
  });

  it('shows text from the model as text, never as markup', async () => {
    const server = streamingFetch();
    vi.stubGlobal('fetch', server.fetchMock);
    const user = userEvent.setup();
    const { container } = render(<AssistantPage />);
    await user.type(input(), 'hi{Enter}');
    server.emit('text', { delta: '<img src=x onerror=alert(1)> ok' });
    expect(await screen.findByText(/onerror/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    server.emit('done', {});
    server.close();
  });
});
