import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NookClient } from './client.js';
import { createServer } from './server.js';

const WS = '01a19399-58bc-7675-a0a4-971d5f002928';
const NOW = new Date('2026-11-01T10:00:00.000Z');

const envelope = (items: unknown[] = []) => ({
  items,
  total: items.length,
  skip: 0,
  limit: 20,
  nextLink: null,
});

type Reply = { status?: number; body?: unknown };

async function setup(reply: (url: URL, init: RequestInit) => Reply = () => ({ body: envelope() })) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const { status = 200, body } = reply(new URL(String(input)), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const nook = new NookClient(
    { apiUrl: 'http://api.test/api', token: 'tkn', workspaceId: WS },
    fetchMock,
  );
  const server = createServer(nook, () => NOW);
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    return { isError: result.isError === true, text };
  };
  const lastRequest = () => {
    const [input, init] = fetchMock.mock.calls.at(-1)!;
    return { url: new URL(String(input)), init: init! };
  };
  return { client, server, fetchMock, call, lastRequest };
}

let closers: (() => Promise<void>)[] = [];
async function boot(reply?: Parameters<typeof setup>[0]) {
  const ctx = await setup(reply);
  closers.push(async () => {
    await ctx.client.close();
    await ctx.server.close();
  });
  return ctx;
}
beforeEach(() => {
  closers = [];
});
afterEach(async () => {
  await Promise.all(closers.map((close) => close()));
});

describe('tool catalogue', () => {
  it('exposes 5 read tools and 2 write tools with descriptions and schemas', async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'append_block',
      'create_task',
      'get_page',
      'list_events',
      'list_pages',
      'list_tasks',
      'search',
    ]);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly).toHaveLength(5);
  });
});

describe('list_pages', () => {
  it('requests the pages of the default workspace', async () => {
    const { call, lastRequest } = await boot(() => ({
      body: envelope([{ id: 'p1', title: 'Plan' }]),
    }));
    const res = await call('list_pages', { parentId: 'root', limit: 5 });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.text).items[0].title).toBe('Plan');
    const { url, init } = lastRequest();
    expect(init.method).toBe('GET');
    expect(url.pathname).toBe(`/api/workspaces/${WS}/pages`);
    expect(url.searchParams.get('parentId')).toBe('root');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('lets workspaceId override the default', async () => {
    const { call, lastRequest } = await boot();
    await call('list_pages', { workspaceId: 'other-ws' });
    expect(lastRequest().url.pathname).toBe('/api/workspaces/other-ws/pages');
  });
});

describe('get_page', () => {
  it('fetches the page with its blocks', async () => {
    const page = { id: 'p1', title: 'Plan', blocks: [{ id: 'b1', type: 'PARAGRAPH' }] };
    const { call, lastRequest } = await boot(() => ({ body: page }));
    const res = await call('get_page', { pageId: 'p1' });
    expect(JSON.parse(res.text)).toEqual(page);
    expect(lastRequest().url.pathname).toBe(`/api/workspaces/${WS}/pages/p1`);
  });

  it('returns the API message as a tool error', async () => {
    const { call } = await boot(() => ({
      status: 404,
      body: { statusCode: 404, error: 'Not Found', message: 'Record not found' },
    }));
    const res = await call('get_page', { pageId: 'nope' });
    expect(res.isError).toBe(true);
    expect(res.text).toBe('Record not found');
  });
});

