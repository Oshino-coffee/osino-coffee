const CACHE = 'mogi-pos-v2'; // キャッシュ名更新で確実に上書き
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=> c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=> Promise.all(keys.map(k=> k===CACHE?null:caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e=>{
  const req = e.request;
  if (new URL(req.url).origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(cached => cached ||
        fetch(req).then(res=>{
          const copy = res.clone();
          caches.open(CACHE).then(c=> c.put(req, copy));
          return res;
        }).catch(()=> caches.match('./index.html'))
      )
    );
  }
});
