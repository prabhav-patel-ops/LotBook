import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, validateTransaction } from '../src/ledger.js';

const buy = (id, overrides = {}) => ({ id, symbol: 'ABC', name: 'ABC Ltd', date: '2026-01-01', side: 'BUY', quantity: 10, price: 100, charges: 0, purpose: 'core', note: '', ...overrides });
const sell = (id, overrides = {}) => buy(id, { date: '2026-01-03', side: 'SELL', price: 120, purpose: 'trading', ...overrides });

test('chosen 1250 lot earns 200; independent broker FIFO loses 300; wealth agrees', () => {
  const buys = [buy('1300', { price: 1300 }), buy('1250', { date: '2026-01-02', price: 1250, purpose: 'trading' })];
  const chosen = analyse([...buys, sell('sale', { price: 1270, allocations: [{ lotId: '1250', quantity: 10 }] })], { ABC: 1270 });
  const fifo = analyse([...buys, sell('sale', { price: 1270 })], { ABC: 1270 });
  assert.equal(chosen.totals.realizedNet, 200);
  assert.equal(chosen.totals.fifoNet, -300);
  assert.equal(fifo.totals.realizedNet, -300);
  assert.equal(chosen.holdings[0].lots[0].id, '1300');
  assert.equal(chosen.holdings[0].cost, 13000);
  assert.equal(chosen.totals.realizedNet + chosen.totals.unrealized, fifo.totals.realizedNet + fifo.totals.unrealized);
  assert.equal(chosen.totals.currentValue, fifo.totals.currentValue);
  assert.equal(chosen.cycles[0].purpose, 'trading');
});

test('partial sales allocate actual buy and sell fees proportionally', () => {
  const result = analyse([buy('a', { charges: 10 }), sell('s', { quantity: 4, charges: 8 })], { ABC: 110 });
  assert.equal(result.cycles[0].gross, 80);
  assert.equal(result.cycles[0].charges, 12);
  assert.equal(result.cycles[0].net, 68);
  assert.equal(result.holdings[0].lots[0].chargesRemaining, 6);
  assert.equal(result.holdings[0].cost, 606);
  assert.equal(result.holdings[0].averageCost, 101);
  assert.equal(result.totals.charges, 18);
  assert.equal(result.totals.unrealized, 54);
});

test('sale fees split across each selected lot and original buy fees are conserved', () => {
  const result = analyse([buy('a', { quantity: 2, charges: 3 }), buy('b', { quantity: 3, charges: 6 }), sell('s', { quantity: 4, charges: 8 }), sell('s2', { quantity: 1, charges: 1 })]);
  assert.deepEqual(result.cycles.map(c => c.charges), [7, 8, 3]);
  assert.equal(result.cycles.reduce((sum, c) => sum + c.charges, 0), result.totals.charges);
  assert.deepEqual(result.holdings, []);
});

test('overselling is atomic for diary, FIFO, fees and later transactions', () => {
  const result = analyse([buy('a'), sell('bad', { quantity: 11, charges: 100 }), sell('ok', { quantity: 2 })]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, 'bad');
  assert.equal(result.holdings[0].quantity, 8);
  assert.equal(result.totals.charges, 0);
  assert.equal(result.totals.realizedNet, 40);
  assert.equal(result.totals.fifoNet, 40);
});

test('nonexistent, future, wrong-symbol and exhausted explicit lots never fall back to FIFO', () => {
  for (const lotId of ['missing', 'future', 'other']) {
    const result = analyse([buy('a'), buy('other', { symbol: 'XYZ' }), sell('bad', { allocations: [{ lotId, quantity: 10 }] }), buy('future', { date: '2026-01-04' })]);
    assert.equal(result.errors.length, 1);
    assert.equal(result.cycles.length, 0);
    assert.equal(result.totals.fifoNet, 0);
  }
  const exhausted = analyse([buy('a'), sell('s'), buy('b'), sell('bad', { allocations: [{ lotId: 'a', quantity: 10 }] })]);
  assert.equal(exhausted.errors.length, 1);
  assert.equal(exhausted.holdings[0].lots.find(l => l.remaining > 0).id, 'b');
});

