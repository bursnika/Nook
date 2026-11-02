import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { PageMessage } from './ops.dto.js';

export type WorkspaceEvent =
  | { topic: 'task'; kind: 'created' | 'updated' | 'deleted'; id: string; task?: unknown }
  | { topic: 'event'; kind: 'created' | 'updated' | 'deleted'; id: string; event?: unknown };

type Listener<T> = (message: T) => void;

@Injectable()
export class RealtimeBus {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  publishPage(pageId: string, message: PageMessage) {
    this.emitter.emit(`page:${pageId}`, message);
  }

  onPage(pageId: string, listener: Listener<PageMessage>) {
    this.emitter.on(`page:${pageId}`, listener);
    return () => this.emitter.off(`page:${pageId}`, listener);
  }

  publishWorkspace(workspaceId: string, event: WorkspaceEvent) {
    this.emitter.emit(`workspace:${workspaceId}`, event);
  }

  onWorkspace(workspaceId: string, listener: Listener<WorkspaceEvent>) {
    this.emitter.on(`workspace:${workspaceId}`, listener);
    return () => this.emitter.off(`workspace:${workspaceId}`, listener);
  }

  workspaceStream(workspaceId: string, signal?: AbortSignal): AsyncGenerator<WorkspaceEvent> {
    const queue: WorkspaceEvent[] = [];
    let wake: (() => void) | undefined;
    const off = this.onWorkspace(workspaceId, (event) => {
      queue.push(event);
      wake?.();
    });
    let done = false;
    const finish = () => {
      done = true;
      off();
      wake?.();
    };
    signal?.addEventListener('abort', finish, { once: true });
    return (async function* () {
      try {
        while (!done) {
          const next = queue.shift();
          if (next) yield next;
          else await new Promise<void>((resolve) => (wake = resolve));
        }
      } finally {
        finish();
      }
    })();
  }
}
