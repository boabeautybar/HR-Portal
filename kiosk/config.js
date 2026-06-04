/* ============================================================
   BOA Check-in App — multi-branch configuration
   ------------------------------------------------------------
   ONE deploy serves all stores. The branch is selected via the
   URL parameter ?branch=<storename>, e.g.

       https://your-checkin-app.netlify.app/?branch=SeaPoint
       https://your-checkin-app.netlify.app/?branch=Sea%20Point

   Spaces in the URL can be encoded as %20 or omitted entirely
   (the matcher accepts "SeaPoint" → "Sea Point" automatically).

   If the parameter is missing or unrecognised, this script
   renders a store-picker page in place of the app — clicking a
   store appends ?branch=... and reloads. No backend changes are
   needed: every store reads/writes the same Supabase keys keyed
   by branch name.

   Each branch has its own MANAGER PIN (unlocks the manager
   dashboard for that store). Staff PIN is the same everywhere
   because it just unlocks the staff dashboard, low stakes.
   PINs are visible in the page source — treat them as a
   friction layer, not real auth. Change them as needed.
   ============================================================ */
(function () {
  // ── Per-branch PIN registry ──────────────────────────────────
  // Order intentionally matches the HR portal's SALONS list, with
  // PINs numbered 0001..0017 in that order.
  // Per-branch registry: PIN + APPROXIMATE GPS coords.
  // The geo coords below are placeholder Cape Town defaults — you'll want
  // to replace each one with the store's exact lat/lng (Google Maps right-
  // click → "What's here?" gives you the numbers). Until you do that, the
  // app records GPS but does NOT enforce the geo-fence (enforceGeo: false).
  // Once you have accurate coords, flip enforceGeo: true to start blocking
  // clock-ins from outside the radiusMeters circle.
  var BRANCHES = [
    { name: "Sea Point",       pin: "0001", geo: { lat: -33.9180, lng: 18.3870 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Bree",            pin: "0002", geo: { lat: -33.9180, lng: 18.4180 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Kloof",           pin: "0003", geo: { lat: -33.9320, lng: 18.4090 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Claremont",       pin: "0004", geo: { lat: -33.9810, lng: 18.4720 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Rondebosch",      pin: "0005", geo: { lat: -33.9610, lng: 18.4730 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Durbanville",     pin: "0006", geo: { lat: -33.8260, lng: 18.6510 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Table Bay",       pin: "0007", geo: { lat: -33.9020, lng: 18.4290 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Somerset West",   pin: "0008", geo: { lat: -34.0820, lng: 18.8290 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Riverlands",      pin: "0009", geo: { lat: -33.9000, lng: 18.6300 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Kuils River",     pin: "0010", geo: { lat: -33.9180, lng: 18.6900 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Westlake",        pin: "0011", geo: { lat: -34.0760, lng: 18.4380 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Green Point",     pin: "0012", geo: { lat: -33.9050, lng: 18.4060 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Plumstead",       pin: "0013", geo: { lat: -34.0210, lng: 18.4630 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Sandown",         pin: "0014", geo: { lat: -33.8670, lng: 18.5050 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Cape Gate",       pin: "0015", geo: { lat: -33.8400, lng: 18.6390 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Winelands",       pin: "0016", geo: { lat: -33.9320, lng: 18.8650 }, radiusMeters: 1000, enforceGeo: false },
    { name: "Betty",           pin: "0017", geo: { lat: -34.3700, lng: 19.2540 }, radiusMeters: 2000, enforceGeo: false },
    // Gauteng (placeholder GPS — replace with exact lat/lng once known)
    { name: "Fourways",          pin: "0018", geo: { lat: -26.0167, lng: 28.0103 }, radiusMeters: 1500, enforceGeo: false },
    { name: "Eastgate",          pin: "0019", geo: { lat: -26.1810, lng: 28.1184 }, radiusMeters: 1500, enforceGeo: false },
    { name: "Mall of the South", pin: "0020", geo: { lat: -26.2812, lng: 28.0420 }, radiusMeters: 1500, enforceGeo: false },
    { name: "Mushroom Farm",     pin: "0021", geo: { lat: -26.0930, lng: 28.0490 }, radiusMeters: 1500, enforceGeo: false },
    { name: "Verdi",             pin: "0022", geo: { lat: -25.8870, lng: 28.1840 }, radiusMeters: 1500, enforceGeo: false },
    // KZN
    { name: "Ballito",           pin: "0023", geo: { lat: -29.5380, lng: 31.2140 }, radiusMeters: 1500, enforceGeo: false }
  ];

  // ── Resolve branch from URL ──────────────────────────────────
  function norm(s) { return String(s || "").replace(/\s+/g, "").toLowerCase(); }

  var params    = new URLSearchParams(window.location.search);
  var requested = (params.get("branch") || "").trim();

  // Device class (set by security.js on prior loads):
  //   • branch device → pinned to its branch: ignore the URL and never show the
  //     picker, so staff can't accidentally open another store.
  //   • admin device  → all-branch: keep URL/picker behaviour so it can open any store.
  var _pinnedBranch = "", _isAdmin = false;
  try {
    _isAdmin = localStorage.getItem("boa_kiosk_device_admin") === "1";
    _pinnedBranch = (localStorage.getItem("boa_kiosk_device_branch") || "").trim();
  } catch (_e) {}
  if (_pinnedBranch && !_isAdmin) requested = _pinnedBranch;

  var resolved  = null;
  if (requested) {
    var rn = norm(requested);
    for (var i = 0; i < BRANCHES.length; i++) {
      if (norm(BRANCHES[i].name) === rn) { resolved = BRANCHES[i]; break; }
    }
  }

  // ── If no valid branch, render the picker and bail ───────────
  if (!resolved) {
    document.addEventListener("DOMContentLoaded", function () {
      document.body.innerHTML =
        '<style>' +
          'body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
          'background:linear-gradient(135deg,#831843,#BE185D);min-height:100vh;display:flex;' +
          'align-items:center;justify-content:center;color:#fff}' +
          '.bp-card{background:#fff;color:#831843;border-radius:18px;padding:34px 30px;max-width:520px;' +
          'width:100%;box-shadow:0 30px 90px rgba(0,0,0,0.25)}' +
          '.bp-h1{font-family:"Playfair Display",serif;font-size:28px;margin:0 0 6px}' +
          '.bp-sub{font-size:13px;color:#9CA3AF;margin:0 0 22px}' +
          '.bp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:9px}' +
          '.bp-btn{display:block;padding:13px 14px;border:1px solid #FBCFE8;border-radius:10px;' +
          'background:#FCE7F3;color:#831843;text-decoration:none;font-weight:700;font-size:13px;text-align:center;' +
          'transition:all .15s}' +
          '.bp-btn:hover{background:#BE185D;color:#fff;border-color:#BE185D}' +
        '</style>' +
        '<div class="bp-card">' +
          '<div class="bp-h1">Pick your store</div>' +
          '<div class="bp-sub">Bookmark this page after picking — your tablet will remember the branch.</div>' +
          '<div class="bp-grid" id="bp-list"></div>' +
        '</div>';
      var list = document.getElementById("bp-list");
      BRANCHES.forEach(function (b) {
        var a = document.createElement("a");
        a.className = "bp-btn";
        a.href = "?branch=" + encodeURIComponent(b.name.replace(/\s+/g, ""));
        a.textContent = b.name;
        list.appendChild(a);
      });
    });
    // Prevent the rest of the app from booting on this page.
    window.APP_CONFIG = { _picker: true };
    return;
  }

  // ── Set the global APP_CONFIG used by data.js / staff-app.js ─
  window.APP_CONFIG = {
    branchName:        resolved.name,                 // exact name as stored in Supabase
    branchDisplayName: "BOA " + resolved.name,        // shown in headers / PIN screen

    // 4-digit PINs — change as needed
    staffPin:   "2026",                               // same across all stores (low-stakes lock)
    managerPin: resolved.pin,                         // unique per store

    // GPS geo-fence for the Manager Clock-in tab
    geo:           resolved.geo,                       // { lat, lng }
    radiusMeters:  resolved.radiusMeters || 1000,
    enforceGeo:    !!resolved.enforceGeo,              // false = capture only, true = block

    // Manager clock-in window
    clockInEarliestHour: 8,                            // earliest hour of day clock-IN is allowed (08:00)
    autoClockOutHour:    18,
    autoClockOutMinute:  30,                           // 18:30 — anyone still clocked in at this time gets auto-clocked-out

    // Manager early-clock-out reason picker. Clocking out before this
    // time triggers the "Why are you leaving early?" modal.
    earlyClockOutCutoffHour: 17,

    // Manager "haven't clocked in yet" blinking warning. Triggers when a
    // scheduled-today manager has no clock-in past this time AND no ROM
    // has tagged them absent for today.
    clockInWarningCutoffHour:   9,
    clockInWarningCutoffMinute: 30,

    // Supabase project (same one as the BOA HR admin portal)
    supabase: {
      url:     "https://kcinqpwkwpzbosxtkwyl.supabase.co",
      anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjaW5xcHdrd3B6Ym9zeHRrd3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MjIwMTYsImV4cCI6MjA5MzI5ODAxNn0.AGL2hXQ5N3uQikqSbWFsZ1uxBlWZUm9o1ipMFlAFjBg"
    }
  };

  // ── Live PIN override from HR portal ─────────────────────────────────
  // Manager PINs live in Supabase under `boa_kiosk_pins_v1` so HR admins
  // can reset them without redeploying the kiosk. Fetched async on boot;
  // mutates window.APP_CONFIG.managerPin in place once it resolves. The
  // hard-coded `resolved.pin` above is the fallback if Supabase is
  // unreachable or no PIN has been set for this branch yet.
  try {
    if (window.supabase && window.APP_CONFIG.supabase) {
      var _sb = window.supabase.createClient(
        window.APP_CONFIG.supabase.url,
        window.APP_CONFIG.supabase.anonKey
      );
      _sb.from("app_state").select("value").eq("key", "boa_kiosk_pins_v1").maybeSingle().then(function (res) {
        var v = res && res.data && res.data.value;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          var override = v[resolved.name];
          if (typeof override === "string" && /^[0-9]{4}$/.test(override)) {
            window.APP_CONFIG.managerPin = override;
          }
        }
      }).catch(function (e) { console.warn("Kiosk PIN override fetch failed:", e); });
    }
  } catch (e) { console.warn("Kiosk PIN override fetch threw:", e); }
})();
