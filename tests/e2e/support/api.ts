import { expect, type APIRequestContext } from '@playwright/test';

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE';
export type BlockType =
  | 'PARAGRAPH'
  | 'HEADING_1'
  | 'HEADING_2'
  | 'HEADING_3'
  | 'BULLETED_LIST'
  | 'NUMBERED_LIST'
  | 'TODO'
  | 'QUOTE'
  | 'CODE'
  | 'DIVIDER';

export interface ApiPage {
  id: string;
  title: string;
}
export interface ApiBlock {
  id: string;
  type: BlockType;
  content: { text?: string; checked?: boolean };
  position: number;
}
export interface ApiTask {
  id: string;
  title: string;
  status: TaskStatus;
  position: number;
  dueDate: string | null;
}
export interface ApiEvent {
  id: string;
  title: string;
}

let counter = 0;
/** A name no other test (and no earlier run) used, so tests never trip over each other's data. */
export function unique(label: string): string {
  counter += 1;
  return `${label} ${Date.now().toString(36)}${counter}`;
}

/** The REST API as one person (the request context carries that person's session cookie). */
export class Api {
  constructor(
    private readonly request: APIRequestContext,
    readonly workspaceId: string,
  ) {}

  dispose() {
    return this.request.dispose();
  }

  private url(path: string) {
    return `/api${path}`;
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.request.get(this.url(path));
    expect(response.ok(), `GET ${path} -> ${response.status()}`).toBeTruthy();
    return (await response.json()) as T;
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    const response = await this.request.post(this.url(path), data === undefined ? {} : { data });
    expect(
      response.ok(),
      `POST ${path} -> ${response.status()} ${await response.text()}`,
    ).toBeTruthy();
    return (response.status() === 204 ? undefined : await response.json()) as T;
  }

  async patch<T>(path: string, data: unknown): Promise<T> {
    const response = await this.request.patch(this.url(path), { data });
    expect(response.ok(), `PATCH ${path} -> ${response.status()}`).toBeTruthy();
    return (await response.json()) as T;
  }

  async remove(path: string): Promise<void> {
    const response = await this.request.delete(this.url(path));
    expect([200, 204, 404], `DELETE ${path} -> ${response.status()}`).toContain(response.status());
  }

  // ---- pages and blocks

  /** A page with paragraphs (or other blocks) in the given order. */
  async createPage(
    title: string,
    blocks: { type?: BlockType; text: string; checked?: boolean }[] = [],
  ): Promise<ApiPage> {
    const page = await this.post<ApiPage>(`/workspaces/${this.workspaceId}/pages`, { title });
    for (const [index, block] of blocks.entries()) {
      await this.post(`/workspaces/${this.workspaceId}/pages/${page.id}/blocks`, {
        type: block.type ?? 'PARAGRAPH',
        content:
          block.checked === undefined
            ? { text: block.text }
            : { text: block.text, checked: block.checked },
        position: (index + 1) * 1024,
      });
    }
    return page;
  }

  async blocks(pageId: string): Promise<ApiBlock[]> {
    const blocks = await this.get<ApiBlock[]>(
      `/workspaces/${this.workspaceId}/pages/${pageId}/blocks`,
    );
    return [...blocks].sort((a, b) => a.position - b.position);
  }

  async blockTexts(pageId: string): Promise<string[]> {
    return (await this.blocks(pageId)).map((block) => block.content.text ?? '');
  }

  deletePage(pageId: string) {
    return this.remove(`/workspaces/${this.workspaceId}/pages/${pageId}`);
  }

  // ---- tasks and events

  createTask(task: {
    title: string;
    status?: TaskStatus;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH';
    dueDate?: string;
    position?: number;
  }): Promise<ApiTask> {
    return this.post<ApiTask>(`/workspaces/${this.workspaceId}/tasks`, task);
  }

  async task(id: string): Promise<ApiTask> {
    return this.get<ApiTask>(`/workspaces/${this.workspaceId}/tasks/${id}`);
  }

  deleteTask(id: string) {
    return this.remove(`/workspaces/${this.workspaceId}/tasks/${id}`);
  }

  createEvent(event: { title: string; startsAt: string; endsAt: string }): Promise<ApiEvent> {
    return this.post<ApiEvent>(`/workspaces/${this.workspaceId}/events`, event);
  }

  async events(): Promise<ApiEvent[]> {
    const reply = await this.get<{ items: ApiEvent[] }>(
      `/workspaces/${this.workspaceId}/events?limit=100`,
    );
    return reply.items;
  }

  deleteEvent(id: string) {
    return this.remove(`/workspaces/${this.workspaceId}/events/${id}`);
  }
}
