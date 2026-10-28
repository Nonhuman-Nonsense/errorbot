import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatReport, formatUnhealthyContainer } from '../src/format.ts';

describe('formatReport', () => {
  it('renders critical terminal council reports', () => {
    const text = formatReport({
      service: 'council-dev',
      severity: 'critical',
      clientImpact: 'terminal',
      source: 'server',
      context: 'AudioSystem',
      message: '[CLIENT TERMINAL] Error generating audio',
      time: '2026-06-17T12:00:00.000Z',
      error: { name: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at AudioSystem.ts:1' },
    });

    assert.match(text, /💀.*CRITICAL/s);
    assert.match(text, /Client session ended/);
    assert.match(text, /AudioSystem/);
    assert.match(text, /Error generating audio/);
    assert.match(text, /TypeError: boom/);
  });

  it('renders warning with notified impact', () => {
    const text = formatReport({
      service: 'council-prod',
      severity: 'warning',
      clientImpact: 'notified',
      source: 'server',
      context: 'meeting 42',
      message: 'Validation error for submit_human_message',
      time: '2026-06-17T12:00:00.000Z',
    });

    assert.match(text, /⚠️.*WARNING/s);
    assert.match(text, /Client notified/);
    assert.match(text, /meeting 42/);
  });

  it('omits impact line when clientImpact is none', () => {
    const text = formatReport({
      severity: 'error',
      clientImpact: 'none',
      message: 'Database insert failed',
    });

    assert.match(text, /🔴.*ERROR/s);
    assert.doesNotMatch(text, /Client session ended/);
    assert.doesNotMatch(text, /Client notified/);
  });

  it('renders meeting and socket ids when present', () => {
    const text = formatReport({
      service: 'council-dev',
      severity: 'error',
      clientImpact: 'terminal',
      source: 'server',
      context: 'meeting',
      message: 'Conversation process error',
      meetingId: 42,
      socketId: 'Kx9mP2aL',
      time: '2026-06-17T12:00:00.000Z',
    });

    assert.match(text, /meeting <code>42<\/code>/);
    assert.match(text, /socket <code>Kx9mP2aL<\/code>/);
  });

  it('omits session line when meetingId and socketId are absent', () => {
    const text = formatReport({
      severity: 'error',
      context: 'api',
      message: 'Database insert failed',
    });

    assert.doesNotMatch(text, /meeting <code>/);
    assert.doesNotMatch(text, /socket <code>/);
  });

  it('renders only meetingId when socketId is absent', () => {
    const text = formatReport({
      severity: 'critical',
      source: 'client',
      meetingId: 7,
      message: 'Client terminal error',
    });

    assert.match(text, /meeting <code>7<\/code>/);
    assert.doesNotMatch(text, /socket <code>/);
  });

  it('escapes html in user-controlled message text', () => {
    const text = formatReport({
      severity: 'error',
      message: '<script>alert(1)</script>',
    });

    assert.doesNotMatch(text, /<script>/);
    assert.match(text, /&lt;script&gt;/);
  });

  it('renders requestParams when present', () => {
    const text = formatReport({
      severity: 'warning',
      context: 'api GET /api/meetings/:meetingId',
      message: 'GET /api/meetings/1228 failed, Bad request',
      requestParams: { params: { meetingId: '1228' }, query: {} },
    });

    assert.match(text, /<b>Request:<\/b>/);
    assert.match(text, /params=\{"meetingId":"1228"\}/);
    assert.doesNotMatch(text, /query=/);
  });

  it('omits the request line when requestParams is absent or empty', () => {
    const text = formatReport({
      severity: 'warning',
      message: 'Database insert failed',
      requestParams: { params: {}, query: {} },
    });

    assert.doesNotMatch(text, /<b>Request:<\/b>/);
  });
});

describe('formatUnhealthyContainer', () => {
  it('escapes names that would break the message', () => {
    const text = formatUnhealthyContainer('my_app<1>', 'registry/my_image:latest');
    assert.match(text, /<code>my_app&lt;1&gt;<\/code>/);
    assert.match(text, /<code>registry\/my_image:latest<\/code>/);
  });

  it('says so when the image is not known', () => {
    assert.match(formatUnhealthyContainer('db', undefined), /Image: <code>unknown<\/code>/);
  });
});
