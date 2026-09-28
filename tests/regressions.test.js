import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, validateTransaction } from '../src/ledger.js';
import { fresh, save, load, validateBackup, saveIfUnchanged, KEY } from '../src/storage.js';
import { allocateLots } from '../src/ui-logic.js';
import { planTransactions, normalizeSnapshots, reconcileHoldings } from '../src/import-workflow.js';
import { parseRows } from '../src/importer.js';

// Synthetic records only. Exercise exported accounting/storage APIs, never the DOM.
const buy = (id, extra = {}) => ({
  id, symbol: 'ABC', name: 'Synthetic ABC', date: '2026-01-01',
  side: 'BUY', quantity: 10, price: 100, charges: 10, purpose: 'core',
  ...extra,
});
const sell = (id, extra = {}) => buy(id, {
  side: 'SELL', date: '2026-01-03', price: 120, charges: 8,
  purpose: 'trading', ...extra,
});
const idFactory = () => {
  let next = 0;
  return () => `kitty-import-${++next}`;
};

function memoryStorage(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const records = new Map();
  const writes = [];
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => records.get(key) ?? null,
      setItem(key, value) { writes.push(key); records.set(key, String(value)); },
      removeItem(key) { writes.push(key); records.delete(key); },
      clear() { throw new Error('Lotbook must never clear another app\'s storage'); },
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  return { records, writes };
}

test('Kitty: full history replay survives unsorted import, explicit lots and private backup roundtrip', t => {
  memoryStorage(t);
  const transactions = [
    sell('sale', { quantity: 4, allocations: [{ lotId: 'trading', quantity: 4 }] }),
    buy('core'),
    buy('trading', { date: '2026-01-02', quantity: 4, price: 90, charges: 4, purpose: 'trading' }),
  ];
  const state = {
    ...fresh(), profile: 'Synthetic', onboarded: true, transactions,
    prices: { ABC: { price: 110, date: '2026-01-04' } }, cash: 123,
    snapshots: [{ symbol: 'ABC', quantity: 10, averageCost: 101 }],
    notes: { '2026-01-03': 'Selected the trading purchase.' },
  };
  const before = structuredClone(state);
  save(state);
  const restored = load();
  assert.deepEqual(state, before);
  assert.deepEqual(restored.transactions.map(tx => tx.id), ['sale', 'core', 'trading']);
  assert.deepEqual(restored.transactions[0].allocations, [{ lotId: 'trading', quantity: 4 }]);
  assert.deepEqual(restored.notes, before.notes);
  const result = analyse(restored.transactions, { ABC: restored.prices.ABC.price });
  assert.deepEqual(result.errors, []);
  assert.equal(result.holdings[0].quantity, 10);
  assert.equal(result.holdings[0].cost, 1010);
  assert.equal(result.totals.charges, 22);
  assert.equal(result.totals.realizedNet, 108);
  assert.equal(result.totals.fifoNet, 68);
  assert.equal(result.totals.realizedNet + result.totals.unrealized, 198);
});

test('Kitty: invalid restore leaves the existing diary and sibling app records byte-for-byte intact', t => {
  const { records, writes } = memoryStorage(t);
  const siblingKey = 'another-app.private.v1';
  records.set(siblingKey, '{"private":"synthetic sibling data"}');
  save({ ...fresh(), transactions: [buy('valid')] });
  const before = new Map(records);
  const writesBefore = writes.length;
  const invalid = [
    { ...fresh(), version: 2 },
    { ...fresh(), transactions: [buy('duplicate'), buy('duplicate')] },
    { ...fresh(), transactions: [sell('orphan')] },
    { ...fresh(), transactions: [buy('purchase'), sell('bad', {
      allocations: [{ lotId: 'missing', quantity: 10 }],
    })] },
    { ...fresh(), snapshots: [{ symbol: 'ABC', quantity: -1, averageCost: 100 }] },
    { ...fresh(), prices: { ABC: { price: -1 } } },
  ];
  for (const candidate of invalid) {
    assert.throws(() => validateBackup(candidate));
    assert.throws(() => save(candidate));
    assert.deepEqual(records, before);
  }
  assert.equal(writes.length, writesBefore);
  assert.equal(writes[0], KEY);
});

