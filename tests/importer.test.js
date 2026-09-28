import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeDate, parseRows, parseStatement, MAX_FILE_BYTES, MAX_ROWS } from '../src/importer.js';

const headers = ['Stock', 'ISIN', 'Trade Date', 'Trade type', 'Quantity', 'Trade Price', 'Total charges'];
const trade = ['RELIANCE', 'INE002A01018', '03/04/2026', 'Buy', '1,250', '₹ 1,234.50', '12.50'];

test('Groww preamble, synonyms, footer, Indian numbers and sell trades', () => {
  const result = parseRows([['Groww'], ['Client', 'Prabhav'], ['Trade report'], headers, trade,
    ['TCS', '', '04/05/2026', 'SELL', '1,23,456', '3,456.70', '1,234.50'],
    ['Total', '', '', '', '1,24,706', '', '1247'], ['Disclaimer: for reference']]);
  assert.equal(result.mappingRequired, false);
  assert.equal(result.transactions.length, 2);
  assert.deepEqual(result.transactions[0], { symbol: 'RELIANCE', isin: 'INE002A01018', date: '2026-04-03', side: 'BUY', quantity: 1250, price: 1234.5, charges: 12.5, purpose: 'core', sourceRow: 5, chargesKnown: true, priceSource: 'unit-price', tradeTime: '' });
  assert.equal(result.transactions[1].quantity, 123456);
  assert.equal(result.transactions[1].side, 'SELL');
  assert.deepEqual(result.headers, headers);
  assert.ok(result.warnings.some(warning => warning.includes('metadata')));
  assert.ok(result.warnings.some(warning => warning.includes('footer')));
});

test('strict day-first dates, ISO, Date, and Excel serials', () => {
  assert.equal(normalizeDate('01/02/2026'), '2026-02-01');
  assert.equal(normalizeDate('13/02/2026'), '2026-02-13');
  assert.equal(normalizeDate('2024-02-29'), '2024-02-29');
  assert.equal(normalizeDate('2026-04-03T12:00:00Z'), '2026-04-03');
  assert.equal(normalizeDate(new Date(2026, 3, 3)), '2026-04-03');
  assert.equal(normalizeDate(1), '1900-01-01');
  assert.equal(normalizeDate(61.5), '1900-03-01');
  assert.equal(normalizeDate(45292), '2024-01-01');
  for (const value of ['31/04/2026', '29/02/2025', '2026-02-30', '2026-04-03T24:00:00Z', '02/13/2026', '01/02/26', 'April 3, 2026', '45292', '', 60, Infinity, NaN, new Date(NaN)]) assert.equal(normalizeDate(value), null, String(value));
});

test('holdings are snapshots, never implicit buys; prefer average price', () => {
  const result = parseRows([['Holdings report'], ['Stock name', 'ISIN', 'Qty', 'Price', 'Average buy price'], ['TCS', 'INE467B01029', '25', '4000', '3,200.50']], 'holdings');
  assert.deepEqual(result.transactions, []);
  assert.deepEqual(result.holdings, [{ symbol: 'TCS', isin: 'INE467B01029', quantity: 25, avgPrice: 3200.5 }]);
  assert.equal(result.mappingRequired, false);
});

test('missing required columns request mapping and do not invent transactions', () => {
  const result = parseRows([['Symbol', 'Date', 'Qty', 'Price', 'Total'], ['TCS', '01/02/2026', '5', '100', '500']]);
  assert.equal(result.mappingRequired, true);
  assert.equal(result.transactions.length, 0);
  assert.ok(result.warnings.some(warning => warning.includes('side')));
  const noPrice = parseRows([['Stock', 'Date', 'Buy/Sell', 'Qty', 'Total'], ['TCS', '01/02/2026', 'Buy', 5, 500]]);
  assert.equal(noPrice.transactions.length, 0);
  assert.ok(noPrice.warnings.some(warning => warning.includes('price')));
});

test('rows with missing side, date, quantity, or price are ignored with warning', () => {
  const rows = [headers, trade, ...[2, 3, 4, 5].map(index => { const row = [...trade]; row[index] = ''; return row; })];
  const result = parseRows(rows);
  assert.equal(result.transactions.length, 1);
  assert.ok(result.warnings.some(warning => warning.includes('Skipped 4 row(s)')));
});

test('invalid dates, numeric junk, incorrect grouping, zero/negative numbers and charges are rejected', () => {
  const invalid = [[2, '31/04/2026'], [4, '12abc'], [4, '1,2,3'], [4, '0'], [4, '-2'], [5, 'NaN'], [5, 'Infinity'], [5, '0'], [6, '-1'], [6, 'unknown'], [3, 'Dividend']];
  const result = parseRows([headers, ...invalid.map(([index, value]) => { const row = [...trade]; row[index] = value; return row; })]);
  assert.equal(result.transactions.length, 0);
  assert.ok(result.warnings.some(warning => warning.includes('No valid trades')));
});

test('mapping accepts header names and zero-based indexes', () => {
  const rows = [['Instrument', 'When', 'Action', 'Units', 'Execution', 'Fees'], ['ABC', '02/03/2026', 'S', '10', '20', '1']];
  const named = parseRows(rows, 'trades', { symbol: 'Instrument', date: 'When', side: 'Action', quantity: 'Units', price: 'Execution', charges: 'Fees' });
  // A custom header has no synonyms: index mapping supports a headerless export.
  const indexed = parseRows(rows.slice(1), 'trades', { symbol: 0, date: 1, side: 2, quantity: 3, price: 4, charges: 5 });
  assert.equal(indexed.transactions.length, 1);
  assert.equal(indexed.transactions[0].date, '2026-03-02');
  assert.equal(named.transactions.length, 1);
});

