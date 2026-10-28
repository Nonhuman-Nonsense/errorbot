import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { monitorDockerHealth, parseHealthEvent, type DockerClient, type UnhealthyContainer } from '../src/docker.ts';

const RETRY_MS = 30_000;

/** Let the stream, readline and the watch's promises run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

const quietLog = { log: () => {}, warn: () => {}, error: () => {} };

const unhealthy = (name: string, image = 'some/image') =>
  JSON.stringify({ id: 'abcdef0123456789', Action: 'health_status: unhealthy', Actor: { Attributes: { name, image } } }) + '\n';

/** A Docker whose event streams the test writes to; `fail` makes the next connects throw. */
function fakeDocker() {
  const streams: PassThrough[] = [];
  const state = { fail: undefined as Error | undefined };
  const docker: DockerClient = {
    ping: async () => {
      if (state.fail) throw state.fail;
    },
    getEvents: async () => {
      const stream = new PassThrough();
      streams.push(stream);
      return stream;
    },
  };
  return { docker, streams, state };
}

async function setup() {
  const fake = fakeDocker();
  const found: UnhealthyContainer[] = [];
  const events: string[] = [];
  await monitorDockerHealth({
    docker: fake.docker,
    onUnhealthy: (container) => found.push(container),
    onLost: () => events.push('lost'),
    onRestored: () => events.push('restored'),
    retryMs: RETRY_MS,
    log: quietLog,
  });
  return { ...fake, found, events };
}

describe('monitorDockerHealth', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('reports every event when several arrive in one chunk', async () => {
    const { streams, found } = await setup();
    streams[0].write(unhealthy('api') + unhealthy('db'));
    await settle();
    assert.deepEqual(found.map((c) => c.name), ['api', 'db']);
  });

  it('reports an event split across chunks', async () => {
    const { streams, found } = await setup();
    const line = unhealthy('api');
    streams[0].write(line.slice(0, 20));
    await settle();
    assert.equal(found.length, 0);
    streams[0].write(line.slice(20));
    await settle();
    assert.deepEqual(found.map((c) => c.name), ['api']);
  });

  it('keeps going after a line it cannot read', async () => {
    const { streams, found } = await setup();
    streams[0].write('not json\n' + unhealthy('db'));
    await settle();
    assert.deepEqual(found.map((c) => c.name), ['db']);
  });

  it('reconnects after the stream ends, and says so both times', async () => {
    const { streams, found, events } = await setup();
    streams[0].end();
    await settle();
    assert.deepEqual(events, ['lost']);

    mock.timers.tick(RETRY_MS);
    await settle();
    assert.equal(streams.length, 2);
    assert.deepEqual(events, ['lost', 'restored']);

    streams[1].write(unhealthy('api'));
    await settle();
    assert.deepEqual(found.map((c) => c.name), ['api']);
  });

  it('reconnects once after the stream fails', async () => {
    const { streams, events } = await setup();
    streams[0].destroy(new Error('socket hang up'));
    await settle();
    assert.deepEqual(events, ['lost']);

    mock.timers.tick(RETRY_MS);
    await settle();
    assert.equal(streams.length, 2);
  });

  it('keeps retrying while Docker is away', async () => {
    const { streams, state, events } = await setup();
    state.fail = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    streams[0].end();
    await settle();

    mock.timers.tick(RETRY_MS);
    await settle();
    mock.timers.tick(RETRY_MS);
    await settle();
    assert.equal(streams.length, 1);

    state.fail = undefined;
    mock.timers.tick(RETRY_MS);
    await settle();
    assert.equal(streams.length, 2);
    assert.deepEqual(events, ['lost', 'restored']);
  });

  it('stays off without a Docker socket', async () => {
    const fake = fakeDocker();
    fake.state.fail = Object.assign(new Error('connect ENOENT /var/run/docker.sock'), { code: 'ENOENT' });
    await monitorDockerHealth({ docker: fake.docker, onUnhealthy: () => {}, retryMs: RETRY_MS, log: quietLog });

    mock.timers.tick(RETRY_MS);
    await settle();
    assert.equal(fake.streams.length, 0);
  });
});

describe('parseHealthEvent', () => {
  it('ignores a container turning healthy', () => {
    const line = JSON.stringify({ id: 'abc', Action: 'health_status: healthy', Actor: { Attributes: { name: 'api' } } });
    assert.equal(parseHealthEvent(line), undefined);
  });

  it('falls back to the short id without a name', () => {
    const line = JSON.stringify({ id: 'abcdef0123456789', Action: 'health_status: unhealthy' });
    assert.deepEqual(parseHealthEvent(line), { name: 'abcdef012345', image: undefined });
  });
});
