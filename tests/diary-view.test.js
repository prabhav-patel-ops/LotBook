import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDiaryEntries } from '../src/diary-view.js';

const trade = (id, overrides = {}) => ({
  id, symbol: 'ABC', name: 'Alpha Industries', date: '2026-01-01',
  side: 'BUY', quantity: 10, price: 100, charges: 0, purpose: 'core', ...overrides,
});
const ids = result => result.entries.map(t => t.id);
const transactions = [
  trade('buy'),
  trade('sell', { side: 'SELL', date: '2026-02-03' }),
  trade('bonus', { corporateAction: 'BONUS', price: 0, date: '2026-02-01' }),
  trade('split', { corporateAction: 'SPLIT', side: 'SPLIT', price: 0, quantity: 2, date: '2026-02-02' }),
  trade('other', { symbol: 'XYZ', name: 'Other Company', date: '2025-12-31' }),
  trade('feb-buy', { date: '2026-02-04' }),
];

test('latest first reverses ledger date, execution-time and corporate-action ordering', () => {
  const rows = [
    trade('late', { date: '2026-02-01', tradeTime: '15:00:00' }),
    trade('old'),
    trade('early', { date: '2026-02-01', tradeTime: '09:00:00' }),
    trade('bonus', { date: '2026-02-01', corporateAction: 'BONUS', price: 0 }),
    trade('latest', { date: '2026-03-01' }),
  ];
  assert.deepEqual(ids(selectDiaryEntries(rows)), ['latest', 'late', 'early', 'bonus', 'old']);
});

test('same-day ties and missing execution times reverse stable ledger input order', () => {
  const rows = [trade('first', { tradeTime: '10:00:00' }), trade('second', { tradeTime: '10:00:00' })];
  assert.deepEqual(ids(selectDiaryEntries(rows)), ['second', 'first']);
  rows.push(trade('untimed'), trade('earlier-time', { tradeTime: '09:00:00' }));
  assert.deepEqual(ids(selectDiaryEntries(rows)), ['earlier-time', 'untimed', 'second', 'first']);
});

test('query matches case-insensitive substrings in either name or symbol', () => {
  assert.deepEqual(ids(selectDiaryEntries(transactions, { query: 'Ha InDuS' })), ['feb-buy', 'sell', 'split', 'bonus', 'buy']);
  assert.deepEqual(ids(selectDiaryEntries(transactions, { query: 'yZ' })), ['other']);
  const unnamed = [trade('unnamed', { name: undefined })];
  assert.deepEqual(ids(selectDiaryEntries(unnamed, { query: 'aBc' })), ['unnamed']);
  assert.equal(selectDiaryEntries(unnamed, { query: 'missing' }).total, 0);
});

test('kind filters exclude corporate bonuses from buys and count actions separately', () => {
  assert.deepEqual(ids(selectDiaryEntries(transactions, { kind: 'buy' })), ['feb-buy', 'buy', 'other']);
  assert.deepEqual(ids(selectDiaryEntries(transactions, { kind: 'sell' })), ['sell']);
  const adjustments = selectDiaryEntries(transactions, { kind: 'adjustment' });
  assert.deepEqual(ids(adjustments), ['split', 'bonus']);
  assert.equal(adjustments.buyCount, 0);
  assert.equal(adjustments.sellCount, 0);
  assert.equal(adjustments.adjustmentCount, 2);
  const buys = selectDiaryEntries(transactions, { kind: 'buy' });
  assert.equal(buys.buyCount, 3);
  assert.equal(buys.sellCount, 0);
  assert.equal(buys.adjustmentCount, 0);
});

test('name search finds unnamed sales of the same stock and ignores surrounding spaces', () => {
  const rows = [trade('purchase'), trade('sale', { side: 'SELL', name: undefined, date: '2026-02-01' })];
  assert.deepEqual(ids(selectDiaryEntries(rows, {query:'  Alpha Industries ',kind:'sell'})), ['sale']);
});

