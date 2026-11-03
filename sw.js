const CACHE='igfc-shell-v2';
const SHELL=['./','./index.html','./css/app.css','./config.js','./js/core.js','./js/data.js','./js/app.js','./js/drive.js','./vendor/jszip.min.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('igfc-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url),scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin)return;
  const allowed=new Set(SHELL.map(p=>new URL(p,scope).href));
  if(!allowed.has(url.href))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response}catch(e){const cached=await cache.match(event.request);if(cached)return cached;throw e}
  }));
});
