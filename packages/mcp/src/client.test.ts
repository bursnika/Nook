import { describe, expect, it, vi } from 'vitest';
import { NookApiError, NookClient, loadConfig } from './client.js';

const WS = '01a19399-58bc-7675-a0a4-971d5f002928';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function setup(respond: () => Response | Promise<Response> = () => jsonResponse({ ok: true })) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  const client = new NookClient(
    { apiUrl: 'http://api.test/api', token: 'tkn', workspaceId: WS },
    fetchMock,
  );
  const lastCall = () => {
    const [input, init] = fetchMock.mock.calls.at(-1)!;
    return { url: new URL(String(input)), init: init! };
  };
  return { client, fetchMock, lastCall };
}

describe('loadConfig', () => {
  it('uses defaults and trims the trailing slash', () => {
    expect(loadConfig({})).toEqual({
      apiUrl: 'http://localhost:3000/api',
      token: undefined,
      workspaceId: undefined,
    });
    expect(
      loadConfig({
        NOOK_API_URL: 'https://x.test/api/',
        NOOK_TOKEN: ' t ',
        NOOK_WORKSPACE_ID: 'w',
      }),
    ).toEqual({ apiUrl: 'https://x.test/api', token: 't', workspaceId: 'w' });
  });
});

describe('NookClient requests', () => {
  it('sends the bearer token and builds the pages list query', async () => {
    const { client, lastCall } = setup();
    await client.listPages(WS, { q: 'plan', parentId: 'root', skip: 0, limit: 5 });
    const { url, init } = lastCall();
    expect(init.method).toBe('GET');
    expect(url.pathname).toBe(`/api/workspaces/${WS}/pages`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'plan',
      parentId: 'root',
      skip: '0',
      limit: '5',
    });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tkn');
    expect(init.body).toBeUndefined();
  });

  it('omits undefined query values', async () => {
    const { client, lastCall } = setup();
    await client.listTasks(WS, { status: 'TODO', priority: undefined });
    expect(Object.fromEntries(lastCall().url.searchParams)).toEqual({ status: 'TODO' });
  });

  it('gets a page by id', async () => {
    const { client, lastCall } = setup();
    await client.getPage(WS, 'p 1');
    expect(lastCall().url.pathname).toBe(`/api/workspaces/${WS}/pages/p%201`);
  });

  it('calls the calendar with from and to', async () => {
    const { client, lastCall } = setup();
    await client.calendar(WS, '2026-11-01T00:00:00.000Z', '2026-11-08T00:00:00.000Z');
    const { url } = lastCall();
    expect(url.pathname).toBe(`/api/workspaces/${WS}/calendar`);
    expect(url.searchParams.get('from')).toBe('2026-11-01T00:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-11-08T00:00:00.000Z');
  });

  it('posts a task as JSON', async () => {
    const { client, lastCall } = setup();
    await client.createTask(WS, { title: 'Buy milk', priority: 'HIGH' });
    const { url, init } = lastCall();
    expect(init.method).toBe('POST');
    expect(url.pathname).toBe(`/api/workspaces/${WS}/tasks`);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Buy milk', priority: 'HIGH' });
  });

  it('posts a block with the text inside content', async () => {
    const { client, lastCall } = setup();
    await client.appendBlock(WS, 'page-1', { type: 'TODO', text: 'Call mom' });
    const { url, init } = lastCall();
    expect(url.pathname).toBe(`/api/workspaces/${WS}/pages/page-1/blocks`);
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'TODO',
      content: { text: 'Call mom' },
    });
  });

  it('returns the parsed body', async () => {
    const { client } = setup(() => jsonResponse({ items: [], total: 0 }));
    await expect(client.listPages(WS)).resolves.toEqual({ items: [], total: 0 });
  });
});

describe('NookClient workspace resolution', () => {
  it('prefers the argument over the configured default', () => {
    const { client } = setup();
    expect(client.resolveWorkspace('other')).toBe('other');
    expect(client.resolveWorkspace()).toBe(WS);
  });

  it('throws a clear error when there is no workspace at all', () => {
    const client = new NookClient({ apiUrl: 'http://api.test/api', token: 't' }, vi.fn());
    expect(() => client.resolveWorkspace()).toThrow(/NOOK_WORKSPACE_ID/);
  });
});

describe('NookClient errors', () => {
  it('uses the API message of an error answer', async () => {
    const { client } = setup(() =>
      jsonResponse(
        { statusCode: 404, error: 'Not Found', message: 'Record not found' },
        { status: 404 },
      ),
    );
    const err = await client.getPage(WS, 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NookApiError);
    expect(err).toMatchObject({ status: 404, message: 'Record not found' });
  });

  it('joins validation message arrays', async () => {
    const { client } = setup(() =>
      jsonResponse(
        { statusCode: 400, message: ['title must be a string', 'priority is invalid'] },
        { status: 400 },
      ),
    );
    await expect(client.createTask(WS, { title: 'x' })).rejects.toThrow(
      'title must be a string; priority is invalid',
    );
  });

  it('falls back to the status text for a non-JSON error', async () => {
    const { client } = setup(
      () => new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    await expect(client.listTasks(WS)).rejects.toMatchObject({
      status: 502,
      message: 'Bad Gateway',
    });
  });

  it('wraps network failures', async () => {
    const { client } = setup(() => {
      throw new TypeError('fetch failed');
    });
    await expect(client.listTasks(WS)).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('fetch failed') as string,
    });
  });

  it('refuses to call the API without a token', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new NookClient({ apiUrl: 'http://api.test/api', workspaceId: WS }, fetchMock);
    await expect(client.listTasks(WS)).rejects.toThrow(/NOOK_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a success answer that is not JSON', async () => {
    const { client } = setup(() => new Response('hello', { status: 200 }));
    await expect(client.listTasks(WS)).rejects.toThrow(/not JSON/);
  });
});