test('Kitty: storage quota failure preserves the saved diary and does not mutate the candidate', t => {
  const { records } = memoryStorage(t);
  const original = { ...fresh(), profile: 'Old', transactions: [buy('old')] };
  save(original);
  const previous = records.get(KEY);
  const candidate = { ...fresh(), profile: 'New', transactions: [buy('new')] };
  const before = structuredClone(candidate);
  globalThis.localStorage.setItem = () => { throw new Error('Synthetic quota exceeded'); };
  assert.throws(() => save(candidate), /quota exceeded/);
  assert.equal(records.get(KEY), previous);
  assert.deepEqual(candidate, before);
  assert.equal(load().profile, 'Old');
});

test('Kitty: corrupt saved data remains available for recovery after a failed load', t => {
  const { records, writes } = memoryStorage(t);
  const raw = '{"version":1,"transactions":[';
  records.set(KEY, raw);
  records.set('other-app', 'untouched');
  assert.throws(() => load(), SyntaxError);
  assert.equal(records.get(KEY), raw);
  assert.equal(records.get('other-app'), 'untouched');
  assert.deepEqual(writes, []);
});

test('Kitty: undoing an appended historical buy is rejected without losing its dependent sale', t => {
  const { records } = memoryStorage(t);
  const state = { ...fresh(), transactions: [sell('later-sale'), buy('older-opening')] };
  save(state);
  const before = records.get(KEY);
  assert.deepEqual(analyse(state.transactions).errors, []);
  assert.throws(() => save({ ...state, transactions: state.transactions.slice(0, -1) }), /invalid trading history/);
  assert.equal(records.get(KEY), before);
  assert.deepEqual(load().transactions.map(tx => tx.id), ['later-sale', 'older-opening']);
});

test('Kitty: a failed same-day sale can be retried after a purchase without leaking rejected fees', () => {
  const rejected = sell('sale', { date: '2026-01-01', quantity: 4, charges: 800 });
  const accepted = sell('retry', { date: '2026-01-01', quantity: 4 });
  const result = analyse([rejected, buy('purchase'), accepted]);
  assert.deepEqual(result.errors.map(error => error.id), ['sale']);
  assert.equal(result.holdings[0].quantity, 6);
  assert.equal(result.totals.charges, 18);
  assert.equal(result.totals.realizedNet, 68);
  assert.equal(result.totals.fifoNet, 68);
});

test('Kitty: cheapest-lot and FIFO autofill conserve tiny lots without mutating lot history', () => {
  const lots = [
    { id: 'old', date: '2026-01-01', price: 100, remaining: 0.000000005 },
    { id: 'new', date: '2026-01-02', price: 90, remaining: 1 },
    { id: 'closed', date: '2025-01-01', price: 1, remaining: 0 },
  ];
  const before = structuredClone(lots);
  for (const fifo of [false, true]) {
    const allocations = allocateLots(lots, 1.000000005, fifo);
    assert.equal(allocations.length, 2);
    assert.equal(allocations[0].lotId, fifo ? 'old' : 'new');
    assert.equal(allocations.reduce((sum, allocation) => sum + allocation.quantity, 0), 1.000000005);
    assert.doesNotThrow(() => validateTransaction(sell('sale', { quantity: 1.000000005, allocations })));
  }
  assert.deepEqual(lots, before);
});

