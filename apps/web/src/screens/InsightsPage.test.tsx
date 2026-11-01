import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InsightsPage from './InsightsPage';

vi.mock('../lib/workspace', () => ({
  useWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Test', slug: 'test' } }),
}));
// canvas drawing is not available in jsdom
vi.mock('./insights/ChartCanvas', () => ({
  ChartCanvas: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  palette: () => ({
    ink: '#000',
    pink: '#f0f',
    pinkSoft: '#f0f',
    lavender: '#90f',
    lavenderSoft: '#ddf',
    blue: '#00f',
    gray: '#999',
    grid: '#eee',
    text: '#666',
    body: 'sans-serif',
  }),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const switchedOff = () =>
  json(
    {
      statusCode: 403,
      code: 'FEATURE_NOT_AVAILABLE',
      message: '"insights" is switched off',
      feature: 'insights',
    },
    403,
  );

const insights = {
  tasksByStatus: { TODO: 2, IN_PROGRESS: 1, DONE: 3 },
  completedLastWeek: 3,
  overdue: 1,
  pages: 4,
  weeklyCompleted: [{ weekStart: '2026-10-26', completed: 3 }],
  tasksByPriority: { LOW: 1, MEDIUM: 2, HIGH: 3 },
  activity: [{ date: '2026-11-02', count: 2 }],
};

function show() {
  render(
    <MemoryRouter>
      <InsightsPage />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Insights', () => {
  it('says so when an administrator switched the feature off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(switchedOff()));
    show();
    expect(
      await screen.findByRole('heading', { name: 'Insights is switched off' }),
    ).toBeInTheDocument();
    expect(screen.getByText('"insights" is switched off')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the numbers and the charts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(insights)));
    show();
    expect(await screen.findByText('Done in 7 days')).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: /Tasks by status: Backlog 2, In progress 1, On hold 0, Complete 3/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Tasks finished per week: .*3$/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /2 changes in the last 1 days/ })).toBeInTheDocument();
  });

  it('degrades gracefully while the server lacks the newer fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ tasksByStatus: { TODO: 1 }, completedLastWeek: 0, overdue: 0, pages: 0 }),
        ),
    );
    show();
    expect(
      await screen.findByText('Weekly history is not available from the server yet.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Activity history is not available from the server yet.'),
    ).toBeInTheDocument();
  });

  it('reports other errors with a retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ message: 'Boom' }, 500)));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
