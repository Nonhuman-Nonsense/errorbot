import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { sendMessage, TelegramError } from '../src/telegram.ts';

/** Makes the next fetch answer with `body` as JSON, and records the request. */
function answer(status: number, body: unknown) {
  const requests: { url: string; body: unknown }[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
  return requests;
}

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('expected a rejection');
};

describe('sendMessage', () => {
  afterEach(() => mock.restoreAll());

  it('posts the text to the chat', async () => {
    const requests = answer(200, { ok: true, result: {} });
    await sendMessage('TOKEN', '-100', '<b>hi</b>', { parse_mode: 'HTML' });
    assert.deepEqual(requests, [{
      url: 'https://api.telegram.org/botTOKEN/sendMessage',
      body: { chat_id: '-100', text: '<b>hi</b>', parse_mode: 'HTML' },
    }]);
  });

  it('passes on how long Telegram asks to wait after a 429', async () => {
    answer(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } });
    const err = await rejection(sendMessage('TOKEN', '-100', 'hi'));
    assert.ok(err instanceof TelegramError);
    assert.equal(err.errorCode, 429);
    assert.equal(err.retryAfter, 7);
  });

  it('fails with the HTTP status when the answer is not JSON', async () => {
    answer(502, '<html>Bad Gateway</html>');
    const err = await rejection(sendMessage('TOKEN', '-100', 'hi'));
    assert.ok(err instanceof TelegramError);
    assert.equal(err.errorCode, 502);
  });
});