test('unknown usable rows request mapping, empty rows do not', () => {
  assert.equal(parseRows([['Something', 'Else'], ['a', 'b']]).mappingRequired, true);
  assert.equal(parseRows([]).mappingRequired, false);
  assert.equal(parseRows([[]]).mappingRequired, false);
});

test('preview can be remapped using names and mixed index assignments', () => {
  const unknown = parseRows([['ABC', '02/03/2026', 'Buy', '10', '20']]);
  assert.deepEqual(unknown.headers, ['Column 1', 'Column 2', 'Column 3', 'Column 4', 'Column 5']);
  const remapped = parseRows([unknown.headers, ...unknown.rows], 'trades', { symbol: 'Column 1', date: 1, side: 2, quantity: 3, price: 4 });
  assert.equal(remapped.transactions.length, 1);
  assert.equal(remapped.transactions[0].symbol, 'ABC');
  const invalidMapping = parseRows([headers, trade], 'trades', { price: 'Does not exist' });
  assert.equal(invalidMapping.mappingRequired, true);
  assert.equal(invalidMapping.transactions.length, 0);
});

test('holdings require quantity, retain missing average cost as null and never use total as cost', () => {
  const missing = parseRows([['Symbol', 'Quantity', 'Total'], ['ABC', 2, 100]], 'holdings');
  assert.equal(missing.mappingRequired, false);
  assert.deepEqual(missing.holdings, [{ symbol: 'ABC', isin: '', quantity: 2, avgPrice: null }]);
  assert.ok(missing.warnings.some(warning => warning.includes('cost is unknown')));
  const invalid = parseRows([['Symbol', 'Qty', 'Avg. price'], ['ABC', 0, 50], ['ABC', 2, 'bad'], ['ABC', 2, 50]], 'holdings');
  assert.equal(invalid.holdings.length, 1);
  assert.equal(invalid.transactions.length, 0);
  assert.ok(invalid.warnings.some(warning => warning.includes('Skipped 2')));
});

test('object rows, absent charges, repeated headers, and text safety', () => {
  const result = parseRows([{ Scrip: '<img src=x onerror=alert(1)>', Date: '03/04/2026', 'Buy/Sell': 'B', Qty: 3, Price: 10 }]);
  assert.equal(result.transactions[0].symbol, '<img src=x onerror=alert(1)>');
  assert.equal(result.transactions[0].charges, 0);
  assert.equal(parseRows([headers, trade, headers, trade]).transactions.length, 2);
});

test('row limit and file size are enforced before file reads', async () => {
  const result = parseRows([headers, ...Array.from({ length: MAX_ROWS + 2 }, () => trade)]);
  assert.equal(result.transactions.length, MAX_ROWS - 1);
  assert.ok(result.warnings.some(warning => warning.includes('Row limit')));
  const oversized = await parseStatement({ name: 'trades.csv', size: MAX_FILE_BYTES + 1, text() { throw new Error('must not read'); } });
  assert.deepEqual(oversized.transactions, []);
  assert.ok(oversized.warnings[0].includes('15 MB'));
  const unsupported = await parseStatement({ name: 'trades.exe', size: 12 });
  assert.ok(unsupported.warnings[0].includes('Unrecognised'));
});

test('execution status allowlist excludes cancelled, rejected, pending, unknown and blank orders', () => {
  const accepted = ['successful', 'EXECUTED', 'Complete', 'completed', 'filled'];
  const rejected = ['CANCELLED', 'canceled', 'rejected', 'pending', 'open', 'success', 'unsuccessful', '', 'PARTIALLY FILLED'];
  for (const statusHeader of ['Status', 'Order status', 'Execution status', 'Trade status', 'Transaction status']) {
    const result = parseRows([[...headers, statusHeader], ...[...accepted, ...rejected].map(status => [...trade, status])]);
    assert.equal(result.transactions.length, accepted.length, statusHeader);
    assert.ok(result.warnings.some(warning => warning.includes('execution status')));
    assert.ok(result.warnings.some(warning => warning.includes('partially filled')));
  }
});

test('partially filled orders use only explicit positive trade quantity, including with manual mapping', () => {
  const partialHeaders = [...headers, 'Order Status', 'Trade Qty', 'Execution Time'];
  const rows = [partialHeaders, [...trade, 'PARTIALLY FILLED', 5, '09:15:32'], [...trade, 'Filled', 8, '09:16:00'],
    [...trade, 'Cancelled', 3, '09:16:01'], [...trade, 'Rejected', 3, '09:16:02'],
    [...trade, 'Partially Filled', '', ''], [...trade, 'Partially Filled', 'bad', ''], [...trade, 'Partially Filled', 0, '']];
  const result = parseRows(rows);
  assert.deepEqual(result.transactions.map(row => row.quantity), [5, 8, 3]);
  assert.equal(result.transactions[0].tradeTime, '09:15:32');
  const remapped = parseRows([result.headers, ...result.rows], 'trades', { symbol: 0, date: 2, side: 3, quantity: 4, price: 5, charges: 6 });
  assert.deepEqual(remapped.transactions.map(row => row.quantity), [5, 8, 3]);
  assert.ok(result.warnings.some(warning => warning.includes('partially filled status without valid trade quantity')));
});

test('executed quantity synonyms beat order quantity and preserve optional tradeTime', () => {
  for (const quantityHeader of ['Executed Quantity', 'Filled Qty', 'Traded Quantity', 'Trade Quantity']) {
    const result = parseRows([['Stock name', 'Execution Date', 'Order side', 'Order Quantity', quantityHeader, 'Execution Price', 'Execution Status', 'Trade Time'],
      ['ABC', '02/03/2026', 'Buy', 100, 2, 10, 'executed', '12:00:01']]);
    assert.equal(result.transactions[0].quantity, 2, quantityHeader);
    assert.equal(result.transactions[0].tradeTime, '12:00:01');
  }
});

