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
  // Only touch same-origin GETs. Cross-origin assets (React/ReactDOM/Babel/
  // Supabase from CDNs, Google Fonts) MUST load normally — re-fetching them
  // through the worker breaks CORS and the app fails to boot ("React is not
  // defined"). For everything else, let the browser handle it untouched.
  let url;
  try { url = new URL(e.request.url); } catch (_) { return; }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request));
});
