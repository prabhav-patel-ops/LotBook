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

/** Compare a quoted holding price with the cheapest purchase lot that is still open. */
export function holdingPriceSignal(holding) {
  const openLotPrices = (holding?.lots || [])
    .filter(lot => Number(lot?.remaining) > 0 && Number.isFinite(Number(lot?.price)) && Number(lot.price) >= 0)
    .map(lot => Number(lot.price));
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
