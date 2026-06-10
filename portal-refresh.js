/*
  BOA HR Portal — auto-refresh
  -----------------------------------------------------------------------------
  Portal tabs get left open for days on laptops and desks across many users.
  A tab still running last week's code keeps saving data the OLD way, which
  can silently undo what newer sessions wrote (e.g. attendance cell edits and
  review checkmarks). Nobody can phone every user to refresh — so stale tabs
  refresh themselves:

    • New deploy detected → reload, but only when the tab has been idle for a
      while and nothing is mid-flow (no typing, no open dialog).
    • Tab returns after being hidden/asleep for a long time → reload so it
      comes back on fresh code + data.

  Conservative on purpose: the portal is admin tooling with long forms, so we
  only ever reload a tab that is visibly idle. window.prompt/confirm dialogs
  block JS entirely, so a reload can never fire mid-prompt.
*/
(function () {
  "use strict";

  var IDLE_MS        = 5 * 60 * 1000;    // "idle" = no interaction for 5 min
  var POLL_MS        = 2 * 60 * 1000;    // how often we check for a new deploy
  var MIN_UPTIME_MS  = 5 * 60 * 1000;    // never reload within 5 min of a load
  var HIDDEN_WAKE_MS = 30 * 60 * 1000;   // reload on return if hidden 30+ min

  var loadedAt = Date.now();
  var lastActivity = Date.now();
  var hiddenSince = null;
  var baseTag = null;

  ["pointerdown", "keydown", "touchstart", "mousedown", "scroll", "input"].forEach(function (ev) {
    window.addEventListener(ev, function () { lastActivity = Date.now(); }, { passive: true });
  });

  function idle() { return Date.now() - lastActivity > IDLE_MS; }
  function youngPage() { return Date.now() - loadedAt < MIN_UPTIME_MS; }
  function typing() {
    var a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
  }
  function reload() { if (typing()) return; try { location.reload(); } catch (_e) { } }

  // app.jsx's ETag / Last-Modified changes on every redeploy, so a difference
  // means new code is live. Netlify serves both for static files.
  function versionTag() {
    return fetch("app.jsx", { method: "HEAD", cache: "no-store" })
      .then(function (r) { return r.headers.get("etag") || r.headers.get("last-modified") || null; })
      .catch(function () { return null; });
  }
  versionTag().then(function (t) { baseTag = t; });

  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    if (youngPage() || typing() || !idle()) return;     // only act when calm & idle
    versionTag().then(function (t) {
      if (t && baseTag && t !== baseTag) reload();      // new deploy → pick it up
    });
  }, POLL_MS);

  // Came back to the tab after a long absence → reload for fresh code + data.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { hiddenSince = Date.now(); return; }
    if (hiddenSince && (Date.now() - hiddenSince > HIDDEN_WAKE_MS) && !youngPage()) reload();
    hiddenSince = null;
  });
})();
