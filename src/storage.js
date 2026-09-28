import { validateTransaction, analyse } from "./ledger.js";
export const KEY = "lotbook.private.v1";
const referenceNumber=(value,field)=>{
 const number=Number(value);if(!Number.isFinite(number))throw Error(`Invalid ${field} in saved reference report.`);return number;
};
const referenceDate=value=>{
 if(value===undefined||value===null||value==='')return null;
 const text=String(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw Error('Invalid date in saved reference report.');return text;
};
function validateReferenceReports(raw){
 if(raw===undefined)return [];
 if(!Array.isArray(raw)||raw.length>40)throw Error('Invalid saved reference reports.');
 let total=0;
 return raw.map(report=>{
  if(!report||typeof report!=='object'||!['pnl','capital-gains'].includes(report.kind))throw Error('Invalid saved reference report.');
  const entries=Array.isArray(report.entries)?report.entries:[];
  total+=entries.length;if(total>20000)throw Error('Too many saved reference rows.');
  const start=referenceDate(report.period?.start),end=referenceDate(report.period?.end);
  if(start&&end&&start>end)throw Error('Invalid reference report period.');
  return {id:String(report.id||'').slice(0,120),kind:report.kind,importedAt:referenceDate(report.importedAt)||'',period:{start,end},entries:entries.map(entry=>{
   if(!entry||typeof entry!=='object')throw Error('Invalid saved reference entry.');
   const type=entry.type==='unrealised'?'unrealised':entry.type==='realised'?'realised':null;
   if(!type)throw Error('Invalid reference P&L type.');
   const term=['short-term','long-term','unclassified'].includes(entry.term)?entry.term:'unclassified';
   const next={symbol:String(entry.symbol||'').trim().slice(0,200),isin:String(entry.isin||'').trim().slice(0,200),kind:report.kind,type,term,sheet:String(entry.sheet||'').slice(0,120),sourceRow:referenceNumber(entry.sourceRow,'reference row'),pnl:referenceNumber(entry.pnl,'reference P&L')};
   if(!next.symbol||!Number.isInteger(next.sourceRow)||next.sourceRow<1)throw Error('Invalid saved reference entry.');
   for(const field of ['quantity','buyPrice','sellPrice','buyValue','sellValue'])if(entry[field]!==undefined){const value=referenceNumber(entry[field],field);if(field==='quantity'&&value<0)throw Error('Invalid reference quantity.');next[field]=value;}
   for(const field of ['buyDate','sellDate','closingDate'])if(entry[field]!==undefined){const value=referenceDate(entry[field]);if(!value)throw Error('Invalid reference date.');next[field]=value;}
   return next;
  })};
 });
}
const snapshotNumber=value=>{
 if(typeof value!=='number'&&!(typeof value==='string'&&value.trim()))throw Error('Invalid snapshot number.');
 const number=Number(value);if(!Number.isFinite(number)||number<0)throw Error('Invalid snapshot number.');return number;
};
export function fresh() {
  return {
    version: 1,
    profile: "",
    onboarded: false,
    transactions: [],
    prices: {},
    snapshots: [],
    snapshotComplete: false,
    snapshotDate: '',
    cash: null,
    privacyMode: false,
    imports: [],
    referenceReports: [],
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
  const ids = new Set(), executions=[];
  state.transactions = raw.transactions.map((t) => {
    const v = validateTransaction(t);
    if (!v.id || ids.has(v.id))
      throw Error("Duplicate or missing transaction ID.");
    ids.add(v.id);
    if(v.tradeId){
      if(executions.some(t=>t.tradeId===v.tradeId&&t.date===v.date&&(!t.exchange||!v.exchange||t.exchange===v.exchange)))throw Error('Duplicate source trade execution in backup.');
      executions.push(v);
    }
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
  state.privacyMode = raw.privacyMode === true;
  state.snapshots = (Array.isArray(raw.snapshots) ? raw.snapshots : [])
    .slice(-20000)
    .map((s) => ({
      symbol: String(s.symbol || "").trim().toUpperCase(),
      quantity: snapshotNumber(s.quantity),
      averageCost: s.averageCost===null||s.averageCost===undefined&&s.price===undefined ? null : snapshotNumber(s.averageCost??s.price),
      isin: String(s.isin||'').slice(0,200),
    }));
  if (
    state.snapshots.some(
      (s) =>
        !s.symbol ||
        !Number.isFinite(s.quantity) ||
        s.quantity < 0 ||
        s.averageCost!==null&&(!Number.isFinite(s.averageCost) || s.averageCost < 0),
    )
  )
    throw Error("Invalid holdings snapshot.");
  if(new Set(state.snapshots.map(s=>s.symbol)).size!==state.snapshots.length)throw Error('Duplicate stock in holdings snapshot. Combine rows before restoring.');
  state.snapshotComplete=raw.snapshotComplete===true;
  state.snapshotDate=String(raw.snapshotDate||'').slice(0,10);
  state.imports = (Array.isArray(raw.imports) ? raw.imports : [])
    .slice(-100)
    .map((i) => ({
      date: String(i.date || ""),
      kind: String(i.kind || ""),
      count: Number(i.count) || 0,
    }));
  state.referenceReports = validateReferenceReports(raw.referenceReports);
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
export function saveIfUnchanged(state, expectedRaw) {
  if(localStorage.getItem(KEY)!==expectedRaw)throw Error('This diary changed in another tab. Refresh to load the latest saved data before making changes.');
  save(state);
}
