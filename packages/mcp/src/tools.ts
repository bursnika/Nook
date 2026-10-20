import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BLOCK_TYPES, type NookClient } from './client.js';

export interface ToolDeps {
  client: NookClient;
  /** Injected so tests can pin the clock. */
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 14;

const workspaceId = z
  .string()
  .min(1)
  .optional()
  .describe('Workspace id. Defaults to the NOOK_WORKSPACE_ID of the server.');

const skip = z.number().int().min(0).optional().describe('Number of items to skip (pagination).');
const limit = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe('Page size, 1-100 (the API default is 20).');

const isoDate = (what: string) =>
  z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: `${what} must be an ISO 8601 date or date-time`,
    })
    .describe(`${what}: ISO 8601, e.g. 2026-11-05 or 2026-11-05T18:00:00Z.`);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const ok = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

const fail = (err: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
});

/** Runs a tool body; any failure (HTTP, network, config) becomes an MCP tool error instead of a crash. */
async function run(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await body());
  } catch (err) {
    return fail(err);
  }
}

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const writeOnly = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export function registerTools(server: McpServer, { client, now = () => new Date() }: ToolDeps) {
  server.registerTool(
    'list_pages',
    {
      title: 'List pages',
      description:
        'List pages of a Nook workspace (newest first), optionally only the children of one page ' +
        'or only top-level pages. Returns { items, total, skip, limit, nextLink }; use skip/limit to page.',
      inputSchema: {
        workspaceId,
        parentId: z
          .string()
          .min(1)
          .optional()
          .describe('A parent page id, or "root" for top-level pages only.'),
        skip,
        limit,
      },
      annotations: readOnly,
    },
    (args) =>
      run(() =>
        client.listPages(client.resolveWorkspace(args.workspaceId), {
          parentId: args.parentId,
          skip: args.skip,
          limit: args.limit,
        }),
      ),
  );

  server.registerTool(
    'get_page',
    {
      title: 'Get page',
      description:
        'Get one page by id together with its blocks in order (each block has a type and a content ' +
        'payload, text lives in content.text), its author and parent.',
      inputSchema: { workspaceId, pageId: z.string().min(1).describe('Page id.') },
      annotations: readOnly,
    },
    (args) => run(() => client.getPage(client.resolveWorkspace(args.workspaceId), args.pageId)),
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'List tasks of a Nook workspace, optionally filtered by status, priority and a due-date ' +
        'upper bound. Returns { items, total, skip, limit, nextLink }.',
      inputSchema: {
        workspaceId,
        status: z
          .enum(['TODO', 'IN_PROGRESS', 'DONE'])
          .optional()
          .describe('Only tasks in this status.'),
        priority: z
          .enum(['LOW', 'MEDIUM', 'HIGH'])
          .optional()
          .describe('Only tasks with this priority.'),
        dueTo: isoDate('Due date upper bound')
          .optional()
          .describe(
            'Only tasks due on or before this moment. A plain date (2026-11-05) includes that whole day (UTC).',
          ),
        pageId: z.string().min(1).optional().describe('Only tasks linked to this page.'),
        skip,
        limit,
      },
      annotations: readOnly,
    },
    (args) =>
      run(() =>
        client.listTasks(client.resolveWorkspace(args.workspaceId), {
          status: args.status,
          priority: args.priority,
          dueTo:
            args.dueTo && DATE_ONLY.test(args.dueTo) ? `${args.dueTo}T23:59:59.999Z` : args.dueTo,
          pageId: args.pageId,
          skip: args.skip,
          limit: args.limit,
        }),
      ),
  );

  server.registerTool(
    'list_events',
    {
      title: 'List calendar events',
      description:
        'List calendar events overlapping a time window, plus the tasks that are due inside it ' +
        '(the workspace calendar). The window is at most 100 days. Without from/to it shows the next ' +
        `${DEFAULT_WINDOW_DAYS} days starting now.`,
      inputSchema: {
        workspaceId,
        from: isoDate('Window start').optional(),
        to: isoDate('Window end (after from)').optional(),
      },
      annotations: readOnly,
    },
    (args) =>
      run(() => {
        const from = args.from ?? now().toISOString();
        const to =
          args.to ??
          new Date(new Date(from).getTime() + DEFAULT_WINDOW_DAYS * DAY_MS).toISOString();
        return client.calendar(client.resolveWorkspace(args.workspaceId), from, to);
      }),
  );

  server.registerTool(
    'search',
    {
      title: 'Search pages and tasks',
      description:
        'Case-insensitive search by title across pages and tasks of a workspace. Returns ' +
        '{ pages, tasks }, each with { items, total, ... }.',
      inputSchema: {
        workspaceId,
        query: z.string().trim().min(1).describe('Text to look for in titles.'),
        limit: limit.describe('Maximum results per kind, 1-100 (default 10).'),
      },
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        const id = client.resolveWorkspace(args.workspaceId);
        const params = { q: args.query, limit: args.limit ?? 10 };
        const [pages, tasks] = await Promise.all([
          client.listPages(id, params),
          client.listTasks(id, params),
        ]);
        return { pages, tasks };
      }),
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description:
        'Create a task in a Nook workspace (status starts as TODO). Optionally set priority, a due ' +
        'date and the page it belongs to. Returns the created task.',
      inputSchema: {
        workspaceId,
        title: z.string().min(1).max(200).describe('Task title, 1-200 characters.'),
        description: z.string().max(5000).optional().describe('Details, up to 5000 characters.'),
        priority: z
          .enum(['LOW', 'MEDIUM', 'HIGH'])
          .optional()
          .describe('Priority (default MEDIUM).'),
        dueDate: isoDate('Due date').optional(),
        pageId: z.string().min(1).optional().describe('Link the task to this page.'),
      },
      annotations: writeOnly,
    },
    (args) =>
      run(() =>
        client.createTask(client.resolveWorkspace(args.workspaceId), {
          title: args.title,
          description: args.description,
          priority: args.priority,
          dueDate: args.dueDate,
          pageId: args.pageId,
        }),
      ),
  );

  server.registerTool(
    'append_block',
    {
      title: 'Append block to page',
      description:
        'Append a block with the given text to the end of a page. Types: ' +
        `${BLOCK_TYPES.join(', ')}. Returns the created block.`,
      inputSchema: {
        workspaceId,
        pageId: z.string().min(1).describe('Page id.'),
        type: z.enum(BLOCK_TYPES).describe('Block type, e.g. PARAGRAPH, HEADING_1, TODO.'),
        text: z.string().describe('Block text (ignored visually for DIVIDER).'),
      },
      annotations: writeOnly,
    },
    (args) =>
      run(() =>
        client.appendBlock(client.resolveWorkspace(args.workspaceId), args.pageId, {
          type: args.type,
          text: args.text,
        }),
      ),
  );
}
