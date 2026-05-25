// Pass-through Service Worker
// Satisfies PWA install criteria without aggressive caching.
// This ensures the Lead's local "no-build" live edits show up immediately.

self.addEventListener('install', (e) => {
  // Activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Take control of all pages immediately
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Pass-through: always fetch from network, do not cache.
  e.respondWith(fetch(e.request));
});
