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
  assert.deepEqual(result.transactions[0], { symbol: 'RELIANCE', isin: 'INE002A01018', date: '2026-04-03', side: 'BUY', quantity: 1250, price: 1234.5, charges: 12.5, purpose: 'core' });
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

test('holdings require quantity and average cost and never use trade total as cost', () => {
  const missing = parseRows([['Symbol', 'Quantity', 'Total'], ['ABC', 2, 100]], 'holdings');
  assert.equal(missing.mappingRequired, true);
  assert.deepEqual(missing.holdings, []);
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
  assert.deepEqual(result.transactions.map(row => row.quantity), [5, 8]);
  assert.equal(result.transactions[0].tradeTime, '09:15:32');
  const remapped = parseRows([result.headers, ...result.rows], 'trades', { symbol: 0, date: 2, side: 3, quantity: 4, price: 5, charges: 6 });
  assert.deepEqual(remapped.transactions.map(row => row.quantity), [5, 8]);
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
  assert.deepEqual(genericMapped.warnings, []);
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
