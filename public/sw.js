const CACHE = 'lotbook-shell-v1';
const root = new URL('./', self.location).href;
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([root, new URL('icon.svg',root).href, new URL('manifest.webmanifest',root).href])).then(()=>self.skipWaiting())); });
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k.startsWith('lotbook-shell-') && k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL(root).pathname)) return;
  // Cache static app assets only. No files, imported records, or account data enter this cache.
  if(event.request.mode === 'navigate') event.respondWith(fetch(event.request).then(response=>{ if(response.ok) {const copy=response.clone(); event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));} return response; }).catch(()=>caches.match(event.request).then(cached=>cached || caches.match(root))));
  else if(/\.(js|mjs|css|png|svg|webmanifest)$/.test(url.pathname)) event.respondWith(caches.match(event.request).then(cached=>cached || fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));}return response;})));
});
