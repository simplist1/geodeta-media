const CACHE_NAME = 'geodeta-media-shell-20260715-2';
const CACHE_PREFIX = 'geodeta-media-shell-';

const APP_SHELL = [
  '/',
  '/index.html',
  '/app.css',
  '/app-overrides.css',
  '/update.css',
  '/library-explorer.css',
  '/spotify-integration.css',
  '/pwa.css',
  '/supabase.js',
  '/app.js',
  '/library-explorer.js',
  '/profile-autosync.js',
  '/spotify-integration.js',
  '/update.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/art/icon-192.svg',
  '/art/icon-512.svg',
  '/art/icon-maskable.svg'
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
      .then(names => Promise.all(
        names
          .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return;

  if(request.mode === 'navigate'){
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  const cacheableDestinations = new Set(['script','style','image','font','manifest']);
  if(cacheableDestinations.has(request.destination) || APP_SHELL.includes(url.pathname)){
    event.respondWith(networkFirst(request));
  }
});

async function networkFirst(request, fallbackPath=''){
  const cache = await caches.open(CACHE_NAME);
  try{
    const response = await fetch(request, {cache:'no-store'});
    if(response.ok) await cache.put(request, response.clone());
    return response;
  }catch(error){
    const cached = await cache.match(request, {ignoreSearch:true});
    if(cached) return cached;
    if(fallbackPath){
      const fallback = await cache.match(fallbackPath, {ignoreSearch:true});
      if(fallback) return fallback;
    }
    throw error;
  }
}
