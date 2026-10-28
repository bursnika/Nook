import { useState } from 'react';
import { PixelIcon } from '../components/PixelIcon';
import { ErrorState, LoadingState, Window } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useReducedMotion, useResource } from '../lib/hooks';
import { weekLabel } from '../lib/insights';
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Insights,
} from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import { ChartCanvas, palette } from './insights/ChartCanvas';
import { Heatmap } from './insights/Heatmap';
import '../styles/insights.css';

/** Productivity statistics. Pro only: Free workspaces get an explanation and (for owners) a switch. */
export default function InsightsPage() {
  const { workspace, isOwner, changePlan } = useWorkspace();
  const result = useResource(
    () => api<Insights>(`/workspaces/${workspace.id}/insights`),
    `${workspace.id}:${workspace.plan}`,
  );
  const [switching, setSwitching] = useState(false);
  const [problem, setProblem] = useState<string>();

  if (result.loading) return <LoadingState label="Counting" />;

  if (result.error instanceof ApiError && result.error.status === 403) {
    const free = workspace.plan === 'FREE';
    const upgrade = async () => {
      setSwitching(true);
      setProblem(undefined);
      try {
        await changePlan('PRO');
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not switch the plan');
        setSwitching(false);
      }
    };
    return (
      <div className="gate">
        <PixelIcon name="lock" size={44} />
        <h2>{free ? 'Insights is a Pro feature' : 'Insights is switched off'}</h2>
        <p className="muted">
          {free
            ? 'Charts of finished tasks, workload by status and priority, and a twelve-week activity map come with the Pro plan.'
            : result.error.message}
        </p>
        {free &&
          (isOwner ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={switching}
              onClick={() => void upgrade()}
            >
              {switching ? 'Switching…' : 'Switch this workspace to Pro'}
            </button>
          ) : (
            <p>Ask a workspace owner to switch the plan.</p>
          ))}
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
      </div>
    );
  }
  if (result.error || !result.data) {
    return (
      <ErrorState
        error={result.error ?? new Error('No data')}
        onRetry={() => void result.reload()}
      />
    );
  }
  return <InsightsView data={result.data} />;
}

function InsightsView({ data }: { data: Insights }) {
  const reduced = useReducedMotion();
  const colors = palette();
  const status = TASK_STATUSES.map((key) => data.tasksByStatus[key] ?? 0);
  const open =
    (data.tasksByStatus.TODO ?? 0) +
    (data.tasksByStatus.IN_PROGRESS ?? 0) +
    (data.tasksByStatus.ON_HOLD ?? 0);
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduced ? (false as const) : { duration: 400 },
    font: { family: colors.body },
  };
  const describe = (labels: string[], values: number[]) =>
    labels.map((label, index) => `${label} ${values[index]}`).join(', ');

  const priority = data.tasksByPriority
    ? TASK_PRIORITIES.map((key) => data.tasksByPriority?.[key] ?? 0)
    : undefined;

  return (
    <div className="insights">
      <ul className="tiles">
        <li>
          <span className="tiles__value">{data.completedLastWeek}</span>
          <span className="label">Done in 7 days</span>
        </li>
        <li className={data.overdue > 0 ? 'tiles--alert' : ''}>
          <span className="tiles__value">{data.overdue}</span>
          <span className="label">Overdue</span>
        </li>
        <li>
          <span className="tiles__value">{open}</span>
          <span className="label">Open tasks</span>
        </li>
        <li>
          <span className="tiles__value">{data.pages}</span>
          <span className="label">Pages</span>
        </li>
      </ul>

      <div className="insights__grid">
        <Window
          title="Finished per week"
          icon="tasks"
          tone="lavender"
          className="insights__card insights__card--wide"
        >
          <div className="window__content">
            {data.weeklyCompleted && data.weeklyCompleted.length > 0 ? (
              <ChartCanvas
                label={`Tasks finished per week: ${describe(
                  data.weeklyCompleted.map((week) => weekLabel(week.weekStart)),
                  data.weeklyCompleted.map((week) => week.completed),
                )}`}
                config={{
                  type: 'bar',
                  data: {
                    labels: data.weeklyCompleted.map((week) => weekLabel(week.weekStart)),
                    datasets: [
                      {
                        label: 'Finished tasks',
                        data: data.weeklyCompleted.map((week) => week.completed),
                        backgroundColor: colors.lavender,
                        hoverBackgroundColor: colors.pink,
                        borderColor: colors.ink,
                        borderWidth: 2,
                      },
                    ],
                  },
                  options: {
                    ...baseOptions,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { grid: { display: false }, ticks: { color: colors.text } },
                      y: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: colors.text },
                        grid: { color: colors.grid },
                      },
                    },
                  },
                }}
              />
            ) : (
              <p className="muted">Weekly history is not available from the server yet.</p>
            )}
          </div>
        </Window>

        <Window title="By status" icon="folder" tone="blue" className="insights__card">
          <div className="window__content">
            <ChartCanvas
              label={`Tasks by status: ${describe(
                TASK_STATUSES.map((key) => STATUS_LABEL[key]),
                status,
              )}`}
              config={{
                type: 'doughnut',
                data: {
                  labels: TASK_STATUSES.map((key) => STATUS_LABEL[key]),
                  datasets: [
                    {
                      data: status,
                      backgroundColor: [colors.gray, colors.blue, colors.pinkSoft, colors.lavender],
                      borderColor: colors.ink,
                      borderWidth: 2,
                    },
                  ],
                },
                options: {
                  ...baseOptions,
                  plugins: { legend: { position: 'bottom', labels: { color: colors.ink } } },
                },
              }}
            />
          </div>
        </Window>

        <Window title="By priority" icon="sparkle" tone="pink" className="insights__card">
          <div className="window__content">
            {priority ? (
              <ChartCanvas
                label={`Tasks by priority: ${describe(
                  TASK_PRIORITIES.map((key) => PRIORITY_LABEL[key]),
                  priority,
                )}`}
                config={{
                  type: 'doughnut',
                  data: {
                    labels: TASK_PRIORITIES.map((key) => PRIORITY_LABEL[key]),
                    datasets: [
                      {
                        data: priority,
                        backgroundColor: [colors.gray, colors.blue, colors.pink],
                        borderColor: colors.ink,
                        borderWidth: 2,
                      },
                    ],
                  },
                  options: {
                    ...baseOptions,
                    plugins: { legend: { position: 'bottom', labels: { color: colors.ink } } },
                  },
                }}
              />
            ) : (
              <p className="muted">Priority breakdown is not available from the server yet.</p>
            )}
          </div>
        </Window>

        <Window
          title="Activity"
          icon="calendar"
          tone="lavender"
          className="insights__card insights__card--wide"
        >
          <div className="window__content">
            {data.activity && data.activity.length > 0 ? (
              <Heatmap activity={data.activity} />
            ) : (
              <p className="muted">Activity history is not available from the server yet.</p>
            )}
          </div>
        </Window>
      </div>
    </div>
  );
}
