import test from 'node:test';
import assert from 'node:assert/strict';
import { growwInvestedSummary, holdingPriceSignal, holdingReturnPercent } from '../src/ui-logic.js';

test('Groww invested uses a current quantity-matching holdings statement', () => {
  assert.deepEqual(growwInvestedSummary({
    holdings: [{symbol: 'ABC', quantity: 10}, {symbol: 'XYZ', quantity: 2}],
    fifoInvested: 999,
    snapshots: [{symbol: 'ABC', quantity: 10, averageCost: 101.25}, {symbol: 'XYZ', quantity: 2, averageCost: 500}],
    snapshotDate: '2026-10-15',
    latestTransactionDate: '2026-10-14',
  }), {value: 2012.5, source: 'statement', asOf: '2026-10-15'});
});

test('Groww invested falls back to FIFO for stale, incomplete or mismatched statements', () => {
  const common={holdings:[{symbol:'ABC',quantity:10}],fifoInvested:975,snapshots:[{symbol:'ABC',quantity:10,averageCost:101}],snapshotDate:'2026-10-10'};
  assert.deepEqual(growwInvestedSummary({...common,latestTransactionDate:'2026-10-11'}), {value:975,source:'fifo',asOf:null});
  assert.deepEqual(growwInvestedSummary({...common,snapshots:[{symbol:'ABC',quantity:9,averageCost:101}],latestTransactionDate:'2026-10-10'}), {value:975,source:'fifo',asOf:null});
  assert.deepEqual(growwInvestedSummary({...common,snapshots:[{symbol:'ABC',quantity:10,averageCost:null}],latestTransactionDate:'2026-10-10'}), {value:975,source:'fifo',asOf:null});
});

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
