/** One message from a person to the bot. */
export interface TelegramUpdate {
  updateId: number;
  chatId: string;
  text: string;
}

/** The part of the Telegram Bot API Nook uses. A fake stands in for it in tests. */
export interface TelegramProvider {
  readonly configured: boolean;
  sendMessage(chatId: string, text: string): Promise<void>;
  /** Long polling: waits up to `timeoutSeconds` for new messages after `offset`. */
  getUpdates(
    offset: number,
    timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]>;
}

export const TELEGRAM_PROVIDER = Symbol('TELEGRAM_PROVIDER');
