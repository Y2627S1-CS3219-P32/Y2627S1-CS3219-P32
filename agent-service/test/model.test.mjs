import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { streamModelResponse, toModelMessages, generateConversationTitle, generateMandateTitle } from '../orchestrator/dist/llm/model.js';
import { createToolRegistry } from '../orchestrator/dist/llm/tools/registry.js';
import { prepareToolCall } from '../orchestrator/dist/llm/tools/dispatcher.js';

test('model adapter assembles fragmented calls and rejects incomplete output', async () => {
  const saved = {
    key: process.env.SOCLAAS_API_KEY,
    model: process.env.SOCLAAS_MODEL,
    url: process.env.SOCLAAS_BASE_URL,
  };
  let mode = 'valid',
    received;
  const server = createServer(async (req, res) => {
    let input = '';
    for await (const data of req) input += data;
    received = JSON.parse(input);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (value) => res.write(`data: ${JSON.stringify(value)}\n\n`);
    frame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: 'search_suppliers', arguments: '{"query":' },
              },
            ],
          },
        },
      ],
    });
    frame({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"coffee","supplier_ids":[]}' } }],
          },
        },
      ],
    });
    if (mode === 'valid') frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    process.env.SOCLAAS_API_KEY = 'test-only';
    process.env.SOCLAAS_MODEL = 'test-model';
    process.env.SOCLAAS_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
    const fragments = [];
    for await (const value of streamModelResponse(
      [{ role: 'user', content: { kind: 'text', text: 'coffee' } }],
      [...createToolRegistry().values()].map(tool => tool.definition),
      AbortSignal.timeout(5000),
    ))
      fragments.push(value);
    const complete = fragments.find((value) => value.kind === 'complete');
    assert.equal(complete.response.calls[0].name, 'search_suppliers');
    assert.deepEqual(complete.response.calls[0].arguments, { query: 'coffee', supplier_ids: [] });
    assert.equal(received.model, 'test-model');
    assert.ok(received.tools.some(tool => tool.function.name === 'search_suppliers'));
    assert.equal(prepareToolCall(complete.response.calls[0]).call.id, 'call_1');
    mode = 'truncated';
    await assert.rejects(async () => {
      for await (const _ of streamModelResponse([], [], AbortSignal.timeout(5000))) {
      }
    }, /interrupted/);
    assert.throws(() =>
      prepareToolCall({
        id: 'bad',
        name: 'fetch_url',
        version: '1',
        arguments: { url: 'https://example.com' },
      }),
    );
    const invalid = prepareToolCall({
        id: 'bad',
        name: 'cancel_order',
        version: '1',
        arguments: { order_id: 'not-an-id', user_id: 2 },
      });
    const invalidResult = await invalid.invoke();
    assert.equal(invalidResult.ok, false);
    assert.equal(invalidResult.error.code, 'INVALID_ARGUMENTS');
    assert.equal(invalidResult.error.retryable, true);
    const registry = createToolRegistry();
    assert.doesNotThrow(() => registry.get('cancel_order').prepare({ order_id: '11111111-1111-4111-8111-111111111111' }));
    assert.doesNotThrow(() => registry.get('search_suppliers').prepare({ supplier_ids: ['11111111-1111-4111-8111-111111111111'] }));
    assert.doesNotThrow(() => registry.get('place_order').prepare({
            supplierId: '11111111-1111-4111-8111-111111111111',
            title: 'Coffee',
            description: 'Latte',
            deliveryLocation: 'COM1',
            creditReward: 99,
    }));
    assert.deepEqual(
      toModelMessages([
        {
          role: 'tool',
          content: {
            kind: 'tool_result',
            tool_call_id: 'call_1',
            result: { ok: true, data: { found: true } },
          },
        },
      ]),
      [{ role: 'tool', tool_call_id: 'call_1', content: '{"ok":true,"data":{"found":true}}' }],
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries({
      SOCLAAS_API_KEY: saved.key,
      SOCLAAS_MODEL: saved.model,
      SOCLAAS_BASE_URL: saved.url,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

for (const generateTitle of [generateConversationTitle, generateMandateTitle]) test(`${generateTitle.name}: title generation returns a concise title and falls back on failure or invalid output`, async () => {
  const saved = { SOCLAAS_API_KEY: process.env.SOCLAAS_API_KEY, SOCLAAS_MODEL: process.env.SOCLAAS_MODEL, SOCLAAS_BASE_URL: process.env.SOCLAAS_BASE_URL };
  let title = '“Campus coffee”', status = 200;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.max_tokens, 64);
    assert.equal(Object.hasOwn(body, 'tools'), false);
    res.writeHead(status, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: title }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    process.env.SOCLAAS_API_KEY = 'test';
    process.env.SOCLAAS_MODEL = 'test';
    process.env.SOCLAAS_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
    const generate = () => generateTitle('coffee', 'Fallback', AbortSignal.timeout(3000));
    assert.equal(await generate(), 'Campus coffee');
    for (title of ['', 'x'.repeat(101), 'Title\nExtra text']) assert.equal(await generate(), 'Fallback');
    status = 503;
    assert.equal(await generate(), 'Fallback');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
