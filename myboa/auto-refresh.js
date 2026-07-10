/*
  My BOA — staff-viewer auto-refresh
  -----------------------------------------------------------------------------
  Staff open a My BOA page on their phone and it keeps whatever code + data it
  had at first load, so a re-published schedule / new deploy is invisible until
  they manually reload. This keeps the page current automatically:

    • New deploy detected (any page script's ETag changed) → reload once the
      page is idle and nothing is mid-flow.
    • Returned to the page after it was hidden/asleep a while → reload for
      fresh data the moment they pick the phone back up.
    • Sitting idle on a screen → periodic reload to pull a fresh re-publish
      even when no new code was deployed.

  A full reload is safe here: My BOA is a read-only-ish viewer, identity lives
  in localStorage (no PIN to re-enter), and each page rebuilds its data from
  scratch on load (schedule.js starts with an empty state.cache). We NEVER
  reload while a field is focused, while window.BOA_BUSY is set, or until the
  page has been idle a while — so an in-progress leave / absence / extra-day
  submission is never interrupted.
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
  function typing() {
    var a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
  }
  // Safe to reload only when nothing is mid-flow. window.BOA_BUSY is an optional
  // opt-in a page script can set (e.g. from its submit state.busy) — if it's
  // never set, this is a harmless no-op and the idle + typing guards still hold.
  function busy() { return typing() || !!window.BOA_BUSY; }
  function reload() { if (busy()) return; try { location.reload(); } catch (_e) {} }

  // Watch every My BOA page script (all live alongside this file in myboa/), so
  // a deploy that changes ANY of them is detected. Each file's ETag / Last-Modified
  // changes when its content changes (Netlify serves both for static files).
  var WATCH = ["schedule.js", "leave.js", "absence.js", "extra.js", "bonus.js", "report.js"];
  function versionTag() {
    return Promise.all(WATCH.map(function (f) {
      return fetch(f, { method: "HEAD", cache: "no-store" })
        .then(function (r) { return r.headers.get("etag") || r.headers.get("last-modified") || ""; })
        .catch(function () { return ""; });
    })).then(function (tags) {
      // Only trust a COMPLETE reading — if any file failed (offline / transient),
      // return null so a partial result never looks like a "new deploy".
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
      // data (a re-publish with no deploy) after a quiet spell.
      if (t !== baseTag || (Date.now() - loadedAt > DATA_REFRESH_MS)) reload();
    });
  }, POLL_MS);

  // Phone woke / staff came back after a while → reload for fresh data.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { hiddenSince = Date.now(); return; }
    if (hiddenSince && (Date.now() - hiddenSince > HIDDEN_WAKE_MS) && !youngPage()) reload();
    hiddenSince = null;
  });
})();
