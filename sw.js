/* Solo archivos públicos. Nunca se cachean las películas, credenciales ni API. */
const CACHE = 'mi-filmoteca-shell-v6-social';
const SHELL = ['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./assets/icon-maskable-512.png','./assets/icon-180.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()).catch(()=>{}));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(url.pathname.endsWith('config.js')||url.pathname.endsWith('index.html')||url.pathname.endsWith('/')){
    event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));return;
  }
  event.respondWith(caches.match(event.request).then(c=>c||fetch(event.request)));
});
