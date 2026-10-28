const { existsSync } = require("node:fs");

// Production has no .env file (env vars come from the host instead), and loadEnvFile throws ENOENT if missing.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const environment = process.env.NODE_ENV ?? "production";
const express = require("express");
const { Telegraf } = require('telegraf');

if (!process.env.ERRORBOT_URL) {
  throw new Error("ERRORBOT_URL environment variable not set.");
}
if (!process.env.ERRORBOT_INGEST_KEY) {
  throw new Error("ERRORBOT_INGEST_KEY environment variable not set.");
}
if (!process.env.ERRORBOT_TOKEN) {
  throw new Error("ERRORBOT_TOKEN environment variable not set.");
}
if (!process.env.ERRORBOT_CHAT) {
  throw new Error("ERRORBOT_CHAT environment variable not set.");
}

const httpPort = 4000;
const botPort = 4001;

const token = process.env.ERRORBOT_TOKEN;
const url = process.env.ERRORBOT_URL;
const chat = process.env.ERRORBOT_CHAT;
const ingestKey = process.env.ERRORBOT_INGEST_KEY;

const Docker = require('dockerode');
const { createRelay } = require('./relay.js');

const bot = new Telegraf(token);

const TELEGRAM_MAX = 4096;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeSeverity(body) {
  const raw = (body.severity ?? 'unknown').toString().toLowerCase();
  if (raw === 'warning') return 'warning';
  if (raw === 'critical') return 'critical';
  if (raw === 'error') return 'error';
  return 'unknown';
}

function impactLabel(impact) {
  if (impact === 'terminal') return '🛑 <b>Client session ended</b>';
  if (impact === 'process_exit') return '☠️ <b>Process exited</b>';
  if (impact === 'notified') return '📣 Client notified';
  return undefined;
}

function formatErrorBlock(error) {
  if (!error || typeof error !== 'object') return undefined;
  const stack = error.stack || error.message;
  if (!stack) return undefined;
  return escapeHtml(String(stack));
}

/** Raw request params/query from the API layer, e.g. `{ params: { meetingId: "1228" }, query: {} }`. */
function formatRequestParams(requestParams) {
  if (!requestParams || typeof requestParams !== 'object') return undefined;
  const { params, query } = requestParams;
  const parts = [];
  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    parts.push(`params=${JSON.stringify(params)}`);
  }
  if (query && typeof query === 'object' && Object.keys(query).length > 0) {
    parts.push(`query=${JSON.stringify(query)}`);
  }
  if (parts.length === 0) return undefined;
  return escapeHtml(parts.join(' '));
}

/**
 * Render an ingest JSON body as a readable Telegram HTML message.
 */
const SEVERITY_EMOJI = {
  warning: '⚠️',
  error: '🔴',
  critical: '💀',
  unknown: '❓',
};

function formatReport(body) {
  const severity = normalizeSeverity(body);
  const emoji = SEVERITY_EMOJI[severity] ?? '❓';

  const service = body.service ?? 'unknown';
  const source = body.source ?? 'server';
  const impact = body.clientImpact;

  const lines = [
    `${emoji} <b>${severity.toUpperCase()}</b> · <code>${escapeHtml(service)}</code> · ${escapeHtml(source)}`,
  ];

  const sessionParts = [];
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
 * The one message for reports grouped behind an earlier one (see relay.js): how
 * many, and enough of the first to recognise it.
 */
function formatRepeats(count, body, windowMs) {
  const severity = normalizeSeverity(body);
  const minutes = Math.round(windowMs / 60_000);
  const lines = [
    `🔁 <b>${count} more like this</b> in the last ${minutes} min · ${SEVERITY_EMOJI[severity] ?? '❓'} <code>${escapeHtml(body.service ?? 'unknown')}</code>`,
  ];
  if (body.context) lines.push(`<b>Context:</b> <code>${escapeHtml(body.context)}</code>`);
  if (body.message) lines.push('', escapeHtml(String(body.message).split('\n')[0]).slice(0, 500));
  return lines.join('\n');
}

const relay = createRelay({
  send: (text, options) => bot.telegram.sendMessage(chat, text, options),
  format: formatReport,
  formatRepeats,
});

const monitorDockerEvents = async () => {
  try {
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    // Check if we can talk to docker (e.g. is the socket mounted?)
    await docker.ping();
    console.log('[Docker] Connected to Docker socket');

    const stream = await docker.getEvents({
      filters: {
        type: ['container'],
        event: ['health_status']
      }
    });

    stream.on('data', chunk => {
      try {
        const event = JSON.parse(chunk.toString());
        // Action format example: "health_status: unhealthy"
        if (event.Action.includes('unhealthy')) {
          const containerName = event.Actor.Attributes.name || event.id.substring(0, 12);
          console.log(`[Docker] Unhealthy container detected: ${containerName}`);
          relay.notify(`⚠️ *Unhealthy Container Detected*\nName: \`${containerName}\`\nImage: \`${event.Actor.Attributes.image}\``, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error('[Docker] Error processing event chunk', err);
      }
    });

    stream.on('error', err => {
      console.error('[Docker] Event stream error', err);
    });

  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
      console.log('[Docker] Docker socket not found or inaccessible. Monitoring disabled.');
    } else {
      console.error('[Docker] Failed to initialize monitoring', err);
    }
  }
};

const init = async () => {
  console.log('[Boot] Starting bot');
  bot.launch({ webhook: { domain: url, port: botPort } });
  console.log('[Boot] Bot ready on port ' + botPort);
  monitorDockerEvents();
};

const verifyIngestAuth = (req, res, next) => {
  if (!ingestKey) {
    return next();
  }
  const providedKey = req.get('X-Errorbot-Key');
  if (!providedKey || providedKey !== ingestKey) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return next();
};

const handleIngest = (req, res) => {
  //Reply to the http request to close it
  res.send("OK");

  //Log everything to ourselves
  console.log(req.body);

  //Relay to admin chat: grouped, paced, retried (relay.js)
  relay.report(req.body ?? {});
};

// html server
const app = express();
app.use(express.json());

// Keep both routes to avoid breaking old clients.
app.post('/', verifyIngestAuth, handleIngest);
app.post('/ingest', verifyIngestAuth, handleIngest);

app.get('/health', (_, res) => {
  res.json({ ok: true, environment });
});

if (require.main === module) {
  init();
  app.listen(httpPort, () => {
    console.log('[Boot] Listening for http on port ' + httpPort);
  });
}

process.on('SIGTERM', () => {
  console.log('[Shutdown] SIGTERM shutdown');
  process.exit(1)
});
process.on('SIGINT', () => {
  console.log('[Shutdown] SIGINT shutdown');
  process.exit(1)
});

module.exports = { formatReport, formatRepeats, escapeHtml, normalizeSeverity };
