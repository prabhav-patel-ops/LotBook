/** Pure, in-memory lot accounting. Money is rounded to cents only at the API boundary. */
const near = (a, b) => Math.abs(a - b) <= Number.EPSILON * 8 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
const quantityOut = value => {
  const rounded = Number(value.toPrecision(15));
  return Number.isFinite(rounded) ? rounded : value;
};
const money = value => {
  // At this magnitude cents are below Number's precision; avoid overflowing * 100.
  if (Math.abs(value) >= 1e21) return value;
  const rounded = Math.round((Math.abs(value) + Number.EPSILON * Math.abs(value)) * 100) / 100;
  return rounded === 0 ? 0 : Math.sign(value) * rounded;
};
const finite = value => {
  if (!Number.isFinite(value)) throw new Error('Transaction would exceed the supported numeric range');
  return value;
};

function number(value, field, positive = false) {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim() !== '')) {
    throw new Error(`${field} must be a finite number`);
  }
  const result = Number(value);
  if (!Number.isFinite(result) || (positive ? result <= 0 : result < 0)) {
    throw new Error(`${field} must be finite and ${positive ? 'positive' : 'non-negative'}`);
  }
  return result;
}

function identifier(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    throw new Error('date must be a valid YYYY-MM-DD calendar date');
  }
  const stamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) {
    throw new Error('date must be a valid YYYY-MM-DD calendar date');
  }
  return value;
}

/** Validates structure; lot existence and available balances are checked by analyse. */
export function validateTransaction(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Transaction must be an object');
  const id = identifier(t.id, 'id');
  const symbol = identifier(t.symbol, 'symbol').toUpperCase();
  const side = identifier(t.side, 'side').toUpperCase();
  if (side !== 'BUY' && side !== 'SELL') throw new Error('side must be BUY or SELL');
  if (t.purpose !== 'core' && t.purpose !== 'trading') throw new Error('purpose must be core or trading');
  if (t.name !== undefined && typeof t.name !== 'string') throw new Error('name must be a string');
  if (t.note !== undefined && typeof t.note !== 'string') throw new Error('note must be a string');
  const normalized = {
    id, symbol, name: t.name?.trim() || symbol, date: dateValue(t.date), side,
    quantity: number(t.quantity, 'quantity', true), price: number(t.price, 'price', true),
    charges: number(t.charges === undefined ? 0 : t.charges, 'charges'),
    purpose: t.purpose, note: t.note ?? '',
    // Old zero placeholders do not establish that the broker charged nothing.
    chargesKnown: typeof t.chargesKnown==='boolean' ? t.chargesKnown : Number(t.charges)>0,
  };
  for (const field of ['isin','exchange','orderId','exchangeOrderId','tradeId']) {
    if(t[field]!==undefined){if(typeof t[field]!=='string'||t[field].length>200)throw Error(`Invalid ${field}`);normalized[field]=t[field].trim();}
  }
  if(t.tradeTime){if(typeof t.tradeTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(t.tradeTime))throw Error('Invalid execution time');normalized.tradeTime=t.tradeTime;}
  finite(normalized.quantity * normalized.price + normalized.charges);
  finite(normalized.price + normalized.charges / normalized.quantity);
  if (t.allocations !== undefined) {
    if (side !== 'SELL') throw new Error('Only SELL transactions may have allocations');
    if (!Array.isArray(t.allocations) || !t.allocations.length) throw new Error('Explicit allocations must be a non-empty array');
    const seen = new Set();
    normalized.allocations = t.allocations.map(a => {
      if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('Invalid allocation');
      const lotId = identifier(a.lotId, 'lotId');
      if (seen.has(lotId)) throw new Error(`Duplicate allocation for lot ${lotId}`);
      seen.add(lotId);
      return { lotId, quantity: number(a.quantity, 'allocation quantity', true) };
    });
    const allocated = normalized.allocations.reduce((sum, a) => finite(sum + a.quantity), 0);
    if (!near(allocated, normalized.quantity)) throw new Error('Explicit allocations must sum exactly to sell quantity');
  }
  return normalized;
}

