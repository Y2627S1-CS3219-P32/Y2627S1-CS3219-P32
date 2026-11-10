// AI Assistance Disclosure: Codex (GPT-6.1), 2026-11-10.
// Scope: Align invalid-argument assertion with the existing dispatcher result. Author review: Pending.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { prepareToolCall, executeToolCall } from '../orchestrator/dist/llm/tools/dispatcher.js';

test('balance tool uses the execution owner and validates credit responses', async () => {
  const secret = 'test-only-credit-secret-0000000000';
  let response = { totalCredits: 100, reservedCredits: 30, availableCredits: 70 };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/internal/credits/balance');
    assert.equal(req.headers['x-internal-secret'], secret);
    assert.equal(req.headers.authorization, undefined);
    assert.deepEqual(JSON.parse(body), { user_id: 42 });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(response));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const saved = { SERVICE_AUTH_MODE: process.env.SERVICE_AUTH_MODE };
  for (const destination of ['ORDER', 'SUPPLIER', 'MANDATE', 'CREDIT']) {
    for (const suffix of ['URL', 'SECRET']) {
      const key = `${destination}_SERVICE_${suffix}`;
      saved[key] = process.env[key];
      process.env[key] = suffix === 'URL' ? `http://127.0.0.1:${server.address().port}` : secret;
    }
  }
  process.env.SERVICE_AUTH_MODE = 'local';
  try {
    const call = { id: 'balance', name: 'get_credit_balance', version: '1', arguments: {} };
    const tool = prepareToolCall(call);
    const context = { user_id: 42, signal: AbortSignal.timeout(5000), deadline: Date.now() + 5000 };
    const invalid = await executeToolCall(prepareToolCall({ ...call, arguments: { user_id: 99 } }), context);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'INVALID_ARGUMENTS');
    assert.deepEqual(await executeToolCall(tool, context), { ok: true, data: response });
    for (const value of [
      { totalCredits: 100, reservedCredits: 30, availableCredits: 100 },
      { totalCredits: 100, reservedCredits: -1, availableCredits: 101 },
      { totalCredits: '100', reservedCredits: 0, availableCredits: 100 },
    ]) {
      response = value;
      const result = await executeToolCall(tool, context);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'INVALID_RESPONSE');
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
