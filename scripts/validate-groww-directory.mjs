import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseStatement } from '../src/importer.js';
import { analyse } from '../src/ledger.js';
import { planTransactions, normalizeSnapshots, reconcileHoldings } from '../src/import-workflow.js';

const directory = process.argv[2];
if (!directory) throw new Error('Pass a local directory containing Groww statement files.');

const classify = name => name.includes('Order_History') ? 'trades'
  : name.includes('Holdings_Statement') ? 'holdings'
  : name.includes('Capital_Gains') ? 'capital-gains'
  : name.includes('PnL') ? 'pnl' : 'unknown';

let trades, holdings;
for (const name of (await readdir(directory)).filter(name => /\.(?:xlsx|xls|csv)$/i.test(name)).sort()) {
  const kind = classify(name);
  const bytes = await readFile(join(directory, name));
  const file = {
    name: basename(name), size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => bytes.toString('utf8'),
  };
  if (kind === 'trades' || kind === 'holdings') {
    const result = await parseStatement(file, kind);
    if(kind==='trades')trades=result.transactions;
    if(kind==='holdings')holdings=result.holdings;
    const plan = kind === 'trades' ? planTransactions([], result.transactions, (()=>{let i=0;return()=>`private-check-${++i}`;})()) : null;
    const ledgerErrors = plan ? analyse(plan.transactions).errors.length : undefined;
    console.log(JSON.stringify({
      kind, selectedSheet: result.selectedSheet, headers: result.headers,
      transactions: result.transactions.length, holdings: result.holdings.length,
      excludedRows: result.rowIssues.length, warnings: result.warnings,
      blockingErrors: result.blockingErrors, fatal: result.fatal,
      columns: result.columns,
      ledgerErrors,
      importConflicts: plan?.conflicts.length,
    }));
  } else {
    const asTrades = await parseStatement(file, 'trades');
    console.log(JSON.stringify({
      kind, recognizedAsTradeHistory: asTrades.transactions.length > 0,
      headers: asTrades.headers, warnings: asTrades.warnings,
      blockingErrors: asTrades.blockingErrors,
    }));
  }
}
if(trades&&holdings){
  const plan=planTransactions([],trades,(()=>{let i=0;return()=>`private-reconcile-${++i}`;})());
  const snapshots=normalizeSnapshots(holdings,plan.transactions);
  const rows=reconcileHoldings(plan.transactions,snapshots,{complete:true});
  console.log(JSON.stringify({kind:'cross-reconciliation',positions:rows.length,quantityMatches:rows.filter(row=>Math.abs(row.difference)<1e-8).length,quantityDifferences:rows.filter(row=>Math.abs(row.difference)>=1e-8).length}));
}
