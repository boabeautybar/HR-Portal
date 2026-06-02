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
  // Only touch same-origin GETs. Cross-origin assets (Supabase SDK / fonts from
  // CDNs) must load normally — re-fetching them through the worker breaks CORS.
  let url;
  try { url = new URL(e.request.url); } catch (_) { return; }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request));
});
