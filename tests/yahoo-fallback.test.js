import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchYahooFallback, fetchYahooBatchQuotes, parseYahooQuote, usableMarketQuote} from '../src/market-data.js';

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

test('70 holdings refresh in three batched requests instead of one request per stock',async()=>{
 const holdings=Array.from({length:70},(_,index)=>({symbol:`FAST${index}`,name:`Fast Company ${index} Limited`}));
 const requested=[];
 const result=await fetchYahooBatchQuotes(holdings,async url=>{
   requested.push(url);
   const encoded=url.split('symbols=')[1].split('%26')[0];
   const symbols=decodeURIComponent(encoded).split(',');
   const rows=symbols.map(symbol=>({symbol,response:[{meta:{symbol,currency:'INR',longName:`Fast Company ${Number(symbol.match(/\d+/)[0])} Limited`,regularMarketPrice:100,regularMarketTime:Date.now()/1000}}]}));
   return {ok:true,text:async()=>`Markdown Content:\n${JSON.stringify({spark:{result:rows,error:null}})}`};
 });
 assert.equal(requested.length,3);
 assert.equal(Object.keys(result.quotes).length,70);
 assert.deepEqual(result.errors,[]);
});

test('batch refresh handles direct and verified fallback BSE listings without per-stock rules',async()=>{
 const requested=[];
 const result=await fetchYahooBatchQuotes([
   {symbol:'BSE:NSDL',name:'National Securities Depository Limited'},
   {symbol:'NSE',name:'National Stock Exchange of India Limited'},
 ],async url=>{
   requested.push(url);
   const encoded=url.split('symbols=')[1].split('%26')[0];
   const symbols=decodeURIComponent(encoded).split(',');
   const rows=symbols.flatMap(symbol=>{
     if(symbol==='NSE.NS') return [];
     const longName=symbol==='NSDL.BO'?'National Securities Depository Limited':'National Stock Exchange of India Limited';
     return [{symbol,response:[{meta:{symbol,currency:'INR',longName,regularMarketPrice:500,regularMarketTime:Date.now()/1000}}]}];
   });
   return {ok:true,text:async()=>`Markdown Content:\n${JSON.stringify({spark:{result:rows,error:null}})}`};
 });
 assert.equal(requested.length,3);
 assert.equal(result.quotes['BSE:NSDL'].exchange,'BSE');
 assert.equal(result.quotes.NSE.exchange,'BSE');
 assert.deepEqual(result.errors,[]);
});
