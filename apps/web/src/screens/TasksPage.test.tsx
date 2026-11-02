import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { makeTask } from '../lib/testing';
import type { Task } from '../lib/types';
import TasksPage from './TasksPage';

vi.mock('../lib/graphql', () => ({
  useTaskChanges: () => 'live',
  useEventChanges: () => 'live',
  useLiveStatus: () => 'live',
}));
vi.mock('../lib/workspace', () => ({
  useWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Test', slug: 'test' } }),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const members = (url: string) => (url.endsWith('/members') ? json([]) : undefined);

function setup(tasks: Task[]) {
  const patches: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (members(url)) return members(url)!;
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patches.push({ url, body });
        const id = url.split('/').pop()!;
        return json({ ...tasks.find((task) => task.id === id), ...body });
      }
      return json({ items: tasks, total: tasks.length, skip: 0, limit: 100, nextLink: null });
    }),
  );
  render(
    <MemoryRouter>
      <TasksPage />
    </MemoryRouter>,
  );
  return patches;
}

afterEach(() => vi.unstubAllGlobals());

describe('Kanban board', () => {
  it('puts the cards into their columns', async () => {
    setup([
      makeTask({ id: 'a', title: 'Write report', status: 'TODO' }),
      makeTask({ id: 'b', title: 'Review', status: 'IN_PROGRESS' }),
    ]);
    const todo = await screen.findByRole('region', { name: 'Backlog' });
    expect(within(todo).getByText('Write report')).toBeInTheDocument();
    const doing = screen.getByRole('region', { name: 'In progress' });
    expect(within(doing).getByText('Review')).toBeInTheDocument();
  });

  it('moves a card to the next column at once and saves status and position', async () => {
    const patches = setup([
      makeTask({ id: 'a', title: 'Write report', status: 'TODO', position: 1024 }),
      makeTask({ id: 'b', title: 'Review', status: 'IN_PROGRESS', position: 4096 }),
    ]);
    const user = userEvent.setup();
    await screen.findByText('Write report');

    await user.click(screen.getByRole('button', { name: 'Move “Write report” to In progress' }));

    const doing = screen.getByRole('region', { name: 'In progress' });
    expect(within(doing).getByText('Write report')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Backlog' })).queryByText('Write report'),
    ).toBeNull();
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]?.url).toBe('/api/workspaces/ws-1/tasks/a');
    expect(patches[0]?.body).toEqual({ status: 'IN_PROGRESS', position: 4096 + 1024 });
  });

  it('puts the card back and says so when saving fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string, init?: RequestInit) =>
          members(url) ??
          (init?.method === 'PATCH'
            ? json({ message: 'Server is down' }, 500)
            : json({
                items: [makeTask({ id: 'a', title: 'Write report', status: 'TODO' })],
                total: 1,
                skip: 0,
                limit: 100,
                nextLink: null,
              })),
      ),
    );
    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await screen.findByText('Write report');
    await user.click(screen.getByRole('button', { name: 'Move “Write report” to In progress' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server is down');
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Backlog' })).getByText('Write report'),
      ).toBeInTheDocument(),
    );
  });

  it('adds a card from the column quick-create', async () => {
    const created: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (members(url)) return members(url)!;
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          created.push(body);
          return json(makeTask({ id: 'new', title: String(body.title), status: 'TODO' }), 201);
        }
        return json({ items: [], total: 0, skip: 0, limit: 100, nextLink: null });
      }),
    );
    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    const todo = await screen.findByRole('region', { name: 'Backlog' });
    await user.click(within(todo).getByRole('button', { name: '+ Add card' }));
    await user.type(within(todo).getByLabelText('New card in Backlog'), 'Buy milk{Enter}');
    expect(await within(todo).findByText('Buy milk')).toBeInTheDocument();
    expect(created).toEqual([{ title: 'Buy milk', status: 'TODO' }]);
  });
});
