/* ============================================================
   BOA — shared manager/tech shift-hour rules.

   ONE rule set for the per-store × role × day-of-week × shift-code
   opening/closing hours. Until now the SAME rules were copied verbatim
   into FOUR shiftTimes bodies that had to be hand-kept in step:
     • portal  app.jsx            (Manager Coverage + Attendance deductions)
     • kiosk   manager-app.js     (manager dashboard)
     • kiosk   staff-app.js       (_shiftTimes — Manager Schedule grid)
     • My BOA  myboa/schedule.js  (staff/manager phone view)
   Each now keeps a thin local wrapper that calls window.BOA_SHIFT.times(...).

   ── THREE MIRROR COPIES (deploy topology) ─────────────────────
   The portal, kiosk, and My BOA deploy as SEPARATE Netlify sites whose
   publish roots are the repo root, kiosk/, and myboa/ — a page cannot
   load a script from above its site root, so this file exists three
   times and MUST stay byte-identical:
     shift-rules.js         (portal — loaded by index.html)
     kiosk/shift-rules.js   (kiosk  — loaded by kiosk/index.html)
     myboa/shift-rules.js   (My BOA — loaded by myboa/schedule.html)
   EDIT ALL THREE TOGETHER (edit one, copy over the other two), then run
   `node scripts/check-shift-rules.js` — it fails if the copies drift.

   ── WHAT THIS FILE DOES *NOT* COVER ───────────────────────────
   • Store OPENING-HOURS banners (app.jsx STORE_HOURS_DEFAULT).
   • Nail-tech per-store times (myboa/schedule.js TECH_TIMES/NORMAL_TECH).
   • Kiosk HO banner strings derive from BOA_SHIFT at load (staff-app
     HO_HOURS) — keep the Head Office block below authoritative.
   An hours change may need those tables updated too.

   Returns a "HH:MM - HH:MM" string. This is the STANDARD-rule fallback:
   per-day custom hours (boa_mgr_times_v1) and portal-baked snapshot hours
   (Phase 1.1) override it upstream in each surface.

     role: "SM" | "SSM" | "AM" | "CC" | "MCC" | "SALES" | tech ("")
     code: W / WE / WM / WL / WB / E
     dow:  0=Sun … 6=Sat
   ============================================================ */
(function () {
  function _isHeadOffice(b) {
    return String(b == null ? "" : b).trim().toLowerCase() === "head office";
  }

  function shiftTimes(role, code, branch, dow) {
    var r = (role || "").toUpperCase();
    var isSM = r === "SM" || r === "SSM";
    var isAM = r === "AM";
    var b = branch || "";

    // Head Office runs its own hours, driven by the HO department (role) + code:
    // the Call Centre & Sales floor a two-shift early/late split
    // (WE 07:00–16:00 · WL 09:00–18:30); everyone else one day shift 08:00–17:00.
    if (_isHeadOffice(b)) {
      if (r === "CC" || r === "MCC" || r === "SALES") return code === "WL" ? "09:00 - 18:30" : "07:00 - 16:00";
      return "08:00 - 17:00";
    }

    // Sandown / Table Bay — Mon-Fri split (Table Bay extends it to Saturday;
    // Sandown has its own Saturday window). SM flat 08:00-17:00 every day.
    if (b === "Sandown" || b === "Table Bay") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) {                                // Sunday
        if (code === "WE") return "08:00 - 17:00";
        if (code === "WL") return "09:00 - 18:00";
        return "09:00 - 18:00";
      }
      if (dow === 6 && b === "Sandown") {             // Sandown Saturday
        if (code === "WE") return "08:00 - 17:00";
        if (code === "WL") return "10:00 - 19:00";
        return "10:00 - 19:00";
      }
      if (code === "WE") return "08:00 - 17:00";      // Mon-Fri (Mon-Sat for Table Bay)
      if (code === "WM") return "09:00 - 18:00";
      if (code === "WL") return "11:00 - 20:00";
      return "11:00 - 20:00";
    }

    // Riverlands — Mon-Fri split, Sat/Sun single shift.
    if (b === "Riverlands") {
      if (isSM) return "08:00 - 17:00";               // SM/SSM always 08:00-17:00, every day
      if (dow === 6) return "09:00 - 18:00";          // Sat single AM
      if (dow === 0) return "08:30 - 17:00";          // Sun single AM (08:30 open)
      if (code === "WE") return "09:00 - 18:00";      // AM opener
      if (code === "WB") return "08:00 - 17:00";      // 4+ bonus opener
      if (code === "WM") return "09:00 - 18:00";      // AM mid shift
      if (code === "WL") return "10:00 - 19:00";
      return "10:00 - 19:00";
    }

    // Ballito / Mall of the South — SM-only WE opener, AM closers.
    if (b === "Ballito" || b === "Mall of the South") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) return isAM ? "08:30 - 17:00" : "08:00 - 17:00"; // Sunday: AM opens 08:30, others 08:00
      if (code === "WE") return "08:00 - 17:00";
      if (code === "WM") return "09:00 - 18:00";
      if (code === "WL") return "10:00 - 19:00";
      return "10:00 - 19:00";
    }

    // Fourways — SM/SSM always open (08-17); AMs/techs carry the late close.
    if (b === "Fourways") {
      if (isSM) return "08:00 - 17:00";               // SM/SSM always open, never close
      if (dow === 0) {                                // Sunday (store 09-19)
        if (code === "WE") return "08:00 - 17:00";
        if (code === "WL") return "10:00 - 19:00";
        return "10:00 - 19:00";
      }
      if (code === "WE") return "08:00 - 17:00";      // AM opener when no SM is in
      if (code === "WM") return "10:00 - 19:00";
      if (code === "WL") return "11:00 - 20:00";
      return "11:00 - 20:00";
    }

    // Generic stores — generic SM 08-17 / AM 09:00-18:30 hours.
    if (isSM) {
      if (dow === 0 || dow === 6) return "08:00 - 17:00";
      if (code === "WL") return "08:30 - 17:30";
      if (code === "WE") return "07:30 - 16:30";
      if (code === "WM") return "08:00 - 13:00";
      return "08:00 - 17:00";
    }
    if (dow === 6) return "09:00 - 18:00";             // Saturday AM
    if (dow === 0) return "08:30 - 17:00";             // Sunday AM
    if (code === "WL") return "10:00 - 19:00";
    if (code === "WE") return "08:30 - 18:00";
    if (code === "WM") return "09:00 - 13:00";
    if (code === "WB") return "08:00 - 19:00";
    if (code === "E") return "09:00 - 18:30";
    return "09:00 - 18:30";
  }

  window.BOA_SHIFT = {
    times: shiftTimes,
    isHeadOffice: _isHeadOffice,
    // Stores whose managers run a split (WE/WM/WL) shift — the ONE place this
    // membership lives (portal, kiosk staff-app, and My BOA all read it here).
    // These are exactly the stores shiftTimes() gives a multi-shift window.
    SPLIT_SHIFT_STORES: { "Sandown": 1, "Table Bay": 1, "Riverlands": 1, "Ballito": 1, "Mall of the South": 1, "Fourways": 1 }
  };
})();
