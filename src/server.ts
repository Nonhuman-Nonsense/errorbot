import { existsSync } from "node:fs";
import Docker from 'dockerode';
import { createApp } from './app.ts';
import { monitorDockerHealth } from './docker.ts';
import { formatRepeats, formatReport, formatUnhealthyContainer } from './format.ts';
import { createRelay } from './relay.ts';
import { sendMessage } from './telegram.ts';

// Production has no .env file (env vars come from the host instead), and loadEnvFile throws ENOENT if missing.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const environment = process.env.NODE_ENV ?? "production";

const token = process.env.ERRORBOT_TOKEN;
const chat = process.env.ERRORBOT_CHAT;
const ingestKey = process.env.ERRORBOT_INGEST_KEY;

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

const relay = createRelay({
  send: (text, options) => sendMessage(token, chat, text, options),
  format: formatReport,
  formatRepeats,
});

monitorDockerHealth({
  docker: new Docker({ socketPath: '/var/run/docker.sock' }),
  onUnhealthy: ({ name, image }) => relay.notify(formatUnhealthyContainer(name, image), { parse_mode: 'HTML' }),
  onLost: () => relay.notify('⚠️ Lost the Docker event stream; unhealthy containers go unreported until it reconnects.'),
  onRestored: () => relay.notify('✅ Docker event stream back; reporting unhealthy containers again.'),
});

const app = createApp({ ingestKey, onReport: relay.report, environment });

app.listen(httpPort, () => {
  console.log('[Boot] Listening for http on port ' + httpPort);
});

process.on('SIGTERM', () => {
  console.log('[Shutdown] SIGTERM shutdown');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[Shutdown] SIGINT shutdown');
  process.exit(0);
});
