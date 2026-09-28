/**
 * Local-only statement import API (browser ESM).
 * parseStatement(File, kind = 'trades', {sheetName?} = {}) -> Promise<ImportResult>
 * parseRows(Array<Array|Object>|ImportResult, kind = 'trades', mapping = null) -> ImportResult
 * mapping: {symbol, date, side, quantity, price, charges}; values are header names
 * or zero-based column indexes (numeric strings also accepted). Optional mappings:
 * isin, name, exchange, orderId, exchangeOrderId, tradeId, tradeValue
 * (value is an alias), tradeTime, status, tradeQuantity, avgPrice (holdings price).
 * Transactions: {symbol, isin, date: 'YYYY-MM-DD', side: 'BUY'|'SELL',
 *                quantity, price, charges, purpose: 'core', tradeTime?};
 * holdings: {symbol, isin, quantity, avgPrice: number|null, name?, exchange?}.
 * Holdings without acquisition price remain quantity snapshots with null cost and
 * a warning. Cancelled/expired orders may contain real fills: only positive explicit
 * executed quantity plus clearly labelled execution price/trade value is accepted.
 * Trades additionally include sourceRow (1-based input record/worksheet row),
 * chargesKnown, priceSource ('unit-price'|'trade-value'), and supplied identifiers,
 * name, tradeValue (gross, excluding charges), executionDateTime, and tradeTime
 * orderId prefers a broker Order Id, falling back to Exchange Order Id (also kept
 * separately as exchangeOrderId). An order ID is not a unique fill ID.
 * (validated HH:mm:ss, otherwise ''). Unknown fees have chargesKnown=false.
 * Invalid/conflicting optional clocks are retained as unknown time with a warning;
 * invalid date/timestamp cells reject the record.
 * Missing charges retain the legacy numeric 0 placeholder, explicitly flagged and
 * warned; this does not assert that the actual fees were zero.
 * ImportResult also includes headerRow, metadataRows, sourceRows ({sourceRow, row}),
 * columns (detected/mapped indexes), rowIssues ({sourceRow, row, reasons, code}),
 * fatal and blockingErrors. Never confirm or remap a fatal statement. parseRows also
 * accepts a result object for remapping, retaining fatal provenance. The legacy
 * [result.headers, ...result.rows] path retains fatal protection in this session.
 * XLSX adds selectedSheet and worksheets (counts, warnings, selected flags).
 * headers/rows are plain preview data, never HTML. Duplicate detection belongs to caller.
 * To remap a preview and retain source provenance: parseRows(result, kind, mapping).
 * normalizeDate(value) returns 'YYYY-MM-DD' or null for invalid/unsupported dates.
 * PDFs additionally return text, with mappingRequired=false (text is not a table).
 * Status columns restrict trades to successful/executed/complete/completed/filled.
 * Partially filled rows require an explicit executed/trade quantity column.
 */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_ROWS = 20000;

