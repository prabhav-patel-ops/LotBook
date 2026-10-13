import test from 'node:test';
import assert from 'node:assert/strict';
import { holdingReturnPercent } from '../src/ui-logic.js';

test('holding return uses the remaining lots cost and unrealised result', () => {
  assert.equal(holdingReturnPercent(1000, 250), 25);
  assert.equal(holdingReturnPercent(1000, -125), -12.5);
  assert.equal(holdingReturnPercent(1000, 0), 0);
});

test('missing quote or zero cost cannot produce a return percentage', () => {
  assert.equal(holdingReturnPercent(1000, null), null);
  assert.equal(holdingReturnPercent(0, 50), null);
  assert.equal(holdingReturnPercent(1000, NaN), null);
});
