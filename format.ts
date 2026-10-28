/**
 * Renders ingest reports as Telegram HTML messages.
 */

const TELEGRAM_MAX = 4096;

/** An ingest body, as documented in the README. It comes from other services, so every field may be missing. */
export interface Report {
  service?: string;
  severity?: string;
  clientImpact?: string;
  source?: string;
  context?: string;
  message?: string;
  time?: string;
  error?: { name?: string; message?: string; stack?: string };
  meetingId?: number | string;
  socketId?: string;
  /** Raw request params/query from the API layer, e.g. `{ params: { meetingId: "1228" }, query: {} }`. */
  requestParams?: { params?: Record<string, unknown>; query?: Record<string, unknown> };
}

type Severity = 'warning' | 'error' | 'critical' | 'unknown';

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function normalizeSeverity(body: Report): Severity {
  const raw = (body.severity ?? 'unknown').toString().toLowerCase();
  if (raw === 'warning') return 'warning';
  if (raw === 'critical') return 'critical';
  if (raw === 'error') return 'error';
  return 'unknown';
}

function impactLabel(impact: string): string | undefined {
  if (impact === 'terminal') return '🛑 <b>Client session ended</b>';
  if (impact === 'process_exit') return '☠️ <b>Process exited</b>';
  if (impact === 'notified') return '📣 Client notified';
  return undefined;
}

function formatErrorBlock(error: Report['error']): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const stack = error.stack || error.message;
  if (!stack) return undefined;
  return escapeHtml(String(stack));
}

function formatRequestParams(requestParams: Report['requestParams']): string | undefined {
  if (!requestParams || typeof requestParams !== 'object') return undefined;
  const { params, query } = requestParams;
  const parts: string[] = [];
  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    parts.push(`params=${JSON.stringify(params)}`);
  }
  if (query && typeof query === 'object' && Object.keys(query).length > 0) {
    parts.push(`query=${JSON.stringify(query)}`);
  }
  if (parts.length === 0) return undefined;
  return escapeHtml(parts.join(' '));
}

const SEVERITY_EMOJI: Record<Severity, string> = {
  warning: '⚠️',
  error: '🔴',
  critical: '💀',
  unknown: '❓',
};

/**
 * Render an ingest JSON body as a readable Telegram HTML message.
 */
export function formatReport(body: Report): string {
  const severity = normalizeSeverity(body);
  const emoji = SEVERITY_EMOJI[severity] ?? '❓';

  const service = body.service ?? 'unknown';
  const source = body.source ?? 'server';
  const impact = body.clientImpact;

  const lines = [
    `${emoji} <b>${severity.toUpperCase()}</b> · <code>${escapeHtml(service)}</code> · ${escapeHtml(source)}`,
  ];

  const sessionParts: string[] = [];
  if (body.meetingId != null && body.meetingId !== '') {
    sessionParts.push(`meeting <code>${escapeHtml(body.meetingId)}</code>`);
  }
  if (body.socketId) {
    sessionParts.push(`socket <code>${escapeHtml(body.socketId)}</code>`);
  }
  if (sessionParts.length) {
    lines.push(sessionParts.join(' · '));
  }

  if (impact && impact !== 'none') {
    const impactLine = impactLabel(impact);
    if (impactLine) lines.push(impactLine);
  }

  if (body.context) {
    lines.push(`<b>Context:</b> <code>${escapeHtml(body.context)}</code>`);
  }

  const requestParamsLine = formatRequestParams(body.requestParams);
  if (requestParamsLine) {
    lines.push(`<b>Request:</b> <code>${requestParamsLine}</code>`);
  }

  if (body.message) {
    lines.push('');
    lines.push(escapeHtml(body.message));
  }

  const errorBlock = formatErrorBlock(body.error);
  if (errorBlock) {
    lines.push('');
    lines.push(`<pre>${errorBlock.slice(0, 2800)}</pre>`);
  }

  if (body.time) {
    lines.push('');
    lines.push(`<i>${escapeHtml(body.time)}</i>`);
  }

  let text = lines.join('\n');
  if (text.length > TELEGRAM_MAX) {
    text = `${text.slice(0, TELEGRAM_MAX - 20)}\n… [truncated]`;
  }
  return text;
}

/**
 * The one message for reports grouped behind an earlier one (see relay.ts): how
 * many, and enough of the first to recognise it.
 */
export function formatRepeats(count: number, body: Report, windowMs: number): string {
  const severity = normalizeSeverity(body);
  const minutes = Math.round(windowMs / 60_000);
  const lines = [
    `🔁 <b>${count} more like this</b> in the last ${minutes} min · ${SEVERITY_EMOJI[severity] ?? '❓'} <code>${escapeHtml(body.service ?? 'unknown')}</code>`,
  ];
  if (body.context) lines.push(`<b>Context:</b> <code>${escapeHtml(body.context)}</code>`);
  if (body.message) lines.push('', escapeHtml(String(body.message).split('\n')[0]).slice(0, 500));
  return lines.join('\n');
}
