import { Injectable } from '@nestjs/common';
import { RealtimeBus } from './realtime.bus.js';
import type { PresenceMessage } from './ops.dto.js';

export const PRESENCE_TTL_MS = 20_000;

@Injectable()
export class PresenceService {
  private readonly pages = new Map<string, Map<string, PresenceMessage>>();

  constructor(private readonly bus: RealtimeBus) {}

  touch(pageId: string, presence: Omit<PresenceMessage, 'type' | 'at'>) {
    const message: PresenceMessage = {
      type: 'presence',
      at: new Date().toISOString(),
      ...presence,
    };
    let clients = this.pages.get(pageId);
    if (!clients) this.pages.set(pageId, (clients = new Map()));
    clients.set(presence.clientId, message);
    this.bus.publishPage(pageId, message);
    return message;
  }

  leave(pageId: string, clientId: string) {
    const clients = this.pages.get(pageId);
    if (!clients?.delete(clientId)) return;
    if (clients.size === 0) this.pages.delete(pageId);
    this.bus.publishPage(pageId, { type: 'leave', clientId });
  }

  list(pageId: string, exceptClientId?: string, now = Date.now()): PresenceMessage[] {
    const clients = this.pages.get(pageId);
    if (!clients) return [];
    const alive: PresenceMessage[] = [];
    for (const [clientId, message] of clients) {
      if (now - Date.parse(message.at) > PRESENCE_TTL_MS) clients.delete(clientId);
      else if (clientId !== exceptClientId) alive.push(message);
    }
    if (clients.size === 0) this.pages.delete(pageId);
    return alive;
  }
}