const aliases = {
  symbol: ['symbol', 'trading symbol', 'stock symbol', 'scrip symbol', 'stock', 'scrip', 'stock name', 'scrip name', 'security', 'security name', 'company name'],
  name: ['stock name', 'company name', 'companyname', 'security name', 'scrip name', 'name'],
  isin: ['isin', 'isin code'],
  date: ['trade date', 'execution date and time', 'execution datetime', 'execution date', 'executed date', 'transaction date', 'date'],
  side: ['buy/sell', 'buy / sell', 'buy sell', 'trade type', 'transaction type', 'order side', 'side', 'type'],
  quantity: ['quantity', 'qty', 'holding quantity', 'holdings quantity', 'shares', 'order quantity', 'order qty'],
  tradeQuantity: ['trade quantity', 'trade qty', 'traded quantity', 'traded qty', 'executed quantity', 'executed qty', 'filled quantity', 'filled qty'],
  price: ['trade price', 'execution price', 'executed price', 'average execution price', 'price', 'unit price', 'rate'],
  tradeValue: ['trade value', 'tradevalue', 'gross trade value', 'trade consideration', 'total trade value', 'executed value', 'value'],
  avgPrice: ['avgprice', 'avg price', 'average price', 'avg buy price', 'average buy price', 'average purchase price', 'avg cost', 'average cost', 'cost price', 'buy price', 'purchase price', 'price'],
  charges: ['total charges', 'charges', 'transaction charges', 'total fees', 'fees', 'transaction fees'],
  tradeTime: ['trade time', 'execution time', 'executed time', 'transaction time', 'tradetime', 'time'],
  status: ['execution status', 'trade status', 'order status', 'transaction status', 'status'],
  exchange: ['exchange', 'stock exchange'],
  orderId: ['order id', 'orderid', 'broker order id', 'order number', 'order no'],
  exchangeOrderId: ['exchange order id', 'exchangeorderid', 'exchange order number', 'exchange order no'],
  tradeId: ['trade id', 'tradeid', 'execution id', 'trade number', 'trade no', 'exchange trade id'],
};
const key = value => String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[_.\-]+/g, ' ').replace(/\s+/g, ' ');
const blank = value => value == null || String(value).trim() === '';
const emptyResult = () => ({ transactions: [], holdings: [], warnings: [], headers: [], rows: [], mappingRequired: false, headerRow: null, metadataRows: [], sourceRows: [], columns: {}, rowIssues: [], fatal: false, blockingErrors: [] });
const fatalPreviewRows = new WeakSet();

function markFatal(result, message) {
  result.transactions = [];
  result.holdings = [];
  result.mappingRequired = false;
  result.fatal = true;
  result.blockingErrors.push(message);
  result.warnings.push(message);
  fatalPreviewRows.add(result.headers);
  for (const row of result.rows) fatalPreviewRows.add(row);
  return result;
}

function calendarDate(year, month, day) {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateParts(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    const date = calendarDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    const time = value.toTimeString().slice(0, 8);
    return date ? { date, time, executionDateTime: `${date}T${time}` } : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value >= 2958466 || Math.floor(value) === 60) return null;
    const days = Math.floor(value);
    const date = new Date(Date.UTC(1899, 11, 31) + (days > 60 ? days - 1 : days) * 86400000);
    const normalized = calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    if (!normalized) return null;
    const milliseconds = Math.round((value - days) * 86400000);
    if (!milliseconds) return { date: normalized };
    // Rounding must not silently carry a near-midnight time to a different day.
    if (milliseconds >= 86400000) return null;
    const time = new Date(milliseconds).toISOString().slice(11, 23).replace(/\.000$/, '');
    return { date: normalized, time, executionDateTime: `${normalized}T${time}` };
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2}|\d{1,2}([/-])\d{1,2}\2\d{4})(?:[ T](.+))?$/.exec(text);
  if (!match) return null;
  const parts = match[1].split(/[/-]/).map(Number);
  const date = match[2] ? calendarDate(parts[2], parts[1], parts[0]) : calendarDate(...parts);
  if (!date) return null;
  if (!match[3]) return { date };
  const time = timeParts(match[3]);
  return time ? { date, time, executionDateTime: `${date}T${time}` } : null;
}

