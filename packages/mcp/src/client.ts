/**
 * Minimal HTTP client for the Nook REST API. It knows nothing about MCP: every method returns the
 * parsed JSON body or throws a NookApiError carrying the API's own message, so it is easy to unit test
 * with a stubbed `fetch`.
 */

export const DEFAULT_API_URL = 'http://localhost:3000/api';
const REQUEST_TIMEOUT_MS = 15_000;

export interface NookConfig {
  /** Base URL of the REST API including the `/api` prefix, without a trailing slash. */
  apiUrl: string;
  /** JWT sent as `Authorization: Bearer`. */
  token?: string;
  /** Workspace used by the tools when they get no `workspaceId` argument. */
  workspaceId?: string;
}

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export const BLOCK_TYPES = [
  'PARAGRAPH',
  'HEADING_1',
  'HEADING_2',
  'HEADING_3',
  'BULLETED_LIST',
  'NUMBERED_LIST',
  'TODO',
  'QUOTE',
  'CODE',
  'DIVIDER',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** The `{ items, total, skip, limit, nextLink }` envelope of every list endpoint. */
export interface PageResult<T = unknown> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
  nextLink: string | null;
}

export interface Paging {
  skip?: number;
  limit?: number;
}

export interface ListPagesParams extends Paging {
  q?: string;
  parentId?: string;
}

export interface ListTasksParams extends Paging {
  q?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  pageId?: string;
  dueFrom?: string;
  dueTo?: string;
}

export interface CreateTaskBody {
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  pageId?: string;
}

export interface AppendBlockBody {
  type: BlockType;
  text: string;
}

/** An error answer of the API (or a failure to reach it). `status` is 0 when there was no answer. */
export class NookApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'NookApiError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NookConfig {
  const apiUrl = env.NOOK_API_URL?.trim() || DEFAULT_API_URL;
  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    token: env.NOOK_TOKEN?.trim() || undefined,
    workspaceId: env.NOOK_WORKSPACE_ID?.trim() || undefined,
  };
}

type Query = Record<string, string | number | undefined>;

/** Nest answers `{ statusCode, message: string | string[], error }`; anything else falls back to the status text. */
function errorMessage(status: number, statusText: string, body: unknown): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message) && message.length > 0) return message.join('; ');
  if (typeof message === 'string' && message) return message;
  return statusText || `HTTP ${status}`;
}

export class NookClient {
  constructor(
    private readonly config: NookConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The workspace to use: an explicit argument wins over NOOK_WORKSPACE_ID. */
  resolveWorkspace(workspaceId?: string): string {
    const id = workspaceId ?? this.config.workspaceId;
    if (!id) {
      throw new Error(
        'No workspace selected: pass workspaceId or set the NOOK_WORKSPACE_ID environment variable',
      );
    }
    return id;
  }

  listPages(workspaceId: string, params: ListPagesParams = {}) {
    return this.request<PageResult>('GET', `${ws(workspaceId)}/pages`, { query: { ...params } });
  }

  /** A single page already contains its blocks in order. */
  getPage(workspaceId: string, pageId: string) {
    return this.request<Record<string, unknown>>(
      'GET',
      `${ws(workspaceId)}/pages/${encodeURIComponent(pageId)}`,
    );
  }

  listTasks(workspaceId: string, params: ListTasksParams = {}) {
    return this.request<PageResult>('GET', `${ws(workspaceId)}/tasks`, { query: { ...params } });
  }

  /** Events and tasks due inside the `from`..`to` window. */
  calendar(workspaceId: string, from: string, to: string) {
    return this.request<Record<string, unknown>>('GET', `${ws(workspaceId)}/calendar`, {
      query: { from, to },
    });
  }

  createTask(workspaceId: string, body: CreateTaskBody) {
    return this.request<Record<string, unknown>>('POST', `${ws(workspaceId)}/tasks`, { body });
  }

  /** The API stores the editor payload in `content`; plain text lives in `content.text`. */
  appendBlock(workspaceId: string, pageId: string, { type, text }: AppendBlockBody) {
    return this.request<Record<string, unknown>>(
      'POST',
      `${ws(workspaceId)}/pages/${encodeURIComponent(pageId)}/blocks`,
      { body: { type, content: { text } } },
    );
  }

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    if (!this.config.token) {
      throw new NookApiError(
        401,
        'NOOK_TOKEN is not set: put a Nook access token (JWT) into the environment of the MCP server',
      );
    }
    const url = new URL(this.config.apiUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.token}`,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new NookApiError(0, `Cannot reach the Nook API at ${this.config.apiUrl}: ${reason}`);
    }

    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // not JSON (e.g. a proxy error page): handled below
      }
    }
    if (!res.ok) throw new NookApiError(res.status, errorMessage(res.status, res.statusText, json));
    if (text && json === undefined) {
      throw new NookApiError(res.status, 'The Nook API returned a response that is not JSON');
    }
    return json as T;
  }
}

function ws(workspaceId: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}`;
}
