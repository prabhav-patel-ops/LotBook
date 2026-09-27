/**
 * Local-only statement import API (browser ESM).
 * parseStatement(File, kind = 'trades') -> Promise<ImportResult>
 * parseRows(Array<Array|Object>, kind = 'trades', mapping = null) -> ImportResult
 * mapping: {symbol, date, side, quantity, price, charges}; values are header names
 * or zero-based column indexes (numeric strings also accepted). Optional mappings:
 * isin, tradeTime, status, tradeQuantity, avgPrice (holdings alias for price).
 * Transactions: {symbol, isin, date: 'YYYY-MM-DD', side: 'BUY'|'SELL',
 *                quantity, price, charges, purpose: 'core', tradeTime?};
 * holdings: {symbol, isin, quantity, avgPrice}.
 * ImportResult: {transactions, holdings, warnings, headers, rows, mappingRequired}.
 * headers/rows are plain preview data, never HTML. Duplicate detection belongs to caller.
 * To remap a preview: parseRows([result.headers, ...result.rows], kind, mapping).
 * normalizeDate(value) returns 'YYYY-MM-DD' or null for invalid/unsupported dates.
 * PDFs additionally return text, with mappingRequired=false (text is not a table).
 * Status columns restrict trades to successful/executed/complete/completed/filled.
 * Partially filled rows require an explicit executed/trade quantity column.
 */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_ROWS = 20000;

const aliases = {
  symbol: ['stock', 'scrip', 'symbol', 'stock name', 'scrip name', 'security', 'security name', 'company name', 'trading symbol'],
  isin: ['isin', 'isin code'],
  date: ['trade date', 'execution date', 'executed date', 'transaction date', 'date'],
  side: ['buy/sell', 'buy / sell', 'buy sell', 'trade type', 'transaction type', 'order side', 'side', 'type'],
  quantity: ['quantity', 'qty', 'holding quantity', 'holdings quantity', 'shares', 'order quantity', 'order qty'],
  tradeQuantity: ['trade quantity', 'trade qty', 'traded quantity', 'traded qty', 'executed quantity', 'executed qty', 'filled quantity', 'filled qty'],
  price: ['trade price', 'execution price', 'executed price', 'average execution price', 'price', 'unit price', 'rate'],
  avgPrice: ['avgprice', 'avg price', 'average price', 'avg buy price', 'average buy price', 'average purchase price', 'avg cost', 'average cost', 'cost price', 'buy price', 'purchase price', 'price'],
  charges: ['total charges', 'charges', 'transaction charges'],
  tradeTime: ['trade time', 'execution time', 'executed time', 'transaction time', 'tradetime', 'time'],
  status: ['execution status', 'trade status', 'order status', 'transaction status', 'status'],
};
const key = value => String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[_.\-]+/g, ' ').replace(/\s+/g, ' ');
const blank = value => value == null || String(value).trim() === '';
const emptyResult = () => ({ transactions: [], holdings: [], warnings: [], headers: [], rows: [], mappingRequired: false });

