const CACHE = 'fintrack-pwa-v6';
const SHELL = './index.html';
const ASSETS = ['./', SHELL, './styles.css', './balance.js', './adjustments.js', './data.js', './backup.js', './voice-parser.js', './deep-link.js', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    const navigationUrl = new URL(event.request.url);
    if (navigationUrl.searchParams.has('action')) {
      // Once the PWA is controlled, process financial query text from the local
      // shell without forwarding that query to the network.
      event.respondWith(caches.match(SHELL).then(cached => cached || fetch(new URL(SHELL, self.registration.scope))));
      return;
    }
    // The browser keeps the voice query in its address bar while the response is
    // always the canonical shell, preventing one cached document per dictation.
    event.respondWith(fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(SHELL, copy));
        return response;
      })
      .catch(() => caches.match(SHELL)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  })));
});