test('explicit selection exceeding one lot is atomic despite sufficient symbol balance', () => {
  const result = analyse([buy('a', { quantity: 2 }), buy('b'), sell('bad', { quantity: 3, allocations: [{ lotId: 'a', quantity: 3 }] })]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.holdings[0].quantity, 12);
  assert.equal(result.totals.cycles, 0);
});

test('valid calendar dates including leap years and early years', () => {
  for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '0099-12-31']) assert.equal(validateTransaction(buy('a', { date })).date, date);
  for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '0000-01-01', '2026-1-01', '2026-01-01T00:00:00Z']) assert.throws(() => validateTransaction(buy('a', { date })), /date/);
});

test('fractional lots and floating point allocation sums are supported', () => {
  const result = analyse([buy('a', { quantity: 0.1 }), buy('b', { quantity: 0.2, purpose: 'trading' }), sell('s', { quantity: 0.3, allocations: [{ lotId: 'a', quantity: 0.1 }, { lotId: 'b', quantity: 0.2 }] })]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.holdings, []);
  assert.equal(result.totals.realizedNet, 6);
  assert.equal(result.totals.fifoNet, 6);
  const small = analyse([buy('tiny', { quantity: 1e-14 }), sell('s', { quantity: 1e-14 })]);
  assert.deepEqual(small.errors, []);
  assert.deepEqual(small.holdings, []);
});

test('chronology uses date then stable input order; holding days use UTC', () => {
  const result = analyse([sell('s', { date: '2026-03-10' }), buy('b', { date: '2026-03-08' })]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.cycles[0].holdingDays, 2);
  const sameDay = analyse([sell('s', { date: '2026-01-01' }), buy('b'), sell('s2', { date: '2026-01-01' })]);
  assert.deepEqual(sameDay.errors.map(e => e.id), ['s']);
  assert.equal(sameDay.cycles[0].sellId, 's2');
});

test('invalid numeric data, missing fields, unsupported purposes and overflow throw', () => {
  for (const field of ['quantity', 'price']) {
    for (const value of [0, -1, Infinity, -Infinity, NaN, null, true, '', 'Infinity', undefined]) assert.throws(() => validateTransaction(buy('a', { [field]: value })));
  }
  for (const charges of [-1, Infinity, NaN, null]) assert.throws(() => validateTransaction(buy('a', { charges })));
  for (const purpose of ['investment', '', null, undefined, 'CORE']) assert.throws(() => validateTransaction(buy('a', { purpose })), /purpose/);
  for (const invalid of [null, [], {}, buy('', {}), buy('a', { symbol: '' }), buy('a', { side: 'HOLD' }), buy('a', { quantity: 1e308, price: 1e308 })]) assert.throws(() => validateTransaction(invalid));
});

test('malformed allocations throw without silently accepting a partial selection', () => {
  for (const allocations of [[], null, [{ lotId: 'a', quantity: 9 }], [{ lotId: 'a', quantity: 0 }], [{ lotId: 'a', quantity: 5 }, { lotId: 'a', quantity: 5 }]]) assert.throws(() => validateTransaction(sell('s', { allocations })));
  assert.throws(() => validateTransaction(buy('a', { allocations: [{ lotId: 'b', quantity: 10 }] })));
});

test('invalid-data errors are atomic and do not prevent subsequent valid replay', () => {
  const result = analyse([buy('bad', { price: Infinity }), buy('a'), sell('bad-sale', { allocations: [{ lotId: 'a', quantity: 9 }], charges: 90 }), sell('ok', { quantity: 3 })]);
  assert.deepEqual(result.errors.map(e => e.id), ['bad', 'bad-sale']);
  assert.ok(result.errors.every(e => typeof e.message === 'string'));
  assert.equal(result.holdings[0].quantity, 7);
  assert.equal(result.totals.realizedNet, 60);
  assert.equal(result.totals.fifoNet, 60);
  assert.equal(result.totals.charges, 0);
});

test('duplicate transaction IDs are rejected atomically', () => {
  const result = analyse([buy('a'), buy('a', { charges: 99 }), sell('s', { quantity: 1 })]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.holdings[0].quantity, 9);
  assert.equal(result.totals.charges, 0);
});