test('Kitty: import multiplicity grows only by excess occurrences and survives JSON reload', t => {
  memoryStorage(t);
  const incoming = buy('ignored', { chargesKnown: true });
  const first = planTransactions([], [incoming, incoming], idFactory());
  assert.deepEqual([first.added, first.skipped, first.conflicts.length, first.errors.length], [2, 0, 0, 0]);
  save({ ...fresh(), transactions: first.transactions });
  const saved = load().transactions;
  const before = structuredClone(saved);
  const overlapping = planTransactions(saved, [incoming, incoming, incoming], idFactory());
  assert.equal(overlapping.added, 1);
  assert.equal(overlapping.skipped, 2);
  assert.equal(analyse(overlapping.transactions).holdings[0].quantity, 30);
  assert.deepEqual(overlapping.conflicts, []);
  assert.deepEqual(overlapping.errors, []);
  assert.deepEqual(saved, before);
  const repeat = planTransactions(overlapping.transactions, [incoming, incoming, incoming], idFactory());
  assert.equal(repeat.added, 0);
  assert.equal(repeat.skipped, 3);
});

test('Kitty: same order can have separate fills while an exact trade ID repeat is skipped', () => {
  const row = buy('unused', { orderId: 'shared-order', exchange: 'NSE' });
  const orders = planTransactions([], [row, row], idFactory());
  assert.equal(orders.added, 2);
  const identified = planTransactions([], [
    { ...row, tradeId: 'fill-a' }, { ...row, tradeId: 'fill-b' }, { ...row, tradeId: 'fill-a' },
  ], idFactory());
  assert.equal(identified.added, 2);
  assert.equal(identified.skipped, 1);
  assert.deepEqual(identified.conflicts, []);
  assert.equal(analyse(identified.transactions).holdings[0].quantity, 20);
});

test('Kitty: unknown charges enrichment preserves purchase IDs, chosen allocations and purpose', t => {
  memoryStorage(t);
  const existing = [
    buy('core'),
    buy('trading', { date: '2026-01-02', price: 90, charges: 0, chargesKnown: false, purpose: 'trading' }),
    sell('chosen', { quantity: 4, charges: 0, chargesKnown: false,
      allocations: [{ lotId: 'trading', quantity: 4 }] }),
  ];
  const before = structuredClone(existing);
  const incoming = [
    buy('ignored', { date: '2026-01-02', price: 90, charges: 10, chargesKnown: true,
      purpose: 'core', isin: 'SYNTHETIC-ABC', tradeId: 'buy-fill', orderId: 'buy-order', exchange: 'NSE', tradeTime: '09:15:00' }),
    sell('ignored-sale', { quantity: 4, charges: 8, chargesKnown: true, tradeId: 'sell-fill' }),
  ];
  const plan = planTransactions(existing, incoming, idFactory());
  assert.deepEqual([plan.added, plan.skipped, plan.updated], [0, 2, 2]);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(existing, before);
  const purchase = plan.transactions.find(tx => tx.id === 'trading');
  assert.equal(purchase.purpose, 'trading');
  assert.equal(purchase.charges, 10);
  const sale = plan.transactions.find(tx => tx.id === 'chosen');
  assert.deepEqual(sale.allocations, [{ lotId: 'trading', quantity: 4 }]);
  save({ ...fresh(), transactions: plan.transactions });
  const restored = load();
  const restoredPurchase = restored.transactions.find(tx => tx.id === 'trading');
  for (const field of ['isin', 'tradeId', 'orderId', 'exchange', 'tradeTime', 'chargesKnown']) {
    assert.equal(restoredPurchase[field], purchase[field], `${field} must survive backup roundtrip`);
  }
  const result = analyse(restored.transactions);
  assert.equal(result.totals.unknownCharges, 0);
  assert.equal(result.cycles[0].chargesKnown, true);
  assert.equal(result.cycles[0].net, 108);
});

