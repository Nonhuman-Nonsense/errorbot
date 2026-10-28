/**
 * Watches Docker for containers turning unhealthy.
 *
 * The event stream is newline-delimited JSON, and a chunk of it can hold several
 * events or part of one, so it is read line by line. When the stream ends or
 * fails (the daemon restarted, say) the watch reconnects after a pause instead of
 * quietly stopping.
 */

import { createInterface } from 'node:readline';
import type { GetEventsOptions } from 'dockerode';

const DEFAULT_RETRY_MS = 30_000;

/** The parts of dockerode the watch uses. */
export interface DockerClient {
  ping(): Promise<unknown>;
  getEvents(options: GetEventsOptions): Promise<NodeJS.ReadableStream>;
}

export interface UnhealthyContainer {
  name: string;
  image?: string;
}

/** The parts of a Docker event the watch reads. */
interface DockerEvent {
  id: string;
  Action?: string;
  Actor?: { Attributes?: { name?: string; image?: string } };
}

/** The container a health event is about, if it says the container became unhealthy. */
export function parseHealthEvent(line: string): UnhealthyContainer | undefined {
  const event: DockerEvent = JSON.parse(line);
  // Action format example: "health_status: unhealthy"
  if (!event.Action?.includes('unhealthy')) return undefined;
  const attributes = event.Actor?.Attributes ?? {};
  return { name: attributes.name || event.id.substring(0, 12), image: attributes.image };
}

export interface MonitorOptions {
  docker: DockerClient;
  onUnhealthy: (container: UnhealthyContainer) => void;
  /** The watch stopped after it had been running; it keeps trying to reconnect. */
  onLost?: () => void;
  /** The watch is running again after onLost. */
  onRestored?: () => void;
  retryMs?: number;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * Starts the watch. Without a Docker socket (not mounted) monitoring stays off;
 * once it has connected, it keeps reconnecting for as long as the process runs.
 */
export async function monitorDockerHealth({
  docker,
  onUnhealthy,
  onLost,
  onRestored,
  retryMs = DEFAULT_RETRY_MS,
  log = console,
}: MonitorOptions): Promise<void> {
  const retry = () => setTimeout(() => void connect(true), retryMs);

  const watch = (stream: NodeJS.ReadableStream) => {
    let stopped = false;
    const stop = (reason: string, err?: unknown) => {
      if (stopped) return;
      stopped = true;
      log.warn(`[Docker] Event stream ${reason}, reconnecting in ${retryMs} ms`, ...(err ? [err] : []));
      onLost?.();
      retry();
    };

    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const container = parseHealthEvent(line);
        if (!container) return;
        log.log(`[Docker] Unhealthy container detected: ${container.name}`);
        onUnhealthy(container);
      } catch (err) {
        log.error('[Docker] Error processing event', err);
      }
    });
    // readline passes the stream's errors on, and closes when the stream ends.
    lines.on('error', (err) => stop('failed', err));
    lines.on('close', () => stop('ended'));
  };

  const connect = async (reconnecting: boolean) => {
    try {
      // Check if we can talk to docker (e.g. is the socket mounted?)
      await docker.ping();
      const stream = await docker.getEvents({
        filters: {
          type: ['container'],
          event: ['health_status'],
        },
      });
      log.log(`[Docker] ${reconnecting ? 'Reconnected' : 'Connected'} to Docker socket`);
      watch(stream);
      if (reconnecting) onRestored?.();
    } catch (err) {
      if (reconnecting) {
        log.error(`[Docker] Reconnect failed, retrying in ${retryMs} ms`, err);
        retry();
        return;
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        log.log('[Docker] Docker socket not found or inaccessible. Monitoring disabled.');
      } else {
        log.error('[Docker] Failed to initialize monitoring', err);
      }
    }
  };

  await connect(false);
}