function calendarDate(year, month, day) {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Strict day-first dates, ISO dates/timestamps, Date objects, or Excel 1900 serials. */
export function normalizeDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : calendarDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value >= 2958466 || Math.floor(value) === 60) return null;
    const days = Math.floor(value);
    const date = new Date(Date.UTC(1899, 11, 31) + (days > 60 ? days - 1 : days) * 86400000);
    return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const indian = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (indian) return calendarDate(Number(indian[3]), Number(indian[2]), Number(indian[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(text);
  if (!iso || (text.includes('T') && !Number.isFinite(Date.parse(text)))) return null;
  return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
}

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || blank(value)) return null;
  const text = value.trim().replace(/^(?:₹|INR\s*|Rs\.?\s*)/i, '').trim();
  // Accept ungrouped, Western, and Indian grouping; never parse partial numbers.
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function fieldsFor(kind) {
  return kind === 'holdings' ? ['symbol', 'quantity', 'price'] : ['symbol', 'date', 'side', 'quantity', 'price'];
}

function inferColumns(headers, kind) {
  const normalized = headers.map(key);
  const columns = {};
  for (const field of [...fieldsFor(kind), 'isin', 'charges', ...(kind === 'trades' ? ['tradeQuantity', 'tradeTime', 'status'] : [])]) {
    const choices = field === 'price' && kind === 'holdings' ? aliases.avgPrice : aliases[field];
    // Prefer the specific average-price synonym over generic Price in holdings.
    const found = choices.map(choice => normalized.indexOf(choice)).find(index => index >= 0);
    if (found !== undefined) columns[field] = found;
  }
  if (kind === 'trades' && columns.tradeQuantity !== undefined) columns.quantity = columns.tradeQuantity;
  return columns;
}

function footer(row) {
  const first = row.find(value => !blank(value));
  return /^(?:grand total|sub total|subtotal|total|totals|disclaimer|note|notes|summary)(?:\s|:|$)/i.test(String(first ?? '').trim());
}

export function parseRows(input, kind = 'trades', mapping = null) {
  const result = emptyResult();
  if (!['trades', 'holdings'].includes(kind)) {
    result.warnings.push(`Unrecognised import kind: ${String(kind)}. Use trades or holdings.`);
    return result;
  }
  if (!Array.isArray(input) || !input.length) {
    result.warnings.push('No statement rows found. CSV or XLSX is preferred.');
    return result;
  }
  let source = input;
  if (source[0] && !Array.isArray(source[0]) && typeof source[0] === 'object') {
    const headers = Object.keys(source[0]);
    source = [headers, ...source.map(row => headers.map(header => row?.[header] ?? ''))];
  }
  if (source.length > MAX_ROWS) result.warnings.push(`Row limit exceeded. Only the first ${MAX_ROWS.toLocaleString('en-IN')} rows were considered.`);
  source = source.slice(0, MAX_ROWS).map(row => Array.isArray(row) ? row : []);
  let headerIndex = -1;
  let bestScore = 1;
  const namedSelections = mapping && typeof mapping === 'object' ? Object.values(mapping).filter(value => typeof value === 'string' && !/^\d+$/.test(value)).map(key) : [];
  for (let i = 0; i < source.length; i++) {
    const inferred = inferColumns(source[i], kind);
    const normalized = source[i].map(key);
    const namedMatches = namedSelections.filter(name => normalized.includes(name)).length;
    const score = Math.max(Object.keys(inferred).length, namedMatches);
    const generatedHeader = mapping && source[i].length > 0 && source[i].every((cell, index) => cell === `Column ${index + 1}`);
    if (score > bestScore || ((namedMatches > 0 || generatedHeader || inferred.status !== undefined) && headerIndex < 0)) { headerIndex = i; bestScore = Math.max(1, score); }
    if (fieldsFor(kind).every(field => inferred[field] !== undefined)) { headerIndex = i; break; }
  }
  if (headerIndex >= 0) result.headers = source[headerIndex].map(value => String(value ?? '').trim());
  const width = source.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  if (headerIndex < 0) result.headers = Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  let columns = inferColumns(result.headers, kind);
  // Preserve inferred safety checks even when only core columns are remapped.
  const statusColumns = result.headers.flatMap((header, index) => aliases.status.includes(key(header)) ? [index] : []);
  if (mapping && typeof mapping === 'object') {
    // Explicit mappings override inference, including explicit invalid assignments.
    for (const [mappedField, selection] of Object.entries(mapping)) {
      const field = mappedField === 'avgPrice' && kind === 'holdings' ? 'price' : mappedField;
      if (![...fieldsFor(kind), 'isin', 'charges', ...(kind === 'trades' ? ['tradeQuantity', 'tradeTime', 'status'] : [])].includes(field)) continue;
      const index = Number.isInteger(selection) ? selection : typeof selection === 'string' && /^\d+$/.test(selection) ? Number(selection) : typeof selection === 'string' ? result.headers.findIndex(header => key(header) === key(selection)) : -1;
      if (index >= 0 && index < width) columns[field] = index;
      else delete columns[field];
    }
  }
  if (columns.status !== undefined && !statusColumns.includes(columns.status)) statusColumns.push(columns.status);
  const data = source.slice(headerIndex + 1).filter(row => row.some(value => !blank(value)));
  result.rows = data;
  const missing = fieldsFor(kind).filter(field => columns[field] === undefined);
  if (missing.length) {
    result.mappingRequired = data.length > 0;
    result.warnings.push(`Unrecognised or incomplete ${kind} format. Map required columns: ${missing.join(', ')}. No ${kind === 'trades' ? 'trades' : 'holdings'} imported.`);
    return result;
  }
  if (headerIndex > 0) result.warnings.push(`Skipped ${headerIndex} metadata row(s) before the header.`);
  let skipped = 0;
  let footerCount = 0;
  const reasons = new Map();
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (footer(row) || Object.keys(inferColumns(row, kind)).length >= bestScore && bestScore > 1) { footerCount++; continue; }
    const value = field => row[columns[field]];
    const symbol = String(value('symbol') ?? '').trim();
    const statuses = statusColumns.map(index => key(row[index]));
    const partial = statuses.some(status => ['partially filled', 'partial filled', 'partiallyfilled'].includes(status));
    const tradeQuantity = numberValue(value('tradeQuantity'));
    const quantity = kind === 'trades' && columns.tradeQuantity !== undefined ? tradeQuantity : numberValue(value('quantity'));
    const price = numberValue(value('price'));
    const date = kind === 'trades' ? normalizeDate(value('date')) : null;
    const sideText = key(value('side'));
    const side = ['buy', 'b', 'purchase', 'bought'].includes(sideText) ? 'BUY' : ['sell', 's', 'sale', 'sold'].includes(sideText) ? 'SELL' : null;
    const charges = blank(value('charges')) ? 0 : numberValue(value('charges'));
    const invalid = [];
    if (kind === 'trades' && statuses.some(status => !['successful', 'executed', 'complete', 'completed', 'filled', 'partially filled', 'partial filled', 'partiallyfilled'].includes(status))) invalid.push('execution status (not successful/executed/complete/completed/filled)');
    if (kind === 'trades' && partial && (columns.tradeQuantity === undefined || tradeQuantity === null || tradeQuantity <= 0)) invalid.push('partially filled status without valid trade quantity');
    if (!symbol) invalid.push('symbol');
    if (quantity === null || quantity <= 0) invalid.push('quantity');
    if (price === null || price <= 0) invalid.push(kind === 'holdings' ? 'average price' : 'price');
    if (kind === 'trades' && !date) invalid.push('date');
    if (kind === 'trades' && !side) invalid.push('buy/sell side');
    if (kind === 'trades' && (charges === null || charges < 0)) invalid.push('charges');
    if (invalid.length) {
      skipped++;
      for (const reason of invalid) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      continue;
    }
    const isin = String(value('isin') ?? '').trim();
    if (kind === 'holdings') result.holdings.push({ symbol, isin, quantity, avgPrice: price });
    else {
      const transaction = { symbol, isin, date, side, quantity, price, charges, purpose: 'core' };
      if (!blank(value('tradeTime'))) transaction.tradeTime = String(value('tradeTime')).trim();
      result.transactions.push(transaction);
    }
  }
  if (skipped) result.warnings.push(`Skipped ${skipped} row(s) with missing or invalid required fields: ${[...reasons].map(([reason, count]) => `${reason} (${count})`).join(', ')}.`);
  if (footerCount) result.warnings.push(`Skipped ${footerCount} footer or repeated-header row(s).`);
  if (!(result.transactions.length + result.holdings.length)) result.warnings.push(`No valid ${kind === 'trades' ? 'trades' : 'holdings snapshots'} found.`);
  return result;
}

