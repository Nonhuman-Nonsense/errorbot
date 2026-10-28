# Errorbot

A Telegram relay service for application error reporting.

## Features

1. **HTTP relay**: accepts JSON reports and forwards them to a Telegram chat.
2. **Authenticated ingest**: optional shared-key auth via `X-Errorbot-Key`.
3. **Health endpoint**: lightweight `/health` endpoint for probes.
4. **Grouped repeats**: the first report of a kind is sent at once; more of the same kind within 10 minutes become one "N more like this" message when the window ends. Reports are the same kind when service, severity, source, context and the first line of the message match, with ids, numbers and UUIDs ignored (`relay.js`).
5. **Paced sends**: Telegram takes about 20 messages a minute into a group and loses the rest, so messages go out at most one per 3 s. On a 429 the bot waits as long as Telegram asks and sends the same message again. Up to 100 wait in line; past that it drops them and says how many.

## Endpoints

- `POST /ingest` - preferred ingest route for error reports.
- `POST /` - legacy ingest route (kept for backward compatibility).
- `GET /health` - returns service health JSON.

## Configuration

Required:

- `ERRORBOT_TOKEN`: Telegram Bot API token.
- `ERRORBOT_CHAT`: Telegram chat ID to send messages to.
- `ERRORBOT_URL`: public URL used by the Telegram webhook setup.

Optional:

- `ERRORBOT_INGEST_KEY`: when set, requests to `/ingest` and `/` must include `X-Errorbot-Key`.

## Reporter configuration

On services that report errors (for example on another droplet):

- `ERRORBOT=https://error.<your-domain>/ingest`
- `ERRORBOT_KEY=<same value as ERRORBOT_INGEST_KEY>`

Council uses `COUNCIL_ERRORBOT` and `COUNCIL_ERRORBOT_KEY` for the same ingest endpoint and key.

## Ingest payload (formatted for Telegram)

Ingest bodies are rendered as HTML Telegram messages. Required / recommended fields:

| Field | Values | Purpose |
|-------|--------|---------|
| `service` | e.g. `council-prod` | Which deployment |
| `severity` | `warning`, `error`, `critical` | How severe the report is |
| `clientImpact` | `none`, `notified`, `terminal`, `process_exit` | User / process impact |
| `source` | `server`, `client` | Where the report originated |
| `context` | free text | e.g. `meeting 42`, `AudioSystem` |
| `message` | free text | Human summary |
| `time` | ISO timestamp | When it happened |
| `error` | `{ name, message, stack }` | Optional stack block |
| `meetingId` | number (optional) | Council meeting id, when known |
| `socketId` | string (optional) | Socket.io session id, when known |

When `meetingId` and/or `socketId` are present, they appear on one compact line below the severity header (e.g. `meeting 42 · socket Kx9mP2aL`). Omitted entirely when neither is sent.

If HTML formatting fails, the bot falls back to `JSON.stringify(body)`.

## Running with Docker

Minimal setup:

```yaml
services:
  errorbot:
    image: nonhumannonsense/errorbot:latest
    environment:
      - ERRORBOT_TOKEN=...
      - ERRORBOT_CHAT=...
      - ERRORBOT_URL=...
      - ERRORBOT_INGEST_KEY=...
```

If you use Docker event monitoring in this service, also mount the Docker socket:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

## Build Docker image

```bash
docker build . -t nonhumannonsense/errorbot:latest
docker push nonhumannonsense/errorbot:latest
```

On Apple Silicon, you may need `--platform linux/amd64` in the build command.

### Licence

This work is licensed under a
[Creative Commons Attribution-NonCommercial 4.0 International License][cc-by-nc]

[![CC BY-NC 4.0][cc-by-nc-image]][cc-by-nc]

[cc-by-nc]: https://creativecommons.org/licenses/by-nc/4.0/
[cc-by-nc-image]: https://licensebuttons.net/l/by-nc/4.0/88x31.png
[cc-by-nc-shield]: https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg
