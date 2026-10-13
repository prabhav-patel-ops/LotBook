import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchYahooFallback, parseYahooQuote, usableMarketQuote} from '../src/market-data.js';

const now='2026-10-13T03:00:00.000Z';
const body={chart:{result:[{meta:{symbol:'LICI.NS',currency:'INR',regularMarketPrice:391.5,regularMarketTime:Date.parse('2026-10-12T10:00:00Z')/1000}}],error:null}};

test('keyless quote accepts only recent INR quote with exact ticker identity',()=>{
 const quote=parseYahooQuote(body,'LICI',now);
 assert.equal(quote.price,391.5);
 assert.equal(quote.marketAt,'2026-10-12T10:00:00.000Z');
 assert.equal(usableMarketQuote(quote,Date.parse(now)),true);
 assert.throws(()=>parseYahooQuote(body,'RELIANCE',now),/identity/);
 assert.throws(()=>parseYahooQuote({chart:{result:[{meta:{...body.chart.result[0].meta,currency:'USD'}}]}},'LICI',now),/currency/);
 assert.throws(()=>parseYahooQuote({chart:{result:[{meta:{...body.chart.result[0].meta,regularMarketTime:Date.parse('2026-09-01T10:00:00Z')/1000}}]}},'LICI',now),/recent/);
});

test('keyless relay sends only ticker, validates response, and does not require an API key',async()=>{
 const fetched=[];
 const quote=await fetchYahooFallback('LICI',async(url,options)=>{
   fetched.push({url,options});
   return {ok:true,text:async()=>`Title: \n\nMarkdown Content:\n${JSON.stringify(body)}`};
 });
 assert.equal(quote.price,391.5);
 assert.match(fetched[0].url,/LICI.NS/);
 assert.equal(fetched[0].options.headers['X-No-Cache'],'true');
 assert.equal(fetched[0].url.includes('apiKey'),false);
});