async function pdfPreview(file) {
  const result = emptyResult();
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  // Vite emits the installed worker as a local asset; never use a CDN worker.
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  let document;
  try {
    document = await task.promise;
    for (let pageNumber = 1; pageNumber <= document.numPages && result.rows.length < MAX_ROWS; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let line = [];
      let lastY;
      const flush = () => { if (line.length && result.rows.length < MAX_ROWS) result.rows.push([line.join(' ')]); line = []; };
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform?.[5];
        if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 2) flush();
        if (item.str.trim()) line.push(item.str.trim());
        lastY = y;
        if (item.hasEOL) flush();
      }
      flush();
      page.cleanup();
    }
    result.headers = ['PDF text'];
    result.text = result.rows.map(row => row[0]).join('\n');
    result.mappingRequired = false;
    result.warnings.push('PDF text was extracted locally for preview only. PDF statement layouts are not automatically parsed; use CSV or XLSX for reliable import. No transactions or holdings were imported.');
    if (!result.rows.length) result.warnings.push('No readable PDF text found. This may be a scanned statement; export CSV or XLSX.');
    if (result.rows.length === MAX_ROWS) result.warnings.push(`PDF preview limited to ${MAX_ROWS} rows.`);
    return result;
  } finally {
    if (document) await document.destroy();
    else await task.destroy();
  }
}

