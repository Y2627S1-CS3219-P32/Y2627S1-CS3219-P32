import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createClient } from 'redis';
import { PubSub } from '@google-cloud/pubsub';
import { createBroker } from '../dist/common/connections/pubsub.js';
import { createStreams } from '../dist/common/connections/redis.js';
import { provision } from '../scripts/provision.mjs';

const signal = () => AbortSignal.timeout(20_000);
async function receive(pull) {
  const deadline = signal();
  while (!deadline.aborted) {
    try { const delivery = await pull(deadline); if (delivery) return delivery; }
    catch (error) { if (error.code !== 4) throw error; }
  }
  throw new Error('Timed out receiving delivery');
}
test('Chat→Orchestrator turns and Mandate→Chat approvals use real Pub/Sub', { timeout: 60_000 }, async () => {
  assert.ok(process.env.PUBSUB_EMULATOR_HOST);
  await provision(); await provision(); // repeated provisioning preserves resources
  const client = new PubSub({projectId:process.env.PUBSUB_PROJECT_ID});
  try {
    const [metadata] = await client.subscription('agent-orchestrator-turns').getMetadata();
    assert.equal(metadata.deadLetterPolicy.maxDeliveryAttempts,5);
    assert(metadata.deadLetterPolicy.deadLetterTopic.endsWith('/topics/agent-turns-dead-letter'));
  } finally { await client.close(); }
  const broker = createBroker(process.env.PUBSUB_PROJECT_ID);
  const conversation = randomUUID();
  const event = { data: { conversation_id: conversation, message_id: randomUUID() }, ordering_key: conversation,
    attributes: { schema_version: '1', event_type: 'agent.turn.requested', event_id: randomUUID() } };
  try {
    await broker.publishTurn('agent-turns', event);
    const first = await receive(s => broker.pullTurn('agent-orchestrator-turns', s));
    assert.deepEqual(first.event, event);
    await first.renew(); await first.defer();
    const duplicate = await receive(s => broker.pullTurn('agent-orchestrator-turns', s));
    assert.deepEqual(duplicate.event, event);
    await duplicate.ack();
    for (let n = 0; n < 2; n++) await broker.publishTurn('agent-turns', { ...event, data: { ...event.data, message_id: `message-${n}` }, attributes: { ...event.attributes, event_id: `event-${n}` } });
    for (let n = 0; n < 2; n++) {
      const next = await receive(s => broker.pullTurn('agent-orchestrator-turns', s));
      assert.equal(next.event.data.message_id, `message-${n}`); await next.ack();
    }
    const approval = { schema_version: 1, event_id: randomUUID(), event_type: 'mandate.approved', mandate_id: randomUUID(), business_key_id: randomUUID(), user_id: 1, occurred_at: new Date().toISOString() };
    await broker.publishApproval('mandate-events', approval);
    const delivery = await receive(s => broker.pullApproval('agent-chat-approvals', s));
    assert.deepEqual(delivery.event, approval); await delivery.ack();
  } finally { await broker.close(); }
});

test('Redis publication, independent replay, trimming, cancellation and outage handling', { timeout: 30_000 }, async () => {
  const errors = [];
  const streams = createStreams(process.env.REDIS_URL, e => errors.push(e));
  const client = createClient({ url: process.env.REDIS_URL }); client.on('error', e => errors.push(e)); await client.connect();
  const conversation = randomUUID();
  const event = { schema_version: 1, event_id: randomUUID(), conversation_id: conversation, turn_id: randomUUID(), stream_id: randomUUID(),
    occurred_at: new Date().toISOString(), type: 'message_delta', message_id: randomUUID(), text: 'hello' };
  const key = `agent:conversation:{${conversation}}:events`;
  try {
    assert.equal(await streams.publish(event, signal()), true);
    const a = streams.read(conversation, '0-0', signal()), b = streams.read(conversation, '0-0', signal());
    const first = await a.next(), other = await b.next();
    assert.deepEqual(first.value, other.value); assert.equal(first.value.event.text, 'hello');
    await a.return(); await b.return();
    const resume = streams.read(conversation, first.value.cursor, signal());
    assert.equal(await streams.publish({ ...event, event_id: randomUUID(), text: 'next' }, signal()), true);
    assert.equal((await resume.next()).value.event.text, 'next'); await resume.return();
    await client.xTrim(key, 'MAXLEN', 1);
    const trimmed = streams.read(conversation, first.value.cursor, signal());
    assert.deepEqual((await trimmed.next()).value, { resync: true }); await trimmed.return();
    const invalid = streams.read(conversation, 'bad-cursor', signal()); assert.deepEqual((await invalid.next()).value, { resync: true }); await invalid.return();
    const cancelled = new AbortController();
    const reader = streams.read(randomUUID(), '0-0', cancelled.signal);
    const pending = reader.next(); setTimeout(() => cancelled.abort(), 50);
    assert.equal((await pending).done, true);
    await streams.close();
    const unavailable = createStreams('redis://127.0.0.1:1', e => errors.push(e));
    assert.equal(await unavailable.publish(event, signal()), false); await unavailable.close();
  } finally { await streams.close(); await client.del(key); await client.close(); }
});
