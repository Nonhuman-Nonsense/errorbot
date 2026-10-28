/**
 * Posts messages to a chat through the Telegram Bot API. The bot only sends;
 * it never reads its chat, so there is no webhook or polling.
 */

const API_URL = 'https://api.telegram.org';
/** A hung request would hold up every message queued behind it. */
const TIMEOUT_MS = 10_000;

export interface SendOptions {
  parse_mode?: 'HTML';
}

/** Telegram refused a message, e.g. 429 (too many) or 400 (bad HTML). */
export class TelegramError extends Error {
  readonly errorCode: number;
  /** On a 429: how many seconds Telegram asks to wait before sending again. */
  readonly retryAfter?: number;

  constructor(errorCode: number, description: string, retryAfter?: number) {
    super(`${errorCode}: ${description}`);
    this.name = 'TelegramError';
    this.errorCode = errorCode;
    this.retryAfter = retryAfter;
  }
}

/** What the Bot API answers: `ok` with a result, or the error. */
interface ApiResponse {
  ok: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export async function sendMessage(token: string, chatId: string, text: string, options: SendOptions = {}): Promise<void> {
  const response = await fetch(`${API_URL}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...options }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // A proxy in between can answer with something that is not JSON.
  const body: ApiResponse | undefined = await response.json().catch(() => undefined);
  if (!body?.ok) {
    throw new TelegramError(
      body?.error_code ?? response.status,
      body?.description ?? response.statusText,
      body?.parameters?.retry_after,
    );
  }
}
