// Service worker do Scanner: guarda a app para abrir depressa e sem rede.
// A app é pedida sempre primeiro à rede e sem usar a cache do browser (o GitHub Pages deixa guardar 10 min),
// por isso cada vez que abres recebes logo a versão nova; a cópia guardada só é usada sem ligação.
// Os dados de mercado (Binance, Yahoo) e o Firebase nunca passam pela cache.
const CACHE = 'scanner-v2';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;   // só os ficheiros da própria app
  const page = e.request.mode === 'navigate';
  // a página (com ou sem ?a=… dos links do Telegram) guarda-se sempre como index.html — uma só cópia
  const key = page ? './index.html' : e.request;
  const req = page ? new Request(u.pathname, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(fetch(req).then((r) => {
    if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(key, cp)); }
    return r;
  }).catch(() => caches.match(key, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});
