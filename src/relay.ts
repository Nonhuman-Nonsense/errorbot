/**
 * Between the ingest and Telegram.
 *
 * Telegram takes about 20 messages a minute into a group chat. Past that it
 * answers 429, and a message sent anyway is lost — so a burst of reports from
 * one service (a scanner, a loop) used to drown out every other service's in the
 * same minute. The relay:
 *
 * - groups repeats: the first report of a kind goes out at once; more of the same
 *   kind within the window become one "N more like this" message when it ends;
 * - paces what it sends, and on a 429 waits as long as Telegram asks, then retries;
 * - keeps a bounded queue, and says so when it had to drop something.
 */

import type { Report } from './format.ts';
import { TelegramError, type SendOptions } from './telegram.ts';

const DEFAULT_WINDOW_MS = 10 * 60_000;
/** 20 a minute. */
const DEFAULT_MIN_INTERVAL_MS = 3_000;
const DEFAULT_MAX_QUEUE = 100;
const TELEGRAM_MAX = 4096;

/** Ids, counts and timestamps differ between repeats of the same report; the rest says what it is. */
function normalizeForGrouping(text: unknown): string {
  return String(text ?? '')
    .split('\n')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#')
    .replace(/\b[0-9a-f]{16,}\b/gi, '#')
    .replace(/\d+/g, '#');
}

/** Reports that are the same thing happening again: same service, severity, source, context and first line. */
export function groupKey(body: Report): string {
  return [
    body.service ?? '',
    body.severity ?? '',
    body.source ?? '',
    normalizeForGrouping(body.context),
    normalizeForGrouping(body.message),
  ].join('|');
}

export interface RelayOptions {
  /** Posts one message. */
  send: (text: string, options?: SendOptions) => Promise<unknown>;
  /** Renders a report as Telegram HTML. */
  format: (body: Report) => string;
  /** The "N more" message. */
  formatRepeats: (count: number, body: Report, windowMs: number) => string;
  windowMs?: number;
  minIntervalMs?: number;
  maxQueue?: number;
  log?: Pick<Console, 'warn' | 'error'>;
}

interface QueueItem {
  text: string;
  options?: SendOptions;
  /** Plain text to send instead if the formatted one is refused. */
  fallback?: string;
}

export function createRelay({
  send,
  format,
  formatRepeats,
  windowMs = DEFAULT_WINDOW_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  maxQueue = DEFAULT_MAX_QUEUE,
  log = console,
}: RelayOptions) {
  /** key → number of repeats since the group's first report went out. */
  const groups = new Map<string, number>();
  const queue: QueueItem[] = [];
  let pumping = false;
  let dropped = 0;

  const enqueue = (item: QueueItem) => {
    if (queue.length >= maxQueue) {
      dropped += 1;
      return;
    }
    queue.push(item);
    void pump();
  };

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const item = queue[0];
        try {
          await send(item.text, item.options);
          queue.shift();
        } catch (err) {
          if (err instanceof TelegramError && err.errorCode === 429) {
            const delay = err.retryAfter != null ? err.retryAfter * 1000 : minIntervalMs * 10;
            log.warn(`[Relay] Telegram rate limit, retrying in ${delay} ms (${queue.length} queued)`);
            await wait(delay);
            continue;
          }
          queue.shift();
          if (item.fallback) {
            log.error('[Relay] Send failed, falling back to plain text', err);
            queue.unshift({ text: item.fallback });
          } else {
            log.error('[Relay] Send failed, dropping message', err);
          }
        }
        if (queue.length === 0 && dropped > 0) {
          queue.push({ text: `⚠️ ${dropped} report(s) dropped: more arrived than Telegram would take.` });
          dropped = 0;
        }
        if (queue.length > 0) await wait(minIntervalMs);
      }
    } finally {
      pumping = false;
    }
  };

  /** A report from the ingest: sent, or counted towards its group's summary. */
  const report = (body: Report) => {
    const key = groupKey(body);
    if (groups.has(key)) {
      groups.set(key, (groups.get(key) ?? 0) + 1);
      return;
    }
    groups.set(key, 0);
    setTimeout(() => {
      const repeats = groups.get(key) ?? 0;
      groups.delete(key);
      if (repeats > 0) enqueue({ text: formatRepeats(repeats, body, windowMs), options: { parse_mode: 'HTML' } });
    }, windowMs);
    enqueue({
      text: format(body),
      options: { parse_mode: 'HTML' },
      fallback: JSON.stringify(body).slice(0, TELEGRAM_MAX),
    });
  };

  /** Any other message (e.g. a Docker health alert): paced with the reports, never grouped. */
  const notify = (text: string, options?: SendOptions) => enqueue({ text, options });

  return { report, notify };
}
