import {test} from 'node:test';import assert from 'node:assert/strict';
import {planTransactions,normalizeSnapshots,reconcileHoldings} from '../src/import-workflow.js';
import {analyse} from '../src/ledger.js';
const buy={symbol:'ALPHA',name:'Alpha Limited',date:'2026-09-01',side:'BUY',quantity:5,price:100,charges:0,chargesKnown:false,purpose:'core',isin:'SYNTHETIC-ALPHA'};
let counter=0;const id=()=>`test-${++counter}`;
test('identical independent fills survive first upload; repeat upload is idempotent',()=>{
 const first=planTransactions([],[buy,buy],id);assert.equal(first.added,2);assert.equal(analyse(first.transactions).holdings[0].quantity,10);
 const repeat=planTransactions(first.transactions,[buy,buy],id);assert.equal(repeat.added,0);assert.equal(repeat.skipped,2);
});
test('different stable trade IDs distinguish identical fills and conflicts block guesses',()=>{
 const first=planTransactions([],[{...buy,tradeId:'one'},{...buy,tradeId:'two'}],id);assert.equal(first.added,2);
 const duplicate=planTransactions(first.transactions,[{...buy,tradeId:'one'}],id);assert.equal(duplicate.added,0);
 assert.equal(planTransactions(first.transactions,[{...buy,tradeId:'one',price:200}],id).conflicts.length,1);
});
test('known charges enrich matching records without losing IDs, purposes or allocations',()=>{
 const saved={...buy,id:'original',purpose:'trading'};
 const plan=planTransactions([saved],[{...buy,charges:5,chargesKnown:true,orderId:'report-order'}],id);
 assert.equal(plan.added,0);assert.equal(plan.updated,1);assert.equal(plan.transactions[0].id,'original');assert.equal(plan.transactions[0].purpose,'trading');assert.equal(plan.transactions[0].charges,5);
});
test('known conflicting charges require review, not silent replacement',()=>{
 const existing={...buy,id:'first',chargesKnown:true,charges:2};
 const p=planTransactions([existing],[{...buy,chargesKnown:true,charges:3}],id);assert.equal(p.conflicts.length,1);assert.equal(p.transactions[0].charges,2);
});
test('same-day actual execution times fix reversed report order; absent times are not guessed',()=>{
 const purchased={...buy,id:'buy',tradeTime:'09:30:00'};const sold={...buy,id:'sell',side:'SELL',price:110,tradeTime:'10:00:00'};
 assert.equal(analyse([sold,purchased]).errors.length,0);
 assert.equal(analyse([{...sold,tradeTime:undefined},{...purchased,tradeTime:undefined}]).errors.length,1);
});
test('unknown charges stay unknown after ledger validation and surface in results',()=>{
 const result=analyse([{...buy,id:'buy'},{...buy,id:'sell',side:'SELL',date:'2026-09-02',price:110}]);
 assert.equal(result.totals.unknownCharges,2);assert.equal(result.cycles[0].chargesKnown,false);
});
test('snapshot resolves exact ISIN/company name, never invents purchases',()=>{
 const transactions=[{...buy,id:'one'}];const snapshots=normalizeSnapshots([{symbol:'Alpha Limited',isin:buy.isin,quantity:5,avgPrice:100}],transactions);
 assert.equal(snapshots[0].symbol,'ALPHA');assert.equal(transactions.length,1);
});
test('complete reconciliation detects diary stocks omitted from current report',()=>{
 const transactions=[{...buy,id:'one'},{...buy,id:'two',symbol:'BETA'}];const snapshots=[{symbol:'ALPHA',quantity:5,averageCost:100}];
 assert.equal(reconcileHoldings(transactions,snapshots,{complete:true}).find(x=>x.symbol==='BETA').difference,-5);
 assert.equal(reconcileHoldings(transactions,snapshots).length,1);
});
