import { orderedTransactions } from './ledger.js';

/** Select diary rows without changing the ledger or its transactions. */
export function selectDiaryEntries(transactions, { query = '', kind = 'all', month = '', limit = 30 } = {}) {
  const numericLimit = typeof limit === 'number' || (typeof limit === 'string' && limit.trim())
    ? Number(limit) : NaN;
  const boundedLimit = Number.isFinite(numericLimit)
    ? Math.max(1, Math.min(transactions.length, Math.floor(numericLimit))) : 30;
  const search = query.trim().toLowerCase();
  const names = new Map();
  for (const t of transactions) if (t.name) names.set(t.symbol, `${names.get(t.symbol) || ''} ${t.name}`.toLowerCase());
  const months = [...new Set(transactions.map(t => t.date.slice(0, 7)))].sort().reverse();
  const filtered = orderedTransactions(transactions).reverse().filter(t => {
    const entryKind = t.corporateAction ? 'adjustment' : t.side.toLowerCase();
    return (kind === 'all' || entryKind === kind)
      && (!month || t.date.slice(0, 7) === month)
      && (!search || t.symbol.toLowerCase().includes(search) || (names.get(t.symbol) || '').includes(search));
  });
  let buyCount = 0, sellCount = 0, adjustmentCount = 0;
  for (const t of filtered) {
    if (t.corporateAction) adjustmentCount++;
    else if (t.side === 'BUY') buyCount++;
    else if (t.side === 'SELL') sellCount++;
  }
  return { entries: filtered.slice(0, boundedLimit), total: filtered.length, months, buyCount, sellCount, adjustmentCount };
}
