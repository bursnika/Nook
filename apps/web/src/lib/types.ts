/** Shapes of what the API returns, trimmed to the fields the screens use. */
export type Plan = 'FREE' | 'PRO';
export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  /** Only the list endpoint includes the viewer's own membership. */
  memberships?: { role: Role }[];
}

/** TODO is the backlog and DONE is complete. */
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export const TASK_STATUSES: readonly TaskStatus[] = ['TODO', 'IN_PROGRESS', 'ON_HOLD', 'DONE'];
export const TASK_PRIORITIES: readonly TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH'];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'Backlog',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  DONE: 'Complete',
};
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** ISO timestamp. */
  dueDate: string | null;
  /** Order inside a column; fractional. */
  position: number;
  pageId: string | null;
  assigneeId: string | null;
  commentCount?: number;
  attachmentCount?: number;
  /** ISO timestamps; live updates over GraphQL leave them out. */
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
}

export interface Member {
  id: string;
  role: Role;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
}

export interface TaskComment {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
}

export interface Attachment {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** Present on events from the calendar endpoint. */
  imported?: boolean;
  mine?: boolean;
  editable?: boolean;
  recurring?: boolean;
  calendarName?: string | null;
  url?: string | null;
}

/** A task as the calendar and the overview list it. */
export interface TaskCard {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  isOverdue?: boolean;
  assignee?: { id: string; name: string } | null;
}

export interface GoogleRights {
  connected: boolean;
  editGranted: boolean;
  twoWay: boolean;
}

export interface CalendarData {
  events: CalendarEvent[];
  tasks: TaskCard[];
  google: GoogleRights;
}

export interface GoogleStatus extends GoogleRights {
  configured: boolean;
  tasksGranted: boolean;
  lastSyncAt: string | null;
}

export interface PageSummary {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  updatedAt: string;
  isPublished?: boolean;
  _count?: { blocks: number; children: number };
}

export interface Feature {
  key: string;
  description: string;
  minPlan: Plan;
  available: boolean;
  reason?: string;
}

export interface Overview {
  dueSoonHours: number;
  dueSoon: TaskCard[];
  upcomingEvents: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    calendarName: string | null;
    isRunning: boolean;
  }[];
  priority: TaskCard[];
  openTasks: TaskCard[];
  openTotal: number;
  pages: number;
  recentPages: { id: string; title: string; icon: string | null; updatedAt: string }[];
}

export interface Insights {
  tasksByStatus: Partial<Record<TaskStatus, number>>;
  completedLastWeek: number;
  overdue: number;
  pages: number;
  weeklyCompleted?: { weekStart: string; completed: number }[];
  tasksByPriority?: Partial<Record<TaskPriority, number>>;
  activity?: { date: string; count: number }[];
}