test('Kitty: reuploading unknown fees never erases recorded known fees or annotations', () => {
  const existing = [buy('saved', { charges: 7.5, chargesKnown: true, note: 'Original reason', purpose: 'trading' })];
  const plan = planTransactions(existing, [buy('ignored', { charges: 0, chargesKnown: false })], idFactory());
  assert.equal(plan.added, 0);
  assert.equal(plan.updated, 0);
  assert.equal(plan.transactions[0].charges, 7.5);
  assert.equal(plan.transactions[0].chargesKnown, true);
  assert.equal(plan.transactions[0].note, 'Original reason');
  assert.equal(plan.transactions[0].purpose, 'trading');
});

test('Kitty: same source trade ID with changed economic values or known fees requires conflict resolution', () => {
  const existing = [buy('saved', { tradeId: 'stable', exchange: 'NSE', chargesKnown: true })];
  const before = structuredClone(existing);
  for (const overrides of [
    { quantity: 11 }, { price: 101 }, { side: 'SELL' }, { symbol: 'XYZ' }, { charges: 11 },
  ]) {
    const plan = planTransactions(existing, [buy('ignored', { tradeId: 'stable', exchange: 'NSE', chargesKnown: true, ...overrides })], idFactory());
    assert.equal(plan.conflicts.length, 1, JSON.stringify(overrides));
    assert.equal(plan.added, 0);
    assert.deepEqual(plan.transactions, existing.map(validateTransaction));
  }
  assert.deepEqual(existing, before);
});

test('Kitty: execution-time sorting only applies to complete date groups and ties remain stable', () => {
  const purchased = buy('purchase', { tradeTime: '09:15:00' });
  const sold = sell('sale', { date: '2026-01-01', quantity: 4, tradeTime: '10:00:00' });
  const chronological = analyse([sold, purchased]);
  assert.deepEqual(chronological.errors, []);
  assert.equal(chronological.holdings[0].quantity, 6);
  assert.equal(chronological.cycles[0].holdingDays, 0);
  const incomplete = analyse([sold, purchased, buy('unknown-time', { symbol: 'XYZ', tradeTime: '' })]);
  assert.deepEqual(incomplete.errors.map(error => error.id), ['sale']);
  const tied = analyse([{ ...sold, tradeTime: '09:15:00' }, purchased]);
  assert.deepEqual(tied.errors.map(error => error.id), ['sale']);
  assert.equal(validateTransaction(buy('empty', { tradeTime: '' })).tradeTime, undefined);
  for (const tradeTime of ['24:00:00', '9:15:00', '09:60:00', '09:15:60', 'invalid']) {
    assert.throws(() => validateTransaction(buy('invalid', { tradeTime })), /execution time/);
  }
});

test('Kitty: unknown buy and sell fees stay visible after backup without counting invalid sales', t => {
  memoryStorage(t);
  const state = { ...fresh(), transactions: [
    buy('unknown-buy', { charges: 0, chargesKnown: false }),
    sell('known-sale', { quantity: 2, chargesKnown: true }),
    sell('unknown-sale', { quantity: 2, charges: 0, chargesKnown: false }),
  ] };
  save(state);
  const result = analyse([...load().transactions, sell('bad', { quantity: 100, chargesKnown: false })]);
  assert.equal(result.totals.unknownCharges, 2);
  assert.deepEqual(result.cycles.map(cycle => cycle.chargesKnown), [false, false]);
  assert.deepEqual(result.errors.map(error => error.id), ['bad']);
});