test('numeric preview mappings and a status-only recognised header retain safety checks', () => {
  const rows = [['Instrument', 'When', 'Action', 'Units', 'Execution', 'Order Status'],
    ['ABC', '02/03/2026', 'Buy', 10, 20, 'Cancelled'], ['ABC', '02/03/2026', 'Buy', 10, 20, 'Filled']];
  const preview = parseRows(rows);
  assert.deepEqual(preview.headers, rows[0]);
  const mapping = { symbol: '0', date: '1', side: '2', quantity: '3', price: '4' };
  const result = parseRows([preview.headers, ...preview.rows], 'trades', mapping);
  assert.equal(result.transactions.length, 1);
  assert.ok(result.warnings.some(warning => warning.includes('execution status')));
  const generic = parseRows([['ABC', '02/03/2026', 'Buy', 10, 20]]);
  const genericMapped = parseRows([generic.headers, ...generic.rows], 'trades', mapping);
  assert.equal(genericMapped.transactions.length, 1);
  assert.equal(genericMapped.transactions[0].chargesKnown, false);
  assert.ok(genericMapped.warnings.some(warning => warning.includes('Fees are unknown')));
});

test('holdings avgPrice headers and mappings are supported without applying order status', () => {
  const automatic = parseRows([['Symbol', 'Qty', 'avgPrice', 'Status'], ['ABC', 2, 50, 'Unknown']], 'holdings');
  assert.equal(automatic.holdings[0].avgPrice, 50);
  const mapped = parseRows([['Symbol', 'Qty', 'Cost'], ['ABC', 2, 50]], 'holdings', { avgPrice: 2 });
  assert.equal(mapped.holdings[0].avgPrice, 50);
});

async function dependency(name, context) {
  try { return await import(name); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    context.skip(`${name} not installed yet`);
    return null;
  }
}

test('local CSV supports metadata, quoted commas and escaped quotes', async context => {
  if (!await dependency('papaparse', context)) return;
  const text = 'Groww trade report\nClient,Example\nStock,Trade Date,Buy/Sell,Quantity,Trade Price,Charges,Status\n"ACME, ""India""",03/04/2026,BUY,"1,23,456","₹ 1,234.50",12,Filled\nABC,03/04/2026,BUY,10,50,0,Rejected\n';
  const result = await parseStatement(new File([text], 'trades.csv'));
  assert.equal(result.transactions.length, 1, result.warnings.join('\n'));
  assert.equal(result.transactions[0].symbol, 'ACME, "India"');
  assert.equal(result.transactions[0].quantity, 123456);
  assert.equal(result.transactions[0].price, 1234.5);
});

test('local CSV truncation produces a visible limit warning', async context => {
  if (!await dependency('papaparse', context)) return;
  const text = 'Stock,Trade Date,Buy/Sell,Quantity,Price\n' + 'ABC,03/04/2026,Buy,1,50\n'.repeat(MAX_ROWS + 5);
  const result = await parseStatement(new File([text], 'large.csv'));
  assert.equal(result.transactions.length, MAX_ROWS - 1);
  assert.ok(result.warnings.some(warning => warning.includes('Row limit exceeded')));
});

test('XLSX chooses the strongest trade sheet rather than a populated disclaimer or rejected orders', async context => {
  const XLSX = await dependency('xlsx', context);
  if (!XLSX) return;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Disclaimer'], ['For reference only']]), 'Disclaimer');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[...headers, 'Status'], [...trade, 'Rejected']]), 'Orders');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, trade]), 'One trade');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, trade, [...trade].map((cell, index) => index === 0 ? 'TCS' : cell)]), 'Trade report');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const result = await parseStatement(new File([bytes], 'trades.xlsx'));
  assert.deepEqual(result.transactions.map(row => row.symbol), ['RELIANCE', 'TCS']);
  assert.ok(result.warnings.some(warning => warning.includes('Selected worksheet "Trade report"')));
});

test('XLSX selects holdings independently and applies the 1904 date epoch on selected trades', async context => {
  const XLSX = await dependency('xlsx', context);
  if (!XLSX) return;
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { WBProps: { date1904: true } };
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Disclaimer'], ['Not a statement']]), 'Notes');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, trade.map((cell, index) => index === 2 ? 43830 : cell)]), 'Trades');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Symbol', 'Qty', 'avgPrice'], ['ABC', 2, 50], ['XYZ', 3, 20]]), 'Holdings');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const holdings = await parseStatement(new File([bytes], 'holdings.xlsx'), 'holdings');
  assert.equal(holdings.holdings.length, 2);
  assert.deepEqual(holdings.transactions, []);
  assert.ok(holdings.warnings.some(warning => warning.includes('Selected worksheet "Holdings"')));
  const trades = await parseStatement(new File([bytes], 'trades.xlsx'));
  assert.equal(trades.transactions[0].date, '2024-01-01');
});

test('XLSX physical row truncation is warned even when blank rows hide the limit', async context => {
  const XLSX = await dependency('xlsx', context);
  if (!XLSX) return;
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, trade]);
  XLSX.utils.sheet_add_aoa(sheet, [trade], { origin: `A${MAX_ROWS + 5}` });
  XLSX.utils.book_append_sheet(workbook, sheet, 'Trades');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const result = await parseStatement(new File([bytes], 'large.xlsx'));
  assert.equal(result.transactions.length, 1);
  assert.ok(result.warnings.some(warning => warning.includes('truncated') && warning.includes('Trades')));
});