function selectLots(t, lots, explicit) {
  if (explicit) {
    return t.allocations.map(a => {
      const lot = lots.find(l => l.id === a.lotId);
      if (!lot) throw new Error(`Lot ${a.lotId} does not preexist this sale`);
      if (lot.symbol !== t.symbol) throw new Error(`Lot ${a.lotId} belongs to a different symbol`);
      if (a.quantity > lot.remaining && !near(a.quantity, lot.remaining)) throw new Error(`Lot ${a.lotId} has insufficient available quantity`);
      if (lot.remaining <= 0) throw new Error(`Lot ${a.lotId} is already exhausted`);
      return { lot, quantity: Math.min(a.quantity, lot.remaining) };
    });
  }
  let left = t.quantity;
  const selected = [];
  for (const lot of lots) {
    if (lot.symbol !== t.symbol || lot.remaining <= 0) continue;
    const quantity = Math.min(left, lot.remaining);
    selected.push({ lot, quantity });
    left -= quantity;
    if (left === 0 || near(quantity, quantity + left)) break;
  }
  const allocated = selected.reduce((sum, a) => sum + a.quantity, 0);
  if (!near(allocated, t.quantity)) throw new Error(`Cannot sell ${t.quantity} ${t.symbol}: insufficient available quantity`);
  return selected;
}

export function orderedTransactions(transactions) {
 const dateGroups=new Map();
 transactions.forEach((t,index)=>{if(!dateGroups.has(t.date))dateGroups.set(t.date,[]);dateGroups.get(t.date).push({t,index});});
 const ordered=[];
 for(const [,entries] of [...dateGroups].sort(([a],[b])=>a.localeCompare(b))){
  if(entries.every(e=>e.t.tradeTime))entries.sort((a,b)=>a.t.tradeTime.localeCompare(b.t.tradeTime)||a.index-b.index);
  ordered.push(...entries.map(e=>e.t));
 }
 return ordered;
}

function calculate(t, selected) {
  return selected.map(({ lot, quantity }) => {
    const gross = finite((t.price - lot.price) * quantity);
    const charges = finite(lot.charges * (quantity / lot.quantity) + t.charges * (quantity / t.quantity));
    return {
      // JSON encoding makes the pair unique even when IDs contain punctuation.
      id: JSON.stringify([t.id, lot.id]), sellId: t.id, lotId: lot.id, symbol: t.symbol,
      buyDate: lot.date, sellDate: t.date, quantity, buyPrice: lot.price, sellPrice: t.price,
      gross, charges, net: finite(gross - charges), purpose: lot.purpose,
      chargesKnown: t.chargesKnown && lot.chargesKnown,
      holdingDays: Math.round((Date.parse(`${t.date}T00:00:00Z`) - Date.parse(`${lot.date}T00:00:00Z`)) / 86400000),
    };
  });
}

function consume(selected) {
  for (const { lot, quantity } of selected) {
    lot.remaining = near(lot.remaining, quantity) ? 0 : lot.remaining - quantity;
  }
}

/** Invalid entries produce {id,message} errors and change neither diary nor FIFO state.
 * invested is remaining acquisition cost including remaining buy fees; charges is
 * all accepted buy/sell fees; unpriced counts holdings without a valid quote.
 * currentValue/unrealized totals cover priced holdings only (see unpriced).
 * Holdings include only currently held symbols; their lots include closed purchases.
 * monthlyResults contains {month,net,gross,charges}, grouped by sell month
 * (YYYY-MM), sorted oldest first, and rounded after summing unrounded cycles.
 * Monthly charges include only fees allocated to those realized cycles.
 */
