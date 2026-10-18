import test from 'node:test';
import assert from 'node:assert/strict';
import {analyse} from '../src/ledger.js';
import {holdingPriceSignal} from '../src/ui-logic.js';
import {prepareTradeReplacement, applyVerifiedCorporateActions, reconcileHoldings, suspectedShareAdjustmentSymbols} from '../src/import-workflow.js';
import {fresh, validateBackup} from '../src/storage.js';

const buy=(symbol,date,quantity,price,id)=>({id,symbol,date,side:'BUY',quantity,price,charges:0,chargesKnown:true,purpose:'core'});
const event=(symbol='LICI',type='BONUS',factor=2,exDate='2026-05-29')=>({symbol,type,factor,exDate,source:'NSE + Yahoo'});

test('complete statement replacement excludes old manual Reliance',()=>{
 const old=buy('RELIANCE','2026-01-01',2,1000,'manual-reliance');
 const replacement=prepareTradeReplacement([buy('TCS','2026-10-01',3,2000,'source')],()=> 'new-tcs');
 assert.equal(replacement.errors.length,0);
 const state=validateBackup({...fresh(),transactions:replacement.transactions});
 assert.deepEqual(state.transactions.map(t=>t.symbol),['TCS']);
 assert.equal(state.transactions.some(t=>t.id===old.id),false);
});

test('rights-entitlement sales remain visible but never block equity replacement or invent lots',()=>{
 const rows=[buy('ABC','2026-01-01',2,100,'a'),
  {id:'rights',symbol:'STALL-RE',date:'2026-01-02',side:'SELL',quantity:11,price:3,charges:0,chargesKnown:false,purpose:'core'},
  {id:'sell',symbol:'ABC',date:'2026-01-03',side:'SELL',quantity:1,price:120,charges:0,chargesKnown:false,purpose:'core'}];
 const plan=prepareTradeReplacement(rows,(()=>{let i=0;return()=>`import-${++i}`;})());
 assert.equal(plan.errors.length,0);
 assert.equal(plan.added,2);
 assert.deepEqual(plan.rightsTrades.map(t=>t.symbol),['STALL-RE']);
 const state=validateBackup({...fresh(),transactions:plan.transactions,rightsTrades:plan.rightsTrades});
 assert.equal(state.rightsTrades[0].quantity,11);
 assert.equal(analyse(state.transactions).totals.realizedNet,20);
});

test('verified LICI bonus repairs existing saved holdings and cost without a re-import',()=>{
 const transactions=[buy('LICI','2026-05-01',4,900,'lic-buy')];
 const snapshots=[{symbol:'LICI',quantity:8,averageCost:450}];
 const result=applyVerifiedCorporateActions(transactions,[event()],snapshots,'2026-10-13');
 assert.equal(result.issues.length,0);
 assert.equal(result.applied.length,1);
 assert.equal(result.applied[0].quantity,4);
 assert.equal(result.applied[0].price,0);
 assert.equal(result.applied[0].corporateAction,'BONUS');
 const holding=analyse(result.transactions,{LICI:450}).holdings.find(h=>h.symbol==='LICI');
 assert.equal(holding.quantity,8);
 assert.equal(holding.cost,3600);
 assert.equal(holding.averageCost,450);
 assert.equal(holding.unrealized,0);
 assert.equal(holding.lots.length,2);
 assert.equal(holding.lots.find(lot=>lot.id==='lic-buy').price,900);
 assert.equal(holdingPriceSignal(holding).lowestPrice,450);
 assert.equal(reconcileHoldings(result.transactions,snapshots)[0].difference,0);
 validateBackup({...fresh(),transactions:result.transactions});
 assert.equal(applyVerifiedCorporateActions(result.transactions,[event()],snapshots,'2026-10-13').applied.length,0);
});