test('PDF text preview returns joined text and never requests table mapping', async context => {
  const esbuild = await dependency('esbuild', context);
  if (!esbuild) return;
  // Exercise the actual importer with pdfjs text items; bundling stays in memory.
  const items = [{ str: 'Groww', transform: [1, 0, 0, 1, 0, 100] }, { str: '<preview>', transform: [1, 0, 0, 1, 50, 100], hasEOL: true },
    { str: 'Statement text', transform: [1, 0, 0, 1, 0, 80], hasEOL: true }];
  const bundled = await esbuild.build({
    stdin: { contents: await readFile(new URL('../src/importer.js', import.meta.url), 'utf8'), sourcefile: 'importer.js' }, tsconfigRaw: {},
    bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['xlsx', 'papaparse'],
    plugins: [{ name: 'local-pdf-text-fixture', setup(build) {
      build.onResolve({ filter: /^pdfjs-dist\// }, args => ({ path: args.path, namespace: 'pdf-fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'pdf-fixture' }, args => ({ contents: args.path.includes('worker') ? 'export default "/assets/pdf.worker.min.mjs";' :
        `export const GlobalWorkerOptions = {}; export function getDocument() { return {promise: Promise.resolve({numPages:1, async getPage(){return {async getTextContent(){return {items:${JSON.stringify(items)}}}, cleanup(){}}}, async destroy(){}}), async destroy(){}}; }`, loader: 'js' }));
    } }],
  });
  const importer = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const result = await importer.parseStatement(new File(['local test data'], 'preview.pdf'));
  assert.equal(result.text, 'Groww <preview>\nStatement text');
  assert.deepEqual(result.rows, [['Groww <preview>'], ['Statement text']]);
  assert.equal(result.mappingRequired, false);
  assert.deepEqual(result.transactions, []);
  assert.deepEqual(result.holdings, []);
  assert.ok(result.warnings.some(warning => warning.includes('preview only')));
});

const orderHeaders = ['Stock name', 'Symbol', 'ISIN', 'Type', 'Quantity', 'Value', 'Exchange', 'Exchange Order Id', 'Execution date'];
const orderRow = ['Synthetic Components Ltd', 'SYNCOMP', 'INE000S01003', 'BUY', 4, 1000, 'NSE', '000012345678901234567890', '03-04-2026 09:15:32'];

test('strict dash dates and timestamps validate calendar, clock and timezone without guessing', () => {
  for (const text of ['03-04-2026', '03-04-2026 09:15', '03-04-2026 09:15:32', '03/04/2026 9:15:32 AM', '2026-04-03 09:15:32', '2026-04-03T09:15:32.123+05:30']) {
    assert.equal(normalizeDate(text), '2026-04-03', text);
  }
  for (const text of ['04-13-2026', '31-04-2026', '29-02-2025', '03-04/2026', '03-04-26', '03-04-2026 garbage', '03-04-2026 24:00:00', '03-04-2026 09:60:00', '03-04-2026 00:15 AM', '2026-04-03T09:15:32+14:01']) {
    assert.equal(normalizeDate(text), null, text);
  }
  const timestamp = parseRows([orderHeaders, orderRow]).transactions[0];
  assert.equal(timestamp.tradeTime, '09:15:32');
  assert.equal(timestamp.executionDateTime, '2026-04-03T09:15:32');
  const dateOnly = parseRows([orderHeaders, orderRow.map((cell, index) => index === 8 ? '03-04-2026' : cell)]).transactions[0];
  assert.equal(dateOnly.tradeTime, '');
  assert.equal(dateOnly.executionDateTime, undefined);
});

test('synthetic Groww CSV keeps Symbol, gross Value, metadata, row provenance and separate identical fills', async context => {
  if (!await dependency('papaparse', context)) return;
  const bytes = await readFile(new URL('./fixtures/groww-order-history-synthetic.csv', import.meta.url));
  const result = await parseStatement(new File([bytes], 'groww-order-history.csv'));
  assert.equal(result.fatal, false, result.blockingErrors.join('\n'));
  assert.equal(result.mappingRequired, false, result.warnings.join('\n'));
  assert.equal(result.transactions.length, 3);
  assert.equal(result.headerRow, 5);
  assert.deepEqual(result.metadataRows.slice(0, 3), [['Name', 'Synthetic Investor'], ['UniqueClientCode', 'SYNTH-CLIENT-001'], ['Orderhistory']]);
  assert.equal(result.columns.symbol, 1);
  assert.equal(result.columns.name, 0);
  assert.equal(result.columns.tradeValue, 5);
  assert.equal(result.columns.price, undefined);
  assert.deepEqual(result.transactions.map(row => row.sourceRow), [6, 7, 8]);
  assert.deepEqual(result.transactions.map(row => row.price), [250, 250, 270]);
  assert.deepEqual(result.transactions.map(row => row.tradeValue), [1000, 1000, 540]);
  assert.equal(result.transactions[0].name, 'Aster, Laboratories Limited');
  assert.equal(result.transactions[0].symbol, 'ASTER');
  assert.equal(result.transactions[0].isin, 'INE000S01001');
  assert.equal(result.transactions[0].exchange, 'NSE');
  assert.deepEqual(result.transactions.map(row => row.exchangeOrderId), ['000000100001', '000000100002', '000000100003']);
  assert.ok(result.transactions.every(row => row.orderId === undefined));
  assert.ok(result.transactions.every(row => row.chargesKnown === false && row.charges === 0 && row.priceSource === 'trade-value'));
  assert.ok(result.warnings.some(warning => warning.includes('unknown, not confirmed zero')));
  assert.equal(result.sourceRows.length, 4);
  assert.equal(result.rowIssues.length, 1);
  assert.equal(result.rowIssues[0].sourceRow, 9);
  assert.equal(result.rowIssues[0].code, 'invalid-row');
  assert.ok(result.rowIssues[0].reasons.includes('buy/sell side'));
  assert.deepEqual(result.blockingErrors, []);
  const again = parseRows(result, 'trades', { tradeValue: 'Value' });
  assert.deepEqual(again.transactions, result.transactions);
});

