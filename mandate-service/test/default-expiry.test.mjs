import test from 'node:test';
import assert from 'node:assert/strict';
import { termsSchema } from '../dist/common/validation.js';
test('omitted expiry defaults to thirty days while explicit values survive', () => {
  const terms = { constraints: [], starts_at: '2026-01-31T00:00:00.000Z' };
  assert.equal(termsSchema.parse(terms).expires_at, '2026-03-02T00:00:00.000Z');
  assert.equal(termsSchema.parse({ ...terms, expires_at: null }).expires_at, null);
  const expiry = '2026-02-01T00:00:00.000Z';
  assert.equal(termsSchema.parse({ ...terms, expires_at: expiry }).expires_at, expiry);
});
