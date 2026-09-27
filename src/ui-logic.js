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