test('unit price has precedence only when valid and gross Value must reconcile to executed quantity', () => {
  const result = parseRows([[...orderHeaders, 'Price', 'Charges'], [...orderRow, 250, 2], [...orderRow, '', 0], [...orderRow, 200, 0], [...orderRow, 'bad', 0]]);
  assert.equal(result.transactions.length, 2);
  assert.deepEqual(result.transactions.map(row => row.priceSource), ['unit-price', 'trade-value']);
  assert.ok(result.transactions.every(row => row.chargesKnown));
  assert.equal(result.transactions[1].charges, 0);
  assert.ok(result.rowIssues[0].reasons.includes('conflicting price/value'));
  assert.ok(result.rowIssues[1].reasons.includes('price'));
  const rounded = parseRows([[...orderHeaders, 'Price'], [...orderRow.map((cell, index) => index === 5 ? 999.9999999999999 : cell), 250]]);
  assert.equal(rounded.transactions.length, 1);
  const minorConflict = parseRows([[...orderHeaders, 'Price'], [...orderRow.map((cell, index) => index === 5 ? 1000.01 : cell), 250]]);
  assert.equal(minorConflict.transactions.length, 0);
});

test('value/price mapping aliases work and holdings market Value never becomes acquisition cost', () => {
  const custom = [['Instrument', 'When', 'Action', 'Units', 'Consideration'], ['SYNCOMP', '03-04-2026', 'BUY', 4, 1000]];
  for (const mappedField of ['tradeValue', 'value']) {
    const result = parseRows(custom, 'trades', { symbol: 0, date: 1, side: 2, quantity: 3, [mappedField]: 4 });
    assert.equal(result.transactions[0].price, 250, mappedField);
    assert.equal(result.transactions[0].tradeValue, 1000);
    assert.equal(result.columns.tradeValue, 4);
  }
  const missing = parseRows([['Stock name', 'Symbol', 'Quantity', 'Value'], ['Synthetic Components Ltd', 'SYNCOMP', 4, 1000]], 'holdings');
  assert.equal(missing.mappingRequired, false);
  assert.deepEqual(missing.holdings, [{ symbol: 'SYNCOMP', isin: '', quantity: 4, avgPrice: null, name: 'Synthetic Components Ltd' }]);
  const unsafeMapping = parseRows([missing.headers, ...missing.rows], 'holdings', { price: 'Value' });
  assert.deepEqual(unsafeMapping.holdings, missing.holdings);
  const priced = parseRows([['Stock name', 'Symbol', 'Qty', 'Value', 'Average buy price'], ['Synthetic Components Ltd', 'SYNCOMP', 4, 1500, 250]], 'holdings');
  assert.deepEqual(priced.holdings, [{ symbol: 'SYNCOMP', isin: '', quantity: 4, avgPrice: 250, name: 'Synthetic Components Ltd' }]);
});

test('partial fills with total Value require explicit executed quantity and keep status safeguards after mapping', () => {
  const data = [[...orderHeaders, 'Executed Quantity', 'Order Status', 'Order Id', 'Trade Id'],
    [...orderRow.map((cell, index) => index === 4 ? 100 : index === 5 ? 500 : cell), 2, 'Partially Filled', '0012', '00031'],
    [...orderRow, '', 'Partially Filled', '0013', '00032'],
    [...orderRow, 0, 'Partially Filled', '0014', '00033'],
    [...orderRow, 4, 'Rejected', '0015', '00034'],
    [...orderRow, 4, '', '0016', '00035']];
  const result = parseRows(data);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].quantity, 2);
  assert.equal(result.transactions[0].price, 250);
  assert.equal(result.transactions[0].orderId, '0012');
  assert.equal(result.transactions[0].tradeId, '00031');
  assert.equal(result.rowIssues.length, 4);
  const remapped = parseRows(result, 'trades', { quantity: 'Quantity', tradeValue: 'Value' });
  assert.equal(remapped.transactions.length, 1);
  assert.equal(remapped.transactions[0].quantity, 2);
  const noExecutedQuantity = parseRows([[...orderHeaders, 'Status'], [...orderRow, 'Partially Filled']]);
  assert.equal(noExecutedQuantity.transactions.length, 0);
});

test('invalid/nonfinite/negative/zero Value or unit price and numeric overflow are never guessed', () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity, 'NaN', 'Infinity', '12junk', '1,2,3', '']) {
    const result = parseRows([orderHeaders, orderRow.map((cell, index) => index === 5 ? value : cell)]);
    assert.equal(result.transactions.length, 0, String(value));
    assert.equal(result.rowIssues[0].code, 'invalid-row');
  }
  for (const price of [0, -1, NaN, Infinity, 'bad']) {
    const result = parseRows([[...orderHeaders, 'Price'], [...orderRow, price]]);
    assert.equal(result.transactions.length, 0, String(price));
  }
  const overflow = parseRows([headers, ['SYNCOMP', '', '03-04-2026', 'BUY', 2, 1e308, 0]]);
  assert.equal(overflow.transactions.length, 0);
  const underflow = parseRows([orderHeaders, orderRow.map((cell, index) => index === 4 ? 1e308 : index === 5 ? Number.MIN_VALUE : cell)]);
  assert.equal(underflow.transactions.length, 0);
});

test('conflicting duplicate price/value headers cannot bypass reconciliation by manual mapping', () => {
  for (const extra of [['Trade Value', 900], ['Trade Price', 200]]) {
    const result = parseRows([[...orderHeaders, 'Price', extra[0]], [...orderRow, 250, extra[1]]], 'trades', { price: 'Price', tradeValue: 'Value' });
    assert.equal(result.transactions.length, 0, extra[0]);
    assert.ok(result.rowIssues[0].reasons.some(reason => reason.includes('conflicting')));
  }
});

