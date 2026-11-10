import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateMandateCoverage } from '../dist/services.js';

const terms = { constraints: [], starts_at: '2026-01-01T00:00:00Z', expires_at: '2027-01-01T00:00:00Z' };
const mandate = { id: 'mandate-1', user_id: 42, status: 'active', terms };
const action = { action: 'order.create', supplier_id: 'supplier-123', credit_amount: 10, order: {} };
const supplier = value => ({ type: 'supplier_id', value });
const amount = value => ({ type: 'max_credit_amount', value });
function coverage(constraints = [], overrides = {}) {
  return evaluateMandateCoverage({ mandate: { ...mandate, terms: { ...terms, constraints } }, user_id: 42,
    action, now: '2026-11-09T00:00:00Z', ...overrides });
}

test('no constraints means unrestricted', () => {
  assert.equal(coverage().covered, true);
});

test('supplier constraints match stable IDs, not display names', () => {
  assert.equal(coverage([supplier('supplier-123')]).covered, true);
  assert.equal(coverage([supplier('Example Merchant')]).covered, false);
  assert.equal(coverage([supplier('supplier-456')]).covered, false);
});

test('multiple supplier constraints form one whitelist; amount is checked independently', () => {
  const list = [supplier('supplier-456'), supplier('supplier-123')];
  assert.equal(coverage(list).covered, true);
  assert.equal(coverage([...list, amount(9)]).covered, false);
  assert.equal(coverage([amount(10)]).covered, true);
});

test('amount limit is inclusive, and zero is a real limit', () => {
  assert.equal(coverage([amount(10)]).covered, true);
  assert.equal(coverage([amount(9)]).covered, false);
  assert.equal(coverage([amount(0)]).covered, false);
  assert.equal(coverage([amount(0)], { action: { ...action, credit_amount: 0 } }).covered, true);
});

test('each operation is evaluated independently without a cumulative budget', () => {
  for (let i = 0; i < 20; i++) assert.equal(coverage([amount(10)]).covered, true);
});

test('unrestricted constraints never bypass ownership or lifecycle', () => {
  assert.equal(coverage([], { user_id: 99 }).covered, false);
  for (const status of ['pending', 'paused', 'revoked', 'expired']) {
    assert.equal(coverage([], { mandate: { ...mandate, status } }).covered, false);
  }
});

test('validity includes start and excludes expiry, failing closed for invalid dates', () => {
  assert.equal(coverage([], { now: terms.starts_at }).covered, true);
  assert.equal(coverage([], { now: terms.expires_at }).covered, false);
  assert.equal(coverage([], { now: '2025-01-01T00:00:00Z' }).covered, false);
  assert.equal(coverage([], { now: 'invalid' }).covered, false);
});

test('no expiry remains valid in the future without bypassing start, status, or limits', () => {
  const forever = { ...mandate, terms: { ...terms, expires_at: null, constraints: [amount(10)] } };
  const check = overrides => coverage([], { mandate: forever, now: '2099-01-01T00:00:00Z', ...overrides });
  assert.equal(check({}).covered, true);
  assert.equal(check({ now: '2025-01-01T00:00:00Z' }).covered, false);
  assert.equal(check({ now: 'invalid' }).covered, false);
  assert.equal(check({ action: { ...action, credit_amount: 11 } }).covered, false);
  assert.equal(check({ mandate: { ...forever, status: 'paused' } }).covered, false);
});