export function analyse(transactions, prices = {}) {
  if (!Array.isArray(transactions)) throw new Error('transactions must be an array');
  const errors = [], valid = [], lots = [], fifoLots = [], rawCycles = [];
  const ids = new Set();
  let charges = 0, realizedGross = 0, realizedNet = 0, fifoNet = 0, unknownCharges=0;
  transactions.forEach((raw, index) => {
    try { valid.push({ t: validateTransaction(raw), index }); }
    catch (error) { errors.push({ id: raw?.id ?? null, message: error.message }); }
  });
  for (const t of orderedTransactions(valid.map(entry=>entry.t))) {
    try {
      if (ids.has(t.id)) throw new Error(`Duplicate transaction id ${t.id}`);
      const nextCharges = finite(charges + t.charges);
      if (t.side === 'BUY') {
        finite(lots.filter(lot => lot.symbol === t.symbol).reduce((sum, lot) => finite(sum + lot.remaining), 0) + t.quantity);
        finite(lots.reduce((sum, lot) => finite(sum + lot.remaining * lot.price + lot.charges * (lot.remaining / lot.quantity)), 0) + t.quantity * t.price + t.charges);
        const lot = { ...t, remaining: t.quantity };
        lots.push(lot);
        fifoLots.push({ ...lot });
      } else {
        const selected = selectLots(t, lots, t.allocations !== undefined);
        const fifoSelected = selectLots(t, fifoLots, false);
        const cycles = calculate(t, selected);
        const fifoCycles = calculate(t, fifoSelected);
        const nextGross = finite(realizedGross + cycles.reduce((sum, c) => finite(sum + c.gross), 0));
        const nextNet = finite(realizedNet + cycles.reduce((sum, c) => finite(sum + c.net), 0));
        const nextFifo = finite(fifoNet + fifoCycles.reduce((sum, c) => finite(sum + c.net), 0));
        consume(selected);
        consume(fifoSelected);
        rawCycles.push(...cycles);
        realizedGross = nextGross;
        realizedNet = nextNet;
        fifoNet = nextFifo;
      }
      charges = nextCharges;
      if(!t.chargesKnown)unknownCharges++;
      ids.add(t.id);
    } catch (error) { errors.push({ id: t.id, message: error.message }); }
  }

  const groups = new Map();
  for (const lot of lots) {
    if (lot.remaining > 0) {
      if (!groups.has(lot.symbol)) groups.set(lot.symbol, []);
      groups.get(lot.symbol).push(lot);
    }
  }
  let invested = 0, currentValue = 0, unrealized = 0, unpriced = 0;
  const holdings = [...groups].map(([symbol, group]) => {
    const quantity = group.reduce((sum, l) => sum + l.remaining, 0);
    const cost = group.reduce((sum, l) => sum + l.remaining * l.price + l.charges * (l.remaining / l.quantity), 0);
    const quote = prices && Object.prototype.hasOwnProperty.call(prices, symbol) ? prices[symbol] : null;
    const currentPrice = typeof quote === 'number' && Number.isFinite(quote) && quote >= 0 && Number.isFinite(quote * quantity) ? quote : null;
    const value = currentPrice === null ? null : currentPrice * quantity;
    invested += cost;
    if (value === null) unpriced++;
    else { currentValue += value; unrealized += value - cost; }
    return {
      symbol, name: group[group.length - 1].name, quantity: quantityOut(quantity),
      averageCost: money(cost / quantity), cost: money(cost), currentPrice,
      currentValue: value === null ? null : money(value), unrealized: value === null ? null : money(value - cost),
      coreQuantity: quantityOut(group.filter(l => l.purpose === 'core').reduce((sum, l) => sum + l.remaining, 0)),
      tradingQuantity: quantityOut(group.filter(l => l.purpose === 'trading').reduce((sum, l) => sum + l.remaining, 0)),
      lots: lots.filter(l => l.symbol === symbol).map(l => ({ id: l.id, date: l.date, purpose: l.purpose, quantity: quantityOut(l.quantity), remaining: quantityOut(l.remaining), price: l.price, chargesRemaining: money(l.charges * (l.remaining / l.quantity)) })),
    };
  });
  const months = new Map();
  for (const cycle of rawCycles) {
    const month = cycle.sellDate.slice(0, 7);
    if (!months.has(month)) months.set(month, { month, net: 0, gross: 0, charges: 0 });
    const result = months.get(month);
    result.net += cycle.net;
    result.gross += cycle.gross;
    result.charges += cycle.charges;
  }
  const monthlyResults = [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(m => ({ month: m.month, net: money(m.net), gross: money(m.gross), charges: money(m.charges) }));
  const cycles = rawCycles.map(c => ({ ...c, quantity: quantityOut(c.quantity), gross: money(c.gross), charges: money(c.charges), net: money(c.net) }));
  return {
    holdings, cycles, monthlyResults, errors,
    totals: { invested: money(invested), currentValue: money(currentValue), unrealized: money(unrealized),
      realizedGross: money(realizedGross), charges: money(charges), realizedNet: money(realizedNet), fifoNet: money(fifoNet),
      cycles: cycles.length, wins: cycles.filter(c => c.net > 0).length, losses: cycles.filter(c => c.net < 0).length, unpriced, unknownCharges },
  };
}