test('fees are known only for a supplied valid fee including explicit zero', () => {
  const result = parseRows([[...orderHeaders, 'Charges'], [...orderRow, ''], [...orderRow, 0], [...orderRow, 2.5], [...orderRow, 'bad'], [...orderRow, -1]]);
  assert.deepEqual(result.transactions.map(row => row.chargesKnown), [false, true, true]);
  assert.deepEqual(result.transactions.map(row => row.charges), [0, 0, 2.5]);
  assert.equal(result.rowIssues.length, 2);
  assert.ok(result.warnings.some(warning => warning.includes('1 imported trade')));
});

test('source rows include blank gaps and unsupported records; ticker-like footers are never dropped', () => {
  const result = parseRows([['Name', 'Synthetic Investor'], [], orderHeaders, [], orderRow,
    ['Notes Limited', 'NOTE', '', 'BUY', 4, 1000, 'NSE', 'one', '03-04-2026'],
    ['Total Components Ltd', 'TOTAL', '', 'BUY', 4, 1000, 'NSE', 'two', '03-04-2026'],
    ['Unsupported', 'OTHER', '', 'Split', 4, 1000, 'NSE', 'three', '03-04-2026'], orderHeaders, ['Disclaimer: synthetic only']]);
  assert.deepEqual(result.transactions.map(row => row.sourceRow), [5, 6, 7]);
  assert.deepEqual(result.rowIssues.map(issue => [issue.sourceRow, issue.code]), [[8, 'invalid-row'], [9, 'repeated-header'], [10, 'footer']]);
  assert.equal(result.rows.length, 6);
  assert.equal(result.sourceRows.length, 6);
});

test('stable text identifiers keep leading zeros and long IDs; lossy Excel numeric IDs are rejected', () => {
  const good = parseRows([orderHeaders, orderRow]).transactions[0];
  assert.equal(good.exchangeOrderId, '000012345678901234567890');
  const bad = parseRows([orderHeaders, orderRow.map((cell, index) => index === 7 ? 12345678901234567890 : cell)]);
  assert.equal(bad.transactions.length, 0);
  assert.ok(bad.rowIssues[0].reasons.some(reason => reason.includes('unsafe exchangeOrderId')));
});

test('actual times normalize to HH:mm:ss; missing/invalid/conflicting optional clocks remain unknown', () => {
  const dateOnly = orderRow.map((cell, index) => index === 8 ? '03-04-2026' : cell);
  const result = parseRows([[...orderHeaders, 'Trade Time'], [...dateOnly, '9:15 AM'], [...dateOnly, '09:15:32.125+05:30'], [...dateOnly, ''], [...dateOnly, '24:00:00'], [...orderRow, '10:15:32']]);
  assert.deepEqual(result.transactions.map(row => row.tradeTime), ['09:15:00', '09:15:32', '', '', '']);
  assert.equal(result.transactions[1].executionDateTime, '2026-04-03T09:15:32.125+05:30');
  assert.equal(result.rowIssues.length, 2);
  assert.ok(result.rowIssues.every(issue => issue.code === 'unknown-time'));
  assert.ok(result.warnings.some(warning => warning.includes('Execution time is unknown')));
  assert.equal(result.transactions[4].executionDateTime, undefined);
});

test('malformed CSV is fatal and both preview remapping paths remain blocked', async context => {
  if (!await dependency('papaparse', context)) return;
  const text = 'Symbol,Date,Side,Quantity,Price\n"BROKEN,03-04-2026,BUY,2,10\n';
  const result = await parseStatement(new File([text], 'broken.csv'));
  assert.equal(result.fatal, true);
  assert.equal(result.mappingRequired, false);
  assert.deepEqual(result.transactions, []);
  assert.ok(result.blockingErrors.some(error => error.includes('Malformed CSV')));
  const mapping = { symbol: 0, date: 1, side: 2, quantity: 3, price: 4 };
  for (const input of [result, [result.headers, ...result.rows]]) {
    const remapped = parseRows(input, 'trades', mapping);
    assert.equal(remapped.fatal, true);
    assert.deepEqual(remapped.transactions, []);
    assert.ok(remapped.blockingErrors.length);
  }
});

test('extra CSV columns are retained as rejected rows instead of shifted or silently imported', async context => {
  if (!await dependency('papaparse', context)) return;
  const text = 'Symbol,Date,Side,Quantity,Price\nSYNCOMP,03-04-2026,BUY,2,10,unexpected\nSYNCOMP,03-04-2026,BUY,2,10\n';
  const result = await parseStatement(new File([text], 'extra-column.csv'));
  assert.equal(result.transactions.length, 1);
  assert.equal(result.rowIssues.length, 1);
  assert.ok(result.rowIssues[0].reasons.includes('unexpected extra columns'));
  assert.equal(result.rowIssues[0].row[5], 'unexpected');
});

