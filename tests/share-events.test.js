import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYahooShareEvents, verifyNseShareEvents, fetchVerifiedShareEvents} from '../src/market-data.js';

const stamp=Date.parse('2026-05-29T04:00:00Z')/1000;
const chart={chart:{result:[{meta:{symbol:'LICI.NS',currency:'INR'},events:{splits:{one:{date:stamp,numerator:2,denominator:1,splitRatio:'2:1'}}}}],error:null}};
const nse='| [LICI](https://www.nseindia.com/get-quotes/equity?symbol=LICI) | Life Insurance Corporation Of India | EQ | Bonus 1:1 | 10 | 29-May-2026 | 29-May-2026 | - | - |';

test('Yahoo factor and exact NSE bonus row jointly verify the action',()=>{
 const events=parseYahooShareEvents(chart,'LICI','2026-01-01');
 assert.deepEqual(verifyNseShareEvents(nse,'LICI',events),[{symbol:'LICI',exDate:'2026-05-29',factor:2,type:'BONUS',source:'NSE + Yahoo'}]);
});

test('NSE split classification does not mislabel a bonus and dates must agree',()=>{
 const events=parseYahooShareEvents(chart,'LICI','2026-01-01');
 const split=nse.replace('Bonus 1:1','Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 5/- Per Share');
 assert.equal(verifyNseShareEvents(split,'LICI',events)[0].type,'SPLIT');
 assert.throws(()=>verifyNseShareEvents(split.replace('To Rs 5','To Rs 2'),'LICI',events),/could not be confirmed/);
 assert.throws(()=>verifyNseShareEvents(nse.replace('29-May-2026','30-May-2026'),'LICI',events),/could not be confirmed/);
 assert.throws(()=>verifyNseShareEvents(nse.replace('Bonus 1:1','Bonus 2:1'),'LICI',events),/could not be confirmed/);
 assert.throws(()=>verifyNseShareEvents(nse.replaceAll('LICI','OTHER'),'LICI',events),/could not be confirmed/);
});

test('ticker and currency mismatch cannot create verified shares',()=>{
 assert.throws(()=>parseYahooShareEvents(chart,'RELIANCE','2026-01-01'),/identity/);
 assert.throws(()=>parseYahooShareEvents({chart:{result:[{...chart.chart.result[0],meta:{symbol:'LICI.NS',currency:'USD'}}]}},'LICI','2026-01-01'),/identity/);
});

test('only public ticker history is requested, never portfolio dates or records',async()=>{
 const urls=[];
 const fetcher=async url=>{
  urls.push(url);
  return {ok:true,text:async()=>url.includes('yahoo.com')?`Markdown Content:\n${JSON.stringify(chart)}`:nse};
 };
 const events=await fetchVerifiedShareEvents('LICI','2026-01-01',fetcher);
 assert.equal(events[0].type,'BONUS');
 assert.equal(urls.length,2);
 assert.ok(urls.every(url=>url.includes('LICI')&&!url.includes('quantity')&&!url.includes('shares')));
 assert.ok(urls.every(url=>!url.includes('2026-01-01')&&!url.includes('period1')));
});
