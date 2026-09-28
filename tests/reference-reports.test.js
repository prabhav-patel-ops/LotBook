import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReferenceRows, summarizeReferenceEntries } from '../src/reference-reports.js';
import { validateBackup } from '../src/storage.js';

const headers=['Stock name','ISIN','Quantity','Buy date','Buy price','Buy value','Sell date','Sell price','Sell value','Realised P&L'];

test('Capital Gains keeps Groww short-term and long-term realised rows separate',()=>{
  const result=parseReferenceRows([
    ['Capital Gains Statement for stocks from 01-04-2025 To 31-03-2026'],
    ['Short Term trades'],headers,['SYNTH ST','INESYNTH001',2,'01-06-2025',100,200,'01-08-2025',130,260,60],
    ['Long Term trades'],headers,['SYNTH LT','INESYNTH002',1,'01-01-2024',100,100,'02-01-2026',250,250,150],
  ],'capital-gains');
  assert.equal(result.entries.length,2);
  assert.deepEqual(result.entries.map(entry=>entry.term),['short-term','long-term']);
  assert.deepEqual(result.period,{start:'2025-04-01',end:'2026-03-31'});
  assert.deepEqual(result.summary,{realised:210,unrealised:0,shortTerm:60,longTerm:150,unclassified:0});
});

test('P&L keeps realised and unrealised entries as reference data without inventing trades',()=>{
  const result=parseReferenceRows([
    ['Realised trades'],headers,['SYNTH R','INESYNTH003',3,'01-01-2026',100,300,'02-01-2026',90,270,'(30)'],
    ['Unrealised trades'],['Stock name','ISIN','Quantity','Buy value','Closing date','Unrealised P&L'],['SYNTH U','INESYNTH004',4,400,'31-03-2026',25],
  ],'pnl','Trade Level');
  assert.equal(result.entries.length,2);
  assert.deepEqual(result.entries.map(entry=>[entry.type,entry.pnl]),[['realised',-30],['unrealised',25]]);
  assert.deepEqual(summarizeReferenceEntries(result.entries),{realised:-30,unrealised:25,shortTerm:0,longTerm:0,unclassified:-30});
});

test('reference reports survive a private backup and malformed tax data is rejected',()=>{
  const entries=parseReferenceRows([['Short Term trades'],headers,['SYNTH','INESYNTH005',1,'01-01-2026',100,100,'02-01-2026',120,120,20]],'capital-gains').entries;
  const restored=validateBackup({version:1,profile:'Tester',onboarded:true,transactions:[],referenceReports:[{id:'cg-1',kind:'capital-gains',importedAt:'2026-09-28',period:{start:'2026-04-01',end:'2027-03-31'},entries}]});
  assert.equal(restored.referenceReports[0].entries[0].pnl,20);
  assert.throws(()=>validateBackup({version:1,transactions:[],referenceReports:[{kind:'capital-gains',entries:[{symbol:'SYNTH',type:'realised',term:'short-term',sourceRow:1,pnl:'bad'}]}]}),/reference P&L/);
});
