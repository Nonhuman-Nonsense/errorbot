import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import type { Report } from '../format.ts';
import { createRelay, groupKey, type RelayOptions } from '../relay.ts';

const WINDOW_MS = 10 * 60_000;
const INTERVAL_MS = 3_000;

/** Let the relay's promise chain run after a send or a timer. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

const quietLog = { warn: () => {}, error: () => {} };

function rateLimited(retryAfterSeconds: number) {
  return Object.assign(new Error('429: Too Many Requests'), {
    response: { error_code: 429, parameters: { retry_after: retryAfterSeconds } },
  });
}

function setup({ send = async () => {}, maxQueue }: { send?: RelayOptions['send']; maxQueue?: number } = {}) {
  const sent: string[] = [];
  const relay = createRelay({
    send: async (text, options) => {
      await send(text, options);
      sent.push(text);
    },
    format: (body) => `report: ${body.message}`,
    formatRepeats: (count, body) => `${count} more: ${body.message}`,
    windowMs: WINDOW_MS,
    minIntervalMs: INTERVAL_MS,
    ...(maxQueue ? { maxQueue } : {}),
    log: quietLog,
  });
  return { relay, sent };
}

const report = (message: string, extra: Report = {}): Report => ({ service: 'CouncilOfForest', severity: 'warning', source: 'server', context: 'api', message, ...extra });

describe('relay', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('sends the first report of a kind at once and its repeats as one message when the window ends', async () => {
    const { relay, sent } = setup();
    relay.report(report('GET /api/meetings/1 failed, Bad request'));
    relay.report(report('GET /api/meetings/2 failed, Bad request'));
    relay.report(report('GET /api/meetings/3 failed, Bad request'));
    await settle();
    assert.deepEqual(sent, ['report: GET /api/meetings/1 failed, Bad request']);

    mock.timers.tick(WINDOW_MS);
    await settle();
    assert.deepEqual(sent.slice(1), ['2 more: GET /api/meetings/1 failed, Bad request']);
  });

  it('sends nothing more for a report that was not repeated', async () => {
    const { relay, sent } = setup();
    relay.report(report('once'));
    await settle();
    mock.timers.tick(WINDOW_MS);
    await settle();
    assert.equal(sent.length, 1);
  });

  it('paces distinct reports to Telegram\'s rate', async () => {
    const { relay, sent } = setup();
    relay.report(report('first'));
    relay.report(report('second', { context: 'socket' }));
    await settle();
    assert.equal(sent.length, 1);

    mock.timers.tick(INTERVAL_MS - 1);
    await settle();
    assert.equal(sent.length, 1);
    mock.timers.tick(1);
    await settle();
    assert.equal(sent.length, 2);
  });

  it('waits as long as Telegram asks after a 429, then sends the same message', async () => {
    let refusals = 1;
    const { relay, sent } = setup({
      send: async () => {
        if (refusals-- > 0) throw rateLimited(7);
      },
    });
    relay.report(report('important'));
    await settle();
    assert.equal(sent.length, 0);

    mock.timers.tick(6_999);
    await settle();
    assert.equal(sent.length, 0);
    mock.timers.tick(1);
    await settle();
    assert.deepEqual(sent, ['report: important']);
  });

  it('falls back to plain text when the formatted message is refused', async () => {
    const { relay, sent } = setup({
      send: async (text) => {
        if (text.startsWith('report:')) throw Object.assign(new Error("400: can't parse entities"), { response: { error_code: 400 } });
      },
    });
    relay.report(report('<odd>'));
    await settle();
    mock.timers.tick(INTERVAL_MS);
    await settle();
    assert.equal(sent.length, 1);
    assert.match(sent[0], /"message":"<odd>"/);
  });

  it('says how many it dropped when more arrive than the queue holds', async () => {
    const { relay, sent } = setup({ maxQueue: 2 });
    for (const context of ['a', 'b', 'c', 'd']) relay.report(report('distinct', { context }));
    for (let i = 0; i < 4; i++) {
      await settle();
      mock.timers.tick(INTERVAL_MS);
    }
    await settle();
    assert.equal(sent.length, 3);
    assert.match(sent[2], /2 report\(s\) dropped/);
  });
});

describe('groupKey', () => {
  const cases = [
    { name: 'ids and counts in the message', a: report('Meeting 1546 not found (occurrence 1)'), b: report('Meeting 1550 not found (occurrence 2)'), same: true },
    { name: 'a uuid in the context', a: report('x', { context: 'page 88b0e3d2-4cbd-437a-acce-cf26c7803940' }), b: report('x', { context: 'page 0d324549-226a-4c68-a025-b990be5f07aa' }), same: true },
    { name: 'a second line that differs (user agent)', a: report('boom\nUA: Chrome'), b: report('boom\nUA: Safari'), same: true },
    { name: 'another service', a: report('boom'), b: report('boom', { service: 'CouncilOfFoods' }), same: false },
    { name: 'another severity', a: report('boom'), b: report('boom', { severity: 'critical' }), same: false },
    { name: 'another message', a: report('boom'), b: report('bang'), same: false },
  ];
  for (const { name, a, b, same } of cases) {
    it(`${same ? 'groups' : 'keeps apart'} reports differing in ${name}`, () => {
      assert.equal(groupKey(a) === groupKey(b), same);
    });
  }
});
