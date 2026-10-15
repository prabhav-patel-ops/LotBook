import test from 'node:test';
import assert from 'node:assert/strict';
import { holdingPriceSignal, holdingReturnPercent } from '../src/ui-logic.js';

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

test('price signal compares with the cheapest remaining open lot', () => {
  const signal = holdingPriceSignal({
    currentPrice: 125,
    lots: [
      {price: 80, remaining: 0},
      {price: 100, remaining: 2},
      {price: 115, remaining: 3},
    ],
  });
  assert.deepEqual(signal, {status: 'above', lowestPrice: 100, difference: 25});
});

test('price signal identifies prices below or equal to the cheapest open lot', () => {
  assert.deepEqual(
    holdingPriceSignal({currentPrice: 95, lots: [{price: 100, remaining: 1}]}),
    {status: 'below', lowestPrice: 100, difference: -5},
  );
  assert.deepEqual(
    holdingPriceSignal({currentPrice: 100, lots: [{price: 100, remaining: 1}]}),
    {status: 'at', lowestPrice: 100, difference: 0},
  );
});

test('price signal stays neutral without a quote or an open purchase lot', () => {
  assert.deepEqual(
    holdingPriceSignal({currentPrice: null, lots: [{price: 100, remaining: 1}]}),
    {status: 'unknown', lowestPrice: 100, difference: null},
  );
  assert.deepEqual(
    holdingPriceSignal({currentPrice: 125, lots: [{price: 100, remaining: 0}]}),
    {status: 'unknown', lowestPrice: null, difference: null},
  );
});
