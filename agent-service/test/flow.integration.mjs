import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import pg from 'pg';
import { PubSub } from '@google-cloud/pubsub';
import { provision } from '../scripts/provision.mjs';
import { handleMandateApproved } from '../chat/dist/handlers/mandateApprovalHandler.js';
import { closeDatabase } from '../dist/db/client.js';

const root = new URL('../../', import.meta.url),
  suffix = randomBytes(4).toString('hex');
const dbUrl = process.env.TEST_DATABASE_URL;
if (!dbUrl || !process.env.REDIS_URL || !process.env.PUBSUB_EMULATOR_HOST)
  throw new Error(
    'Set TEST_DATABASE_URL, REDIS_URL and PUBSUB_EMULATOR_HOST for isolated integration infrastructure',
  );
const secret = 'agent-test-secret-at-least-thirty-two-characters';
function token(user = 1) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: String(user), exp: Math.floor(Date.now() / 1000) + 900 })}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function waitFor(work, description) {
  let last;
  for (let count = 0; count < 200; count++) {
    try {
      const result = await work();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`, { cause: last });
}
async function freePort() {
  const server = createServer();
  const url = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return Number(new URL(url).port);
}
async function migrate(client, folder) {
  for (const name of (await readdir(new URL(folder, root)))
    .filter((value) => value.endsWith('.sql'))
    .sort()) {
    const file = await readFile(new URL(`${folder}/${name}`, root), 'utf8');
    for (const statement of file.split('--> statement-breakpoint')) {
      if (!statement.trim()) continue;
      try {
        await client.query(
          statement.replace(
            /CREATE ROLE (\w+) NOLOGIN;/g,
            (_match, role) =>
              `DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
          ),
        );
      } catch (error) {
        if (error.code !== '42710' || !statement.includes('CREATE ROLE')) throw error;
      }
    }
  }
}

