/* ============================================================================
 * assets.js — the asset register's rules, in one place and free of the DOM.
 *
 * WHY THIS EXISTS
 * The owner's asset workbook has five sheets that are supposed to agree with
 * each other and never do: a transfer typed on the Movement sheet does not
 * move the asset on the IT sheet, an allocation does not change its status,
 * and a leaver's laptop is found by reading everything. Operations → Assets
 * keeps those sheets as VIEWS over one linked model, and this file holds the
 * rules that make the views agree:
 *
 *   project()    the asset's current state (branch, holder, status, condition)
 *                folded from its history — the ONE way the register row is
 *                ever computed, so it cannot drift from the timeline;
 *   nextId()     IT-0001 / MOV-0001 / AL-0001 numbering, never reused;
 *   bookValue()  straight-line depreciation;
 *   summarise()  every number on the dashboard sub-tab;
 *   parseImport() the bulk-upload parser with its duplicate review.
 *
 * Exposes window.BOA_ASSETS (browser) / module.exports (node — see
 * scripts/check-assets.js, which asserts the invariants in docs/assets-plan.md).
 * ========================================================================== */
(function (root) {
  "use strict";

  /* ── Registers, event kinds, statuses ──────────────────────────────────── */
  var REGISTERS = [
    { k: "IT", prefix: "IT", label: "IT Assets", short: "IT", icon: "💻" },
    { k: "FA", prefix: "FA", label: "Furniture & General", short: "Furniture", icon: "🪑" },
    { k: "SE", prefix: "SE", label: "Salon Equipment", short: "Salon equip.", icon: "💅" },
    { k: "VE", prefix: "VE", label: "Vehicles", short: "Vehicles", icon: "🚗" }
  ];
  var REGISTER_BY_KEY = {};
  REGISTERS.forEach(function (r) { REGISTER_BY_KEY[r.k] = r; });

  var EVENT_KINDS = {
    transfer:      { prefix: "MOV",  label: "Transfer",               icon: "🔀" },
    disposal:      { prefix: "DISP", label: "Disposal",               icon: "🗑" },
    repair_out:    { prefix: null,   label: "Sent for repair",        icon: "🔧" },
    repair_in:     { prefix: null,   label: "Back from repair",       icon: "✅" },
    status_change: { prefix: null,   label: "Status / condition set", icon: "✏️" }
  };
  var ALLOC_PREFIX = "AL";

  // Register-specific fields kept in assets.details (jsonb).
  var DETAIL_FIELDS = {
    IT: [
      { k: "os", l: "Operating system", t: "text" },
      { k: "login_user", l: "Login / user account", t: "text" }
    ],
    FA: [],
    SE: [
      { k: "install_date", l: "Installed on", t: "date" },
      { k: "service_due", l: "Next service due", t: "date" }
    ],
    VE: [
      { k: "registration", l: "Registration no.", t: "text" },
      { k: "licence_disc_expiry", l: "Licence disc expires", t: "date" },
      { k: "insurance_expiry", l: "Insurance expires", t: "date" },
      { k: "odometer", l: "Odometer (km)", t: "number" }
    ]
  };

  var DEFAULT_CFG = {
    conditions: ["New", "Excellent", "Good", "Fair", "Poor", "Damaged", "Unserviceable"],
    statuses: ["In Use", "In Storage", "Assigned", "Under Repair", "Lost", "Stolen", "Damaged",
      "Awaiting Disposal", "Disposed", "Transferred", "Returned"],
    departments: ["HR", "Finance", "Operations", "IT", "Marketing", "Training", "Call Centre",
      "Management", "Administration", "Salon", "Other"],
    categories: {
      IT: ["Laptop", "Desktop", "Monitor", "Tablet", "Cell Phone", "Printer", "Scanner", "Keyboard",
        "Mouse", "Headset", "Router", "Wi-Fi Equipment", "UPS", "Projector", "Server/Network Equipment", "Other"],
      FA: ["Desk", "Office Chair", "Table", "Filing Cabinet", "Storage Cabinet", "Shelving", "Sofa",
        "Reception Furniture", "Mirror", "Trolley", "Safe", "Fridge", "Microwave", "Television",
        "Air Conditioner", "Other"],
      SE: ["Manicure Station", "Pedicure Chair", "Treatment Bed", "UV/LED Lamp", "Steriliser/Autoclave",
        "Dust Collector", "Wax Heater", "Steamer", "Massage Chair", "Salon Trolley", "Other"],
      VE: ["Car", "Bakkie", "Van", "Scooter/Motorbike", "Trailer", "Other"]
    },
    moveReasons: ["New Purchase", "Employee Allocation", "Branch Transfer", "Replacement", "Repair", "Return", "Other"],
    disposalMethods: ["Sold", "Donated", "Scrapped", "Returned to Supplier", "Recycled", "Written Off", "Other"],
    extraLocations: ["Storage", "Other"],
    usefulLifeDefault: { IT: 36, FA: 72, SE: 60, VE: 60 },
    usefulLifeMonths: {}
  };

  // Statuses grouped into the families the dashboard colours by.
  var STATUS_FAMILY = {
    "In Use": "active", "Assigned": "active", "Transferred": "active", "Returned": "storage",
    "In Storage": "storage", "Under Repair": "repair",
    "Lost": "problem", "Stolen": "problem", "Damaged": "problem",
    "Awaiting Disposal": "awaiting", "Disposed": "disposed"
  };
  var FAMILIES = [
    { k: "active",   label: "In use / assigned", colour: "#BE185D" },
    { k: "storage",  label: "In storage",        colour: "#A78BC7" },
    { k: "repair",   label: "Under repair",      colour: "#F59E0B" },
    { k: "problem",  label: "Lost / stolen / damaged", colour: "#DC2626" },
    { k: "awaiting", label: "Awaiting disposal", colour: "#7F1D1D" },
    { k: "disposed", label: "Disposed",          colour: "#9CA3AF" }
  ];
  function familyOf(status) { return STATUS_FAMILY[status] || "active"; }

  /* ── Small helpers ─────────────────────────────────────────────────────── */
  function isArr(a) { return Array.isArray(a); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uniq(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (x) {
      var s = String(x == null ? "" : x).trim();
      if (!s || seen[s.toLowerCase()]) return;
      seen[s.toLowerCase()] = true; out.push(s);
    });
    return out;
  }
  function pad4(n) { var s = String(n); while (s.length < 4) s = "0" + s; return s; }
  function num(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v).replace(/[Rr]\s*/g, "").replace(/[,\s]/g, "");
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function money(v) {
    var n = Number(v) || 0;
    return "R " + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function normKey(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  function normEc(s) { return String(s == null ? "" : s).toUpperCase().replace(/[\s-]+/g, "").trim(); }

  // Config with the defaults filled in, so a partially-edited cfg never leaves
  // a dropdown empty.
  function normCfg(cfg) {
    var c = cfg && typeof cfg === "object" ? cfg : {};
    var out = clone(DEFAULT_CFG);
    ["conditions", "statuses", "departments", "moveReasons", "disposalMethods", "extraLocations"].forEach(function (k) {
      if (isArr(c[k]) && c[k].length) out[k] = uniq(c[k]);
    });
    if (c.categories && typeof c.categories === "object") {
      REGISTERS.forEach(function (r) {
        if (isArr(c.categories[r.k]) && c.categories[r.k].length) out.categories[r.k] = uniq(c.categories[r.k]);
      });
    }
    if (c.usefulLifeDefault && typeof c.usefulLifeDefault === "object") {
      REGISTERS.forEach(function (r) {
        var n = num(c.usefulLifeDefault[r.k]);
        if (n != null && n > 0) out.usefulLifeDefault[r.k] = n;
      });
    }
    if (c.usefulLifeMonths && typeof c.usefulLifeMonths === "object") {
      Object.keys(c.usefulLifeMonths).forEach(function (k) {
        var n = num(c.usefulLifeMonths[k]);
        if (n != null && n > 0) out.usefulLifeMonths[k] = n;
      });
    }
    return out;
  }

  /* ── Dates ─────────────────────────────────────────────────────────────── */
  // Everything is a "YYYY-MM-DD" string. Never through a Date for the
  // calendar day, so no timezone can shift it.
  var YMD_RX = /^(\d{4})-(\d{2})-(\d{2})$/;
  function isYmd(s) { return YMD_RX.test(String(s || "")); }
  function todayYmd() {
    var t = new Date();
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }
  // Accepts YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY, D MMM YYYY, an
  // Excel serial (SheetJS with raw cells), or a JS Date. Returns ymd or null.
  function toYmd(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      return v.getFullYear() + "-" + String(v.getMonth() + 1).padStart(2, "0") + "-" + String(v.getDate()).padStart(2, "0");
    }
    if (typeof v === "number") {
      if (v < 20000 || v > 80000) return null;                 // not a plausible Excel serial
      var ms = Math.round((v - 25569) * 86400000);             // 1899-12-30 epoch
      var d = new Date(ms);
      return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return _validYmd(m[1], m[2], m[3]);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
    if (m) return _validYmd(m[3], m[2], m[1]);
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/);
    if (m) {
      var mi = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase());
      if (mi >= 0) return _validYmd(m[3], String(mi + 1), m[1]);
    }
    return null;
  }
  // "2026-02-30" is not a date. Build it, then check the calendar agrees.
  function _validYmd(y, mo, d) {
    var yy = parseInt(y, 10), mm = parseInt(mo, 10), dd = parseInt(d, 10);
    if (!(yy >= 1900 && yy <= 2200 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;
    var t = new Date(Date.UTC(yy, mm - 1, dd));
    if (t.getUTCFullYear() !== yy || t.getUTCMonth() !== mm - 1 || t.getUTCDate() !== dd) return null;
    return yy + "-" + String(mm).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
  }
  // Whole months from a to b (b >= a), by calendar, day-of-month aware.
  function monthsBetween(a, b) {
    if (!isYmd(a) || !isYmd(b) || b < a) return 0;
    var ya = +a.slice(0, 4), ma = +a.slice(5, 7), da = +a.slice(8, 10);
    var yb = +b.slice(0, 4), mb = +b.slice(5, 7), db = +b.slice(8, 10);
    var n = (yb - ya) * 12 + (mb - ma);
    if (db < da) n -= 1;
    return Math.max(0, n);
  }
  function daysBetween(a, b) {
    if (!isYmd(a) || !isYmd(b)) return null;
    return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
      - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
  }
  function addDays(ymd, n) {
    var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + n * 86400000);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function ymOf(ymd) { return isYmd(ymd) ? ymd.slice(0, 7) : null; }

  /* ── IDs ───────────────────────────────────────────────────────────────── */
  function formatId(prefix, n) { return prefix + "-" + pad4(n); }
  function parseIdNumber(id, prefix) {
    var m = String(id || "").trim().toUpperCase().match(/^([A-Z]+)-(\d+)$/);
    if (!m) return null;
    if (prefix && m[1] !== String(prefix).toUpperCase()) return null;
    return parseInt(m[2], 10);
  }
  // Highest existing number + 1. IDs are never reused: a gap left by an
  // archived record stays a gap.
  function nextId(prefix, existingIds) {
    var max = 0;
    (existingIds || []).forEach(function (id) {
      var n = parseIdNumber(id, prefix);
      if (n != null && n > max) max = n;
    });
    return formatId(prefix, max + 1);
  }
  function prefixForRegister(register) { var r = REGISTER_BY_KEY[register]; return r ? r.prefix : null; }
  function registerOfId(id) {
    var m = String(id || "").trim().toUpperCase().match(/^([A-Z]+)-/);
    return m && REGISTER_BY_KEY[m[1]] ? m[1] : null;
  }

  /* ── Projection: the asset's current state, folded from its history ─────
     The register row shows what project() returns and nothing else. The
     fold walks events and allocations in date order (created_at breaks ties)
     and starts from the asset's own stored fields, which are the base values
     for an asset with no history and are frozen once it has some.

     Rules (docs/assets-plan.md §4.3):
       transfer       → branch = to_branch (status unchanged, condition if given)
       allocation     → holder = ec/name, date_issued, status Assigned
       return         → holder cleared, status In Storage, condition_returned
       repair_out     → status Under Repair
       repair_in      → status Assigned if a holder is open, else In Storage
       status_change  → status = to_status (condition if given)
       disposal       → status Disposed, holder cleared; TERMINAL              */
  function _items(asset, events, allocations) {
    var items = [];
    (events || []).forEach(function (e) {
      if (!e || e.archived_at) return;
      if (asset && e.asset_id && asset.id && e.asset_id !== asset.id) return;
      items.push({ t: "event", date: e.date || "", ts: e.created_at || "", e: e });
    });
    (allocations || []).forEach(function (a) {
      if (!a || a.archived_at) return;
      if (asset && a.asset_id && asset.id && a.asset_id !== asset.id) return;
      items.push({ t: "alloc_open", date: a.date_issued || "", ts: a.created_at || "", a: a });
      if (a.date_returned) items.push({ t: "alloc_close", date: a.date_returned, ts: "9999" + (a.created_at || ""), a: a });
    });
    items.sort(function (x, y) {
      if (x.date !== y.date) return x.date < y.date ? -1 : 1;
      if (x.ts !== y.ts) return x.ts < y.ts ? -1 : 1;
      return 0;
    });
    return items;
  }

  function project(asset, events, allocations) {
    var a = asset || {};
    var p = {
      branch: a.branch || null,
      assigned_ec: null, assigned_name: null, date_issued: null,
      status: a.status || "In Storage",
      condition: a.condition || null,
      disposed: false,
      open_alloc: null,
      has_history: false,
      last_event_date: null
    };
    var items = _items(asset, events, allocations);
    var openAlloc = null;
    var disposal = null;
    items.forEach(function (it) {
      p.has_history = true;
      if (it.date && (!p.last_event_date || it.date > p.last_event_date)) p.last_event_date = it.date;
      if (it.t === "alloc_open") {
        openAlloc = it.a;
        p.assigned_ec = it.a.ec || null;
        p.assigned_name = it.a.employee_name || (it.a.ec ? null : (it.a.branch || null));
        p.date_issued = it.a.date_issued || null;
        if (it.a.branch && !it.a.ec) p.branch = it.a.branch;
        if (it.a.condition_issued) p.condition = it.a.condition_issued;
        p.status = "Assigned";
        return;
      }
      if (it.t === "alloc_close") {
        if (openAlloc && openAlloc.id === it.a.id) openAlloc = null;
        p.assigned_ec = null; p.assigned_name = null; p.date_issued = null;
        if (it.a.condition_returned) p.condition = it.a.condition_returned;
        if (it.a.returned_to) p.branch = it.a.returned_to;
        p.status = "In Storage";
        return;
      }
      var e = it.e;
      if (e.kind === "transfer") {
        if (e.to_branch) p.branch = e.to_branch;
        if (e.condition) p.condition = e.condition;
      } else if (e.kind === "repair_out") {
        p.status = "Under Repair";
        if (e.condition) p.condition = e.condition;
      } else if (e.kind === "repair_in") {
        p.status = openAlloc ? "Assigned" : "In Storage";
        if (e.condition) p.condition = e.condition;
      } else if (e.kind === "status_change") {
        if (e.to_status) p.status = e.to_status;
        if (e.condition) p.condition = e.condition;
      } else if (e.kind === "disposal") {
        disposal = e;
        p.status = "Disposed";
        p.assigned_ec = null; p.assigned_name = null; p.date_issued = null;
        openAlloc = null;
        if (e.condition) p.condition = e.condition;
      }
    });
    p.open_alloc = openAlloc;
    p.disposed = !!disposal;
    p.disposal = disposal;
    return p;
  }

  // Which actions the drawer may offer for an asset in this state.
  function canAct(proj, action) {
    var p = proj || {};
    if (p.disposed && action !== "undo_disposal" && action !== "archive") return { ok: false, why: "This asset is disposed. Undo the disposal first." };
    switch (action) {
      case "allocate":  return p.open_alloc ? { ok: false, why: "Already allocated (" + (p.open_alloc.allocation_no || "open allocation") + "). Record its return first." } : { ok: true };
      case "return":    return p.open_alloc ? { ok: true } : { ok: false, why: "No open allocation to return." };
      case "repair_out": return p.status === "Under Repair" ? { ok: false, why: "Already under repair." } : { ok: true };
      case "repair_in":  return p.status === "Under Repair" ? { ok: true } : { ok: false, why: "Not under repair." };
      case "undo_disposal": return p.disposed ? { ok: true } : { ok: false, why: "Not disposed." };
      default: return { ok: true };
    }
  }

  // Human timeline for the drawer, newest first.
  function timeline(asset, events, allocations) {
    var items = _items(asset, events, allocations);
    var out = items.map(function (it) {
      if (it.t === "alloc_open") {
        var a = it.a;
        return { kind: "alloc_open", date: a.date_issued, no: a.allocation_no, icon: "🧑",
          label: "Allocated to " + (a.employee_name || a.branch || a.ec || "—") + (a.ec ? " (" + a.ec + ")" : ""),
          sub: [a.condition_issued ? "condition " + a.condition_issued : "", a.acknowledged ? "acknowledged " + (a.acknowledged_at || "") : "not acknowledged"].filter(Boolean).join(" · "),
          who: a.recorded_by || "", ref: a };
      }
      if (it.t === "alloc_close") {
        var b = it.a;
        return { kind: "alloc_close", date: b.date_returned, no: b.allocation_no, icon: "↩️",
          label: "Returned by " + (b.employee_name || b.branch || b.ec || "—") + (b.returned_to ? " to " + b.returned_to : ""),
          sub: [b.condition_returned ? "condition " + b.condition_returned : "", b.outstanding_notes || ""].filter(Boolean).join(" · "),
          who: b.recorded_by || "", ref: b };
      }
      var e = it.e, K = EVENT_KINDS[e.kind] || { label: e.kind, icon: "•" };
      var label = K.label, sub = "";
      if (e.kind === "transfer") { label = "Transferred " + (e.from_branch || "?") + " → " + (e.to_branch || "?"); sub = [e.reason, e.to_name ? "to " + e.to_name : "", e.condition ? "condition " + e.condition : ""].filter(Boolean).join(" · "); }
      else if (e.kind === "disposal") { label = "Disposed — " + (e.disposal_method || "method not set"); sub = [e.reason, e.disposal_value != null ? money(e.disposal_value) : "", e.approved_by ? "approved by " + e.approved_by : ""].filter(Boolean).join(" · "); }
      else if (e.kind === "status_change") { label = "Set to " + (e.to_status || "—") + (e.condition ? " · " + e.condition : ""); sub = e.reason || ""; }
      else if (e.kind === "repair_out") { sub = [e.reason, e.received_by ? "with " + e.received_by : ""].filter(Boolean).join(" · "); }
      else if (e.kind === "repair_in") { sub = e.condition ? "condition " + e.condition : ""; }
      if (e.notes) sub = sub ? sub + " · " + e.notes : e.notes;
      return { kind: e.kind, date: e.date, no: e.event_no || null, icon: K.icon, label: label, sub: sub, who: e.recorded_by || "", ref: e };
    });
    return out.reverse();
  }

  /* ── Book value (straight-line, monthly, residual 0) ───────────────────── */
  function usefulLifeFor(cfg, register, category) {
    var c = normCfg(cfg);
    var key = register + ":" + String(category || "").trim();
    if (c.usefulLifeMonths[key] > 0) return c.usefulLifeMonths[key];
    return c.usefulLifeDefault[register] || 60;
  }
  function bookValue(asset, cfg, today, proj) {
    var cost = num(asset && asset.purchase_cost);
    var life = usefulLifeFor(cfg, asset && asset.register, asset && asset.category);
    var out = { cost: cost, life: life, monthsUsed: null, value: null, pct: null, disposed: false };
    if (proj && proj.disposed) { out.disposed = true; out.value = 0; out.pct = 0; return out; }
    if (cost == null || !isYmd(asset && asset.purchase_date)) return out;
    var used = monthsBetween(asset.purchase_date, today || todayYmd());
    out.monthsUsed = used;
    var frac = life > 0 ? Math.max(0, 1 - used / life) : 0;
    out.pct = Math.round(frac * 100);
    out.value = Math.round(cost * frac * 100) / 100;
    return out;
  }

  /* ── Dashboard summary ─────────────────────────────────────────────────── */
  // ctx: { cfg, today, leavers: { EC: { name, leftDate, departed:bool } } }
  function summarise(assets, events, allocations, ctx) {
    var c = ctx || {};
    var cfg = normCfg(c.cfg);
    var today = c.today || todayYmd();
    var leavers = c.leavers || {};
    var live = (assets || []).filter(function (a) { return a && !a.archived_at; });
    var evLive = (events || []).filter(function (e) { return e && !e.archived_at; });
    var alLive = (allocations || []).filter(function (a) { return a && !a.archived_at; });
    var byAssetId = {};
    live.forEach(function (a) { byAssetId[a.id] = a; });

    var perRegister = {};
    REGISTERS.forEach(function (r) {
      perRegister[r.k] = { total: 0, active: 0, storage: 0, repair: 0, problem: 0, awaiting: 0, disposed: 0, cost: 0, book: 0 };
    });
    var byBranch = {};
    var costByBranch = {};
    var byStatus = {};
    var bookTotal = 0, costTotal = 0;
    live.forEach(function (a) {
      var r = perRegister[a.register];
      if (!r) return;
      var fam = familyOf(a.status);
      r.total += 1;
      r[fam] = (r[fam] || 0) + 1;
      byStatus[a.status || "—"] = (byStatus[a.status || "—"] || 0) + 1;
      var cost = num(a.purchase_cost) || 0;
      var bv = bookValue(a, cfg, today, { disposed: a.status === "Disposed" });
      r.cost += cost; r.book += bv.value || 0;
      costTotal += cost; bookTotal += bv.value || 0;
      if (fam !== "disposed") {
        var b = a.branch || "Unassigned";
        byBranch[b] = (byBranch[b] || 0) + 1;
        costByBranch[b] = (costByBranch[b] || 0) + cost;
      }
    });

    // Movements per month, last 12 months incl. this one.
    var months = [];
    var y = +today.slice(0, 4), m = +today.slice(5, 7);
    for (var i = 11; i >= 0; i--) {
      var mm = m - i, yy = y;
      while (mm <= 0) { mm += 12; yy -= 1; }
      months.push(yy + "-" + String(mm).padStart(2, "0"));
    }
    var monthly = months.map(function (ym) { return { ym: ym, transfers: 0, disposals: 0, allocations: 0 }; });
    var monthIdx = {};
    monthly.forEach(function (x, i) { monthIdx[x.ym] = i; });
    var transfers = 0, disposals = 0;
    var disposalsByMethod = {};
    var disposalValue = 0;
    evLive.forEach(function (e) {
      var k = monthIdx[ymOf(e.date)];
      if (e.kind === "transfer") { transfers += 1; if (k != null) monthly[k].transfers += 1; }
      if (e.kind === "disposal") {
        disposals += 1; if (k != null) monthly[k].disposals += 1;
        disposalsByMethod[e.disposal_method || "Not set"] = (disposalsByMethod[e.disposal_method || "Not set"] || 0) + 1;
        disposalValue += num(e.disposal_value) || 0;
      }
    });
    var openAllocs = alLive.filter(function (a) { return !a.date_returned; });
    alLive.forEach(function (a) { var k = monthIdx[ymOf(a.date_issued)]; if (k != null) monthly[k].allocations += 1; });

    // Attention lists.
    var leaverAllocs = openAllocs.filter(function (a) { return a.ec && leavers[normEc(a.ec)] && leavers[normEc(a.ec)].departed; })
      .map(function (a) {
        var l = leavers[normEc(a.ec)], asset = byAssetId[a.asset_id] || {};
        return { alloc: a, asset: asset, leftDate: l.leftDate || null, daysSince: l.leftDate ? daysBetween(l.leftDate, today) : null };
      });
    var unacknowledged = openAllocs.filter(function (a) { return !a.acknowledged && daysBetween(a.date_issued, today) > 7; })
      .map(function (a) { return { alloc: a, asset: byAssetId[a.asset_id] || {}, days: daysBetween(a.date_issued, today) }; });
    var underRepair = [];
    live.forEach(function (a) {
      if (a.status !== "Under Repair") return;
      var last = null;
      evLive.forEach(function (e) { if (e.asset_id === a.id && e.kind === "repair_out" && (!last || e.date > last)) last = e.date; });
      var days = last ? daysBetween(last, today) : null;
      if (days == null || days > 30) underRepair.push({ asset: a, since: last, days: days });
    });
    var expiring = [];
    var horizon = addDays(today, 60);
    live.forEach(function (a) {
      if (a.status === "Disposed") return;
      var d = a.details || {};
      var checks = [
        { l: "Warranty", d: a.warranty_expiry },
        { l: "Licence disc", d: d.licence_disc_expiry },
        { l: "Insurance", d: d.insurance_expiry },
        { l: "Service due", d: d.service_due }
      ];
      checks.forEach(function (x) {
        if (isYmd(x.d) && x.d <= horizon) expiring.push({ asset: a, what: x.l, date: x.d, days: daysBetween(today, x.d) });
      });
    });
    expiring.sort(function (p, q) { return p.date < q.date ? -1 : 1; });

    return {
      perRegister: perRegister,
      byBranch: byBranch, costByBranch: costByBranch, byStatus: byStatus,
      totals: {
        assets: live.filter(function (a) { return a.status !== "Disposed"; }).length,
        allAssets: live.length,
        transfers: transfers, disposals: disposals, disposalValue: disposalValue,
        allocations: alLive.length, openAllocations: openAllocs.length,
        unacknowledged: openAllocs.filter(function (a) { return !a.acknowledged; }).length,
        leaverAllocations: leaverAllocs.length,
        cost: costTotal, book: bookTotal
      },
      monthly: monthly,
      disposalsByMethod: disposalsByMethod,
      attention: { leavers: leaverAllocs, unacknowledged: unacknowledged, underRepair: underRepair, expiring: expiring }
    };
  }

  /* ── Bulk upload ───────────────────────────────────────────────────────── */
  // One spec per table. `aliases` are extra header spellings accepted on
  // upload (the owner's template headings, mostly). `t` drives parsing.
  var IMPORT_SPECS = {
    asset: {
      label: "Assets",
      idField: "asset_id",
      columns: [
        { key: "asset_id", label: "Asset ID", aliases: ["id", "asset no", "asset number"], hint: "Leave blank for a new asset — the next number is assigned. Fill it in to update an existing asset." },
        { key: "category", label: "Category", t: "list", list: "categories" },
        { key: "description", label: "Asset Description", required: true, aliases: ["description", "asset"] },
        { key: "brand", label: "Brand", aliases: ["make"] },
        { key: "model", label: "Model" },
        { key: "serial_number", label: "Serial Number", aliases: ["serial", "serial no"] },
        { key: "asset_tag", label: "Asset Tag", aliases: ["tag"] },
        { key: "purchase_date", label: "Purchase Date", t: "date" },
        { key: "purchase_cost", label: "Purchase Cost", t: "money", aliases: ["cost", "price"] },
        { key: "supplier", label: "Supplier" },
        { key: "invoice_ref", label: "Invoice Ref", aliases: ["invoice", "invoice number"] },
        { key: "warranty_expiry", label: "Warranty Expiry", t: "date", aliases: ["warranty"] },
        { key: "branch", label: "Branch / Location", t: "branch", aliases: ["branch", "location", "store"] },
        { key: "department", label: "Department", t: "list", list: "departments" },
        { key: "assigned_ec", label: "Employee No.", t: "ec", aliases: ["employee no", "employee code", "ec", "assigned to (ec)"], hint: "Creates an open allocation on upload." },
        { key: "date_issued", label: "Date Issued", t: "date" },
        { key: "condition", label: "Condition", t: "list", list: "conditions" },
        { key: "status", label: "Status", t: "list", list: "statuses" },
        { key: "notes", label: "Notes" }
      ],
      example: {
        asset_id: "", category: "Laptop", description: "Dell Latitude 5540 15\"", brand: "Dell", model: "Latitude 5540",
        serial_number: "ABC123XYZ", asset_tag: "BOA-IT-0001", purchase_date: "2026-01-15", purchase_cost: "18999.00",
        supplier: "Incredible Connection", invoice_ref: "INV-4471", warranty_expiry: "2029-01-15", branch: "Head Office",
        department: "HR", assigned_ec: "H001", date_issued: "2026-01-20", condition: "New", status: "Assigned", notes: ""
      }
    },
    transfer: {
      label: "Movements / Transfers",
      columns: [
        { key: "asset_id", label: "Asset ID", required: true, t: "asset" },
        { key: "date", label: "Date Moved", required: true, t: "date", aliases: ["date"] },
        { key: "to_branch", label: "To Branch", required: true, t: "branch", aliases: ["to", "destination"] },
        { key: "to_ec", label: "New Assignee (Employee No.)", t: "ec", aliases: ["new assignee", "to ec"] },
        { key: "reason", label: "Reason for Transfer", t: "list", list: "moveReasons", aliases: ["reason"] },
        { key: "approved_by", label: "Approved By" },
        { key: "received_by", label: "Received By" },
        { key: "condition", label: "Condition on Transfer", t: "list", list: "conditions", aliases: ["condition"] },
        { key: "notes", label: "Notes" }
      ],
      example: { asset_id: "IT-0001", date: "2026-03-01", to_branch: "Sea Point", to_ec: "", reason: "Branch Transfer", approved_by: "J. Smith", received_by: "Store manager", condition: "Good", notes: "" }
    },
    disposal: {
      label: "Disposals",
      columns: [
        { key: "asset_id", label: "Asset ID", required: true, t: "asset" },
        { key: "date", label: "Disposal Date", required: true, t: "date", aliases: ["date"] },
        { key: "reason", label: "Reason for Disposal", aliases: ["reason"] },
        { key: "condition", label: "Condition", t: "list", list: "conditions" },
        { key: "disposal_method", label: "Disposal Method", t: "list", list: "disposalMethods", aliases: ["method"] },
        { key: "approved_by", label: "Approved By" },
        { key: "disposal_value", label: "Disposal Value", t: "money", aliases: ["value"] },
        { key: "notes", label: "Notes" }
      ],
      example: { asset_id: "FA-0003", date: "2026-04-10", reason: "Beyond repair", condition: "Unserviceable", disposal_method: "Scrapped", approved_by: "Owner", disposal_value: "0", notes: "" }
    },
    allocation: {
      label: "Employee Asset Allocation",
      columns: [
        { key: "asset_id", label: "Asset ID", required: true, t: "asset" },
        { key: "ec", label: "Employee No.", required: true, t: "ec", aliases: ["employee no", "employee code", "ec"] },
        { key: "date_issued", label: "Date Issued", required: true, t: "date" },
        { key: "condition_issued", label: "Condition Issued", t: "list", list: "conditions", aliases: ["condition"] },
        { key: "acknowledged", label: "Employee Acknowledgement (Yes/No)", t: "yesno", aliases: ["acknowledged", "employee acknowledgement", "acknowledgement"] },
        { key: "acknowledged_at", label: "Acknowledged Date", t: "date" },
        { key: "date_returned", label: "Date Returned", t: "date" },
        { key: "condition_returned", label: "Condition Returned", t: "list", list: "conditions" },
        { key: "outstanding_notes", label: "Outstanding / Notes", aliases: ["notes", "outstanding"] }
      ],
      example: { asset_id: "IT-0001", ec: "H001", date_issued: "2026-01-20", condition_issued: "New", acknowledged: "Yes", acknowledged_at: "2026-01-20", date_returned: "", condition_returned: "", outstanding_notes: "" }
    }
  };

  // Header row + one example row, ready for _rowsToCsv-style output.
  function templateRows(table) {
    var spec = IMPORT_SPECS[table];
    if (!spec) return null;
    return {
      headers: spec.columns.map(function (c) { return c.label; }),
      example: spec.columns.map(function (c) { return spec.example[c.key] == null ? "" : String(spec.example[c.key]); })
    };
  }
  function templateCsv(table) {
    var t = templateRows(table);
    if (!t) return "";
    var esc = function (v) { var s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return t.headers.map(esc).join(",") + "\r\n" + t.example.map(esc).join(",") + "\r\n";
  }

  // Map the uploaded header row onto the spec's columns.
  function matchHeaders(table, headerRow) {
    var spec = IMPORT_SPECS[table];
    var map = {}, used = {}, unknown = [];
    var hdrs = (headerRow || []).map(function (h) { return normKey(h); });
    spec.columns.forEach(function (c) {
      var wants = [c.label, c.key].concat(c.aliases || []).map(normKey);
      for (var i = 0; i < hdrs.length; i++) {
        if (used[i] || !hdrs[i]) continue;
        if (wants.indexOf(hdrs[i]) >= 0) { map[c.key] = i; used[i] = true; break; }
      }
    });
    hdrs.forEach(function (h, i) { if (h && !used[i]) unknown.push(String(headerRow[i])); });
    var missing = spec.columns.filter(function (c) { return c.required && map[c.key] == null; }).map(function (c) { return c.label; });
    return { map: map, unknown: unknown, missing: missing };
  }

  function _listMatch(list, v) {
    var k = normKey(v);
    if (!k) return null;
    for (var i = 0; i < list.length; i++) if (normKey(list[i]) === k) return list[i];
    return null;
  }
  function _branchMatch(branches, v) {
    var k = normKey(v);
    if (!k) return null;
    for (var i = 0; i < branches.length; i++) if (normKey(branches[i]) === k) return branches[i];
    // unique substring either way
    var hits = branches.filter(function (b) { var nb = normKey(b); return nb.indexOf(k) >= 0 || k.indexOf(nb) >= 0; });
    return hits.length === 1 ? hits[0] : null;
  }
  function _yesNo(v) {
    var k = normKey(v);
    if (!k) return null;
    if (["yes", "y", "true", "1", "signed", "acknowledged"].indexOf(k) >= 0) return true;
    if (["no", "n", "false", "0"].indexOf(k) >= 0) return false;
    return null;
  }

  /* parseImport(table, aoa, ctx)
       aoa  array of arrays from SheetJS (first row = headers)
       ctx  { cfg, register (asset table only), branches: [names],
              people: { EC: {ec,name,jobTitle,department,branch} },
              assets: [existing asset rows], events: [], allocations: [] }
     Returns { rows: [{ n, data, errors[], warnings[], dup }], missing, unknown, headerMap }
       dup  null | { kind: "asset_id"|"serial"|"tag"|"file"|"event"|"open_alloc",
                     existing: <row>, label }                                   */
  function parseImport(table, aoa, ctx) {
    var spec = IMPORT_SPECS[table];
    if (!spec) throw new Error("Unknown import table " + table);
    var c = ctx || {};
    var cfg = normCfg(c.cfg);
    var rowsIn = (aoa || []).filter(function (r) { return isArr(r) && r.some(function (v) { return v != null && String(v).trim() !== ""; }); });
    if (!rowsIn.length) return { rows: [], missing: spec.columns.filter(function (x) { return x.required; }).map(function (x) { return x.label; }), unknown: [], headerMap: {} };
    var hm = matchHeaders(table, rowsIn[0]);
    var existing = (c.assets || []).filter(function (a) { return a && !a.archived_at; });
    var byAssetId = {}, bySerial = {}, byTag = {}, byUuid = {};
    existing.forEach(function (a) {
      byUuid[a.id] = a;
      if (a.asset_id) byAssetId[normKey(a.asset_id)] = a;
      if (a.serial_number) bySerial[normKey(a.serial_number)] = a;
      if (a.asset_tag) byTag[normKey(a.asset_tag)] = a;
    });
    var seenInFile = { id: {}, serial: {}, tag: {}, ev: {} };
    var out = [];
    for (var i = 1; i < rowsIn.length; i++) {
      var raw = rowsIn[i];
      var isExample = false;
      var data = {}, errors = [], warnings = [], dup = null;
      spec.columns.forEach(function (col) {
        var idx = hm.map[col.key];
        var v = idx == null ? "" : raw[idx];
        if (v == null) v = "";
        if (typeof v === "string") v = v.trim();
        var t = col.t || "text";
        if (v === "" || v === null) { data[col.key] = null; if (col.required) errors.push(col.label + " is required"); return; }
        if (t === "date") { var d = toYmd(v); if (!d) errors.push(col.label + ": '" + v + "' is not a date"); data[col.key] = d; return; }
        if (t === "money" || t === "number") { var n = num(v); if (n == null) errors.push(col.label + ": '" + v + "' is not a number"); data[col.key] = n; return; }
        if (t === "yesno") { var yn = _yesNo(v); if (yn == null) warnings.push(col.label + ": '" + v + "' read as No"); data[col.key] = !!yn; return; }
        if (t === "list") {
          var list = col.list === "categories" ? (cfg.categories[c.register] || []) : (cfg[col.list] || []);
          var hit = _listMatch(list, v);
          if (!hit) { warnings.push(col.label + ": '" + v + "' is not in the " + col.label.toLowerCase() + " list — kept as typed"); data[col.key] = String(v); }
          else data[col.key] = hit;
          return;
        }
        if (t === "branch") {
          var b = _branchMatch(c.branches || [], v);
          if (!b) { errors.push(col.label + ": '" + v + "' is not a known location"); data[col.key] = String(v); }
          else data[col.key] = b;
          return;
        }
        if (t === "ec") {
          var ec = normEc(v);
          var p = (c.people || {})[ec];
          if (!p) errors.push(col.label + ": no employee with code " + v);
          data[col.key] = ec;
          return;
        }
        if (t === "asset") {
          var a = byAssetId[normKey(v)];
          if (!a) errors.push(col.label + ": no asset " + v);
          data[col.key] = a ? a.asset_id : String(v).toUpperCase();
          data._asset = a || null;
          return;
        }
        data[col.key] = String(v);
      });
      // Skip the template's own example row if it was uploaded unchanged.
      if (spec.columns.every(function (col) { var ex = spec.example[col.key]; var got = raw[hm.map[col.key]]; return String(got == null ? "" : got).trim() === String(ex == null ? "" : ex); })) isExample = true;
      if (isExample) continue;

      if (table === "asset") {
        if (data.asset_id) {
          var reg = registerOfId(data.asset_id);
          if (!reg) errors.push("Asset ID '" + data.asset_id + "' is not in the IT-0001 / FA-0001 / SE-0001 / VE-0001 form");
          else if (c.register && reg !== c.register) errors.push("Asset ID '" + data.asset_id + "' belongs to the " + REGISTER_BY_KEY[reg].label + " register");
          data.asset_id = String(data.asset_id).toUpperCase();
          var ex = byAssetId[normKey(data.asset_id)];
          if (ex) dup = { kind: "asset_id", existing: ex, label: "Asset ID " + ex.asset_id + " already exists" };
          else if (seenInFile.id[normKey(data.asset_id)]) dup = { kind: "file", existing: null, label: "Asset ID repeats in this file (row " + seenInFile.id[normKey(data.asset_id)] + ")" };
          seenInFile.id[normKey(data.asset_id)] = i + 1;
        }
        if (!dup && data.serial_number) {
          var s = normKey(data.serial_number);
          if (bySerial[s]) dup = { kind: "serial", existing: bySerial[s], label: "Serial " + data.serial_number + " is already on " + bySerial[s].asset_id };
          else if (seenInFile.serial[s]) dup = { kind: "file", existing: null, label: "Serial repeats in this file (row " + seenInFile.serial[s] + ")" };
          seenInFile.serial[s] = i + 1;
        }
        if (!dup && data.asset_tag) {
          var tg = normKey(data.asset_tag);
          if (byTag[tg]) dup = { kind: "tag", existing: byTag[tg], label: "Tag " + data.asset_tag + " is already on " + byTag[tg].asset_id };
          else if (seenInFile.tag[tg]) dup = { kind: "file", existing: null, label: "Tag repeats in this file (row " + seenInFile.tag[tg] + ")" };
          seenInFile.tag[tg] = i + 1;
        }
        if (data.assigned_ec && !data.date_issued) warnings.push("Employee No. given without a Date Issued — today's date will be used");
        if (c.register) data.register = c.register;
      } else {
        var asset = data._asset;
        var evKey = table + "|" + (asset ? asset.id : data.asset_id) + "|" + (data.date || data.date_issued || "");
        if (asset) {
          var proj = project(asset, c.events || [], c.allocations || []);
          if (proj.disposed && table !== "disposal") errors.push(asset.asset_id + " is disposed");
          if (table === "disposal" && proj.disposed) dup = { kind: "event", existing: proj.disposal, label: asset.asset_id + " is already disposed (" + (proj.disposal.event_no || "") + ")" };
          if (table === "transfer") {
            var same = (c.events || []).find(function (e) { return e && !e.archived_at && e.kind === "transfer" && e.asset_id === asset.id && e.date === data.date && normKey(e.to_branch) === normKey(data.to_branch); });
            if (same) dup = { kind: "event", existing: same, label: "Same transfer already recorded (" + (same.event_no || "") + ")" };
          }
          if (table === "allocation") {
            var sameAl = (c.allocations || []).find(function (a) { return a && !a.archived_at && a.asset_id === asset.id && normEc(a.ec) === data.ec && a.date_issued === data.date_issued; });
            if (sameAl) dup = { kind: "event", existing: sameAl, label: "Same allocation already recorded (" + (sameAl.allocation_no || "") + ")" };
            else if (proj.open_alloc && !data.date_returned) dup = { kind: "open_alloc", existing: proj.open_alloc, label: asset.asset_id + " is already allocated to " + (proj.open_alloc.employee_name || proj.open_alloc.ec) + " (" + proj.open_alloc.allocation_no + ")" };
          }
        }
        if (!dup && seenInFile.ev[evKey]) dup = { kind: "file", existing: null, label: "Repeats in this file (row " + seenInFile.ev[evKey] + ")" };
        seenInFile.ev[evKey] = i + 1;
      }
      out.push({ n: i + 1, data: data, errors: errors, warnings: warnings, dup: dup });
    }
    return { rows: out, missing: hm.missing, unknown: hm.unknown, headerMap: hm.map };
  }

  /* ── Exports ───────────────────────────────────────────────────────────── */
  var API = {
    REGISTERS: REGISTERS, REGISTER_BY_KEY: REGISTER_BY_KEY, EVENT_KINDS: EVENT_KINDS, ALLOC_PREFIX: ALLOC_PREFIX,
    DETAIL_FIELDS: DETAIL_FIELDS, DEFAULT_CFG: DEFAULT_CFG, STATUS_FAMILY: STATUS_FAMILY, FAMILIES: FAMILIES,
    IMPORT_SPECS: IMPORT_SPECS,
    familyOf: familyOf, normCfg: normCfg, num: num, money: money, normEc: normEc, normKey: normKey,
    isYmd: isYmd, toYmd: toYmd, todayYmd: todayYmd, monthsBetween: monthsBetween, daysBetween: daysBetween, addDays: addDays,
    formatId: formatId, parseIdNumber: parseIdNumber, nextId: nextId, prefixForRegister: prefixForRegister, registerOfId: registerOfId,
    project: project, canAct: canAct, timeline: timeline,
    usefulLifeFor: usefulLifeFor, bookValue: bookValue,
    summarise: summarise,
    templateRows: templateRows, templateCsv: templateCsv, matchHeaders: matchHeaders, parseImport: parseImport
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.BOA_ASSETS = API;
})(typeof window !== "undefined" ? window : globalThis);
