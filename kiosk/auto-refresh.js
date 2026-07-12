/*
  BOA Check-in — kiosk auto-refresh
  -----------------------------------------------------------------------------
  Store tablets are left open all day, so they keep running whatever code +
  data they had at first load. This keeps them current automatically:

    • New deploy detected  → reload (once idle / nothing mid-flow) so the
      newest code lands without anyone tapping refresh.
    • Returned to the tablet (was hidden/asleep a while) → reload for fresh
      data the moment a manager picks it up.
    • Sitting idle on a screen → periodic reload to pull fresh data.

  Auth survives a reload (PIN is kept in sessionStorage), so managers are NOT
  asked to re-enter it. We never reload while a modal is open or someone is
  typing in a field, so an in-progress check-in / evaluation / sign-off is
  never interrupted.
*/
(function () {
  "use strict";

  var IDLE_MS         = 90 * 1000;        // "idle" = no interaction for 90s
  var POLL_MS         = 60 * 1000;        // how often we check
  var DATA_REFRESH_MS = 6 * 60 * 1000;    // pull fresh data ~every 6 min when idle
  var MIN_UPTIME_MS   = 2 * 60 * 1000;    // never reload within 2 min of a load
  var HIDDEN_WAKE_MS  = 60 * 1000;        // reload on return if hidden this long

  var loadedAt = Date.now();
  var lastActivity = Date.now();
  var hiddenSince = null;
  var baseTag = null;

  ["pointerdown", "keydown", "touchstart", "mousedown", "scroll", "input"].forEach(function (ev) {
    window.addEventListener(ev, function () { lastActivity = Date.now(); }, { passive: true });
  });

  function idle()      { return Date.now() - lastActivity > IDLE_MS; }
  function youngPage() { return Date.now() - loadedAt < MIN_UPTIME_MS; }
  function modalOpen() { return !!document.querySelector(".boa-modal-backdrop"); }
  function typing() {
    var a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
  }
  // Safe to reload only when nothing is mid-flow.
  function busy() { return modalOpen() || typing(); }
  function reload() { if (busy()) return; try { location.reload(); } catch (_e) {} }

  // Watch ALL the core kiosk scripts (not just staff-app.js), so a data-only
  // deploy — e.g. a fix in data.js that leaves staff-app.js untouched — is
  // detected immediately instead of waiting for the periodic refresh. Each
  // file's ETag / Last-Modified changes when its content changes (Netlify
  // serves both for static files); combine them, so a change to ANY means
  // fresh code is live.
  // shift-rules.js is the shared hours table the app scripts delegate to —
  // an hours-only deploy touches nothing else, so it must be watched too.
  var WATCH = ["config.js", "data.js", "security.js", "pin-gate.js", "shift-rules.js", "staff-app.js", "manager-app.js"];
  function versionTag() {
    return Promise.all(WATCH.map(function (f) {
      return fetch(f, { method: "HEAD", cache: "no-store" })
        .then(function (r) { return r.headers.get("etag") || r.headers.get("last-modified") || ""; })
        .catch(function () { return ""; });
    })).then(function (tags) {
      // Only trust a COMPLETE reading — if any file failed (offline / transient),
      // return null so a partial result never looks like a "new deploy" and
      // triggers a spurious reload.
      return tags.every(function (t) { return t; }) ? tags.join("|") : null;
    });
  }
  versionTag().then(function (t) { baseTag = t; });

  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    if (youngPage() || busy() || !idle()) return;    // only act when calm & idle
    versionTag().then(function (t) {
      if (!t) return;                          // incomplete probe — ignore (don't reload)
      if (!baseTag) { baseTag = t; return; }   // establish baseline if the load-time probe failed
      // Reload for a new deploy (any watched script changed), or to refresh
      // data after a quiet spell.
      if (t !== baseTag || (Date.now() - loadedAt > DATA_REFRESH_MS)) reload();
    });
  }, POLL_MS);

  // Tablet woke / manager came back after a while → reload for fresh data.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { hiddenSince = Date.now(); return; }
    if (hiddenSince && (Date.now() - hiddenSince > HIDDEN_WAKE_MS) && !youngPage()) reload();
    hiddenSince = null;
  });
})();
