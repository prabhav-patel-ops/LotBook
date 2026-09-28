import {analyse, validateTransaction} from './ledger.js';

const sameTrade = (a,b) => a.symbol===b.symbol && a.date===b.date && a.side===b.side && a.quantity===b.quantity && Math.abs(a.price-b.price)<=Number.EPSILON*16*Math.max(a.price,b.price);
const tradeRef = t => t.tradeId ? JSON.stringify([t.exchange||'',t.date,t.tradeId]) : null;
const metadata = ['isin','exchange','orderId','exchangeOrderId','tradeId','tradeTime'];
const refMatches = (a,b) => a.tradeId&&b.tradeId&&a.tradeId===b.tradeId&&a.date===b.date&&(!a.exchange||!b.exchange||a.exchange===b.exchange);
const compatible = (a,b) => metadata.every(field=>!a[field]||!b[field]||a[field]===b[field]);
const canMatch = (a,b) => sameTrade(a,b) && compatible(a,b);
function mergeTrade(previous,next) {
 if(!sameTrade(previous,next)||!compatible(previous,next))throw Error(`Conflicting execution details for ${next.symbol} on ${next.date}${next.tradeId?' (trade '+next.tradeId+')':''}.`);
 if(previous.chargesKnown&&next.chargesKnown&&previous.charges!==next.charges)throw Error(`${next.symbol} on ${next.date}: existing and imported charges differ. Review the trade's charges before importing.`);
 const merged={...previous};
 if(!previous.chargesKnown&&next.chargesKnown){merged.charges=next.charges;merged.chargesKnown=true;}
 for(const field of metadata)if(!merged[field]&&next[field])merged[field]=next[field];
 if((!merged.name||merged.name===merged.symbol)&&next.name)merged.name=next.name;
 return merged;
}

/** Multiset matching preserves separate identical fills on the first import.
 * Existing records are matched at most once per statement; stable trade IDs are unique.
 * Import confirmation may enrich missing fees/metadata, never replace lot IDs or allocations.
 */
export function planTransactions(existing, incoming, createId=()=>crypto.randomUUID()) {
 const transactions=existing.map(t=>validateTransaction(t)), used=new Set(), candidates=[];
 const conflicts=[];let added=0,skipped=0,updated=0;
 for(const raw of incoming){
  const next=validateTransaction({...raw,id:createId(),purpose:raw.purpose||'core'}),ref=tradeRef(next);
  const sameRefs=ref?candidates.flatMap((t,i)=>refMatches(t,next)?[i]:[]):[];
  const knownNamespaces=ref?new Set([...existing,...incoming].filter(t=>t.tradeId===next.tradeId&&t.date===next.date&&t.exchange).map(t=>t.exchange)):new Set();
  if(ref&&!next.exchange&&knownNamespaces.size>1){conflicts.push(`Trade ${next.tradeId} has no exchange and matches multiple exchange namespaces. Review the source identifier.`);continue;}
  if(sameRefs.length>1){conflicts.push(`Ambiguous source trade ID ${next.tradeId}. Supply the exchange before importing.`);continue;}
  if(sameRefs.length===1){
   const index=sameRefs[0];
   try { candidates[index]=mergeTrade(candidates[index],next); skipped++; } catch(e){conflicts.push(e.message);}
   continue;
  }
  candidates.push(next);
 }
 const reserved=new Set(),identifiedMatches=new Map();
 for(const next of candidates){if(next.tradeId){const indices=transactions.flatMap((t,i)=>refMatches(t,next)?[i]:[]);indices.forEach(i=>reserved.add(i));if(indices.length>1){conflicts.push(`Trade ${next.tradeId} matches multiple saved executions. Review its exchange.`);identifiedMatches.set(next,-2);}else identifiedMatches.set(next,indices[0]??-1);}}
 const originalLength=transactions.length;
 for(const next of candidates){
  const byRef=identifiedMatches.get(next)??-1;
  if(byRef===-2)continue;
  const match=byRef>=0?byRef:transactions.findIndex((t,i)=>i<originalLength&&!used.has(i)&&!reserved.has(i)&&canMatch(t,next));
  if(match>=0){
   used.add(match);const previous=transactions[match];
   let merged;try{merged=mergeTrade(previous,next);}catch(e){conflicts.push(e.message);continue;}
   if(JSON.stringify(merged)!==JSON.stringify(previous)){transactions[match]=merged;updated++;}
   skipped++;continue;
  }
  transactions.push(next);added++;
 }
 const errors=analyse(transactions).errors;
 return {transactions,added,skipped,updated,conflicts,errors};
}

/** Match reported identifiers exactly; never use fuzzy name guesses. */
export function normalizeSnapshots(rows,transactions){
 const snapshots=[],symbols=new Set();
 for(const row of rows){
  let symbol=String(row.symbol||'').trim().toUpperCase();
  const candidates=[...new Set(transactions.filter(t=>
   row.isin&&t.isin===row.isin ||
   t.name&&t.name.toUpperCase()===symbol).map(t=>t.symbol))];
  const exact=transactions.filter(t=>t.symbol===symbol);
  if(row.isin&&exact.some(t=>t.isin&&t.isin!==row.isin))throw Error(`${symbol}: snapshot ISIN conflicts with the diary identifier.`);
  if(exact.length&&candidates.some(candidate=>candidate!==symbol))throw Error(`${symbol}: snapshot identifiers match another diary stock. Review the symbol and ISIN.`);
  if(!exact.length&&candidates.length>1)throw Error(`${symbol}: more than one diary stock matches this snapshot identifier.`);
  if(!exact.length&&candidates.length===1)symbol=candidates[0];
  const quantity=Number(row.quantity),rawAverage=row.avgPrice??row.averageCost,averageCost=rawAverage===null||rawAverage===undefined||rawAverage===''?null:Number(rawAverage);
  if(!symbol||!Number.isFinite(quantity)||quantity<0||averageCost!==null&&(!Number.isFinite(averageCost)||averageCost<0))throw Error('Snapshot requires stock and valid quantity; any supplied average price must be non-negative.');
  if(symbols.has(symbol))throw Error(`${symbol} appears more than once in this snapshot. Combine its quantities and weighted average cost first.`);
  symbols.add(symbol);snapshots.push({symbol,quantity,averageCost,isin:String(row.isin||'')});
 }
 return snapshots;
}

export function reconcileHoldings(transactions,snapshots,{complete=false}={}){
 const holdings=analyse(transactions).holdings,reported=new Map(snapshots.map(s=>[s.symbol,s]));
 const symbols=new Set(snapshots.map(s=>s.symbol));
 if(complete)holdings.forEach(h=>symbols.add(h.symbol));
 return [...symbols].map(symbol=>({symbol,reported:reported.get(symbol)?.quantity||0,actual:holdings.find(h=>h.symbol===symbol)?.quantity||0,averageCost:reported.get(symbol)?.averageCost??null}))
  .map(row=>({...row,difference:row.reported-row.actual}));
}