/** Reads only the supplied File in this browser. No upload, fetch, or remote parser. */
export async function parseStatement(file, kind = 'trades') {
  const result = emptyResult();
  if (!file || !Number.isFinite(file.size) || file.size < 0) {
    result.warnings.push('Select a valid local CSV, XLSX, or PDF file.');
    return result;
  }
  if (file.size > MAX_FILE_BYTES) {
    result.warnings.push('File exceeds the 15 MB limit. Export a smaller statement.');
    return result;
  }
  const extension = String(file.name ?? '').split('.').pop().toLowerCase();
  try {
    if (extension === 'pdf') return await pdfPreview(file);
    if (['csv', 'tsv'].includes(extension)) {
      const { default: Papa } = await import('papaparse');
      const parsed = Papa.parse(await file.text(), { skipEmptyLines: 'greedy', dynamicTyping: false, delimiter: extension === 'tsv' ? '\t' : '', preview: MAX_ROWS + 1 });
      // Broken quoting can shift columns; do not silently import those trades.
      if (parsed.errors.some(error => error.type === 'Quotes' || error.type === 'FieldMismatch')) {
        const preview = parseRows(parsed.data, kind);
        preview.transactions = [];
        preview.holdings = [];
        preview.mappingRequired = preview.rows.length > 0;
        preview.warnings.push('Malformed CSV quoting or columns. No records imported; correct the CSV and retry.');
        return preview;
      }
      return parseRows(parsed.data, kind);
    }
    if (['xlsx', 'xls'].includes(extension)) {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, sheetRows: MAX_ROWS + 1 });
      let selected;
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet?.['!ref']) continue;
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false });
        // Excel supports a second date epoch. Convert each sheet before parsing.
        if (workbook.Workbook?.WBProps?.date1904) {
          let dateColumn;
          for (const row of rows) {
            if (dateColumn === undefined) dateColumn = inferColumns(row, kind).date;
            else if (typeof row[dateColumn] === 'number') row[dateColumn] += 1462;
          }
        }
        const imported = parseRows(rows, kind);
        if (sheet['!fullref'] && sheet['!fullref'] !== sheet['!ref']) imported.warnings.push(`Worksheet "${sheetName}" was truncated at the ${MAX_ROWS}-row import limit. Export a smaller statement to import remaining rows.`);
        const count = imported.transactions.length + imported.holdings.length;
        const coverage = fieldsFor(kind).filter(field => inferColumns(imported.headers, kind)[field] !== undefined).length;
        if (!selected || count > selected.count || (count === selected.count && coverage > selected.coverage)) selected = { sheetName, imported, count, coverage };
      }
      if (!selected) { result.warnings.push('No worksheet rows found.'); return result; }
      if (workbook.SheetNames.length > 1) selected.imported.warnings.push(`Selected worksheet "${selected.sheetName}" with ${selected.count} valid ${kind === 'trades' ? 'trades' : 'holdings snapshots'}. Other worksheets were not imported.`);
      return selected.imported;
    }
    result.warnings.push('Unrecognised file format. Select a CSV, XLSX, XLS, or PDF statement.');
  } catch (error) {
    result.warnings.push(`Could not read this statement locally: ${String(error?.message ?? 'unrecognised or damaged file')}. Try exporting CSV or XLSX.`);
  }
  return result;
}
