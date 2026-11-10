import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import * as producer from '../mandate-service/dist/common/validation.js';
import * as consumer from '../agent-service/dist/contracts/mandates.js';
import { approvalSchema } from '../agent-service/dist/contracts/events.js';
import { createApp as mandateApp } from '../mandate-service/dist/app.js';
import { createApp as chatApp } from '../agent-service/chat/dist/app.js';
import { HttpError as AgentError } from '../agent-service/dist/common/errors.js';

const wire = value => JSON.parse(JSON.stringify(value));
test('mandate responses and approval events remain readable by agent', () => {
  const mandate = producer.mandateSchema.parse({
    id: randomUUID(), user_id: 42, business_key_id: 'opaque-caller-key', terms_hash: 'hash', status: 'active',
    terms: {
      constraints: [{ type: 'supplier_id', value: randomUUID() }, { type: 'max_credit_amount', value: 25 }],
      starts_at: '2026-01-01T00:00:00Z', expires_at: '2027-01-01T00:00:00Z',
    },
  });
  assert.deepEqual(consumer.mandateSchema.parse(wire(mandate)), mandate);
  const event = producer.approvalSchema.parse({
    schema_version: 1, event_id: randomUUID(), event_type: 'mandate.approved', mandate_id: mandate.id,
    business_key_id: mandate.business_key_id, user_id: mandate.user_id, occurred_at: '2026-11-09T00:00:00Z',
  });
  assert.deepEqual(approvalSchema.parse(wire(event)), event);
  const order = { supplierId: randomUUID(), title: 'Coffee', description: 'One latte', deliveryLocation: 'COM1', creditReward: 5 };
  for (const raw of [
    { action: 'order.create', supplier_id: order.supplierId, credit_amount: 5, order },
    { action: 'order.cancel', order_id: randomUUID() },
  ]) {
    assert.deepEqual(producer.actionSchema.parse(wire(consumer.actionSchema.parse(raw))), consumer.actionSchema.parse(raw));
  }
});

for (const [name, createApp] of [['mandate', mandateApp], ['chat', chatApp]]) {
  test(`${name} Express routes preserve authentication, validation, limits and errors`, async () => {
    const saved = { JWT_SECRET: process.env.JWT_SECRET, SERVICE_AUTH_MODE: process.env.SERVICE_AUTH_MODE, MANDATE_SERVICE_SECRET: process.env.MANDATE_SERVICE_SECRET };
    const secret = 'test-secret-with-at-least-thirty-two-characters';
    process.env.JWT_SECRET = secret;
    process.env.SERVICE_AUTH_MODE = 'local';
    process.env.MANDATE_SERVICE_SECRET = secret;
    const token = (expires, key = secret) => {
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: '42', exp: expires })}`;
      return `${data}.${createHmac('sha256', key).update(data).digest('base64url')}`;
    };
    let ready = true;
    const app = createApp(async () => { if (!ready) throw new (name === 'chat' ? AgentError : producer.HttpError)(503, 'Stopping'); });
    const server = createServer(app);
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}`;
      const expires = Math.floor(Date.now() / 1000) + 60;
      const path = name === 'chat' ? '/conversations' : `/mandates/${randomUUID()}/approve`;
      async function request(body, jwt = token(expires), target = path) {
        return fetch(base + target, {
          method: 'POST',
          headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
          body,
        });
      }
      const live = await fetch(`${base}/health/live`);
      assert.equal(live.status, 200);
      assert.equal(live.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await live.json(), { status: 'ok' });
      assert.equal((await fetch(`${base}/health/ready`)).status, 200);
      ready = false;
      assert.equal((await fetch(`${base}/health/ready`)).status, 503);
      for (const [body, jwt, status] of [
        ['{}', '', 401], ['{}', token(expires, 'wrong-key'), 401], ['{}', token(1), 401],
        ['{', token(expires), 400], ['"' + 'x'.repeat(32769) + '"', token(expires), 413],
        ['{"extra":true}', token(expires), 400],
      ]) {
        const response = await request(body, jwt);
        assert.equal(response.status, status);
        assert.match(response.headers.get('content-type'), /application\/json/);
        await response.body.cancel();
      }
      const missing = await request('{}', token(expires), path + '/unknown');
      assert.equal(missing.status, 404);
      assert.deepEqual(await missing.json(), { error: 'Route not found' });
      if (name === 'mandate') {
        for (const [value, status] of [[secret, 200], ['wrong', 401]]) {
          const response = await fetch(`${base}/internal/mandates/coverage`, {
            method: 'POST',
            headers: { 'x-internal-secret': value, 'content-type': 'application/json' },
            body: JSON.stringify({ user_id: 42, action: { action: 'order.cancel', order_id: randomUUID() } }),
          });
          assert.equal(response.status, status);
          await response.body.cancel();
        }
      } else {
        const response = await request(JSON.stringify({ client_request_id: 'approval:fake', text: 'fake continuation' }), token(expires), `/conversations/${randomUUID()}/messages`);
        assert.equal(response.status, 400);
        await response.body.cancel();
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
}

test('named mandates and optional expiry agree across service contracts', () => {
  for (const schema of [producer.termsSchema, consumer.termsSchema]) {
    const terms = { constraints: [], starts_at: '2026-01-01T00:00:00Z' };
    assert.equal(schema.parse(terms).expires_at, '2026-01-31T00:00:00.000Z');
    assert.equal(schema.parse({ ...terms, expires_at: null }).expires_at, null);
    assert.equal(schema.safeParse({ ...terms, expires_at: terms.starts_at }).success, false);
    assert.equal(schema.safeParse({ ...terms, expires_at: 'invalid' }).success, false);
  }
  const mandate = producer.mandateSchema.parse({
    id: randomUUID(), user_id: 42, business_key_id: 'no-expiry', title: 'Campus coffee',
    terms_hash: 'hash', status: 'active', terms: { constraints: [], starts_at: '2026-01-01T00:00:00Z' },
  });
  assert.deepEqual(consumer.mandateSchema.parse(wire(mandate)), mandate);
});
