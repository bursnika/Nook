import { Injectable } from '@nestjs/common';
import { env } from '../env.js';
import type { TelegramProvider, TelegramUpdate } from './telegram.provider.js';

interface TelegramReply<T> {
  ok: boolean;
  result: T;
  description?: string;
}

/** The real Bot API over HTTPS. Without TELEGRAM_BOT_TOKEN the bot is simply off. */
@Injectable()
export class TelegramHttp implements TelegramProvider {
  get configured() {
    return !!env.telegram.botToken;
  }

  async sendMessage(chatId: string, text: string) {
    await this.call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
  }

  async getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal) {
    const raw = await this.call<
      { update_id: number; message?: { chat: { id: number }; text?: string } }[]
    >('getUpdates', { offset, timeout: timeoutSeconds, allowed_updates: ['message'] }, signal);
    return raw.flatMap((update): TelegramUpdate[] =>
      update.message?.text
        ? [
            {
              updateId: update.update_id,
              chatId: String(update.message.chat.id),
              text: update.message.text,
            },
          ]
        : [{ updateId: update.update_id, chatId: '', text: '' }],
    );
  }

  private async call<T>(method: string, body: object, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${env.telegram.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const reply = (await response.json()) as TelegramReply<T>;
    if (!reply.ok)
      throw new Error(`Telegram ${method} failed: ${reply.description ?? response.status}`);
    return reply.result;
  }
}
