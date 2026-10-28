import { existsSync } from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import { Telegraf } from 'telegraf';
import Docker from 'dockerode';
import { monitorDockerHealth } from './docker.ts';
import { formatRepeats, formatReport, formatUnhealthyContainer } from './format.ts';
import { createRelay } from './relay.ts';

// Production has no .env file (env vars come from the host instead), and loadEnvFile throws ENOENT if missing.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const environment = process.env.NODE_ENV ?? "production";

const token = process.env.ERRORBOT_TOKEN;
const url = process.env.ERRORBOT_URL;
const chat = process.env.ERRORBOT_CHAT;
const ingestKey = process.env.ERRORBOT_INGEST_KEY;

if (!url) {
  throw new Error("ERRORBOT_URL environment variable not set.");
}
if (!ingestKey) {
  throw new Error("ERRORBOT_INGEST_KEY environment variable not set.");
}
if (!token) {
  throw new Error("ERRORBOT_TOKEN environment variable not set.");
}
if (!chat) {
  throw new Error("ERRORBOT_CHAT environment variable not set.");
}

const httpPort = 4000;
const botPort = 4001;

const bot = new Telegraf(token);

const relay = createRelay({
  send: (text, options) => bot.telegram.sendMessage(chat, text, options),
  format: formatReport,
  formatRepeats,
});

const init = async () => {
  console.log('[Boot] Starting bot');
  bot.launch({ webhook: { domain: url, port: botPort } });
  console.log('[Boot] Bot ready on port ' + botPort);
  monitorDockerHealth({
    docker: new Docker({ socketPath: '/var/run/docker.sock' }),
    onUnhealthy: ({ name, image }) => relay.notify(formatUnhealthyContainer(name, image), { parse_mode: 'HTML' }),
    onLost: () => relay.notify('⚠️ Lost the Docker event stream; unhealthy containers go unreported until it reconnects.'),
    onRestored: () => relay.notify('✅ Docker event stream back; reporting unhealthy containers again.'),
  });
};

const verifyIngestAuth = (req: Request, res: Response, next: NextFunction) => {
  const providedKey = req.get('X-Errorbot-Key');
  if (!providedKey || providedKey !== ingestKey) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return next();
};

const handleIngest = (req: Request, res: Response) => {
  //Reply to the http request to close it
  res.send("OK");

  //Log everything to ourselves
  console.log(req.body);

  //Relay to admin chat: grouped, paced, retried (relay.ts)
  relay.report(req.body ?? {});
};

// html server
const app = express();
app.use(express.json());

// Keep both routes to avoid breaking old clients.
app.post('/', verifyIngestAuth, handleIngest);
app.post('/ingest', verifyIngestAuth, handleIngest);

app.get('/health', (_: Request, res: Response) => {
  res.json({ ok: true, environment });
});

if (import.meta.main) {
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
