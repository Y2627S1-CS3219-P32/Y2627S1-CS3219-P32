import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeBusinessKey, decodeBusinessKey } from '../dist/contracts/conversation.js';

test('an opaque business key preserves Agent conversation and turn routing', () => {
  const conversation = 'conversation:1';
  const turn = 'turn:2';
  assert.deepEqual(decodeBusinessKey(encodeBusinessKey(conversation, turn)), {
    conversation_id: conversation, turn_id: turn,
  });
});

test('malformed business keys cannot produce routing identities', () => {
  for (const key of ['', 'invalid', 'null', '[]', '{}', '{"conversation_id":"c"}',
    '{"conversation_id":"c","turn_id":""}', '{"conversation_id":5,"turn_id":"t"}']) {
    assert.throws(() => decodeBusinessKey(key));
  }
});
