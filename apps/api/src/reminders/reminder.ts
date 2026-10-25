const time = (date: Date) => date.toISOString().slice(11, 16);

/** The Telegram text of one reminder. Times are UTC, as in the morning digest. */
export const formatReminder = (title: string, dueDate: Date, workspace: string) =>
  `⏰ ${title} is due at ${time(dueDate)} (${workspace})`;
