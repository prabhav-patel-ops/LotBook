import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,save,load,validateBackup,KEY} from '../src/storage.js';
import {csvCell,allocateLots} from '../src/ui-logic.js';
const store = new Map();
globalThis.localStorage = {getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
const buy = {id:'buy',symbol:'NSE:ABC',side:'BUY',date:'2026-09-01',quantity:2,price:10,charges:0,purpose:'core'};
test('local save, quote and restore accept the same stock identifier',()=>{
 const s={...fresh(),profile:'Synthetic',onboarded:true,transactions:[buy],prices:{'NSE:ABC':{price:12,date:'2026-09-02'}}};
 save(s);assert.deepEqual(load(),validateBackup(s));
});
test('undo cannot write a broken history or overwrite its valid backup',()=>{
 const sell={...buy,id:'sell',side:'SELL',date:'2026-09-02',quantity:1};
 const s={...fresh(),transactions:[sell,buy]};save(s);const previous=store.get(KEY);
 assert.throws(()=>save({...s,transactions:[sell]}),/invalid trading history/);
 assert.equal(store.get(KEY),previous);
});
test('restore rejects duplicate identifiers, invalid balances and bad quotes',()=>{
 assert.throws(()=>validateBackup({...fresh(),transactions:[buy,buy]}),/Duplicate/);
 assert.throws(()=>validateBackup({...fresh(),cash:-1}),/cash/);
 assert.throws(()=>validateBackup({...fresh(),prices:{ABC:{price:Infinity}}}),/quote/);
});
test('CSV export neutralises formulas while preserving numbers and escaping quotes',()=>{
 assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell(' \t@SUM(1)'),'"\' \t@SUM(1)"');
 assert.equal(csvCell('ABC"LTD'),'"ABC""LTD"');assert.equal(csvCell(1250),'"1250"');
});
test('autofill includes tiny fractional remainders and has stable FIFO ordering',()=>{
 const lots=[{id:'old',date:'2026-09-01',price:11,remaining:1},{id:'new',date:'2026-09-02',price:10,remaining:1}];
 const selected=allocateLots(lots,1.000000005);
 assert.equal(selected.length,2);assert.equal(selected.reduce((s,a)=>s+a.quantity,0),1.000000005);
 assert.equal(allocateLots(lots,1,true)[0].lotId,'old');
});
