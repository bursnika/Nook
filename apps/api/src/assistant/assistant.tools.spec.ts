import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { EventsService } from '../events/events.service.js';
import type { PagesService } from '../pages/pages.service.js';
import type { TasksService } from '../tasks/tasks.service.js';
import { AssistantTools, MAX_TOOL_RESULT_CHARS } from './assistant.tools.js';

const WS = '0199d2a0-0000-7000-8000-000000000001';
const ID = '0199d2a0-0000-7000-8000-0000000000aa';

// like the database, a field that is undefined in the DTO leaves the stored value alone
const task = (changes: Record<string, unknown> = {}) => ({
  id: ID,
  title: 'Write report',
  description: null,
  status: 'TODO',
  priority: 'MEDIUM',
  dueDate: new Date('2026-11-05T00:00:00Z'),
  ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)),
});

function setup() {
  const tasks = {
    list: vi.fn().mockResolvedValue({ items: [task()], total: 1 }),
    create: vi.fn().mockImplementation(async (_ws: string, dto: { title: string }) => task(dto)),
    update: vi
      .fn()
      .mockImplementation(async (_ws: string, _id: string, dto: Record<string, unknown>) =>
        task(dto),
      ),
  };
  const events = {
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    create: vi.fn().mockImplementation(async (_ws: string, dto: { title: string }) => ({
      id: ID,
      allDay: false,
      startsAt: new Date('2026-11-05T10:00:00Z'),
      endsAt: new Date('2026-11-05T11:00:00Z'),
      ...dto,
    })),
  };
  const pages = {
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    get: vi.fn(),
  };
  const tools = new AssistantTools(
    tasks as unknown as TasksService,
    events as unknown as EventsService,
    pages as unknown as PagesService,
  );
  return { tools, tasks, events, pages };
}

const ctx = { workspaceId: WS };