test('month, kind and query combine, while months always cover all transactions', () => {
  const result = selectDiaryEntries(transactions, { month: '2026-02', kind: 'buy', query: 'industries', limit: 1 });
  assert.deepEqual(ids(result), ['feb-buy']);
  assert.equal(result.total, 1);
  assert.equal(result.buyCount, 1);
  assert.deepEqual(result.months, ['2026-02', '2026-01', '2025-12']);
  assert.deepEqual(ids(selectDiaryEntries(transactions, { month: '2026-01' })), ['buy']);
  assert.equal(selectDiaryEntries(transactions, { month: '2026-0' }).total, 0);
});

test('total and kind counts use every filtered entry before limiting the latest rows', () => {
  const result = selectDiaryEntries(transactions, { query: 'alpha', month: '2026-02', limit: 1 });
  assert.deepEqual(result, {
    entries: [transactions[5]], total: 4, months: ['2026-02', '2026-01', '2025-12'],
    buyCount: 1, sellCount: 1, adjustmentCount: 2,
  });
  const all = selectDiaryEntries(transactions, { limit: 2 });
  assert.equal(all.total, 6);
  assert.equal(all.buyCount, 3);
  assert.equal(all.sellCount, 1);
  assert.equal(all.adjustmentCount, 2);
});

test('limits default to 30, round down, and clamp to at least 1 and the available history', () => {
  const rows = Array.from({ length: 510 }, (_, index) => trade(String(index)));
  assert.equal(selectDiaryEntries(rows).entries.length, 30);
  for (const [limit, expected] of [
    [undefined, 30], [NaN, 30], [Infinity, 30], [-Infinity, 30],
    ['invalid', 30], ['', 30], ['   ', 30], [null, 30], [true, 30], [{}, 30], [[], 30],
    [0, 1], [-10, 1], [0.9, 1], [2.9, 2], ['4', 4], [500, 500], [510, 510], [999, 510], [1e100, 510],
  ]) {
    const result = selectDiaryEntries(rows, { limit });
    assert.equal(result.entries.length, expected, `limit: ${String(limit)}`);
    assert.equal(result.entries[0].id, '509');
    assert.equal(result.total, 510);
    assert.equal(result.buyCount, 510);
  }
});

test('Show more in increments of 30 reaches all imported history beyond 500 entries', () => {
  const rows = Array.from({ length: 641 }, (_, index) => trade(String(index)));
  for (let limit = 30; limit <= 660; limit += 30) {
    const result = selectDiaryEntries(rows, { limit });
    assert.equal(result.entries.length, Math.min(limit, rows.length));
    assert.equal(result.total, rows.length);
  }
  assert.deepEqual(ids(selectDiaryEntries(rows, { limit: 660 })), rows.map(t => t.id).reverse());
});

test('empty input and no matches produce zero counts with the available months', () => {
  const empty = { entries: [], total: 0, months: [], buyCount: 0, sellCount: 0, adjustmentCount: 0 };
  assert.deepEqual(selectDiaryEntries([]), empty);
  assert.deepEqual(selectDiaryEntries(transactions, { query: 'no matches' }), {
    ...empty, months: ['2026-02', '2026-01', '2025-12'],
  });
});

test('selection leaves frozen input transactions, nested allocations and options untouched', () => {
  const rows = Object.freeze([
    Object.freeze(trade('late', { tradeTime: '15:00:00' })),
    Object.freeze(trade('early', { tradeTime: '09:00:00' })),
    Object.freeze(trade('sale', { side: 'SELL', date: '2026-02-01', allocations: Object.freeze([
      Object.freeze({ lotId: 'late', quantity: 10 }),
    ]) })),
  ]);
  const before = structuredClone(rows);
  const options = Object.freeze({ query: 'alpha', limit: 2 });
  assert.deepEqual(ids(selectDiaryEntries(rows, options)), ['sale', 'late']);
  assert.deepEqual(rows, before);
  assert.deepEqual(options, { query: 'alpha', limit: 2 });
});