function timeParts(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value >= 1) return null;
    const milliseconds = Math.round(value * 86400000);
    return milliseconds < 86400000 ? new Date(milliseconds).toISOString().slice(11, 23).replace(/\.000$/, '') : null;
  }
  const match = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d)(\.\d{1,3})?)?\s*(AM|PM)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  let hour = Number(match[1]);
  if (match[5]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[5].toUpperCase() === 'PM' ? 12 : 0);
  } else if (hour > 23) return null;
  const zone = (match[6] ?? '').toUpperCase();
  if (/^[+-]14:/.test(zone) && !zone.endsWith(':00')) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}${match[4] ?? ''}${zone}`;
}

/** Strict day-first slash/dash dates, timestamps, Date objects, Excel serials. */
export function normalizeDate(value) { return dateParts(value)?.date ?? null; }

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
  return kind === 'holdings' ? ['symbol', 'quantity'] : ['symbol', 'date', 'side', 'quantity', 'price'];
}

function optionalFields(kind) {
  return ['isin', 'name', 'exchange', ...(kind === 'trades' ? ['charges', 'tradeQuantity', 'tradeTime', 'status', 'tradeValue', 'orderId', 'exchangeOrderId', 'tradeId'] : ['price'])];
}

function missingFields(columns, kind) {
  return fieldsFor(kind).filter(field => columns[field] === undefined && !(kind === 'trades' && ((field === 'price' && columns.tradeValue !== undefined) || (field === 'quantity' && columns.tradeQuantity !== undefined))));
}

function inferColumns(headers, kind) {
  const normalized = headers.map(key);
  const columns = {};
  for (const field of [...fieldsFor(kind), ...optionalFields(kind)]) {
    const choices = field === 'price' && kind === 'holdings' ? aliases.avgPrice : aliases[field];
    // Prefer the specific average-price synonym over generic Price in holdings.
    const found = choices.map(choice => normalized.indexOf(choice)).find(index => index >= 0);
    if (found !== undefined) columns[field] = found;
  }
  return columns;
}

function footer(row) {
  const first = row.find(value => !blank(value));
  return /^(?:grand total|sub total|subtotal|total|totals|disclaimer|note|notes|summary)(?:\s|:|$)/i.test(String(first ?? '').trim());
}

export function parseRows(input, kind = 'trades', mapping = null) {
  const result = emptyResult();
  let previousPreview;
  if (input && !Array.isArray(input) && Array.isArray(input.headers) && Array.isArray(input.rows)) {
    if (input.fatal) return markFatal({ ...result, headers: input.headers, rows: input.rows, sourceRows: input.sourceRows ?? [] }, 'This statement has a fatal parsing error. Correct the source file and retry; mapping cannot repair it.');
    previousPreview = input;
    input = [input.headers, ...input.rows];
  }
  if (Array.isArray(input) && input.some(row => Array.isArray(row) && fatalPreviewRows.has(row))) {
    return markFatal(result, 'This preview came from a fatal parsing error. Correct the source file and retry; mapping cannot repair it.');
  }
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
    const headers = [...new Set(source.flatMap(row => row && typeof row === 'object' ? Object.keys(row) : []))];
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
    if (!missingFields(inferred, kind).length) { headerIndex = i; break; }
  }
  if (headerIndex >= 0) result.headers = source[headerIndex].map(value => String(value ?? '').trim());
  const width = source.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  if (headerIndex < 0) result.headers = Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  result.headerRow = headerIndex >= 0 ? headerIndex + 1 : null;
  result.metadataRows = source.slice(0, Math.max(0, headerIndex));
  const headerKeys=new Set(result.headers.map(key));
  const hasRealisedPnl=headerKeys.has('realised p&l')||headerKeys.has('realized p&l');
  const looksLikePnlOrCapitalGains=hasRealisedPnl&&(
    (headerKeys.has('buy date')&&headerKeys.has('sell date'))||
    headerKeys.has('buy value')||headerKeys.has('sell value')
  );
  if(kind==='trades'&&looksLikePnlOrCapitalGains){
    return markFatal(result,'This is a P&L or capital-gains summary, not Stocks Order History. It cannot reconstruct individual executions or purchase lots. Download Stocks Order History instead.');
  }
  let columns = inferColumns(result.headers, kind);
  // Preserve inferred safety checks even when only core columns are remapped.
  const statusColumns = result.headers.flatMap((header, index) => aliases.status.includes(key(header)) ? [index] : []);
  if (mapping && typeof mapping === 'object') {
    // Explicit mappings override inference, including explicit invalid assignments.
    for (const [mappedField, selection] of Object.entries(mapping)) {
      const field = mappedField === 'avgPrice' && kind === 'holdings' ? 'price' : mappedField === 'value' ? 'tradeValue' : mappedField === 'companyName' ? 'name' : mappedField;
      if (![...fieldsFor(kind), ...optionalFields(kind)].includes(field)) continue;
      const index = Number.isInteger(selection) ? selection : typeof selection === 'string' && /^\d+$/.test(selection) ? Number(selection) : typeof selection === 'string' ? result.headers.findIndex(header => key(header) === key(selection)) : -1;
      if (index >= 0 && index < width) columns[field] = index;
      else delete columns[field];
    }
  }
  // Value is a gross total for trades, and never a holding's acquisition cost.
  if (columns.price !== undefined && (aliases.tradeValue.includes(key(result.headers[columns.price])) || /^(?:holding value|holdings value|current value|market value|total)$/.test(key(result.headers[columns.price])))) {
    delete columns.price;
    result.warnings.push('A total/market Value column cannot be mapped as unit price or average acquisition cost. Map tradeValue for gross trade consideration.');
  }
  if (kind === 'trades' && columns.tradeQuantity !== undefined) columns.quantity = columns.tradeQuantity;
  result.columns = { ...columns };
  if (columns.status !== undefined && !statusColumns.includes(columns.status)) statusColumns.push(columns.status);
  const priceColumns = result.headers.flatMap((header, index) => aliases.price.includes(key(header)) ? [index] : []);
  const valueColumns = result.headers.flatMap((header, index) => aliases.tradeValue.includes(key(header)) ? [index] : []);
  if (columns.price !== undefined && !priceColumns.includes(columns.price)) priceColumns.push(columns.price);
  if (columns.tradeValue !== undefined && !valueColumns.includes(columns.tradeValue)) valueColumns.push(columns.tradeValue);
  result.sourceRows = source.slice(headerIndex + 1).map((row, index) => ({ sourceRow: headerIndex + index + 2, row })).filter(({ row }) => row.some(value => !blank(value)));
  const data = result.sourceRows.map(({ row }) => row);
  result.rows = data;
  if (previousPreview) {
    result.headerRow = previousPreview.headerRow ?? result.headerRow;
    result.metadataRows = previousPreview.metadataRows ?? [];
    result.sourceRows = result.sourceRows.map((entry, index) => ({ ...entry, sourceRow: previousPreview.sourceRows?.[index]?.sourceRow ?? entry.sourceRow }));
    if (previousPreview.selectedSheet) result.selectedSheet = previousPreview.selectedSheet;
    if (previousPreview.worksheets) result.worksheets = previousPreview.worksheets;
  }
  const missing = missingFields(columns, kind);
  if (missing.length) {
    result.mappingRequired = data.length > 0;
    result.warnings.push(`Unrecognised or incomplete ${kind} format. Map required columns: ${missing.join(', ')}. No ${kind === 'trades' ? 'trades' : 'holdings'} imported.`);
    result.blockingErrors.push(`Missing required column mapping: ${missing.join(', ')}.`);
    return result;
  }
  const numericFields = ['quantity', 'price', ...(kind === 'trades' ? ['tradeValue', 'charges'] : [])].filter(field => columns[field] !== undefined);
  if (new Set(numericFields.map(field => columns[field])).size !== numericFields.length) {
    result.mappingRequired = data.length > 0;
    result.blockingErrors.push('Quantity, unit price, gross tradeValue and charges must use distinct columns. Correct the mapping.');
    result.warnings.push(result.blockingErrors[0]);
    return result;
  }
  if (headerIndex > 0) result.warnings.push(`Skipped ${headerIndex} metadata row(s) before the header.`);
  let skipped = 0;
  let footerCount = 0;
  let unknownCharges = 0;
  let unknownTimes = 0;
  let unknownAveragePrices = 0;
  let terminatedFills = 0;
  const reasons = new Map();
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const sourceRow = result.sourceRows[i].sourceRow;
    const repeatedHeader = headerIndex >= 0 && row.length === result.headers.length && row.every((cell, index) => key(cell) === key(result.headers[index]));
    // A company called 'Notes Ltd' or a symbol TOTAL may be an actual record.
    const isFooter = footer(row) && (kind === 'trades' ? blank(row[columns.side]) && blank(row[columns.date]) : blank(row[columns.quantity]));
    if (isFooter || repeatedHeader) {
      footerCount++;
      result.rowIssues.push({ sourceRow, row, code: repeatedHeader ? 'repeated-header' : 'footer', reasons: [repeatedHeader ? 'Repeated header' : 'Footer row'] });
      continue;
    }
    const value = field => row[columns[field]];
    const symbol = String(value('symbol') ?? '').trim();
    const statuses = statusColumns.map(index => key(row[index]));
    const partial = statuses.some(status => ['partially filled', 'partial filled', 'partiallyfilled'].includes(status));
    const terminated = statuses.some(status => ['cancelled', 'canceled', 'expired'].includes(status));
    const tradeQuantity = numberValue(value('tradeQuantity'));
    const quantity = kind === 'trades' && columns.tradeQuantity !== undefined ? tradeQuantity : numberValue(value('quantity'));
    const suppliedPrice = !blank(value('price'));
    let price = numberValue(value('price'));
    const suppliedValue = kind === 'trades' && !blank(value('tradeValue'));
    const tradeValue = suppliedValue ? numberValue(value('tradeValue')) : null;
    if (kind === 'trades' && !suppliedPrice && suppliedValue && tradeValue > 0 && quantity > 0) price = tradeValue / quantity;
    const execution = kind === 'trades' ? dateParts(value('date')) : null;
    const date = execution?.date ?? null;
    const sideText = key(value('side'));
    const side = ['buy', 'b', 'purchase', 'bought'].includes(sideText) ? 'BUY' : ['sell', 's', 'sale', 'sold'].includes(sideText) ? 'SELL' : null;
    const chargesKnown = columns.charges !== undefined && !blank(value('charges'));
    const charges = chargesKnown ? numberValue(value('charges')) : 0;
    const invalid = [];
    if (headerIndex >= 0 && row.slice(result.headers.length).some(cell => !blank(cell))) invalid.push('unexpected extra columns');
    if (kind === 'trades' && statuses.some(status => !['successful', 'executed', 'complete', 'completed', 'filled', 'partially filled', 'partial filled', 'partiallyfilled', 'cancelled', 'canceled', 'expired'].includes(status))) invalid.push('execution status (not successful/executed/complete/completed/filled)');
    if (kind === 'trades' && terminated) {
      if (columns.tradeQuantity === undefined || !Number.isFinite(tradeQuantity) || tradeQuantity <= 0) invalid.push('execution status: cancelled/expired order without positive explicit executed quantity');
      const executedPrice = suppliedPrice && ['trade price', 'execution price', 'executed price', 'average execution price'].includes(key(result.headers[columns.price]));
      const executedValue = suppliedValue && aliases.tradeValue.includes(key(result.headers[columns.tradeValue])) && key(result.headers[columns.tradeValue]) !== 'value';
      if (!executedPrice && !executedValue) invalid.push('cancelled/expired order has ambiguous executed price/value basis');
    }
    if (kind === 'trades' && partial && (columns.tradeQuantity === undefined || tradeQuantity === null || tradeQuantity <= 0)) invalid.push('partially filled status without valid trade quantity');
    if (!symbol) invalid.push('symbol');
    if (!Number.isFinite(quantity) || quantity <= 0) invalid.push('quantity');
    if ((kind === 'trades' || suppliedPrice) && (!Number.isFinite(price) || price <= 0)) invalid.push(kind === 'holdings' ? 'average price' : 'price');
    if (suppliedValue && (!Number.isFinite(tradeValue) || tradeValue <= 0)) invalid.push('gross trade value');
    if (kind === 'trades' && quantity > 0 && price > 0 && !Number.isFinite(quantity * price + charges)) invalid.push('nonfinite trade consideration');
    // Compare gross consideration at one-paisa precision, allowing only FP noise.
    if (suppliedPrice && suppliedValue && price > 0 && quantity > 0 && tradeValue > 0 && Math.abs(price * quantity - tradeValue) > 0.005 + Number.EPSILON * Math.max(price * quantity, tradeValue) * 4) invalid.push('conflicting price/value');
    if (kind === 'trades') {
      const prices = priceColumns.filter(index => !blank(row[index])).map(index => numberValue(row[index]));
      const values = valueColumns.filter(index => !blank(row[index])).map(index => numberValue(row[index]));
      if (prices.some(amount => !Number.isFinite(amount) || amount <= 0)) invalid.push('invalid unit price column');
      if (values.some(amount => !Number.isFinite(amount) || amount <= 0)) invalid.push('invalid gross value column');
      if (prices.some(amount => amount > 0 && price > 0 && Math.abs(amount - price) > Number.EPSILON * Math.max(amount, price) * 4)) invalid.push('conflicting unit price columns');
      if (values.some(amount => amount > 0 && quantity > 0 && price > 0 && Math.abs(price * quantity - amount) > 0.005 + Number.EPSILON * Math.max(price * quantity, amount) * 4)) invalid.push('conflicting price/value columns');
    }
    if (kind === 'trades' && !date) invalid.push('date');
    if (kind === 'trades' && !side) invalid.push('buy/sell side');
    if (kind === 'trades' && (charges === null || charges < 0)) invalid.push('charges');
    let time = execution?.time ?? '';
    let unknownTimeReason;
    if (kind === 'trades' && !blank(value('tradeTime'))) {
      const separateTime = timeParts(value('tradeTime'));
      if (!separateTime) { time = ''; unknownTimeReason = 'Invalid optional execution time'; }
      else if (time && time !== separateTime) { time = ''; unknownTimeReason = 'Conflicting execution times'; }
      else time = separateTime;
    }
    const identifiers = {};
    for (const field of ['orderId', 'exchangeOrderId', 'tradeId']) {
      const raw = value(field);
      if (kind !== 'trades' || blank(raw)) continue;
      if (typeof raw === 'number' && (!Number.isSafeInteger(raw) || raw < 0)) invalid.push(`unsafe ${field} (export identifiers as text)`);
      else identifiers[field] = String(raw).trim();
    }
    if (invalid.length) {
      skipped++;
      for (const reason of invalid) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      result.rowIssues.push({ sourceRow, row, code: 'invalid-row', reasons: invalid });
      continue;
    }
    const isin = String(value('isin') ?? '').trim();
    if (kind === 'holdings') {
      const holding = { symbol, isin, quantity, avgPrice: price };
      if (columns.name !== columns.symbol && !blank(value('name'))) holding.name = String(value('name')).trim();
      if (!blank(value('exchange'))) holding.exchange = String(value('exchange')).trim();
      if (!suppliedPrice) unknownAveragePrices++;
      result.holdings.push(holding);
    }
    else {
      const transaction = { symbol, isin, date, side, quantity, price, charges, purpose: 'core', chargesKnown, sourceRow, priceSource: suppliedPrice ? 'unit-price' : 'trade-value', tradeTime: time.slice(0, 8), ...identifiers };
      if (!blank(value('name'))) transaction.name = String(value('name')).trim();
      if (!blank(value('exchange'))) transaction.exchange = String(value('exchange')).trim();
      if (!blank(value('status'))) transaction.status = String(value('status')).trim();
      if (suppliedValue) transaction.tradeValue = tradeValue;
      if (time) transaction.executionDateTime = `${date}T${time}`;
      if (!chargesKnown) unknownCharges++;
      if (unknownTimeReason) {
        unknownTimes++;
        result.rowIssues.push({ sourceRow, row, code: 'unknown-time', reasons: [unknownTimeReason] });
      }
      if (terminated) {
        terminatedFills++;
        result.rowIssues.push({ sourceRow, row, code: 'executed-terminated-order', reasons: ['Executed fill retained from cancelled/expired order; only explicit executed quantity was used'] });
      }
      result.transactions.push(transaction);
    }
  }
  if (skipped) result.warnings.push(`Skipped ${skipped} row(s) with missing or invalid required fields: ${[...reasons].map(([reason, count]) => `${reason} (${count})`).join(', ')}.`);
  if (footerCount) result.warnings.push(`Skipped ${footerCount} footer or repeated-header row(s).`);
  if (unknownCharges) result.warnings.push(`Charges are missing for ${unknownCharges} imported trade(s). Fees are unknown, not confirmed zero; the numeric 0 is a placeholder. Review actual transaction fees before relying on net results. No fees or income taxes were estimated.`);
  if (unknownTimes) result.warnings.push(`Execution time is unknown for ${unknownTimes} imported trade(s) with an invalid or conflicting optional clock. The trade dates were retained; no time was guessed. Keep source order for any same-day group with unknown times.`);
  if (unknownAveragePrices) result.warnings.push(`Average acquisition price is missing for ${unknownAveragePrices} holdings snapshot(s). Quantity was retained with avgPrice=null; cost is unknown. Market/holding Value was not used as acquisition cost and no purchases were invented.`);
  if (terminatedFills) result.warnings.push(`Retained ${terminatedFills} executed fill(s) from cancelled/expired orders using explicit executed quantity and execution price/trade value. The remaining order quantity was not imported. Review these source rows.`);
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
export async function parseStatement(file, kind = 'trades', options = {}) {
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
      const parsed = Papa.parse(await file.text(), { skipEmptyLines: false, dynamicTyping: false, delimiter: extension === 'tsv' ? '\t' : '', preview: MAX_ROWS + 1 });
      // Broken quoting can shift columns; do not silently import those trades.
      if (parsed.errors.some(error => error.type === 'Quotes' || error.type === 'FieldMismatch')) {
        const preview = parseRows(parsed.data, kind);
        return markFatal(preview, 'Malformed CSV quoting or columns. No records imported; correct the CSV and retry. Mapping cannot repair a malformed parse.');
      }
      return parseRows(parsed.data, kind);
    }
    if (['xlsx', 'xls'].includes(extension)) {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, sheetRows: MAX_ROWS + 1 });
      let selected;
      const worksheets = [];
      if (options.sheetName !== undefined && !workbook.SheetNames.includes(options.sheetName)) return markFatal(result, `Worksheet "${String(options.sheetName)}" does not exist. Choose an available worksheet.`);
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const hidden = Boolean(workbook.Workbook?.Sheets?.[workbook.SheetNames.indexOf(sheetName)]?.Hidden);
        if (!sheet?.['!ref']) { worksheets.push({ name: sheetName, validCount: 0, invalidCount: 0, hidden, selected: false, warnings: ['No worksheet rows found.'] }); continue; }
        // range:0 and blankrows preserve physical row numbers including leading gaps.
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true, range: 0 });
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
        const coverage = fieldsFor(kind).length - missingFields(imported.columns, kind).length;
        worksheets.push({ name: sheetName, validCount: count, invalidCount: imported.rowIssues.filter(issue => issue.code === 'invalid-row').length, hidden, selected: false, warnings: [...imported.warnings] });
        const eligible = options.sheetName !== undefined ? sheetName === options.sheetName : !hidden;
        if (eligible && (!selected || count > selected.count || (count === selected.count && coverage > selected.coverage))) selected = { sheetName, imported, count, coverage };
      }
      if (!selected) { result.worksheets = worksheets; result.warnings.push('No visible worksheet rows found. Select a worksheet explicitly if the report is hidden.'); return result; }
      selected.imported.selectedSheet = selected.sheetName;
      selected.imported.worksheets = worksheets.map(sheet => ({ ...sheet, selected: sheet.name === selected.sheetName }));
      if (workbook.SheetNames.length > 1) {
        const omitted = worksheets.filter(sheet => sheet.name !== selected.sheetName).map(sheet => `"${sheet.name}" (${sheet.validCount} valid, ${sheet.invalidCount} invalid${sheet.hidden ? ', hidden' : ''})`).join(', ');
        selected.imported.warnings.push(`Selected worksheet "${selected.sheetName}" with ${selected.count} valid ${kind === 'trades' ? 'trades' : 'holdings snapshots'}. Other worksheets were not imported: ${omitted}. Select a worksheet explicitly to import it; ties use workbook order.`);
      }
      return selected.imported;
    }
    result.warnings.push('Unrecognised file format. Select a CSV, XLSX, XLS, or PDF statement.');
  } catch (error) {
    return markFatal(result, `Could not read this statement locally: ${String(error?.message ?? 'unrecognised or damaged file')}. Try exporting CSV or XLSX.`);
  }
  return result;
}
