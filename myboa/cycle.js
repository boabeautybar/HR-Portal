/* ============================================================
   My BOA — shared pay-cycle + schedule-key helpers.
   ONE implementation of the 25th→24th pay-cycle rollover and the
   app_state schedule-key format, loaded via <script src="cycle.js">
   before every My BOA feature script that reads schedules
   (schedule.js, extra.js). Feature files keep thin local wrappers
   (storageKey/currentSchedYm/…) that inject their own state and
   delegate here, so there is one rollover and one key format.

   Cycle convention (matches the HR portal + kiosk):
     • A pay cycle runs the 25th of one month → the 24th of the next.
     • The cycle is identified by its END-month ym "YYYY-MM": a date
       with day-of-month ≥ 25 belongs to the NEXT month's cycle.
     • Tech live/approved grids are keyed by that END-month ym.
     • Manager grids are keyed by the START-month ym (END minus 1).

   Companion cycle logic lives in the portal (data.js schedKey/
   schedApprovedKey, app.jsx) and the kiosk (kiosk/data.js). If the
   25th boundary or key format ever changes, change it in all three.
   ============================================================ */
(function () {
  function pad(n) { return String(n).padStart(2, "0"); }

  // Which cycle (END-month ym) does a calendar date fall in? A day-of-
  // month ≥ 25 rolls into the next month's cycle. (">24" and ">=25" are
  // identical for an integer day-of-month; this is the one spelling.)
  function ymForDate(dt) {
    var y = dt.getFullYear(), m = dt.getMonth() + 1;
    if (dt.getDate() >= 25) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + "-" + pad(m);
  }
  function currentYm() { return ymForDate(new Date()); }

  // Add `delta` whole months to a "YYYY-MM" string.
  function shiftYm(ym, delta) {
    var p = String(ym).split("-"), y = +p[0], m = +p[1] + delta;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return y + "-" + pad(m);
  }

  // Live (draft/working) schedule grid key. Tech = END-month ym;
  // manager = START-month ym (END minus 1).
  function liveKey(store, ymEnd, isManager) {
    return (isManager ? "boa_mgrsched_" : "boa_sched_") + store + "_" + (isManager ? shiftYm(ymEnd, -1) : ymEnd);
  }
  // Published (approved) snapshot key — same store + ym convention as
  // liveKey, "…approved_" prefix. Value is a snapshot array, newest first.
  function approvedKey(store, ymEnd, isManager) {
    return (isManager ? "boa_mgrschedapproved_" : "boa_schedapproved_") + store + "_" + (isManager ? shiftYm(ymEnd, -1) : ymEnd);
  }

  // ── Call Centre & Sales split (shared, ONE implementation) ─────────
  // CC&S people carry branch "Head Office" in the staff table but schedule
  // under the "Call Centre & Sales" store. Every My BOA feature that reads a
  // schedule grid must route them there. Classifier mirrors the HR portal's
  // isCallCentreStaff / the kiosk's _hoIsCcSales: EC ends -CC OR role is
  // MCC / CC / SALES (the CC Manager's code is -M, so role matters).
  var CC_STORE = "Call Centre & Sales";
  function isCcSales(ec, role) {
    var e = String(ec == null ? "" : ec).trim().toUpperCase();
    var r = String(role == null ? "" : role).trim().toUpperCase();
    return /-CC$/.test(e) || r === "MCC" || r === "CC" || r === "SALES";
  }
  // The store a person's schedule keys live under, given the store they picked
  // (their staff branch) and their EC/role. Identity for everyone else.
  function ccSchedStore(pickedStore, ec, role) {
    if (String(pickedStore == null ? "" : pickedStore).trim().toLowerCase() === "head office" && isCcSales(ec, role)) return CC_STORE;
    return pickedStore;
  }
  // The grids to SEARCH for a person when only the picked store is known (no
  // staff row / role yet, so a -M-coded CC person can't be classified up
  // front). CC first: a stale pre-split row may linger in the Head Office
  // grid, and the CC&S grid is the authoritative one on a collision.
  function schedStoresFor(pickedStore) {
    if (String(pickedStore == null ? "" : pickedStore).trim().toLowerCase() === "head office") return [CC_STORE, pickedStore];
    return [pickedStore];
  }

  window.BOA_CYCLE = {
    pad: pad,
    ymForDate: ymForDate,
    currentYm: currentYm,
    shiftYm: shiftYm,
    liveKey: liveKey,
    approvedKey: approvedKey,
    CC_STORE: CC_STORE,
    isCcSales: isCcSales,
    ccSchedStore: ccSchedStore,
    schedStoresFor: schedStoresFor
  };
})();
