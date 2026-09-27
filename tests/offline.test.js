import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('offline navigation preserves the app shell when visiting the guide',async()=>{
 const root='https://example.test/LotBook/', handlers={}, saved=new Map();
 const key=request=>typeof request==='string'?request:request.url;
 const cache={addAll:async urls=>urls.forEach(url=>saved.set(url,new Response('app shell'))),put:async(request,response)=>saved.set(key(request),response)};
 let offline=false,claimed=false;
 const context={URL,Response,
  self:{location:new URL(root+'sw.js'),addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{claimed=true;}}},
  caches:{open:async()=>cache,keys:async()=>['lotbook-shell-v1'],delete:async()=>true,match:async request=>saved.get(key(request))?.clone()},
  fetch:async request=>{if(offline)throw Error('offline');return new Response(key(request).endsWith('guide.html')?'guide':'app shell');}
 };
 vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),context);
 let pending;handlers.install({waitUntil:p=>pending=p});await pending;
 handlers.activate({waitUntil:p=>pending=p});await pending;assert.equal(claimed,true);
 async function navigate(url){const sideEffects=[];let response;handlers.fetch({request:{url,method:'GET',mode:'navigate'},respondWith:p=>response=p,waitUntil:p=>sideEffects.push(p)});const resolved=await response;await Promise.all(sideEffects);return resolved.text();}
 assert.equal(await navigate(root+'guide.html'),'guide');
 offline=true;
 assert.equal(await navigate(root),'app shell');
 assert.equal(await navigate(root+'guide.html'),'guide');
 assert.equal(await navigate(root+'unknown'),'app shell');
 let handled=false;handlers.fetch({request:{url:root,method:'POST',mode:'navigate'},respondWith:()=>handled=true});assert.equal(handled,false);
});
