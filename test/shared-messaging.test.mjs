// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-11.
// Scope: The shared Pub/Sub messaging (shared/src/messaging.ts), as compiled into
// agent-service, with telemetry on: traces carried through message attributes, the
// acknowledgement behaviour of processMessage (used by chat-service and notification-service),
// processDelivery, and agent-service's consume() loop on top of it. Run by the deploy
// workflow before Cloud Build. Author review: Pending.
//
//   node shared/sync.mjs && npm run test:messaging
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Telemetry reads these when it loads, so everything below is imported after them. The
// exporter's endpoint is a closed port: nothing is sent, but spans and propagation are real.
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:9';
process.env.OTEL_TRACES_SAMPLER = 'always_on';
process.env.OTEL_METRIC_EXPORT_INTERVAL = '600000';
process.env.OTEL_SERVICE_NAME = 'shared-messaging-test';
process.env.OTEL_LOG_LEVEL = 'none';
process.env.LOG_LEVEL = 'silent';

await import('../agent-service/dist/common/shared/telemetry.mjs');
const { trace } = await import('@opentelemetry/api');
const messaging = await import('../agent-service/dist/common/shared/messaging.js');
const { consume } = await import('../agent-service/dist/common/connections/pubsub.js');
const { turnSchema } = await import('../agent-service/dist/contracts/events.js');

const { currentTraceparent, withTraceparent, publishMessage, processDelivery, processMessage } = messaging;
const traceIdOf = (traceparent) => traceparent?.split('-')[1];
const turnData = { conversation_id: 'conversation-1', message_id: 'message-1' };
const turnAttributes = { schema_version: '1', event_type: 'agent.turn.requested', event_id: 'event-1' };

function inSpan(fn) {
  return trace.getTracer('test').startActiveSpan('request', async (span) => {
    try {
      return await fn(span.spanContext().traceId);
    } finally {
      span.end();
    }
  });
}

async function publishTurn() {
  const sent = [];
  const topic = {
    name: 'projects/p/topics/agent-turns',
    async publishMessage(message) {
      sent.push(message);
      return 'pubsub-1';
    },
  };
  const messageId = await publishMessage(topic, {
    data: Buffer.from(JSON.stringify(turnData)),
    orderingKey: turnData.conversation_id,
    attributes: turnAttributes,
  });
  return { messageId, message: sent[0] };
}

test('telemetry is on, so traces are real', async () => {
  assert.equal(currentTraceparent(), null, 'no trace outside a span');
  await inSpan(async (traceId) => assert.equal(traceIdOf(currentTraceparent()), traceId));
});

test('publishing adds only traceparent, which the agent turn schema accepts', async () => {
  await inSpan(async (traceId) => {
    const { messageId, message } = await publishTurn();
    assert.equal(messageId, 'pubsub-1');
    assert.equal(traceIdOf(message.attributes.traceparent), traceId);
    assert.deepEqual(Object.keys(message.attributes).sort(), [...Object.keys(turnAttributes), 'traceparent'].sort());
    // The attributes are .strict(): an extra key (tracestate, baggage) would be rejected.
    turnSchema.parse({ data: turnData, ordering_key: message.orderingKey, attributes: message.attributes });
  });
});

test('an outbox row is published in the trace it was written in', async () => {
  const stored = await inSpan(async () => currentTraceparent());
  const { message } = await withTraceparent(stored, publishTurn);
  assert.equal(traceIdOf(message.attributes.traceparent), traceIdOf(stored));
  assert.equal(withTraceparent(null, currentTraceparent), null, 'without one, no trace is made up');
});

test('processDelivery runs the handler in the publisher trace and returns its outcome', async () => {
  const { message, traceId } = await inSpan(async (traceId) => ({ ...(await publishTurn()), traceId }));
  const delivery = {
    subscription: 'agent-orchestrator-turns',
    messageId: 'pubsub-1',
    attributes: message.attributes,
    orderingKey: message.orderingKey,
    publishTime: new Date(),
    data: message.data,
  };
  let seen;
  const outcome = await processDelivery(delivery, async () => {
    seen = currentTraceparent();
    return 'ack';
  });
  assert.equal(outcome, 'ack');
  assert.equal(traceIdOf(seen), traceId);
  assert.equal(await processDelivery(delivery, async () => 'nack'), 'nack');
  await assert.rejects(processDelivery(delivery, async () => { throw new Error('handler failed'); }), /handler failed/);
});

test('processMessage acknowledges only an "ack", and never rejects', async () => {
  const calls = [];
  const message = (id) => ({
    id,
    attributes: { type: 'order.created' },
    data: Buffer.from(JSON.stringify({ orderId: 'order-1' })),
    ack: () => calls.push(`ack ${id}`),
    nack: () => calls.push(`nack ${id}`),
  });
  await processMessage('order-events', message('a'), async () => 'ack');
  await processMessage('order-events', message('b'), async () => 'nack');
  await processMessage('order-events', message('c'), async () => { throw new Error('handler failed'); });
  await processMessage('order-events', message('d'), () => 'ack');
  assert.deepEqual(calls, ['ack a', 'nack b', 'nack c', 'ack d']);
});

test('consume() defers a failed message, logs it once, and acknowledges a handled one', async () => {
  const controller = new AbortController();
  const actions = [];
  const reported = [];
  let pulls = 0;
  await consume({
    concurrency: 1,
    signal: controller.signal,
    onError: (error) => reported.push(error),
    async pull() {
      pulls += 1;
      return {
        event: {},
        message: { subscription: 'agent-chat-approvals', messageId: String(pulls), data: Buffer.from('{"event_type":"mandate.approved"}') },
        async renew() { actions.push('renew'); },
        async ack() { actions.push('ack'); controller.abort(); },
        async defer() { actions.push('defer'); },
      };
    },
    async handle() {
      actions.push('handle');
      if (pulls === 1) throw new Error('not committed');
    },
  });
  assert.deepEqual(actions, ['renew', 'handle', 'defer', 'renew', 'handle', 'ack']);
  assert.deepEqual(reported, [], 'processDelivery logs handler failures; onError would log them twice');
});