describe('AssistantTools', () => {
  beforeEach(() => {
    // unexpected failures are logged on purpose; keep the test output clean
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('describes seven tools and none of them can take a workspace id', () => {
    const { tools } = setup();
    expect(tools.definitions.map((tool) => tool.name)).toEqual([
      'list_tasks',
      'list_events',
      'search_pages',
      'get_page',
      'create_task',
      'update_task',
      'create_event',
    ]);
    for (const tool of tools.definitions) {
      expect(Object.keys(tool.inputSchema.properties)).not.toContain('workspaceId');
    }
  });

  it('list_tasks passes the filters and always the request workspace', async () => {
    const { tools, tasks } = setup();
    const outcome = await tools.execute(ctx, 'list_tasks', {
      status: 'TODO',
      dueBefore: '2026-11-10',
      workspaceId: 'someone-elses',
    });
    expect(outcome).toMatchObject({ ok: true, summary: 'Found 1 task' });
    expect(tasks.list).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ status: 'TODO', dueTo: new Date('2026-11-10'), limit: 50 }),
    );
    expect(JSON.parse(outcome.content)).toMatchObject({
      total: 1,
      tasks: [{ id: ID, title: 'Write report', dueDate: '2026-11-05T00:00:00.000Z' }],
    });
  });

  it('list_tasks accepts a missing input and rejects bad filters as a tool error', async () => {
    const { tools, tasks } = setup();
    expect((await tools.execute(ctx, 'list_tasks', undefined)).ok).toBe(true);
    const bad = await tools.execute(ctx, 'list_tasks', { status: 'LATER' });
    expect(bad).toMatchObject({ ok: false });
    expect(bad.summary).toContain('"status" must be one of');
    expect(tasks.list).toHaveBeenCalledTimes(1);
  });

  it('list_events checks the range', async () => {
    const { tools, events } = setup();
    const ok = await tools.execute(ctx, 'list_events', { from: '2026-11-01', to: '2026-12-01' });
    expect(ok.ok).toBe(true);
    expect(events.list).toHaveBeenCalledWith(WS, expect.objectContaining({ limit: 100 }));

    const tooLong = await tools.execute(ctx, 'list_events', {
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(tooLong).toMatchObject({ ok: false, summary: 'The range must be at most 100 days' });
    const backwards = await tools.execute(ctx, 'list_events', {
      from: '2026-12-01',
      to: '2026-11-01',
    });
    expect(backwards.ok).toBe(false);
    const missing = await tools.execute(ctx, 'list_events', { from: '2026-12-01' });
    expect(missing.summary).toBe('"to" is required');
  });

  it('search_pages needs a query; get_page needs an id and cuts long text', async () => {
    const { tools, pages } = setup();
    expect((await tools.execute(ctx, 'search_pages', {})).ok).toBe(false);
    expect((await tools.execute(ctx, 'get_page', { id: 'not-a-uuid' })).ok).toBe(false);

    pages.get.mockResolvedValue({
      id: ID,
      title: 'Plan',
      blocks: [
        { content: { text: 'a'.repeat(5000) } },
        { content: { text: 'b'.repeat(5000) } },
        { content: {} },
      ],
    });
    const outcome = await tools.execute(ctx, 'get_page', { id: ID });
    expect(pages.get).toHaveBeenCalledWith(WS, ID);
    const data = JSON.parse(outcome.content) as { text: string; truncated: boolean };
    expect(data.truncated).toBe(true);
    expect(data.text.length).toBeLessThanOrEqual(6000);
    expect(outcome.summary).toBe('Read page "Plan"');
  });

  it('create_task builds the DTO from known fields only', async () => {
    const { tools, tasks } = setup();
    const outcome = await tools.execute(ctx, 'create_task', {
      title: 'Buy milk',
      priority: 'HIGH',
      dueDate: '2026-11-03',
      workspaceId: 'someone-elses',
      assigneeId: 'x',
      status: 'DONE',
    });
    expect(outcome).toMatchObject({ ok: true, summary: 'Created task "Buy milk"' });
    const [workspaceId, dto] = tasks.create.mock.calls[0] as [string, Record<string, unknown>];
    expect(workspaceId).toBe(WS);
    expect(dto).toMatchObject({ title: 'Buy milk', priority: 'HIGH' });
    expect(dto).not.toHaveProperty('workspaceId');
    expect(dto.assigneeId).toBeUndefined();
    expect(dto.status).toBeUndefined();
  });

  it('create_task validates the title and the date', async () => {
    const { tools, tasks } = setup();
    expect((await tools.execute(ctx, 'create_task', { title: '  ' })).ok).toBe(false);
    expect((await tools.execute(ctx, 'create_task', { title: 'x'.repeat(201) })).ok).toBe(false);
    const date = await tools.execute(ctx, 'create_task', { title: 'x', dueDate: 'tomorrow' });
    expect(date.summary).toContain('ISO 8601');
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('update_task needs an id and a change, and turns missing records into a tool error', async () => {
    const { tools, tasks } = setup();
    expect((await tools.execute(ctx, 'update_task', { status: 'DONE' })).ok).toBe(false);
    const empty = await tools.execute(ctx, 'update_task', { id: ID });
    expect(empty.summary).toContain('at least one');

    tasks.update.mockRejectedValueOnce(
      Object.assign(new Error('raw prisma text'), { code: 'P2025' }),
    );
    const missing = await tools.execute(ctx, 'update_task', { id: ID, status: 'DONE' });
    expect(missing).toMatchObject({ ok: false, summary: 'Not found in this workspace' });
    expect(missing.content).not.toContain('prisma');

    const done = await tools.execute(ctx, 'update_task', { id: ID, status: 'DONE' });
    expect(done.ok).toBe(true);
    expect(tasks.update).toHaveBeenLastCalledWith(
      WS,
      ID,
      expect.objectContaining({ status: 'DONE' }),
    );
  });

  it('create_event calls the local events service', async () => {
    const { tools, events } = setup();
    const outcome = await tools.execute(ctx, 'create_event', {
      title: 'Standup',
      startsAt: '2026-11-05T10:00:00Z',
      endsAt: '2026-11-05T10:15:00Z',
    });
    expect(outcome).toMatchObject({ ok: true, summary: 'Created event "Standup"' });
    expect(events.create).toHaveBeenCalledWith(WS, expect.objectContaining({ title: 'Standup' }));
  });

  it('passes the message of HTTP errors of our own services, hides everything else', async () => {
    const { tools, tasks } = setup();
    tasks.create.mockRejectedValueOnce(
      new BadRequestException('pageId does not belong to this workspace'),
    );
    expect((await tools.execute(ctx, 'create_task', { title: 'x' })).summary).toBe(
      'pageId does not belong to this workspace',
    );
    tasks.create.mockRejectedValueOnce(new NotFoundException('Record not found'));
    expect((await tools.execute(ctx, 'create_task', { title: 'x' })).summary).toBe(
      'Record not found',
    );
    tasks.create.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
    );
    const secret = await tools.execute(ctx, 'create_task', { title: 'x' });
    expect(secret).toMatchObject({ ok: false, summary: 'The tool failed unexpectedly' });
    expect(JSON.stringify(secret)).not.toContain('hunter2');
  });

  it('answers an unknown tool and a non-object input with a tool error', async () => {
    const { tools } = setup();
    expect(await tools.execute(ctx, 'delete_everything', {})).toMatchObject({
      ok: false,
      summary: 'Unknown tool "delete_everything"',
    });
    expect((await tools.execute(ctx, 'create_task', 'title')).summary).toBe(
      'The tool input must be a JSON object',
    );
  });

  it('truncates a very long result for the model', async () => {
    const { tools, tasks } = setup();
    const big = Array.from({ length: 50 }, (_, i) =>
      task({ id: `${i}`, description: 'x'.repeat(300), title: 'y'.repeat(200) }),
    );
    tasks.list.mockResolvedValue({ items: big, total: 50 });
    const outcome = await tools.execute(ctx, 'list_tasks', {});
    expect(outcome.content.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS + 20);
    expect(outcome.content.endsWith('[truncated]')).toBe(true);
  });
});