test('snapshot quantity and average cost generically request a fresh verified share-action check',()=>{
 const transactions=[buy('LICI','2026-05-01',5,808,'lic-buy'),buy('OTHER','2026-05-01',4,100,'other')];
 const snapshots=[{symbol:'LICI',quantity:10,averageCost:404},{symbol:'OTHER',quantity:6,averageCost:100}];
 assert.deepEqual(suspectedShareAdjustmentSymbols(transactions,snapshots,'2026-10-15'),['LICI']);
});

test('bonus and split adjust the lowest open buy before the price signal',()=>{
 const bonusTransactions=[buy('LICI','2026-05-01',4,808,'lic-buy'),{
  id:'bonus:LICI:2026-05-29',symbol:'LICI',date:'2026-05-29',side:'BUY',quantity:4,price:0,
  charges:0,chargesKnown:true,purpose:'core',corporateAction:'BONUS'
 }];
 const afterBonus=analyse(bonusTransactions,{LICI:500}).holdings[0];
 assert.equal(afterBonus.quantity,8);
 assert.equal(afterBonus.cost,3232);
 assert.equal(afterBonus.lots.length,2);
 assert.equal(afterBonus.lots.find(lot=>lot.id==='lic-buy').price,808);
 assert.deepEqual(holdingPriceSignal(afterBonus),{status:'above',lowestPrice:404,difference:96});

 const splitResult=applyVerifiedCorporateActions(
  [buy('ABC','2026-01-01',2,808,'abc-buy')],
  [event('ABC','SPLIT',2,'2026-05-29')],
 );
 const afterSplit=analyse(splitResult.transactions,{ABC:500}).holdings[0];
 assert.equal(afterSplit.lots[0].price,404);
 assert.deepEqual(holdingPriceSignal(afterSplit),{status:'above',lowestPrice:404,difference:96});
});

test('bonus comparison adjusts only purchases eligible on the action date',()=>{
 const transactions=[
  buy('ABC','2026-01-01',4,808,'buy'),
  {...buy('ABC','2026-02-01',2,900,'sale'),side:'SELL'},
  {id:'bonus',symbol:'ABC',date:'2026-05-29',side:'BUY',quantity:2,price:0,charges:0,chargesKnown:true,purpose:'core',corporateAction:'BONUS'},
  buy('ABC','2026-06-01',2,500,'after'),
 ];
 const holding=analyse(transactions,{ABC:450}).holdings[0];
 assert.equal(holding.quantity,6);
 assert.equal(holding.lots.find(lot=>lot.id==='buy').price,808);
 assert.equal(holding.lots.find(lot=>lot.id==='after').price,500);
 assert.equal(holdingPriceSignal(holding).lowestPrice,404);
});

test('events do not invent shares for post-ex-date buyers or a different symbol',()=>{
 assert.equal(applyVerifiedCorporateActions([buy('LICI','2026-06-02',2,500,'after')],[event()]).applied.length,0);
 assert.equal(applyVerifiedCorporateActions([buy('LICHSGFIN','2026-05-01',2,500,'other')],[event()]).applied.length,0);
});

test('broker snapshot mismatch and unverified factor block automatic adjustment',()=>{
 const transactions=[buy('LICI','2026-05-01',4,900,'lic-buy')];
 const missing=applyVerifiedCorporateActions(transactions,[event()]);
 assert.equal(missing.applied.length,1);
 const mismatch=applyVerifiedCorporateActions(transactions,[event()],[{symbol:'LICI',quantity:7}], '2026-10-13');
 assert.equal(mismatch.applied.length,0);
 assert.match(mismatch.issues[0],/snapshot/);
 assert.equal(applyVerifiedCorporateActions(transactions,[{...event(),source:'Yahoo'}]).applied.length,0);
});

