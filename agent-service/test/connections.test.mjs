import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createTransport, httpConfig } from '../dist/common/connections/http.js';
import { consume } from '../dist/common/connections/pubsub.js';
import { turnSchema, streamSchema } from '../dist/contracts/events.js';

const secret = 'a'.repeat(32);
const signal = () => new AbortController().signal;
async function serverTest(fn) {
  let calls = [];
  const server = createServer(async (req, res) => {
    calls.push(req);
    if (req.url === '/slow') { setTimeout(() => res.end('{}'), 100); return; }
    if (req.url === '/redirect') { res.writeHead(302, { location: '/ok' }); res.end(); return; }
    if (req.url === '/denied') { res.writeHead(403); res.end(); return; }
    if (req.url === '/broken') { req.socket.destroy(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(req.url === '/invalid' ? 'bad' : req.url === '/large' ? JSON.stringify('x'.repeat(1000)) : '{"ok":true}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const target = { origin, secret };
  const config = { auth: 'local', destinations: { supplier: target, order: target, mandate: target } };
  const request = { destination: 'order', path: '/ok', method: 'POST', body: {}, operation_key: null, signal: signal() };
  try { await fn(config, request, calls); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('fixed destinations, service credentials, operation identity and tracing', () => serverTest(async (config, request, calls) => {
  const send = createTransport(config);
  assert.deepEqual(await send({ ...request, operation_key: 'stable', traceparent: 'trace' }), { ok: true });
  assert.equal(calls[0].headers['x-internal-secret'], secret);
  assert.equal(calls[0].headers['idempotency-key'], 'stable');
  assert.equal(calls[0].headers.traceparent, 'trace');
  assert.equal(calls[0].headers.authorization, undefined);
  for (const path of ['//example.com', 'https://example.com', '/\\example.com']) await assert.rejects(send({ ...request, path }));
  await assert.rejects(send({ ...request, path: '/redirect' }));
  assert.equal(calls.filter(call => call.url === '/ok').length, 1);
}));
test('bounded JSON, authentication, cancellation and uncertain writes without retry', () => serverTest(async (config, request, calls) => {
  const send = createTransport({ ...config, maxResponseBytes: 100, timeoutMs: 30 });
  for (const path of ['/invalid', '/large']) await assert.rejects(send({ ...request, path }), { kind: 'invalid_response' });
  await assert.rejects(send({ ...request, path: '/denied' }), { kind: 'authentication' });
  await assert.rejects(send({ ...request, path: '/slow' }), { kind: 'cancelled' });
  await assert.rejects(send({ ...request, path: '/broken', operation_key: 'original' }), { kind: 'uncertain_write' });
  assert.equal(calls.filter(call => call.url === '/broken').length, 1);
  await assert.rejects(send({ ...request, signal: AbortSignal.abort() }), { kind: 'cancelled' });
}));
test('invalid configuration fails closed', () => {
  assert.throws(() => httpConfig({}));
  assert.throws(() => createTransport({ auth: 'local', destinations: { order: { origin: 'http://localhost' } } }));
});
test('Google credential provider failure has no local fallback', async () => {
  const target = { origin: 'https://example.com', audience: 'https://example.com' };
  let audience;
  const send = createTransport({ auth: 'google', destinations: { order: target, supplier: target, mandate: target } }, async value => { audience = value; throw new Error('no identity'); });
  await assert.rejects(send({ destination: 'order', path: '/get', method: 'POST', body: {}, operation_key: null, signal: signal() }), { kind: 'authentication' });
  assert.equal(audience, target.audience);
});
test('consumer renews before work and acknowledges only successful handlers', async () => {
  const controller = new AbortController(); const actions = []; let attempts = 0;
  await consume({ concurrency: 1, signal: controller.signal, onError() {},
    async pull() { return { event: {}, async renew() { actions.push('renew'); }, async ack() { actions.push('ack'); controller.abort(); }, async defer() { actions.push('defer'); } }; },
    async handle() { actions.push('handle'); if (++attempts === 1) throw new Error('not committed'); },
  });
  assert.deepEqual(actions, ['renew', 'handle', 'defer', 'renew', 'handle', 'ack']);
});
test('rejects malformed or mismatched event envelopes', () => {
  assert.equal(turnSchema.safeParse({ data: { conversation_id: 'a', message_id: 'b' }, ordering_key: 'other', attributes: { schema_version: '1', event_type: 'agent.turn.requested', event_id: 'id' } }).success, false);
  assert.equal(streamSchema.safeParse({ type: 'message_delta', text: 'x' }).success, false);
});

test('shutdown cancels active handlers without acknowledgement', async () => {
  const controller = new AbortController(); let acknowledged = false, handled = false;
  await consume({ concurrency: 1, signal: controller.signal, onError() {},
    async pull() { return { event: {}, async renew() {}, async ack() { acknowledged = true; }, async defer() {} }; },
    async handle(_event, handlerSignal) {
      handled = true;
      await new Promise(resolve => {
        handlerSignal.addEventListener('abort', resolve, { once: true });
        controller.abort();
      });
    },
  });
  assert.equal(handled, true); assert.equal(acknowledged, false);
});

test('cancellation bounds a stalled service identity provider', async () => {
  const target = { origin: 'https://example.com', audience: 'https://example.com' };
  const send = createTransport({ auth: 'google', timeoutMs: 20, destinations: { order: target, supplier: target, mandate: target } }, () => new Promise(() => {}));
  // Keep the test process alive while AbortSignal.timeout's unref'ed timer expires.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(send({ destination: 'order', path: '/get', method: 'POST', body: {}, operation_key: null, signal: signal() }), { kind: 'cancelled' }); }
  finally { clearTimeout(keepAlive); }
});