test('independent FIFO remains independent across later explicit sales', () => {
  const result = analyse([buy('a', { price: 1300 }), buy('b', { price: 1250 }), sell('s1', { price: 1270, allocations: [{ lotId: 'b', quantity: 10 }] }), sell('s2', { price: 1400, allocations: [{ lotId: 'a', quantity: 10 }] })]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.totals.realizedNet, 1200);
  assert.equal(result.totals.fifoNet, 1200);
  assert.equal(result.totals.wins, 2);
});

test('unpriced holdings have null valuation and are counted separately', () => {
  const result = analyse([buy('a'), buy('b', { symbol: 'XYZ', purpose: 'trading' })], { XYZ: 90 });
  assert.equal(result.holdings[0].currentPrice, null);
  assert.equal(result.holdings[0].currentValue, null);
  assert.equal(result.holdings[0].unrealized, null);
  assert.equal(result.holdings[1].tradingQuantity, 10);
  assert.equal(result.totals.currentValue, 900);
  assert.equal(result.totals.unrealized, -100);
  assert.equal(result.totals.unpriced, 1);
  for (const quote of [Infinity, NaN, -1, '100', null]) assert.equal(analyse([buy('a')], { ABC: quote }).holdings[0].currentPrice, null);
  assert.equal(analyse([buy('a')], { ABC: 0 }).holdings[0].currentValue, 0);
});

test('normalization and analysis leave transactions and prices untouched', () => {
  const transactions = [buy(' a ', { symbol: ' abc ', quantity: '10', price: '100', charges: undefined }), sell('s', { allocations: [{ lotId: ' a ', quantity: '2' }], quantity: 2 })];
  const before = structuredClone(transactions);
  const prices = Object.freeze({ ABC: 110 });
  assert.equal(validateTransaction(transactions[0]).id, 'a');
  assert.equal(validateTransaction(transactions[0]).charges, 0);
  assert.deepEqual(analyse(transactions, prices).errors, []);
  assert.deepEqual(transactions, before);
});

test('rounding retains fee precision until reporting; no fees are invented', () => {
  const result = analyse([buy('a', { quantity: 3, price: 10.005, charges: 0.01 }), sell('s1', { quantity: 1, price: 11.005 }), sell('s2', { quantity: 1, price: 11.005 }), sell('s3', { quantity: 1, price: 11.005 })]);
  assert.equal(result.totals.realizedGross, 3);
  assert.equal(result.totals.realizedNet, 2.99);
  assert.equal(result.totals.charges, 0.01);
  assert.equal(analyse([buy('a'), sell('s')]).cycles[0].charges, 0);
});

test('empty input returns a complete zero summary', () => {
  assert.deepEqual(analyse([]), { holdings: [], cycles: [], monthlyResults: [], errors: [], totals: { invested: 0, currentValue: 0, unrealized: 0, realizedGross: 0, charges: 0, realizedNet: 0, fifoNet: 0, cycles: 0, wins: 0, losses: 0, unpriced: 0 } });
});

