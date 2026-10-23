/** The REST API, same origin (the Vite dev server proxies /api; in production the API serves the app). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The API's own error body, e.g. `{ feature: 'insights' }` for a Pro-only route. */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/** The shape of every list the API returns. */
export interface Paged<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
  nextLink: string | null;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body: unknown = text ? safeParse(text) : undefined;
  if (!response.ok) {
    const message = (body as { message?: string | string[] } | undefined)?.message;
    throw new ApiError(
      response.status,
      Array.isArray(message) ? message.join(', ') : (message ?? response.statusText),
      body,
    );
  }
  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Everything of a list, following `nextLink` (for screens that need the whole set, like a Kanban board). */
export async function apiAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = `${path}${path.includes('?') ? '&' : '?'}limit=100`;
  while (next) {
    const page: Paged<T> = await api<Paged<T>>(apiPathOf(next));
    items.push(...page.items);
    next = page.nextLink;
  }
  return items;
}

/** `nextLink` is an absolute URL (`http://host/api/...`); `api()` wants the part after `/api`. */
export function apiPathOf(link: string): string {
  const url = new URL(link, window.location.origin);
  return (url.pathname + url.search).replace(/^\/api/, '');
}