test('Kitty: complete and partial reconciliation distinguish missing stocks and empty reports', t => {
  memoryStorage(t);
  const transactions = [buy('abc'), buy('xyz', { symbol: 'XYZ', name: 'Synthetic XYZ', quantity: 5 })];
  const snapshots = normalizeSnapshots([{ symbol: 'Synthetic ABC', quantity: 10, avgPrice: 101 }], transactions);
  assert.equal(snapshots[0].symbol, 'ABC');
  assert.deepEqual(reconcileHoldings(transactions, snapshots, { complete: false }).map(row => row.symbol), ['ABC']);
  const complete = reconcileHoldings(transactions, snapshots, { complete: true });
  const extra = complete.find(row => row.symbol === 'XYZ');
  assert.deepEqual([extra.reported, extra.actual, extra.difference], [0, 5, -5]);
  assert.equal(reconcileHoldings(transactions, [], { complete: true }).length, 2);
  assert.deepEqual(reconcileHoldings(transactions, [], { complete: false }), []);
  save({ ...fresh(), transactions, snapshots, snapshotComplete: true, snapshotDate: '2026-01-04' });
  const restored = load();
  assert.equal(restored.snapshotComplete, true);
  assert.equal(restored.snapshotDate, '2026-01-04');
  assert.deepEqual(reconcileHoldings(restored.transactions, restored.snapshots, { complete: restored.snapshotComplete }), complete);
});

test('Kitty: duplicate normalized snapshot symbols require an explicit resolution', () => {
  const transactions = [buy('abc', { isin: 'SYNTHETIC-ABC' })];
  assert.throws(() => normalizeSnapshots([
    { symbol: 'ABC', quantity: 5, avgPrice: 100 },
    { symbol: 'Synthetic ABC', isin: 'SYNTHETIC-ABC', quantity: 5, avgPrice: 100 },
  ], transactions), /more than once/);
});

test('Kitty: stale writes after another tab save or removal never overwrite either app', t => {
  const { records, writes } = memoryStorage(t);
  records.set('sibling-app', 'private sibling');
  save({ ...fresh(), profile: 'First', transactions: [buy('first')] });
  const expected = records.get(KEY);
  const draft = { ...load(), profile: 'Stale draft' };
  save({ ...fresh(), profile: 'Second', transactions: [buy('second')] });
  const second = records.get(KEY);
  const count = writes.length;
  assert.throws(() => saveIfUnchanged(draft, expected), /changed in another tab/);
  assert.equal(records.get(KEY), second);
  assert.equal(writes.length, count);
  records.delete(KEY);
  assert.throws(() => saveIfUnchanged(draft, second), /changed in another tab/);
  assert.equal(records.has(KEY), false);
  saveIfUnchanged({ ...fresh(), profile: 'New diary' }, null);
  assert.equal(load().profile, 'New diary');
  assert.equal(records.get('sibling-app'), 'private sibling');
  assert.ok(writes.every(key => key === KEY));
});

// Active expectations for discovered defects. See docs/kitty-review.md for results.
test('Kitty regression: repeated trade ID within one file enriches unknown charges', () => {
  const unknown = buy('unused', { charges: 0, chargesKnown: false, tradeId: 'fill', exchange: 'NSE' });
  const known = { ...unknown, charges: 12, chargesKnown: true };
  for (const incoming of [[unknown, known], [known, unknown]]) {
    const plan = planTransactions([], incoming, idFactory());
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.transactions.length, 1);
    assert.equal(plan.transactions[0].charges, 12);
    assert.equal(plan.transactions[0].chargesKnown, true);
  }
});

test('Kitty regression: matching anonymous row cannot consume the same saved fill again by ID', () => {
  const saved = buy('saved', { tradeId: 'fill', exchange: 'NSE' });
  const anonymous = buy('unused', { exchange: 'NSE' });
  const identified = { ...anonymous, tradeId: 'fill' };
  for (const incoming of [[anonymous, identified], [identified, anonymous]]) {
    const plan = planTransactions([saved], incoming, idFactory());
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.added, 1);
    assert.equal(plan.skipped, 1);
    assert.equal(analyse(plan.transactions).holdings[0].quantity, 20);
  }
});

test('Kitty regression: exchange namespaces distinguish economically identical source trade IDs', () => {
  const saved = buy('saved', { tradeId: 'fill', exchange: 'NSE' });
  const incoming = buy('unused', { tradeId: 'fill', exchange: 'BSE' });
  const plan = planTransactions([saved], [incoming], idFactory());
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.added, 1);
  assert.equal(plan.transactions.length, 2);
  assert.deepEqual(plan.transactions.map(tx => tx.exchange), ['NSE', 'BSE']);
});