test('monthly results sum unrounded cycles to preserve a cent of buy fees across three closes', () => {
  const result = analyse([
    buy('a', { quantity: 3, price: 10, charges: 0.01 }),
    sell('s1', { date: '2026-01-02', quantity: 1, price: 11 }),
    sell('s2', { date: '2026-01-03', quantity: 1, price: 11 }),
    sell('s3', { date: '2026-01-04', quantity: 1, price: 11 }),
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.cycles.reduce((sum, c) => sum + c.net, 0), 3);
  assert.deepEqual(result.monthlyResults, [{ month: '2026-01', net: 2.99, gross: 3, charges: 0.01 }]);
  assert.equal(result.monthlyResults[0].net, result.totals.realizedNet);
  assert.equal(result.monthlyResults[0].gross, result.totals.realizedGross);
  assert.equal(result.monthlyResults[0].charges, result.totals.charges);
});

test('monthly results use sell month, oldest first, excluding invalid sales and unsold buy fees', () => {
  const result = analyse([
    sell('feb', { date: '2026-02-01', quantity: 1, price: 90, charges: 3 }),
    buy('a', { date: '2025-12-01', quantity: 5, charges: 5 }),
    sell('jan', { date: '2026-01-15', quantity: 1, price: 120, charges: 2 }),
    sell('invalid', { date: '2026-03-01', quantity: 10, charges: 100 }),
  ]);
  assert.deepEqual(result.errors.map(e => e.id), ['invalid']);
  assert.deepEqual(result.monthlyResults, [
    { month: '2026-01', net: 17, gross: 20, charges: 3 },
    { month: '2026-02', net: -14, gross: -10, charges: 4 },
  ]);
  assert.equal(result.totals.realizedNet, 3);
  assert.equal(result.totals.charges, 10);
  assert.equal(result.holdings[0].lots[0].chargesRemaining, 3);
  assert.deepEqual(analyse([buy('only-buy')]).monthlyResults, []);
});

test('numeric range checks reject accumulated quantity overflow atomically', () => {
  const result = analyse([buy('a', { quantity: 1e308, price: 1e-308 }), buy('b', { quantity: 1e308, price: 1e-308 })]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, 'b');
  assert.equal(result.holdings[0].quantity, 1e308);
  assert.ok(Number.isFinite(result.holdings[0].cost));
  const large = analyse([buy('a', { quantity: 1, price: 1e308 })]);
  assert.equal(large.holdings[0].cost, 1e308);
  assert.ok(Number.isFinite(large.totals.invested));
});

test('rounded tiny losses are zero rather than negative zero', () => {
  const result = analyse([buy('a', { quantity: 1, price: 100 }), sell('s', { quantity: 1, price: 99.999 })]);
  assert.equal(result.cycles[0].net, 0);
  assert.equal(result.totals.realizedNet, 0);
  assert.equal(result.totals.losses, 0);
});

test('explicit allocation must not hide an autofill residual below 1e-8', () => {
  const transaction = sell('s', { quantity: 1.000000005, allocations: [{ lotId: 'a', quantity: 1 }] });
  assert.throws(() => validateTransaction(transaction), /sum exactly/);
  const result = analyse([buy('a', { quantity: 1 }), buy('b', { quantity: 1 }), transaction]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.holdings[0].quantity, 2);
  assert.equal(result.totals.realizedNet, 0);
  assert.equal(result.totals.fifoNet, 0);
});

test('failure in a later explicit allocation leaves earlier allocations untouched', () => {
  const result = analyse([
    buy('a', { quantity: 2, charges: 2 }), buy('b', { quantity: 2 }),
    sell('bad', { quantity: 3, charges: 20, allocations: [{ lotId: 'a', quantity: 2 }, { lotId: 'missing', quantity: 1 }] }),
    sell('ok', { quantity: 2, allocations: [{ lotId: 'a', quantity: 2 }] }),
  ]);
  assert.deepEqual(result.errors.map(e => e.id), ['bad']);
  assert.equal(result.cycles.length, 1);
  assert.equal(result.cycles[0].sellId, 'ok');
  assert.equal(result.cycles[0].net, 38);
  assert.equal(result.totals.fifoNet, 38);
  assert.equal(result.totals.charges, 2);
  assert.equal(result.holdings[0].lots.find(l => l.remaining > 0).id, 'b');
});

test('currently held symbols retain closed trading lots without changing active summaries', () => {
  const result = analyse([
    buy('core', { quantity: 10, price: 1300, charges: 10 }),
    buy('trade', { date: '2026-01-02', quantity: 10, price: 1250, charges: 5, purpose: 'trading' }),
    buy('other', { symbol: 'XYZ', quantity: 1 }),
    sell('close-trade', { quantity: 10, price: 1270, allocations: [{ lotId: 'trade', quantity: 10 }] }),
    sell('close-other', { symbol: 'XYZ', quantity: 1 }),
  ], { ABC: 1270 });
  assert.deepEqual(result.errors, []);
  assert.equal(result.holdings.length, 1);
  const h = result.holdings[0];
  assert.equal(h.quantity, 10);
  assert.equal(h.coreQuantity, 10);
  assert.equal(h.tradingQuantity, 0);
  assert.equal(h.cost, 13010);
  assert.equal(h.averageCost, 1301);
  assert.equal(h.currentValue, 12700);
  assert.equal(h.unrealized, -310);
  assert.equal(result.totals.invested, 13010);
  assert.deepEqual(h.lots.map(l => l.id), ['core', 'trade']);
  assert.deepEqual(h.lots[1], {
    id: 'trade', date: '2026-01-02', purpose: 'trading', quantity: 10,
    remaining: 0, price: 1250, chargesRemaining: 0,
  });
});
