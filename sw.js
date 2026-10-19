const CACHE_NAME = 'cuban-league-v185-captain-details';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=176-20261015-classic-navigation',
  './stats-compact.css?v=185-20261019-captain-details',
  './brand-f05.css?v=182-20261018-f05-2',
  './mobile-navigation.css?v=178-20261015',
  './editorial-ui.js?v=176-20261015',
  './app.js?v=185-20261019-captain-details',
  './data.json?v=174-20261014-mister-j8-catalog',
  './catalog/players.json?v=174-20261014-mister-j8-catalog',
  './player-catalog.js?v=168-20260905-mister-catalog-audit',
  './supabase-config.js?v=161-20260902',
  './admin.html',
  './admin.css?v=176-20261015-classic-navigation',
  './admin.js?v=174-20261014-mister-j8-catalog',
  './mister-import-core.js?v=169',
  './admin-manifest.json',
  './supabase.js',
  './supabase-js-LICENSE.txt',
  './manifest.json',
  './cuban-league-f05-logo.svg',
  './icon-f05-192.png',
  './icon-f05-512.png',
  './icon-f05-maskable-512.png',
  './apple-touch-icon-f05.png',
  './favicon-f05-32.png',
  './golden-boot-pichichi.png',
  './bernabeu-bg.jpg',
  './stadium-bg.jpg',
  './home-stadium-night.jpg',
  './mbappe-card.jpg',
  './yamal-card.jpg',
  './team-01.png',
  './team-02.png',
  './team-03.png',
  './team-04.png',
  './team-05.png',
  './team-06.png',
  './team-07.png',
  './team-08.png',
  './team-09.png',
  './team-10.png',
  './team-11.png',
  './team-12.png',
  './team-13.png',
  './team-14.png',
  './team-15.png',
  './team-16.png',
  './team-17.png',
  './team-18.png',
  './team-19.png',
  './team-20.png',
  './team-nelson.png',
  './team-alejandro-cid.svg',
  './team-yadiel-lopez.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('cuban-league-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallback = null) {
  const cache = await caches.open(CACHE_NAME);
  let failedResponse;
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      // A full cache must not turn a successful download into a failed load.
      try { await cache.put(request, response.clone()); } catch {}
      return response;
    }
    if (response.status < 500 && response.status !== 408) return response;
    failedResponse = response;
  } catch {}
  return (await cache.match(request))
    || (fallback ? await cache.match(fallback) : null)
    || failedResponse
    || new Response('', { status: 504, statusText: 'Offline' });
}

function shellFallback(request) {
  const pathname = new URL(request.url).pathname;
  return APP_SHELL.find(asset => new URL(asset, self.location.href).pathname === pathname) || null;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then(async response => {
      if (response.ok) {
        try { await cache.put(request, response.clone()); } catch {}
      }
      return response;
    })
    .catch(() => null);
  event.waitUntil(update.then(() => {}));
  return cached || (await update) || new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const fallback = url.pathname.endsWith('/admin.html') ? './admin.html' : './index.html';
    event.respondWith(networkFirst(request, fallback));
    return;
  }

  if (url.pathname.endsWith('/data.json')) {
    event.respondWith(networkFirst(request, './data.json?v=174-20261014-mister-j8-catalog'));
    return;
  }

  if (url.pathname.endsWith('/catalog/players.json')) {
    event.respondWith(networkFirst(request, './catalog/players.json?v=174-20261014-mister-j8-catalog'));
    return;
  }

  if (
    url.pathname.endsWith('/styles.css') ||
    url.pathname.endsWith('/mobile-navigation.css') ||
    url.pathname.endsWith('/editorial-ui.js') ||
    url.pathname.endsWith('/app.js') ||
    url.pathname.endsWith('/admin.css') ||
    url.pathname.endsWith('/admin.js') ||
    url.pathname.endsWith('/mister-import-helper.js') ||
    url.pathname.endsWith('/mister-import-core.js') ||
    url.pathname.endsWith('/player-catalog.js') ||
    url.pathname.endsWith('/supabase-config.js')
  ) {
    event.respondWith(networkFirst(request, shellFallback(request)));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
