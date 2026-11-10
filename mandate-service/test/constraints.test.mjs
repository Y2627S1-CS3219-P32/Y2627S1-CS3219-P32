import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeMandateConstraints } from '../dist/repository.js';

const stored = (constraintType, value) => ({ constraintType, value });

test('supplier IDs and numeric limits decode from stored rows', () => {
  assert.deepEqual(decodeMandateConstraints([
    stored('supplier_id', 'supplier-123'), stored('max_credit_amount', '25'),
  ]), [{ type: 'supplier_id', value: 'supplier-123' }, { type: 'max_credit_amount', value: 25 }]);
  assert.deepEqual(decodeMandateConstraints([]), []);
});

test('zero and the largest supported exact amount survive storage', () => {
  for (const value of [0, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(decodeMandateConstraints([stored('max_credit_amount', String(value))]),
      [{ type: 'max_credit_amount', value }]);
  }
});

test('unknown constraints and empty supplier IDs fail rather than becoming unrestricted', () => {
  for (const row of [stored('action', 'order.create'), stored('supplier_id', ''), stored('supplier_id', '  ')]) {
    assert.throws(() => decodeMandateConstraints([row]));
  }
});

test('duplicate supplier IDs are one whitelist entry, duplicate amount limits are rejected', () => {
  const supplier = stored('supplier_id', 'supplier-123');
  assert.deepEqual(decodeMandateConstraints([supplier, supplier]), [{ type: 'supplier_id', value: 'supplier-123' }]);
  assert.throws(() => decodeMandateConstraints([stored('max_credit_amount', '10'), stored('max_credit_amount', '20')]));
});

test('malformed stored amounts never coerce to zero or bypass limits', () => {
  for (const value of ['', ' ', '01', '1.5', '-1', '1e2', 'NaN', 'Infinity', '9007199254740992']) {
    assert.throws(() => decodeMandateConstraints([stored('max_credit_amount', value)]));
  }
});
