import { validateTransaction, analyse } from "./ledger.js";
export const KEY = "lotbook.private.v1";
export function fresh() {
  return {
    version: 1,
    profile: "",
    onboarded: false,
    transactions: [],
    prices: {},
    snapshots: [],
    cash: null,
    imports: [],
    notes: {},
  };
}
export function validateBackup(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    !Array.isArray(raw.transactions) ||
    raw.transactions.length > 20000
  )
    throw Error("This is not a supported Lotbook backup (version 1).");
  const state = fresh();
  state.profile = String(raw.profile || "").slice(0, 60);
  state.onboarded = Boolean(raw.onboarded);
  const ids = new Set();
  state.transactions = raw.transactions.map((t) => {
    const v = validateTransaction(t);
    if (!v.id || ids.has(v.id))
      throw Error("Duplicate or missing transaction ID.");
    ids.add(v.id);
    return v;
  });
  const result = analyse(state.transactions);
  if (result.errors.length)
    throw Error(
      "Backup has invalid trading history: " + result.errors[0].message,
    );
  for (const [symbol, value] of Object.entries(raw.prices || {})) {
    if (!symbol.trim() || symbol !== symbol.trim().toUpperCase())
      throw Error("Invalid symbol in price data.");
    const p = Number(value?.price ?? value);
    if (!Number.isFinite(p) || p <= 0) throw Error("Invalid quote.");
    state.prices[symbol] = {
      price: p,
      date: String(value?.date || "").slice(0, 10),
    };
  }
  state.cash =
    raw.cash === null || raw.cash === undefined ? null : Number(raw.cash);
  if (state.cash !== null && (!Number.isFinite(state.cash) || state.cash < 0))
    throw Error("Invalid cash balance.");
  state.snapshots = (Array.isArray(raw.snapshots) ? raw.snapshots : [])
    .slice(-20000)
    .map((s) => ({
      symbol: String(s.symbol || "").trim().toUpperCase(),
      quantity: Number(s.quantity),
      averageCost: Number(s.averageCost || s.price || 0),
    }));
  if (
    state.snapshots.some(
      (s) =>
        !s.symbol ||
        !Number.isFinite(s.quantity) ||
        s.quantity < 0 ||
        !Number.isFinite(s.averageCost) ||
        s.averageCost < 0,
    )
  )
    throw Error("Invalid holdings snapshot.");
  state.imports = (Array.isArray(raw.imports) ? raw.imports : [])
    .slice(-100)
    .map((i) => ({
      date: String(i.date || ""),
      kind: String(i.kind || ""),
      count: Number(i.count) || 0,
    }));
  state.notes = Object.fromEntries(
    Object.entries(raw.notes || {})
      .slice(-500)
      .map(([k, v]) => [String(k).slice(0, 10), String(v).slice(0, 3000)]),
  );
  return state;
}
export function load() {
  const raw = localStorage.getItem(KEY);
  return raw ? validateBackup(JSON.parse(raw)) : fresh();
}
export function save(state) {
  // Validate every write, including undo, so no saved state fails on reload.
  const text = JSON.stringify(validateBackup(state));
  if (text.length > 3500000)
    throw Error(
      "This diary is too large for local storage. Export a backup before adding more records.",
    );
  localStorage.setItem(KEY, text);
}
