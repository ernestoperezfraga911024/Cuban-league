const CACHE_NAME = 'cuban-league-v112-champions-calendar-toggle-pwa';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=112-20260805',
  './app.js?v=112-20260805',
  './data.json?v=112-20260805',
  './supabase-config.js?v=112-20260805',
  './admin.html',
  './admin.css?v=71-20260728',
  './admin.js?v=71-20260728',
  './admin-manifest.json',
  './supabase.js',
  './supabase-js-LICENSE.txt',
  './manifest.json',
  './cuban-league-green-logo.svg',
  './icon-green-192.png',
  './icon-green-512.png',
  './apple-touch-icon-green.png',
  './favicon-green-32.png',
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

async function networkFirst(request, fallback = './index.html') {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(fallback));
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
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
    event.respondWith(networkFirst(request, './data.json?v=112-20260805'));
    return;
  }

  if (
    url.pathname.endsWith('/styles.css') ||
    url.pathname.endsWith('/app.js') ||
    url.pathname.endsWith('/supabase-config.js')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