test('Kitty regression: same identified fill with contradictory source metadata must block', () => {
  const saved = buy('saved', {
    tradeId: 'fill', exchange: 'NSE', isin: 'SYNTHETIC-ABC',
    orderId: 'order-a', tradeTime: '09:15:00',
  });
  const before = structuredClone(saved);
  for (const extra of [{ isin: 'SYNTHETIC-OTHER' }, { orderId: 'order-b' }, { tradeTime: '10:00:00' }]) {
    const incoming = { ...saved, ...extra };
    const repeatedUpload = planTransactions([saved], [incoming], idFactory());
    assert.equal(repeatedUpload.conflicts.length, 1, `existing conflict ${JSON.stringify(extra)}`);
    assert.equal(repeatedUpload.added, 0);
    const sameFile = planTransactions([], [saved, incoming], idFactory());
    assert.equal(sameFile.conflicts.length, 1, `same-file conflict ${JSON.stringify(extra)}`);
  }
  assert.deepEqual(saved, before);
});

test('Kitty regression: contradictory ISIN and known symbol cannot silently reconcile', () => {
  const transactions = [buy('abc', { isin: 'SYNTHETIC-ABC' }), buy('xyz', { symbol: 'XYZ', isin: 'SYNTHETIC-XYZ' })];
  assert.throws(() => normalizeSnapshots([
    { symbol: 'ABC', isin: 'SYNTHETIC-XYZ', quantity: 10, avgPrice: 100 },
  ], transactions), /identifier|ISIN|conflict|match/i);
});

test('Kitty regression: restore rejects duplicate snapshot symbols rather than using the last row', t => {
  const { records } = memoryStorage(t);
  save({ ...fresh(), profile: 'Existing', transactions: [buy('abc')] });
  const before = records.get(KEY);
  const bad = { ...fresh(), snapshotComplete: true, snapshots: [
    { symbol: 'ABC', quantity: 99, averageCost: 100 },
    { symbol: 'ABC', quantity: 10, averageCost: 100 },
  ] };
  assert.throws(() => save(bad), /snapshot|duplicate|more than once/i);
  assert.equal(records.get(KEY), before);
});

test('Kitty: invalid optional clocks remain unknown through planning and do not invent intraday order', () => {
  const headers = ['Symbol', 'Date', 'Side', 'Quantity', 'Price', 'Trade Time'];
  const parsed = parseRows([headers,
    ['ABC', '01-01-2026', 'SELL', 4, 120, '10:00:00'],
    ['ABC', '01-01-2026', 'BUY', 10, 100, '24:00:00'],
  ]);
  assert.equal(parsed.transactions.length, 2);
  assert.equal(parsed.transactions[1].tradeTime, '');
  assert.ok(parsed.rowIssues.some(issue => issue.code === 'unknown-time'));
  assert.ok(parsed.warnings.some(warning => /time.*unknown|unknown.*time/i.test(warning)));
  const plan = planTransactions([], parsed.transactions, idFactory());
  assert.equal(plan.transactions[1].tradeTime, undefined);
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0].message, /insufficient/);
});

