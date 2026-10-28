import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createApp } from '../src/app.ts';
import type { Report } from '../src/format.ts';

describe('app', () => {
  const reports: Report[] = [];
  let server: Server;
  let base: string;

  before(async () => {
    const app = createApp({ ingestKey: 'secret', onReport: (body) => reports.push(body), environment: 'test' });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const ingest = (path: string, key?: string) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Errorbot-Key': key } : {}) },
      body: JSON.stringify({ service: 'test', message: 'boom' }),
    });

  it('relays a report sent with the key', async () => {
    reports.length = 0;
    const res = await ingest('/ingest', 'secret');
    assert.equal(res.status, 200);
    assert.deepEqual(reports, [{ service: 'test', message: 'boom' }]);
  });

  it('refuses a report with a wrong or missing key', async () => {
    reports.length = 0;
    for (const key of ['wrong', 'secret-but-longer', undefined]) {
      const res = await ingest('/ingest', key);
      assert.equal(res.status, 401);
    }
    assert.equal(reports.length, 0);
  });

  it('no longer takes reports on the legacy / route', async () => {
    reports.length = 0;
    const res = await ingest('/', 'secret');
    assert.equal(res.status, 404);
    assert.equal(reports.length, 0);
  });

  it('answers health probes', async () => {
    const res = await fetch(`${base}/health`);
    assert.deepEqual(await res.json(), { ok: true, environment: 'test' });
  });
});