test('generated real XLSX bytes handle Groww metadata, typed total Value, dates, IDs, times and omitted sheets', async context => {
  const XLSX = await dependency('xlsx', context);
  if (!XLSX) return;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Disclaimer'], ['Synthetic workbook for importer tests']]), 'Notes');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[], ['Name', 'Synthetic Investor'], ['UniqueClientCode', 'SYNTH-XLSX-001'], ['Orderhistory'], [],
    [...orderHeaders, 'Executed Quantity', 'Status', 'Order Id', 'Trade Id', 'Charges'],
    [...orderRow.map((cell, index) => index === 4 ? 20 : index === 5 ? 500 : index === 8 ? 45292.5 : cell), 2, 'Partially filled', '001', 'TRADE-001', ''],
    [...orderRow, 4, 'Executed', '002', 'TRADE-002', 0], [...orderRow, 4, 'Rejected', '003', 'TRADE-003', 0]]), 'Groww history');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([orderHeaders, orderRow]), 'Other trades');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const file = new File([bytes], 'synthetic-groww.xlsx');
  const result = await parseStatement(file);
  assert.equal(result.selectedSheet, 'Groww history');
  assert.equal(result.transactions.length, 2, result.warnings.join('\n'));
  assert.equal(result.headerRow, 6);
  assert.deepEqual(result.transactions.map(row => row.sourceRow), [7, 8]);
  assert.equal(result.transactions[0].price, 250);
  assert.equal(result.transactions[0].tradeValue, 500);
  assert.equal(result.transactions[0].date, '2024-01-01');
  assert.equal(result.transactions[0].tradeTime, '12:00:00');
  assert.equal(result.transactions[0].chargesKnown, false);
  assert.equal(result.transactions[1].chargesKnown, true);
  assert.equal(result.transactions[0].orderId, '001');
  assert.equal(result.transactions[0].tradeId, 'TRADE-001');
  assert.equal(result.transactions[0].exchangeOrderId, '000012345678901234567890');
  assert.equal(result.columns.quantity, 9);
  assert.equal(result.columns.tradeValue, 5);
  assert.deepEqual(result.worksheets.map(sheet => [sheet.name, sheet.validCount, sheet.invalidCount, sheet.selected]), [['Notes', 0, 0, false], ['Groww history', 2, 1, true], ['Other trades', 1, 0, false]]);
  assert.ok(result.warnings.some(warning => warning.includes('Other worksheets were not imported') && warning.includes('Other trades')));
  const explicit = await parseStatement(file, 'trades', { sheetName: 'Other trades' });
  assert.equal(explicit.selectedSheet, 'Other trades');
  assert.equal(explicit.transactions.length, 1);
  const absent = await parseStatement(file, 'trades', { sheetName: 'Absent' });
  assert.equal(absent.fatal, true);
});

test('generated XLSX hidden sheets are excluded from automatic selection and ties use workbook order', async context => {
  const XLSX = await dependency('xlsx', context);
  if (!XLSX) return;
  const workbook = XLSX.utils.book_new();
  for (const [name, count] of [['Hidden orders', 3], ['Visible first', 1], ['Visible second', 1]]) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([orderHeaders, ...Array.from({ length: count }, () => orderRow)]), name);
  workbook.Workbook = { Sheets: [{ Hidden: 1 }, { Hidden: 0 }, { Hidden: 0 }] };
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const file = new File([bytes], 'hidden.xlsx');
  const automatic = await parseStatement(file);
  assert.equal(automatic.selectedSheet, 'Visible first');
  assert.equal(automatic.worksheets[0].hidden, true);
  assert.equal(automatic.worksheets[0].validCount, 3);
  const explicit = await parseStatement(file, 'trades', { sheetName: 'Hidden orders' });
  assert.equal(explicit.selectedSheet, 'Hidden orders');
  assert.equal(explicit.transactions.length, 3);
});

test('overlapping numeric mappings block import and known gross aliases cannot become unit price', () => {
  const overlapping = parseRows([headers, trade], 'trades', { quantity: 'Trade Price' });
  assert.equal(overlapping.mappingRequired, true);
  assert.deepEqual(overlapping.transactions, []);
  assert.ok(overlapping.blockingErrors.some(error => error.includes('distinct columns')));
  const gross = parseRows([['Symbol', 'Execution date', 'Type', 'Quantity', 'Executed Value'], ['SYNCOMP', '03-04-2026', 'BUY', 4, 1000]], 'trades', { price: 'Executed Value' });
  assert.equal(gross.transactions[0].price, 250);
  assert.equal(gross.transactions[0].priceSource, 'trade-value');
  assert.equal(gross.columns.price, undefined);
});

test('TSV and object rows retain actual fees, identifiers, and optional fields absent from first object', async context => {
  if (!await dependency('papaparse', context)) return;
  const text = 'Symbol\tExecution date\tType\tQuantity\tValue\tFees\tTrade Id\tTrade Time\nSYNCOMP\t03-04-2026\tBUY\t4\t1,000.00\t0\t000031\t00:00:00\n';
  const tsv = await parseStatement(new File([text], 'synthetic.tsv'));
  assert.equal(tsv.transactions.length, 1, tsv.warnings.join('\n'));
  assert.equal(tsv.transactions[0].chargesKnown, true);
  assert.equal(tsv.transactions[0].tradeId, '000031');
  assert.equal(tsv.transactions[0].tradeTime, '00:00:00');
  const objects = parseRows([{ Symbol: 'SYNCOMP', Date: '03-04-2026', Type: 'BUY', Quantity: 4, Value: 1000 },
    { Symbol: 'SYNCOMP', Date: '03-04-2026', Type: 'BUY', Quantity: 4, Value: 1000, Fees: 2, 'Trade Id': '000032', 'Company Name': 'Synthetic Components Ltd' }]);
  assert.equal(objects.transactions[0].chargesKnown, false);
  assert.equal(objects.transactions[1].chargesKnown, true);
  assert.equal(objects.transactions[1].tradeId, '000032');
  assert.equal(objects.transactions[1].name, 'Synthetic Components Ltd');
});

test('quantity-only holdings keep null average acquisition price and reject invalid supplied costs', () => {
  const result = parseRows([['Stock name', 'Symbol', 'ISIN', 'Quantity', 'Holding Value', 'Exchange'],
    ['Synthetic Components Ltd', 'SYNCOMP', 'INE000S01003', 4, 1500, 'NSE']], 'holdings');
  assert.equal(result.mappingRequired, false);
  assert.deepEqual(result.holdings, [{ symbol: 'SYNCOMP', isin: 'INE000S01003', quantity: 4, avgPrice: null, name: 'Synthetic Components Ltd', exchange: 'NSE' }]);
  assert.deepEqual(result.transactions, []);
  assert.deepEqual(result.blockingErrors, []);
  assert.ok(result.warnings.some(warning => warning.includes('avgPrice=null')));
  const costs = parseRows([['Symbol', 'Quantity', 'Average Buy Price'], ['SYNCOMP', 4, ''], ['SYNCOMP', 4, 250], ['SYNCOMP', 4, 0], ['SYNCOMP', 4, -1], ['SYNCOMP', 4, NaN], ['SYNCOMP', 4, Infinity]], 'holdings');
  assert.deepEqual(costs.holdings.map(row => row.avgPrice), [null, 250]);
  assert.equal(costs.rowIssues.filter(issue => issue.code === 'invalid-row').length, 4);
});

