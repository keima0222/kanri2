/* Change VERSION on every release. Caches only the public application shell. */
const VERSION='hoan-note-shell-v1.0.0';
const BASE=new URL('./',self.location).href;
const CACHE=VERSION+':'+new URL(BASE).pathname;
const FILES=['./','index.html','style.css','app.js','model.js','db.js','cloud.js','backup.js','manifest.webmanifest','vendor/jszip.min.js','icons/icon-192.png','icons/icon-512.png'];
const ALLOWED=new Set(FILES.map(p=>new URL(p,BASE).href));
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(p=>new URL(p,BASE).href))));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('hoan-note-shell-')&&key.endsWith(':'+new URL(BASE).pathname)&&key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('message',event=>{if(event.data==='ACTIVATE_UPDATE')void self.skipWaiting();});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 const url=new URL(event.request.url);url.hash='';url.search='';
 if(!ALLOWED.has(url.href))return;
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.href))||fetch(event.request)));
});