describe('list_tasks', () => {
  it('passes status, priority and dueTo as query parameters', async () => {
    const { call, lastRequest } = await boot();
    await call('list_tasks', {
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueTo: '2026-11-05T18:00:00Z',
      skip: 20,
    });
    const { url } = lastRequest();
    expect(url.pathname).toBe(`/api/workspaces/${WS}/tasks`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueTo: '2026-11-05T18:00:00Z',
      skip: '20',
    });
  });

  it('treats a plain dueTo date as the end of that day', async () => {
    const { call, lastRequest } = await boot();
    await call('list_tasks', { dueTo: '2026-11-05' });
    expect(lastRequest().url.searchParams.get('dueTo')).toBe('2026-11-05T23:59:59.999Z');
  });

  it('rejects an invalid status before any HTTP call', async () => {
    const { call, fetchMock } = await boot();
    const res = await call('list_tasks', { status: 'WAITING' });
    expect(res.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unparsable dueTo', async () => {
    const { call, fetchMock } = await boot();
    const res = await call('list_tasks', { dueTo: 'tomorrow-ish' });
    expect(res.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('list_events', () => {
  it('calls the calendar with the given window', async () => {
    const body = { events: [{ id: 'e1' }], tasks: [], google: { connected: false } };
    const { call, lastRequest } = await boot(() => ({ body }));
    const res = await call('list_events', {
      from: '2026-11-03T00:00:00Z',
      to: '2026-11-04T00:00:00Z',
    });
    expect(JSON.parse(res.text)).toEqual(body);
    const { url } = lastRequest();
    expect(url.pathname).toBe(`/api/workspaces/${WS}/calendar`);
    expect(url.searchParams.get('from')).toBe('2026-11-03T00:00:00Z');
    expect(url.searchParams.get('to')).toBe('2026-11-04T00:00:00Z');
  });

  it('defaults to the next 14 days from now', async () => {
    const { call, lastRequest } = await boot(() => ({ body: { events: [], tasks: [] } }));
    await call('list_events');
    const { url } = lastRequest();
    expect(url.searchParams.get('from')).toBe('2026-11-01T10:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-11-15T10:00:00.000Z');
  });

  it('surfaces the window validation message of the API', async () => {
    const { call } = await boot(() => ({
      status: 400,
      body: { statusCode: 400, message: '"to" must be after "from"' },
    }));
    const res = await call('list_events', { from: '2026-11-05', to: '2026-11-01' });
    expect(res).toEqual({ isError: true, text: '"to" must be after "from"' });
  });
});

describe('search', () => {
  it('queries pages and tasks with q and merges the answers', async () => {
    const { call, fetchMock } = await boot((url) =>
      url.pathname.endsWith('/pages')
        ? { body: envelope([{ id: 'p1', title: 'Roadmap' }]) }
        : { body: envelope([{ id: 't1', title: 'Roadmap review' }]) },
    );
    const res = await call('search', { query: 'road', limit: 3 });
    const data = JSON.parse(res.text);
    expect(data.pages.items[0].id).toBe('p1');
    expect(data.tasks.items[0].id).toBe('t1');
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.map((u) => u.pathname).sort()).toEqual([
      `/api/workspaces/${WS}/pages`,
      `/api/workspaces/${WS}/tasks`,
    ]);
    for (const url of urls) {
      expect(url.searchParams.get('q')).toBe('road');
      expect(url.searchParams.get('limit')).toBe('3');
    }
  });

  it('uses 10 results per kind by default and rejects an empty query', async () => {
    const { call, lastRequest } = await boot();
    await call('search', { query: 'x' });
    expect(lastRequest().url.searchParams.get('limit')).toBe('10');
    expect((await call('search', { query: '  ' })).isError).toBe(true);
  });

  it('fails as a tool error when one of the requests fails', async () => {
    const { call } = await boot((url) =>
      url.pathname.endsWith('/tasks')
        ? { status: 403, body: { message: 'You are not a member of this workspace' } }
        : { body: envelope() },
    );
    const res = await call('search', { query: 'x' });
    expect(res).toEqual({ isError: true, text: 'You are not a member of this workspace' });
  });
});

describe('create_task', () => {
  it('posts the task body', async () => {
    const created = { id: 't1', title: 'Write report', status: 'TODO' };
    const { call, lastRequest } = await boot(() => ({ body: created }));
    const res = await call('create_task', {
      title: 'Write report',
      description: 'Chapter 3',
      priority: 'HIGH',
      dueDate: '2026-11-10',
      pageId: 'p1',
    });
    expect(JSON.parse(res.text)).toEqual(created);
    const { url, init } = lastRequest();
    expect(init.method).toBe('POST');
    expect(url.pathname).toBe(`/api/workspaces/${WS}/tasks`);
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Write report',
      description: 'Chapter 3',
      priority: 'HIGH',
      dueDate: '2026-11-10',
      pageId: 'p1',
    });
  });

  it('sends only the title when nothing else is given', async () => {
    const { call, lastRequest } = await boot(() => ({ body: { id: 't1' } }));
    await call('create_task', { title: 'Just a title' });
    expect(JSON.parse(lastRequest().init.body as string)).toEqual({ title: 'Just a title' });
  });

  it('rejects an empty title locally', async () => {
    const { call, fetchMock } = await boot();
    expect((await call('create_task', { title: '' })).isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns validation messages of the API as a tool error', async () => {
    const { call } = await boot(() => ({
      status: 400,
      body: { statusCode: 400, message: ['pageId must be a UUID', 'dueDate must be a Date'] },
    }));
    const res = await call('create_task', { title: 'x', pageId: 'bad' });
    expect(res).toEqual({ isError: true, text: 'pageId must be a UUID; dueDate must be a Date' });
  });
});

describe('append_block', () => {
  it('posts type and text to the page blocks endpoint', async () => {
    const block = { id: 'b1', type: 'HEADING_1', content: { text: 'Hi' } };
    const { call, lastRequest } = await boot(() => ({ body: block }));
    const res = await call('append_block', { pageId: 'p1', type: 'HEADING_1', text: 'Hi' });
    expect(JSON.parse(res.text)).toEqual(block);
    const { url, init } = lastRequest();
    expect(init.method).toBe('POST');
    expect(url.pathname).toBe(`/api/workspaces/${WS}/pages/p1/blocks`);
    expect(JSON.parse(init.body as string)).toEqual({ type: 'HEADING_1', content: { text: 'Hi' } });
  });

  it('rejects an unknown block type locally', async () => {
    const { call, fetchMock } = await boot();
    const res = await call('append_block', { pageId: 'p1', type: 'TABLE', text: 'x' });
    expect(res.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing page as a tool error', async () => {
    const { call } = await boot(() => ({ status: 404, body: { message: 'Record not found' } }));
    expect(await call('append_block', { pageId: 'p9', type: 'PARAGRAPH', text: 'x' })).toEqual({
      isError: true,
      text: 'Record not found',
    });
  });
});

describe('error handling', () => {
  it('turns a network failure into a tool error instead of crashing', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    const nook = new NookClient(
      { apiUrl: 'http://api.test/api', token: 't', workspaceId: WS },
      fetchMock,
    );
    const server = createServer(nook);
    const client = new Client({ name: 'test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    closers.push(async () => {
      await client.close();
      await server.close();
    });
    const result = await client.callTool({ name: 'list_pages', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toContain('fetch failed');
  });

  it('asks for a workspace when neither the argument nor the env default exist', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const nook = new NookClient({ apiUrl: 'http://api.test/api', token: 't' }, fetchMock);
    const server = createServer(nook);
    const client = new Client({ name: 'test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    closers.push(async () => {
      await client.close();
      await server.close();
    });
    const result = await client.callTool({ name: 'list_tasks', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toContain('NOOK_WORKSPACE_ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
