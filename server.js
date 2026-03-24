require("dotenv").config();
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

const bot = new Telegraf(token);

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
          bot.telegram.sendMessage(chat, `⚠️ *Unhealthy Container Detected*\nName: \`${containerName}\`\nImage: \`${event.Actor.Attributes.image}\``, { parse_mode: 'Markdown' });
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
}
init();

// html server
const app = express();
app.use(express.json());

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

  //Relay to admin chat
  bot.telegram.sendMessage(chat, JSON.stringify(req.body));
};

// Keep both routes to avoid breaking old clients.
app.post('/', verifyIngestAuth, handleIngest);
app.post('/ingest', verifyIngestAuth, handleIngest);

app.get('/health', (_, res) => {
  res.json({ ok: true, environment });
});

app.listen(httpPort, () => {
  console.log('[Boot] Listening for http on port ' + httpPort);
})

process.on('SIGTERM', () => {
  console.log('[Shutdown] SIGTERM shutdown');
  process.exit(1)
});
process.on('SIGINT', () => {
  console.log('[Shutdown] SIGINT shutdown');
  process.exit(1)
});