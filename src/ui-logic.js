/** Quote CSV and neutralise spreadsheet formulas in user-provided text. */
export function csvCell(value) {
  let text = String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/** Do not drop small fractional quantities; validation checks the final sum. */
export function allocateLots(lots, quantity, fifo = false) {
  const ordered = lots.filter(l => l.remaining > 0).toSorted(fifo
    ? (a, b) => a.date.localeCompare(b.date)
    : (a, b) => a.price - b.price);
  let left = quantity;
  const allocations = [];
  for (const lot of ordered) {
    if (left <= 0) break;
    const sold = Math.min(left, lot.remaining);
    allocations.push({lotId: lot.id, quantity: sold});
    left -= sold;
  }
  return allocations;
}

/** Unrealised return on the cost of the remaining lots, not total account return. */
export function holdingReturnPercent(cost, unrealized) {
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(unrealized)) return null;
  return (unrealized / cost) * 100;
}

/**
 * Prefer a current, quantity-matching broker holdings snapshot for the number
 * Groww calls invested. Fall back to the independently replayed FIFO cost.
 * A snapshot is not used after a later trade because unchanged net quantity can
 * hide a sell-and-rebuy whose broker average has changed.
 */
export function growwInvestedSummary({holdings = [], fifoInvested = 0, snapshots = [], snapshotDate = '', latestTransactionDate = ''} = {}) {
  const held = holdings.filter(holding => Number(holding.quantity) > 0);
  const reported = new Map(snapshots.filter(row => Number(row.quantity) > 0).map(row => [row.symbol, row]));
  const sameQuantity = held.length === reported.size && held.every(holding => {
    const row = reported.get(holding.symbol);
    return row && Math.abs(Number(row.quantity) - Number(holding.quantity)) <= 1e-8;
  });
  const averagesAvailable = sameQuantity && held.every(holding => {
    const average = reported.get(holding.symbol)?.averageCost;
    return average !== null && average !== undefined && average !== '' && Number.isFinite(Number(average));
  });
  const currentEnough = Boolean(snapshotDate) && (!latestTransactionDate || latestTransactionDate <= snapshotDate);
  if (averagesAvailable && currentEnough) {
    const value = held.reduce((sum, holding) => sum + Number(holding.quantity) * Number(reported.get(holding.symbol).averageCost), 0);
    return {value: Math.round((value + Number.EPSILON * Math.abs(value)) * 100) / 100, source: 'statement', asOf: snapshotDate};
  }
  return {value: Number.isFinite(Number(fifoInvested)) ? Number(fifoInvested) : 0, source: 'fifo', asOf: null};
}

/** Compare a quoted holding price with the cheapest purchase lot that is still open. */
export function holdingPriceSignal(holding) {
  const lots = holding?.lots || [];
  const bonuses = lots.filter(lot => lot?.corporateAction === 'BONUS' && Number(lot?.adjustmentFactor) > 1);
  const openLotPrices = lots
    .filter(lot => !lot?.corporateAction && Number(lot?.remaining) > 0 && Number.isFinite(Number(lot?.price)) && Number(lot.price) >= 0)
    .map(lot => {
      const factor = bonuses
        .filter(bonus => String(lot.date || '') < String(bonus.date || ''))
        .reduce((product, bonus) => product * Number(bonus.adjustmentFactor), 1);
      return Number(lot.price) / factor;
    });
  const lowestPrice = openLotPrices.length ? Math.min(...openLotPrices) : null;
  const currentPrice = Number(holding?.currentPrice);
  if (lowestPrice === null || holding?.currentPrice === null || holding?.currentPrice === undefined || !Number.isFinite(currentPrice)) {
    return { status: 'unknown', lowestPrice, difference: null };
  }
  const difference = currentPrice - lowestPrice;
  return {
    status: difference > 0 ? 'above' : difference < 0 ? 'below' : 'at',
    lowestPrice,
    difference,
  };
}

/** Filter and sort the visible portfolio without changing ledger order or lot matching. */
export function selectHoldings(holdings = [], { query = '', position = 'all', sort = 'name', direction = 'asc' } = {}) {
  const needle = String(query).trim().toLowerCase();
  const wantedPosition = ['all', 'above', 'not-above'].includes(position) ? position : 'all';
  const wantedSort = ['name', 'price', 'returns', 'pnl', 'cheapest-gap'].includes(sort) ? sort : 'name';
  const multiplier = direction === 'desc' ? -1 : 1;
  const enriched = holdings.filter(holding => Number(holding.quantity) > 0).map((holding, index) => {
    const signal = holdingPriceSignal(holding);
    const returns = holdingReturnPercent(Number(holding.cost), holding.unrealized);
    const cheapestGap = signal.lowestPrice > 0 && Number.isFinite(signal.difference)
      ? signal.difference / signal.lowestPrice * 100
      : null;
    return { holding, index, signal, returns, cheapestGap };
  }).filter(({holding, signal}) => {
    const matchesText = !needle || String(holding.symbol || '').toLowerCase().includes(needle) ||
      String(holding.name || '').toLowerCase().includes(needle);
    const matchesPosition = wantedPosition === 'all' ||
      (wantedPosition === 'above' ? signal.status === 'above' : signal.status === 'below' || signal.status === 'at');
    return matchesText && matchesPosition;
  });
  const metric = item => {
    if (wantedSort === 'price') return item.holding.currentPrice !== null && item.holding.currentPrice !== undefined && Number.isFinite(Number(item.holding.currentPrice)) ? Number(item.holding.currentPrice) : null;
    if (wantedSort === 'returns') return item.returns;
    if (wantedSort === 'pnl') return item.holding.unrealized !== null && item.holding.unrealized !== undefined && Number.isFinite(Number(item.holding.unrealized)) ? Number(item.holding.unrealized) : null;
    if (wantedSort === 'cheapest-gap') return item.cheapestGap;
    return String(item.holding.name || item.holding.symbol || '').toLowerCase();
  };
  enriched.sort((left, right) => {
    const a = metric(left), b = metric(right);
    if (a === null && b !== null) return 1;
    if (a !== null && b === null) return -1;
    let comparison = 0;
    if (typeof a === 'string' || typeof b === 'string') comparison = String(a).localeCompare(String(b));
    else comparison = Number(a) - Number(b);
    if (comparison) return comparison * multiplier;
    const symbolComparison = String(left.holding.symbol || '').localeCompare(String(right.holding.symbol || ''));
    return symbolComparison || left.index - right.index;
  });
  return enriched.map(item => item.holding);
}