test('generated XLSX holdings can omit average acquisition cost and retain quantity-only snapshots', async context => {
  const XLSX = await dependency('xlsx', context);
  if (!XLSX) return;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Holdings'], ['Stock name', 'Symbol', 'ISIN', 'Quantity', 'Value'], ['Synthetic Components Ltd', 'SYNCOMP', 'INE000S01003', 4, 1500]]), 'Current holdings');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const result = await parseStatement(new File([bytes], 'holdings.xlsx'), 'holdings');
  assert.equal(result.selectedSheet, 'Current holdings');
  assert.equal(result.mappingRequired, false);
  assert.equal(result.holdings.length, 1);
  assert.equal(result.holdings[0].avgPrice, null);
  assert.equal(result.holdings[0].quantity, 4);
  assert.equal(result.holdings[0].symbol, 'SYNCOMP');
  assert.ok(result.warnings.some(warning => warning.includes('cost is unknown')));
});

test('current Groww execution date-time header and exchange order ID map without collision', () => {
  const result = parseRows([
    ['Stock name', 'Symbol', 'ISIN', 'Type', 'Quantity', 'Value', 'Exchange', 'Exchange Order Id', 'Execution date and time', 'Order status'],
    ['Synthetic Components Ltd', 'SYNCOMP', 'INE000S01003', 'BUY', 4, 1000, 'NSE', '000012345678901234567890', '01-01-2026 09:15:30', 'Executed'],
  ]);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].date, '2026-01-01');
  assert.equal(result.transactions[0].tradeTime, '09:15:30');
  assert.equal(result.transactions[0].exchangeOrderId, '000012345678901234567890');
  assert.equal(result.transactions[0].orderId, undefined);
  assert.equal(result.transactions[0].price, 250);
});

test('Groww P&L and capital-gains summaries are fatal trade sources and cannot be remapped', () => {
  const rows=[['Stock name','ISIN','Quantity','Buy date','Buy price','Buy value','Sell date','Sell price','Sell value','Realised P&L','Remark'],['Synthetic','SYNTH',1,'01-01-2026',100,100,'02-01-2026',110,110,10,'']];
  const preview=parseRows(rows,'trades');
  assert.equal(preview.fatal,true);
  assert.equal(preview.transactions.length,0);
  assert.match(preview.blockingErrors[0],/not Stocks Order History/);
  assert.equal(parseRows(preview,'trades',{symbol:0,date:3,side:10,quantity:2,price:4}).fatal,true);
});

test('cancelled/expired orders retain proven executions, warn, and reject ambiguous generic Value', () => {
  const terminatedHeaders = [...orderHeaders, 'Executed Quantity', 'Order Status', 'Execution Price'];
  const proven = parseRows([terminatedHeaders,
    [...orderRow.map((cell, index) => index === 4 ? 100 : index === 5 ? 500 : cell), 2, 'Cancelled', 250],
    [...orderRow.map((cell, index) => index === 4 ? 100 : index === 5 ? 600 : cell), 3, 'Expired', 200],
    [...orderRow.map((cell, index) => index === 4 ? 100 : index === 5 ? 500 : cell), 2, 'Canceled', 250]]);
  assert.deepEqual(proven.transactions.map(row => row.quantity), [2, 3, 2]);
  assert.deepEqual(proven.transactions.map(row => row.price), [250, 200, 250]);
  assert.equal(proven.rowIssues.length, 3);
  assert.ok(proven.rowIssues.every(issue => issue.code === 'executed-terminated-order'));
  assert.ok(proven.warnings.some(warning => warning.includes('Retained 3 executed fill')));
  assert.equal(proven.transactions[0].status, 'Cancelled');
  assert.deepEqual(parseRows(proven, 'trades', { quantity: 'Quantity', price: 'Execution Price' }).transactions, proven.transactions);
  const ambiguous = parseRows([[...orderHeaders, 'Executed Quantity', 'Status'], [...orderRow, 2, 'Cancelled'], [...orderRow, 2, 'Expired']]);
  assert.equal(ambiguous.transactions.length, 0);
  assert.equal(ambiguous.rowIssues.length, 2);
  assert.ok(ambiguous.rowIssues.every(issue => issue.reasons.includes('cancelled/expired order has ambiguous executed price/value basis')));
  const labelledValue = parseRows([[...orderHeaders.map(header => header === 'Value' ? 'Trade Value' : header), 'Executed Quantity', 'Status'],
    [...orderRow.map((cell, index) => index === 4 ? 100 : index === 5 ? 500 : cell), 2, 'Cancelled']]);
  assert.equal(labelledValue.transactions.length, 1);
  assert.equal(labelledValue.transactions[0].price, 250);
});

test('cancelled/expired order rows without executed quantity or with conflicting consideration remain rejected', () => {
  for (const status of ['Cancelled', 'Expired']) {
    const noQuantity = parseRows([[...orderHeaders, 'Status', 'Execution Price'], [...orderRow, status, 250]]);
    assert.equal(noQuantity.transactions.length, 0);
    const rows = parseRows([[...orderHeaders, 'Executed Quantity', 'Status', 'Execution Price'], [...orderRow, 0, status, 250], [...orderRow, 2, status, 250]]);
    assert.equal(rows.transactions.length, 0);
    assert.equal(rows.rowIssues.length, 2);
    assert.ok(rows.rowIssues[1].reasons.some(reason => reason.includes('conflicting price/value')));
  }
});
