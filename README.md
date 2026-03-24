# Errorbot

A Telegram relay service for application error reporting.

## Features

1. **HTTP relay**: accepts JSON reports and forwards them to a Telegram chat.
2. **Authenticated ingest**: optional shared-key auth via `X-Errorbot-Key`.
3. **Health endpoint**: lightweight `/health` endpoint for probes.

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

- `COUNCIL_ERRORBOT=https://error.<your-domain>/ingest`
- `COUNCIL_ERRORBOT_KEY=<same value as ERRORBOT_INGEST_KEY>`

## Running with Docker

Minimal setup:

```yaml
services:
  errorbot:
    image: nonhumannonsense/council-of-errors:latest
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
docker build . -t nonhumannonsense/council-of-errors:latest
docker push nonhumannonsense/council-of-errors:latest
```

On Apple Silicon, you may need `--platform linux/amd64` in the build command.

### Licence

This work is licensed under a
[Creative Commons Attribution-NonCommercial 4.0 International License][cc-by-nc]

[![CC BY-NC 4.0][cc-by-nc-image]][cc-by-nc]

[cc-by-nc]: https://creativecommons.org/licenses/by-nc/4.0/
[cc-by-nc-image]: https://licensebuttons.net/l/by-nc/4.0/88x31.png
[cc-by-nc-shield]: https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg
