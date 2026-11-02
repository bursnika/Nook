import { heatmapCells } from '../../lib/insights';

export function Heatmap({ activity }: { activity: { date: string; count: number }[] }) {
  const cells = heatmapCells(activity);
  const total = activity.reduce((sum, day) => sum + day.count, 0);
  const busiest = activity.reduce(
    (best, day) => (day.count > best.count ? day : best),
    activity[0]!,
  );
  const summary =
    total === 0
      ? `No activity in the last ${activity.length} days.`
      : `${total} changes in the last ${activity.length} days. The busiest day was ${busiest.date} with ${busiest.count}.`;
  return (
    <figure className="heat">
      <div className="heat__grid" role="img" aria-label={summary}>
        {cells.map((cell, index) =>
          cell.date ? (
            <span
              key={cell.date}
              className={`heat__cell heat__cell--${cell.level}`}
              title={`${cell.date}: ${cell.count} ${cell.count === 1 ? 'change' : 'changes'}`}
            />
          ) : (
            <span key={`pad-${index}`} className="heat__cell heat__cell--blank" />
          ),
        )}
      </div>
      <figcaption className="heat__legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className={`heat__cell heat__cell--${level}`} aria-hidden="true" />
        ))}
        <span>More</span>
        <span className="sr-only">{summary}</span>
      </figcaption>
    </figure>
  );
}
