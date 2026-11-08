// Offline shell for Draco Code. Drafts and theme preference remain in local storage;
// execution requests are cross-origin and are deliberately never cached or intercepted.
const VERSION = 'draco-shell-v5';
const CACHE = VERSION;
const SHELL = [
  './',
  'app/styles.css',
  'app/app.js',
  'app/project.css',
  'app/features.css',
  'app/terminal.js',
  'app/features-core.js',
  'app/examples.js',
  'app/features.js',
  'app/project-core.js',
  'app/project-data.js',
  'app/project.js',
  'assets/design.css',
  'assets/theme.js',
  'assets/highlight.js',
  'assets/editor.js',
  'assets/config.js',
  'favicon.ico',
  'assets/draco-code-logo.png',
  'assets/draco-code-logo-64.png',
  'assets/cageddragon-logo.png',
  'assets/cageddragon-logo-96.png',
  'assets/icons/favicon-32.png',
  'assets/icons/favicon-64.png',
  'assets/fonts/bricolage.woff2',
  'assets/fonts/jetbrains-mono.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('draco-shell-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) await cache.put(cacheKey || request, fresh.clone());
    return fresh;
  } catch {
    const hit = await cache.match(cacheKey || request, { ignoreSearch: !cacheKey });
    if (hit) return hit;
    throw new Error('Offline and no cached app shell is available.');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response?.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await network || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/assets/config.js') || url.pathname.endsWith('/sw.js')) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, new Request('./')).catch(async () => (await caches.match('./')) || Response.error()));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