test('generic verified split scales pre-event lots and preserves invested cost',()=>{
 const transactions=[buy('ABC','2026-01-01',4,800,'old'),buy('ABC','2026-07-01',2,410,'new')];
 const result=applyVerifiedCorporateActions(transactions,[event('ABC','SPLIT',2,'2026-05-29')],[{symbol:'ABC',quantity:10}],'2026-10-13');
 assert.equal(result.applied.length,1);
 const holding=analyse(result.transactions,{ABC:400}).holdings[0];
 assert.equal(holding.quantity,10);
 assert.equal(holding.cost,4020);
 assert.equal(holding.averageCost,402);
 assert.equal(holding.lots.find(l=>l.id==='old').price,400);
 assert.equal(holding.lots.find(l=>l.id==='new').price,410);
 validateBackup({...fresh(),transactions:result.transactions});
});

test('existing legacy LICI bonus is not doubled by a later verification',()=>{
 const transactions=[buy('LICI','2026-05-01',4,900,'old'),{
  id:'bonus:LICI:2026-06-01',symbol:'LICI',date:'2026-06-01',side:'BUY',quantity:4,price:0,charges:0,chargesKnown:true,purpose:'core',corporateAction:'BONUS'
 }];
 const result=applyVerifiedCorporateActions(transactions,[event()]);
 assert.equal(result.applied.length,0);
 assert.equal(analyse(result.transactions).holdings[0].quantity,8);
});

test('complete replacement blocks duplicate source executions before saving',()=>{
 const row={...buy('TCS','2026-10-01',2,2000,'x'),tradeId:'fill-7',exchange:'NSE'};
 const result=prepareTradeReplacement([row,row],(()=>{let n=0;return()=>`new-${++n}`;})());
 assert.match(result.errors[0].message,/Duplicate source trade execution/);
});

test('verified actions resolve bonus-share sales before replacement validation',()=>{
 const rows=[buy('LICI','2026-05-01',4,900,'b'),{...buy('LICI','2026-06-05',6,450,'s'),side:'SELL'}];
 const plan=prepareTradeReplacement(rows,undefined,[event()]);
 assert.equal(plan.errors.length,0);
 assert.equal(plan.adjustments.length,1);
 assert.equal(analyse(plan.transactions).holdings[0].quantity,2);
});

test('dated snapshots exclude later trades when confirming a bonus',()=>{
 const rows=[buy('ABC','2026-01-01',10,100,'b'),{...buy('ABC','2026-07-01',5,60,'s'),side:'SELL'}];
 const good=applyVerifiedCorporateActions(rows,[event('ABC')],[{symbol:'ABC',quantity:20}],'2026-06-01');
 assert.equal(good.applied.length,1);
 const bad=applyVerifiedCorporateActions(rows,[event('ABC')],[{symbol:'ABC',quantity:15}],'2026-06-01');
 assert.equal(bad.applied.length,0);
});

test('multiple verified actions are staged together before snapshot reconciliation',()=>{
 const rows=[buy('ABC','2026-01-01',10,100,'b')];
 const events=[event('ABC','SPLIT',2,'2026-02-01'),event('ABC')];
 const result=applyVerifiedCorporateActions(rows,events,[{symbol:'ABC',quantity:40}],'2026-06-01');
 assert.equal(result.applied.length,2);
 assert.equal(analyse(result.transactions).holdings[0].cost,1000);
 assert.equal(analyse(result.transactions).holdings[0].quantity,40);
});

test('legacy diary preserves working allocations when cheapest-first would exhaust a selected lot',()=>{
 const rows=[buy('ABC','2026-01-01',5,200,'dear'),buy('ABC','2026-01-02',5,100,'cheap'),
  {...buy('ABC','2026-01-03',5,250,'s1'),side:'SELL'},
  {...buy('ABC','2026-01-04',5,250,'s2'),side:'SELL',allocations:[{lotId:'cheap',quantity:5}]}];
 const legacy={...fresh(),transactions:rows};delete legacy.lotPolicy;
 const restored=validateBackup(legacy);
 assert.equal(analyse(restored.transactions).errors.length,0);
 assert.equal(restored.transactions[2].allocations[0].lotId,'dear');
 assert.equal(restored.transactions[3].allocations[0].lotId,'cheap');
 assert.equal(restored.lotPolicy,'lowest-v2');
});
