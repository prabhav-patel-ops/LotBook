import test from 'node:test';
import assert from 'node:assert/strict';
import {analyse} from '../src/ledger.js';
import {prepareTradeReplacement, reconcileHoldings} from '../src/import-workflow.js';
import {fresh, validateBackup} from '../src/storage.js';

const buy=(symbol,date,quantity,price,id)=>({id,symbol,date,side:'BUY',quantity,price,charges:0,chargesKnown:true,purpose:'core'});

test('complete statement replacement excludes old manual Reliance and preserves valid statement lots',()=>{
 const old=buy('RELIANCE','2026-01-01',2,1000,'manual-reliance');
 const replacement=prepareTradeReplacement([buy('TCS','2026-10-01',3,2000,'source')],()=> 'new-tcs');
 assert.equal(replacement.errors.length,0);
 const state=validateBackup({...fresh(),transactions:replacement.transactions});
 assert.deepEqual(state.transactions.map(t=>t.symbol),['TCS']);
 assert.equal(state.transactions.some(t=>t.id===old.id),false);
});

test('LICI 1:1 bonus creates a separate zero-cost lot exactly once',()=>{
 const purchase=buy('LICI','2026-05-01',4,900,'lic-buy');
 const first=prepareTradeReplacement([purchase],()=> 'purchase-1');
 assert.equal(first.errors.length,0);
 assert.equal(first.applied.length,1);
 assert.equal(first.applied[0].quantity,4);
 assert.equal(first.applied[0].price,0);
 assert.equal(first.applied[0].corporateAction,'BONUS');
 const holdings=analyse(first.transactions).holdings.find(h=>h.symbol==='LICI');
 assert.equal(holdings.quantity,8);
 assert.equal(holdings.cost,3600);
 assert.equal(holdings.averageCost,450);
 assert.equal(reconcileHoldings(first.transactions,[{symbol:'LICI',quantity:8,averageCost:450}])[0].difference,0);
 const restored=validateBackup({...fresh(),transactions:first.transactions});
 assert.equal(restored.transactions.find(t=>t.corporateAction==='BONUS')?.price,0);
});

test('no bonus is invented for purchases after ex-date or another LIC symbol',()=>{
 const after=prepareTradeReplacement([buy('LICI','2026-06-02',2,500,'after')],()=> 'after-id');
 const other=prepareTradeReplacement([buy('LICHSGFIN','2026-05-01',2,500,'other')],()=> 'other-id');
 assert.equal(after.applied.length,0);
 assert.equal(other.applied.length,0);
});

test('complete replacement blocks duplicate source executions before saving',()=>{
 const row={...buy('TCS','2026-10-01',2,2000,'x'),tradeId:'fill-7',exchange:'NSE'};
 const result=prepareTradeReplacement([row,row],(()=>{let n=0;return()=>`new-${++n}`;})());
 assert.match(result.errors[0].message,/Duplicate source trade execution/);
});
