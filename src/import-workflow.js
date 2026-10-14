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

/** Apply only Yahoo-detected share factors independently confirmed by NSE.
 * A price drop alone never changes share count. A current broker snapshot must
 * agree with the resulting quantity before any saved history is changed.
 */
export function applyVerifiedCorporateActions(transactions, events, snapshots = [], snapshotDate = '') {
 let next=transactions.map(t=>validateTransaction(t));
 const applied=[], issues=[],groups=new Map();
 for(const event of [...events].sort((a,b)=>a.exDate.localeCompare(b.exDate))){
  if(!/^[A-Z0-9&._-]+$/.test(event.symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(event.exDate)||
     !['BONUS','SPLIT'].includes(event.type)||!Number.isFinite(event.factor)||event.factor<=0||event.factor>100||event.factor===1||event.source!=='NSE + Yahoo'){
    issues.push('A share event had invalid or unverified details.');continue;
  }
  if(!groups.has(event.symbol))groups.set(event.symbol,[]);
  groups.get(event.symbol).push(event);
 }
 for(const [symbol,stockEvents] of groups){
  const candidate=next.filter(t=>t.symbol===symbol), staged=[];
  let failed=false;
  for(const event of stockEvents){
   const id=`share:${event.type.toLowerCase()}:${symbol}:${event.exDate}`;
   if(candidate.some(t=>t.id===id || t.corporateAction===event.type && t.date>=event.exDate && Date.parse(t.date)-Date.parse(event.exDate)<=14*86400000))continue;
   const before=candidate.filter(t=>t.date<event.exDate),pre=analyse(before);
   if(pre.errors.length){failed=true;break;}
   const holding=pre.holdings.find(h=>h.symbol===symbol);
   if(!holding?.quantity)continue;
   const source=before.find(t=>t.side==='BUY');
   const isins=new Set(before.filter(t=>t.isin).map(t=>t.isin));
   if(isins.size>1){failed=true;break;}
   const quantity=event.type==='BONUS'?holding.quantity*(event.factor-1):event.factor;
   if(!Number.isFinite(quantity)||quantity<=0 || event.type==='BONUS'&&Math.abs(quantity-Math.round(quantity))>1e-6){failed=true;break;}
   const action=validateTransaction({id,symbol,isin:source?.isin,name:source?.name||symbol,
     date:event.exDate,side:event.type==='BONUS'?'BUY':'SPLIT',quantity,price:0,charges:0,chargesKnown:true,
     purpose:source?.purpose||'core',corporateAction:event.type,
     note:`${event.type==='BONUS'?'Bonus':'Split'} factor ${event.factor}:1; Yahoo factor and NSE corporate action agree.`});
   candidate.push(action);staged.push(action);
  }
  if(!staged.length&&!failed)continue;
  if(failed||analyse(candidate).errors.length){issues.push(`${symbol}: share changes need complete trade history or fractional-entitlement review.`);continue;}
  const snapshot=snapshots.find(s=>s.symbol===symbol);
  if(snapshot&&snapshotDate&&staged.some(t=>t.date<=snapshotDate)){
   const atDate=analyse(candidate.filter(t=>t.date<=snapshotDate));
   if(atDate.errors.length||Math.abs((atDate.holdings.find(h=>h.symbol===symbol)?.quantity||0)-snapshot.quantity)>1e-6){
    issues.push(`${symbol}: verified share events do not match the dated broker snapshot; nothing was changed.`);continue;
   }
  }
  next.push(...staged);applied.push(...staged);
 }
 return {transactions:next,applied,issues};
}

/** A full broker order-history import replaces the diary, never merges test trades. */
export function prepareTradeReplacement(incoming, createId=()=>crypto.randomUUID(), events=[]) {
 const imported=incoming.map(raw=>validateTransaction({...raw,id:createId(),purpose:raw.purpose||'core'}));
 // NSE rights entitlements have a separate ISIN and may be credited by a corporate
 // issue, not acquired in the order-history file. Do not invent an equity purchase.
 const rightsTrades=imported.filter(t=>/-RE$/.test(t.symbol));
 const adjusted=applyVerifiedCorporateActions(imported.filter(t=>!/-RE$/.test(t.symbol)),events);
 const transactions=adjusted.transactions;
 const errors=analyse(transactions).errors;
 const seen=new Set();
 for(const trade of imported){
  const ref=tradeRef(trade);
  if(ref&&seen.has(ref))errors.push({id:trade.id,message:`Duplicate source trade execution ${trade.tradeId} on ${trade.date}. Review the statement.`});
  if(ref)seen.add(ref);
 }
 return {transactions,rightsTrades,errors,added:imported.length-rightsTrades.length,adjustments:adjusted.applied,skipped:0,updated:0,conflicts:adjusted.issues};
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