test(
  'real chat, worker, approval outbox, SSE and Order retry flow',
  { timeout: 120000 },
  async () => {
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect();
    const clients = [],
      children = [],
      servers = [],
      names = [];
    let broker;
    const logs = [];
    const supplier = randomUUID(),
      order = {
        supplierId: supplier,
        title: 'Coffee',
        description: 'One latte',
        deliveryLocation: 'COM1 lobby',
        creditReward: 5,
        isGroupOrder: false,
      };
    try {
      async function database(kind, folder) {
        const name = `agent_${kind}_${suffix}`;
        names.push(name);
        await admin.query(`CREATE DATABASE ${name}`);
        const url = new URL(dbUrl);
        url.pathname = `/${name}`;
        const client = new pg.Client({ connectionString: url.href });
        await client.connect();
        clients.push(client);
        await migrate(client, folder);
        return { client, url };
      }
      const conversation = await database('conversation', 'agent-service/db/migrations'),
        mandate = await database('mandate', 'mandate-service/migrations'),
        orders = await database('orders', 'order-service/drizzle');
      async function runtime(database, role, label) {
        const name = `agent_${label}_${suffix}`;
        await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD 'test-only' IN ROLE ${role}`);
        const url = new URL(database.url);
        url.username = name;
        url.password = 'test-only';
        return url.href;
      }
      const chatDb = await runtime(conversation, 'agent_chat', 'chat'),
        executionDb = await runtime(conversation, 'agent_execution', 'exec'),
        mandateDb = await runtime(mandate, 'mandate_runtime', 'mandate');
      await orders.client.query(
        "INSERT INTO users(id,display_name,role,version) VALUES(1,'Tester','student',1),(2,'Other','student',1)",
      );
      await orders.client.query(
        "INSERT INTO supplier_versions(supplier_id,version,deleted,name,type,latitude,longitude,is_active,operating_hours) VALUES($1,1,false,'Test Coffee','Food',1,103,true,'[]')",
        [supplier],
      );
      const supplierServer = createServer(async (req, res) => {
        for await (const _ of req) {
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              id: supplier,
              name: 'Test Coffee',
              type: 'Food',
              buildingName: 'COM1',
              isActive: true,
              isOpen: true,
            },
          ]),
        );
      });
      servers.push(supplierServer);
      const supplierUrl = await listen(supplierServer);
      const observed = [],
        modelAttempts = new Map();
      const modelServer = createServer(async (req, res) => {
        let raw = '';
        for await (const bytes of req) raw += bytes;
        const input = JSON.parse(raw);
        observed.push(input);
        const last = input.messages.at(-1),
          text =
            [...input.messages].reverse().find((value) => value.role === 'user')?.content ?? '';
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const emit = (value) => res.write(`data: ${JSON.stringify(value)}\n\n`);
        const tool = (name, args) => {
          emit({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: randomUUID(),
                      function: { name, arguments: JSON.stringify(args) },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          });
          res.end('data: [DONE]\n\n');
        };
        if (text === 'retry' && !modelAttempts.has(text)) {
          modelAttempts.set(text, 1);
          emit({ choices: [{ delta: { content: 'provisional' } }] });
          res.end();
          return;
        }
        if (text === 'slow-first') await delay(400);
        if (text === 'always-fail') {
          res.end();
          return;
        }
        if (text === 'unauthorized-create') return tool('place_order', order);
        if (text === 'recover-proposal') {
          await delay(800);
          res.end();
          return;
        }
        if (last.role === 'tool') {
          emit({ choices: [{ delta: { content: 'The tool completed.' }, finish_reason: 'stop' }] });
          res.end('data: [DONE]\n\n');
          return;
        }
        if (text === 'order')
          return tool('propose_mandate', {
            constraints: [
              { type: 'supplier_id', value: supplier },
              { type: 'max_credit_amount', value: 5 },
            ],
            starts_at: new Date(Date.now() - 1000).toISOString(),
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          });
        if (text.startsWith('The user approved')) return tool('place_order', order);
        if (text.startsWith('cancel '))
          return tool('cancel_order', { order_id: text.slice(7) });
        emit({ choices: [{ delta: { content: 'Hello from the model.' }, finish_reason: 'stop' }] });
        res.end('data: [DONE]\n\n');
      });
      servers.push(modelServer);
      const modelUrl = await listen(modelServer);
      process.env.PUBSUB_PROJECT_ID = 'foc-local';
      await provision();
      broker = new PubSub({ projectId: 'foc-local' });
      const orderPort = await freePort(),
        mandatePort = await freePort(),
        chatPort = await freePort();
      function child(file, env) {
        const processChild = spawn(process.execPath, [file], {
          cwd: root,
          env: {
            ...process.env,
            JWT_SECRET: secret,
            INTERNAL_SHARED_SECRET: secret,
            SERVICE_AUTH_MODE: 'local',
            ORDER_SERVICE_SECRET: secret,
            SUPPLIER_SERVICE_SECRET: secret,
            MANDATE_SERVICE_SECRET: secret,
            CREDIT_SERVICE_SECRET: secret,
            ORDER_SERVICE_URL: `http://127.0.0.1:${orderPort}`,
            SUPPLIER_SERVICE_URL: supplierUrl,
            MANDATE_SERVICE_URL: `http://127.0.0.1:${mandatePort}`,
            CREDIT_SERVICE_URL: `http://127.0.0.1:${orderPort}`,
            SOCLAAS_API_KEY: 'test-only',
            SOCLAAS_MODEL: 'test',
            SOCLAAS_BASE_URL: `${modelUrl}/v1`,
            PUBSUB_PROJECT_ID: 'foc-local',
            TURN_TOPIC: 'agent-turns',
            TURN_SUBSCRIPTION: 'agent-orchestrator-turns',
            APPROVAL_SUBSCRIPTION: 'agent-chat-approvals',
            MANDATE_TOPIC: 'mandate-events',
            ...env,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        children.push(processChild);
        processChild.stdout.on('data', (data) => logs.push(String(data)));
        processChild.stderr.on('data', (data) => logs.push(String(data)));
        return processChild;
      }
      child('agent-service/test/order-server.mjs', {
        DATABASE_URL: orders.url.href,
        PORT: String(orderPort),
      });
      child('mandate-service/dist/main.js', { DATABASE_URL: mandateDb, PORT: String(mandatePort) });
      child('agent-service/chat/dist/main.js', { DATABASE_URL: chatDb, PORT: String(chatPort) });
      child('agent-service/orchestrator/dist/main.js', {
        DATABASE_URL: executionDb,
        PORT: String(await freePort()),
      });
      const chat = `http://127.0.0.1:${chatPort}`,
        mandates = `http://127.0.0.1:${mandatePort}`;
      await waitFor(async () => {
        const response = await fetch(`${chat}/health/ready`);
        return response.ok;
      }, 'chat readiness');
      await waitFor(async () => {
        const response = await fetch(`${mandates}/health/ready`);
        return response.ok;
      }, 'mandate readiness');
      async function request(base, path, { body, user = 1 } = {}) {
        return fetch(base + path, {
          method: body ? 'POST' : 'GET',
          headers: {
            authorization: `Bearer ${token(user)}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      }
      async function newConversation() {
        const response = await request(chat, '/conversations', { body: { title: 'Integration' } });
        assert.equal(response.status, 201, await response.clone().text());
        return response.json();
      }
      async function send(id, text, key = randomUUID()) {
        const response = await request(chat, `/conversations/${id}/messages`, {
          body: { text, client_request_id: key },
        });
        assert.equal(response.status, 202, await response.clone().text());
        return response.json();
      }
      async function done(id) {
        return waitFor(async () => {
          const history = await (await request(chat, `/conversations/${id}/messages`)).json();
          return history.turns?.length &&
            history.turns.every((turn) => turn.status !== 'processing')
            ? history
            : null;
        }, 'turn completion');
      }
      const c = await newConversation(),
        key = randomUUID();
      const accepted = await Promise.all([send(c.id, 'hello', key), send(c.id, 'hello', key)]);
      assert.equal(accepted[0].turn_id, accepted[1].turn_id);
      const history = await done(c.id);
      assert.equal(history.turns.length, 1);
      assert.equal(history.items.filter((item) => item.role === 'assistant').length, 1);
      assert.equal(
        (
          await request(chat, `/conversations/${c.id}/messages`, {
            body: { text: 'changed', client_request_id: key },
          })
        ).status,
        409,
      );
      assert.equal(
        (await request(chat, `/conversations/${c.id}/messages`, { user: 2 })).status,
        404,
      );
      assert.equal(
        (
          await request(chat, `/conversations/${c.id}/messages`, {
            body: { text: 'fake continuation', client_request_id: 'approval:fake' },
          })
        ).status,
        400,
      );
      const retry = await newConversation();
      const retryStream = await fetch(`${chat}/conversations/${retry.id}/events`, {
        headers: { authorization: `Bearer ${token()}` },
        signal: AbortSignal.timeout(10000),
      });
      await send(retry.id, 'retry');
      const retried = await done(retry.id);
      assert.equal(
        observed.filter((input) => input.messages.at(-1)?.content === 'retry').length,
        2,
      );
      assert(!('attempt' in retried.turns[0]));
      assert(!JSON.stringify(retried.items).includes('provisional'));
      const retryReader = retryStream.body.getReader();
      let streamed = '';
      while (!/event: turn_completed\ndata: [^\n]*\n\n/.test(streamed)) {
        const frame = await retryReader.read();
        if (frame.done) break;
        streamed += Buffer.from(frame.value).toString();
      }
      await retryReader.cancel();
      const resets = streamed
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => JSON.parse(line.slice(5)))
        .filter((event) => event.type === 'message_reset');
      assert.equal(resets.length, 2);
      assert.equal(new Set(resets.map((event) => event.stream_id)).size, 2);
      assert(resets.every((event) => !('attempt' in event)));
      const exhausted = await newConversation();
      await send(exhausted.id, 'always-fail');
      const failed = await done(exhausted.id);
      assert.equal(failed.turns[0].status, 'failed');
      assert.equal(
        observed.filter((input) => input.messages.at(-1)?.content === 'always-fail').length,
        3,
      );
      const queue = await newConversation();
      await send(queue.id, 'slow-first');
      const busyDelete = await fetch(`${chat}/conversations/${queue.id}`, {
        method: 'DELETE', headers: { authorization: `Bearer ${token()}` },
      });
      assert.equal(busyDelete.status, 409);

      await send(queue.id, 'queued-later');
      await done(queue.id);
      assert(
        observed
          .filter((input) => input.messages.at(-1)?.content === 'slow-first')
          .every((input) => !JSON.stringify(input.messages).includes('queued-later')),
      );
      const flow = await newConversation();
      const denied = await newConversation();
      await send(denied.id, 'unauthorized-create');
      const denial = await done(denied.id);
      assert(
        denial.items.some(
          (item) =>
            item.content.kind === 'tool_result' &&
            !item.content.result.ok &&
            item.content.result.error.code === 'MANDATE_REQUIRED',
        ),
      );
      assert.equal(
        (await orders.client.query('SELECT count(*) AS count FROM orders')).rows[0].count,
        '0',
      );
      await send(flow.id, 'order');
      const proposal = await done(flow.id);
      const pending = proposal.items.find((item) => item.content.kind === 'mandate').content
        .mandate;
      assert.equal(
        (
          await request(mandates, `/mandates/${pending.id}/approve`, {
            user: 2,
            body: { consent: true, terms_hash: pending.terms_hash },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request(mandates, `/mandates/${pending.id}/approve`, {
            body: { consent: true, terms_hash: 'changed' },
          })
        ).status,
        409,
      );
      const approval = await request(mandates, `/mandates/${pending.id}/approve`, {
        body: { consent: true, terms_hash: pending.terms_hash },
      });
      assert.equal(approval.status, 200, await approval.clone().text());
      const created = await waitFor(async () => {
        const result = await orders.client.query('SELECT id FROM orders WHERE title=$1', [
          'Coffee',
        ]);
        return result.rows[0]?.id;
      }, 'approved order creation');
      await waitFor(async () => {
        const result = await conversation.client.query(
          "SELECT 1 FROM turns WHERE conversation_id=$1 AND client_request_id=$2 AND status='completed'",
          [flow.id, `approval:${pending.id}`],
        );
        return result.rowCount === 1;
      }, 'continuation completion');
      assert.equal(
        (
          await request(mandates, `/mandates/${pending.id}/approve`, {
            body: { consent: true, terms_hash: pending.terms_hash },
          })
        ).status,
        200,
      );
      const event = (
        await mandate.client.query('SELECT payload FROM mandate_outbox WHERE mandate_id=$1', [
          pending.id,
        ])
      ).rows[0].payload;
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = chatDb;
      try {
        const before = await conversation.client.query('SELECT count(*) AS count FROM turns');
        await assert.rejects(
          handleMandateApproved({ ...event, mandate_id: randomUUID() }, AbortSignal.timeout(5000)),
          { status: 409 },
        );
        await assert.rejects(
          handleMandateApproved({ ...event, user_id: 2 }, AbortSignal.timeout(5000)),
          { status: 404 },
        );
        await assert.rejects(
          handleMandateApproved(event, AbortSignal.abort(new Error('Approval cancelled'))),
          /Approval cancelled/,
        );
        await handleMandateApproved(event, AbortSignal.timeout(5000));
        const after = await conversation.client.query('SELECT count(*) AS count FROM turns');
        assert.equal(after.rows[0].count, before.rows[0].count);
      } finally {
        await closeDatabase();
        if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousDatabaseUrl;
      }
      await broker
        .topic('mandate-events')
        .publishMessage({ data: Buffer.from(JSON.stringify(event)) });
      await delay(1000);
      assert.equal(
        (
          await conversation.client.query(
            'SELECT count(*) AS count FROM turns WHERE conversation_id=$1 AND client_request_id=$2',
            [flow.id, `approval:${pending.id}`],
          )
        ).rows[0].count,
        '1',
      );
      assert.equal(
        (await orders.client.query('SELECT count(*) AS count FROM orders')).rows[0].count,
        '1',
      );
      await request(mandates, `/mandates/${pending.id}/revoke`, { body: {} });
      await send(flow.id, `cancel ${created}`);
      await done(flow.id);
      assert.equal(
        (await orders.client.query('SELECT current_state FROM orders WHERE id=$1', [created]))
          .rows[0].current_state,
        'CANCELLED',
      );
      assert.equal(
        (
          await request(mandates, `/mandates/${pending.id}/approve`, {
            body: { consent: true, terms_hash: pending.terms_hash },
          })
        ).status,
        409,
      );
      const recovery = await newConversation();
      const recovering = await send(recovery.id, 'recover-proposal');
      const recoveredTerms = {
        constraints: [],
        starts_at: new Date(Date.now() - 1000).toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };
      const stored = await fetch(`${mandates}/internal/mandates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({
          user_id: 1,
          business_key_id: JSON.stringify({
            conversation_id: recovery.id,
            turn_id: recovering.turn_id,
          }),
          terms: recoveredTerms,
        }),
      });
      assert.equal(stored.status, 201, await stored.clone().text());
      const storedMandate = await stored.json(),
        recovered = await done(recovery.id);
      assert.equal(
        recovered.items.find((item) => item.content.kind === 'mandate').content.mandate.id,
        storedMandate.id,
      );
      const stream = await request(chat, `/conversations/${c.id}/events`);
      assert.equal(stream.headers.get('content-type'), 'text/event-stream');
      await stream.body.cancel();
      const invalidReplay = await fetch(`${chat}/conversations/${c.id}/events`, {
        headers: { authorization: `Bearer ${token()}`, 'last-event-id': '999999999999999-0' },
        signal: AbortSignal.timeout(5000),
      });
      const reader = invalidReplay.body.getReader();
      let replay = '';
      while (!replay.includes('resync_required')) {
        const frame = await reader.read();
        if (frame.done) break;
        replay += Buffer.from(frame.value).toString();
      }
      assert(replay.includes('resync_required'));
      await reader.cancel();
      const requestsBeforeReplay = observed.length;
      const outbox = (
        await conversation.client.query('SELECT payload FROM turn_outbox WHERE turn_id=$1', [
          accepted[0].turn_id,
        ])
      ).rows[0].payload;
      await broker.topic('agent-turns', { messageOrdering: true }).publishMessage({
        data: Buffer.from(JSON.stringify(outbox.data)),
        orderingKey: outbox.ordering_key,
        attributes: outbox.attributes,
      });
      await delay(1000);
      assert.equal(
        (
          await conversation.client.query('SELECT status FROM turns WHERE id=$1', [
            accepted[0].turn_id,
          ])
        ).rows[0].status,
        'completed',
      );
      assert.equal(observed.length, requestsBeforeReplay);
      assert.equal(
        (
          await conversation.client.query(
            "SELECT 1 FROM information_schema.columns WHERE table_name='turns' AND column_name='attempt'",
          )
        ).rowCount,
        0,
      );

      const deleteChat = user => fetch(`${chat}/conversations/${c.id}`, {
        method: 'DELETE', headers: { authorization: `Bearer ${token(user)}` },
      });
      assert.equal((await deleteChat(2)).status, 404);
      assert.equal((await deleteChat(1)).status, 204);
      assert.equal((await request(chat, `/conversations/${c.id}/messages`)).status, 404);
      for (const table of ['conversations', 'messages', 'turns', 'turn_outbox']) {
        const column = table === 'conversations' ? 'id' : 'conversation_id';
        assert.equal((await conversation.client.query(`SELECT count(*) AS count FROM ${table} WHERE ${column}=$1`, [c.id])).rows[0].count, '0');
      }
    } catch (error) {
      console.error(logs.slice(-20).join('').slice(-10000));
      throw error;
    } finally {
      for (const child of children) child.kill('SIGTERM');
      await Promise.all(
        children.map(async (child) => {
          await Promise.race([once(child, 'exit').catch(() => {}), delay(6000)]);
          if (child.exitCode === null) child.kill('SIGKILL');
        }),
      );
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await broker?.close();
      for (const client of clients) await client.end();
      for (const name of names) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      for (const label of ['chat', 'exec', 'mandate'])
        await admin.query(`DROP ROLE IF EXISTS agent_${label}_${suffix}`);
      await admin.end();
    }
  },
);
