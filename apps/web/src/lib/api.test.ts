import { api, apiAll, apiPathOf, ApiError } from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('apiPathOf', () => {
  it('turns the absolute nextLink into a path for api()', () => {
    expect(apiPathOf('http://localhost:3000/api/workspaces/1/tasks?skip=100&limit=100')).toBe(
      '/workspaces/1/tasks?skip=100&limit=100',
    );
  });
});

describe('apiAll', () => {
  it('follows nextLink until the list is complete', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          items: [1, 2],
          total: 3,
          skip: 0,
          limit: 100,
          nextLink: 'http://host/api/things?skip=100&limit=100',
        }),
      )
      .mockResolvedValueOnce(json({ items: [3], total: 3, skip: 100, limit: 100, nextLink: null }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await apiAll<number>('/things')).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/things?skip=100&limit=100');
  });
});

describe('api', () => {
  it('throws an ApiError carrying the status and the error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ message: 'Nope', feature: 'insights' }, 403)),
    );
    const error = await api('/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: 'Nope', body: { feature: 'insights' } });
  });
});
