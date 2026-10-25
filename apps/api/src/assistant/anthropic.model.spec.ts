import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { AnthropicAssistantModel } from './anthropic.model.js';
import { AssistantModelError } from './assistant.types.js';

/** A tiny stand-in for api.anthropic.com that answers with a hand-written event stream. */
describe('AnthropicAssistantModel (against a local stand-in for the API)', () => {
  let server: Server;
  let baseUrl: string;
  let handler: (
    req: IncomingMessage,
    body: string,
    res: import('node:http').ServerResponse,
  ) => void;
  const previousBase = process.env.ANTHROPIC_BASE_URL;

  const sse = (events: [string, object][]) =>
    events
      .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`)
      .join('');

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk));
      req.on('end', () => handler(req, body, res));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.ANTHROPIC_BASE_URL = baseUrl;
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (previousBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previousBase;
    await new Promise((resolve) => server.close(resolve));
  });

  const request = (
    overrides: Partial<Parameters<AnthropicAssistantModel['streamRound']>[0]> = {},
  ) => ({
    system: 'sys',
    messages: [{ role: 'user' as const, content: 'hi' }],
    tools: [
      {
        name: 'list_tasks',
        description: 'd',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ],
    signal: new AbortController().signal,
    onText: () => {},
    ...overrides,
  });

  it('is not configured without a key and refuses to call', async () => {
    const model = new AnthropicAssistantModel({ model: 'm' });
    expect(model.configured).toBe(false);
    await expect(model.streamRound(request())).rejects.toBeInstanceOf(AssistantModelError);
  });

  it('streams text deltas and returns text, tool calls and usage', async () => {
    let seen:
      | {
          model: string;
          system: string;
          stream: boolean;
          tools: { name: string }[];
          messages: unknown[];
        }
      | undefined;
    handler = (req, body, res) => {
      seen = JSON.parse(body);
      // the SDK decides how the key travels (header name); it must be sent, in some header
      expect(JSON.stringify(req.headers)).toContain('test-key');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        sse([
          [
            'message_start',
            {
              message: {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                model: 'm',
                content: [],
                stop_reason: null,
                usage: { input_tokens: 11, output_tokens: 1 },
              },
            },
          ],
          ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Let me ' } }],
          ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'check.' } }],
          ['content_block_stop', { index: 0 }],
          [
            'content_block_start',
            {
              index: 1,
              content_block: { type: 'tool_use', id: 'toolu_9', name: 'list_tasks', input: {} },
            },
          ],
          [
            'content_block_delta',
            { index: 1, delta: { type: 'input_json_delta', partial_json: '{"status":' } },
          ],
          [
            'content_block_delta',
            { index: 1, delta: { type: 'input_json_delta', partial_json: '"TODO"}' } },
          ],
          ['content_block_stop', { index: 1 }],
          [
            'message_delta',
            {
              delta: { stop_reason: 'tool_use', stop_sequence: null },
              usage: { output_tokens: 20 },
            },
          ],
          ['message_stop', {}],
        ]),
      );
    };
    const model = new AnthropicAssistantModel({ apiKey: 'test-key', model: 'claude-sonnet-5-5' });
    const deltas: string[] = [];
    const round = await model.streamRound(
      request({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_0', name: 'list_tasks', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', toolUseId: 'toolu_0', content: 'ok', isError: true }],
          },
        ],
        onText: (delta) => deltas.push(delta),
      }),
    );

    expect(deltas).toEqual(['Let me ', 'check.']);
    expect(round).toMatchObject({
      text: 'Let me check.',
      stopReason: 'tool_use',
      toolCalls: [{ id: 'toolu_9', name: 'list_tasks', input: { status: 'TODO' } }],
      usage: { inputTokens: 11, outputTokens: 20 },
    });
    expect(seen).toMatchObject({ model: 'claude-sonnet-5-5', system: 'sys', stream: true });
    expect(seen?.tools[0].name).toBe('list_tasks');
    expect(seen?.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_0', content: 'ok', is_error: true }],
    });
  });

  it('turns provider errors into fixed, key-free sentences', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key: sk-ant-leaky' },
        }),
      );
    };
    const model = new AnthropicAssistantModel({ apiKey: 'sk-ant-leaky', model: 'm' });
    const error = await model.streamRound(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AssistantModelError);
    expect((error as Error).message).toBe('The AI provider rejected the server API key.');
    expect((error as Error).message).not.toContain('sk-ant');
  });

  it('stops when the signal is aborted', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        sse([
          [
            'message_start',
            {
              message: {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                model: 'm',
                content: [],
                stop_reason: null,
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            },
          ],
        ]),
      );
      // never ends
    };
    const model = new AnthropicAssistantModel({ apiKey: 'test-key', model: 'm' });
    const abort = new AbortController();
    const pending = model.streamRound(request({ signal: abort.signal }));
    setTimeout(() => abort.abort(), 50);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AssistantModelError);
    expect(abort.signal.aborted).toBe(true);
  });
});
