export interface DigestTask {
  title: string;
  priority: string;
  dueDate: Date | null;
  workspace: string;
}

export interface DigestEvent {
  title: string;
  startsAt: Date;
  allDay: boolean;
  workspace: string;
}

const time = (date: Date) => date.toISOString().slice(11, 16);

/** "What is on today", as a short plain-text message for Telegram. Times are UTC, as everywhere on the server. */
export function formatDigest(
  day: string,
  tasks: DigestTask[],
  events: DigestEvent[],
  heading = 'Your plan for',
): string {
  if (tasks.length === 0 && events.length === 0) {
    return `${heading} ${day}\n\nNothing planned. Enjoy the free day ♡`;
  }
  const lines = [`${heading} ${day}`];
  if (events.length > 0) {
    lines.push('', 'Events');
    for (const event of events) {
      lines.push(
        `• ${event.allDay ? 'all day' : time(event.startsAt)} ${event.title} (${event.workspace})`,
      );
    }
  }
  if (tasks.length > 0) {
    lines.push('', 'Tasks');
    for (const task of tasks) {
      const mark = task.priority === 'HIGH' ? '❗ ' : '';
      const when = task.dueDate ? ` by ${time(task.dueDate)}` : '';
      lines.push(`• ${mark}${task.title}${when} (${task.workspace})`);
    }
  }
  return lines.join('\n');
}