test('Kitty regression: Groww exchange order identity survives parser, import plan and backup', t => {
  memoryStorage(t);
  const createId = idFactory();
  const headers = ['Stock name', 'Symbol', 'ISIN', 'Type', 'Quantity', 'Value', 'Exchange', 'Exchange Order Id', 'Execution date'];
  const row = ['Synthetic ABC', 'ABC', 'SYNTHETIC-ABC', 'BUY', 4, 1000, 'NSE', '000012345678901234567890', '01-01-2026'];
  const parsed = parseRows([headers, row]);
  assert.equal(parsed.transactions.length, 1);
  assert.equal(parsed.transactions[0].exchangeOrderId, row[7]);
  const plan = planTransactions([], parsed.transactions, createId);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.transactions[0].exchangeOrderId, row[7]);
  save({ ...fresh(), transactions: plan.transactions });
  assert.equal(load().transactions[0].exchangeOrderId, row[7]);
  const differentOrder = parseRows([headers, row.map((value, index) => index === 7 ? '000012345678901234567891' : value)]);
  const next = planTransactions(load().transactions, differentOrder.transactions, createId);
  assert.equal(next.added, 1, 'a separate exchange order must not match the first execution');
  assert.deepEqual(next.errors, []);
});

test('Kitty regression: repeated identified fill can enrich a missing exchange without duplicating quantity', () => {
  const unidentifiedExchange = buy('ignored', { tradeId: 'fill' });
  const identifiedExchange = { ...unidentifiedExchange, exchange: 'NSE' };
  for (const incoming of [[unidentifiedExchange, identifiedExchange], [identifiedExchange, unidentifiedExchange]]) {
    const first = planTransactions([], incoming, idFactory());
    assert.deepEqual(first.conflicts, []);
    assert.equal(first.transactions.length, 1);
    assert.equal(first.transactions[0].exchange, 'NSE');
    const existing = [buy('saved', { tradeId: 'fill', exchange: 'NSE' })];
    const repeated = planTransactions(existing, incoming, idFactory());
    assert.deepEqual(repeated.conflicts, []);
    assert.equal(repeated.added, 0);
    assert.equal(repeated.transactions.length, 1);
  }
});

test('Kitty regression: restore cannot reinterpret malformed snapshot numbers as zero holdings', t => {
  const { records } = memoryStorage(t);
  save({ ...fresh(), profile: 'Existing', transactions: [buy('abc')] });
  const before = records.get(KEY);
  for (const quantity of [null, '', false, true, []]) {
    const candidate = { ...fresh(), snapshotComplete: true,
      snapshots: [{ symbol: 'ABC', quantity, averageCost: 100 }] };
    assert.throws(() => save(candidate), /snapshot|quantity|number/i, `quantity ${JSON.stringify(quantity)}`);
    assert.equal(records.get(KEY), before);
  }
});

test('Kitty regression: restore rejects duplicated source executions even when local diary IDs differ', t => {
  const { records } = memoryStorage(t);
  save({ ...fresh(), transactions: [buy('original')] });
  const before = records.get(KEY);
  const candidate = { ...fresh(), transactions: [
    buy('local-one', { tradeId: 'fill', exchange: 'NSE' }),
    buy('local-two', { tradeId: 'fill', exchange: 'NSE' }),
  ] };
  assert.throws(() => save(candidate), /duplicate|trade|execution/i);
  assert.equal(records.get(KEY), before);
  assert.doesNotThrow(() => validateBackup({ ...candidate, transactions: [
    candidate.transactions[0], { ...candidate.transactions[1], exchange: 'BSE' },
  ] }));
});

test('Kitty regression: legacy zero-fee backups migrate to unknown while explicit known zero is preserved', t => {
  const { records } = memoryStorage(t);
  const legacy = { version: 1, transactions: [
    buy('legacy-zero', { charges: 0 }),
    buy('legacy-omitted', { charges: undefined }),
    buy('known-zero', { charges: 0, chargesKnown: true }),
  ] };
  const raw = JSON.stringify(legacy);
  records.set(KEY, raw);
  const migrated = load();
  assert.deepEqual(migrated.transactions.map(tx => tx.chargesKnown), [false, false, true]);
  assert.equal(records.get(KEY), raw, 'read-time migration must preserve original recovery bytes');
  save(migrated);
  assert.deepEqual(load().transactions.map(tx => tx.chargesKnown), [false, false, true]);
  assert.equal(analyse(load().transactions).totals.unknownCharges, 2);
});
