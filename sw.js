// Pass-through Service Worker (BOA HR Portal)
// Satisfies PWA install criteria without aggressive caching, so the no-build
// live edits to app.jsx / data.js show up immediately on next load.

self.addEventListener('install', (e) => {
  // Activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Take control of all open pages immediately
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Pass-through: always go to the network, never serve a stale cache.
  e.respondWith(fetch(e.request));
});
