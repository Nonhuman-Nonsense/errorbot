import { existsSync } from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import { Telegraf } from 'telegraf';
import Docker from 'dockerode';
import { formatRepeats, formatReport } from './format.ts';
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

/** The parts of a Docker event the monitor reads. */
interface DockerEvent {
  id: string;
  Action: string;
  Actor: { Attributes: { name?: string; image?: string } };
}

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

    stream.on('data', (chunk: Buffer) => {
      try {
        const event: DockerEvent = JSON.parse(chunk.toString());
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

    stream.on('error', (err: Error) => {
      console.error('[Docker] Event stream error', err);
    });

  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ECONNREFUSED') {
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

const verifyIngestAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!ingestKey) {
    return next();
  }
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
