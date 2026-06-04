/* ============================================================
   My BOA — Schedule viewer (staff & managers, own phone).
   Standalone page reached from the My BOA hub. Staff enter their
   employee code + store and see their published roster:
   Today/Tomorrow, this week, and the full monthly cycle, with
   shift times. Read-only — pulls schedules straight from the HR
   portal's Supabase (app_state boa_sched_/boa_mgrsched rows).
   ============================================================ */
(function () {
  var cfg = window.BOA_SUPABASE_CONFIG || {};
  var root = document.getElementById("root");
  if (!cfg.url || !cfg.anonKey || !window.supabase) {
    root.innerHTML = '<p class="sub" style="color:#b91c1c">Sorry — this could not load. Please tell HR.</p>';
    return;
  }
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });

  var STORES = [
    "Sea Point", "Bree", "Kloof", "Claremont", "Rondebosch", "Durbanville",
    "Table Bay", "Somerset West", "Riverlands", "Kuils River", "Westlake",
    "Green Point", "Plumstead", "Sandown", "Cape Gate", "Winelands", "Betty",
    "Fourways", "Eastgate", "Mall of the South", "Mushroom Farm", "Verdi", "Ballito"
  ];
  var DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var LS_KEY = "myboa_sched_v1";

  var state = {
    ec: "", store: "", name: "", role: "", effRole: "", isManager: false,
    custom: {},              // ymd -> "HH:MM - HH:MM" custom hours for this person
    view: "soon",            // soon | week | month
    monthYm: null,
    cache: {},               // ym -> grid object (for state.store + isManager)
    busy: false
  };

  // ── Cycle helpers (mirror the HR portal's 25th→24th logic) ───
  function pad(n) { return String(n).padStart(2, "0"); }
  function currentSchedYm() {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
    if (d.getDate() > 24) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + "-" + pad(m);
  }
  function shiftYm(ym, delta) {
    var p = ym.split("-"), y = +p[0], m = +p[1] + delta;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return y + "-" + pad(m);
  }
  // Which cycle (end-month ym) does a calendar date belong to?
  function ymForDate(dt) {
    var y = dt.getFullYear(), m = dt.getMonth() + 1;
    if (dt.getDate() >= 25) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + "-" + pad(m);
  }
  function periodDays(ym) {
    var p = ym.split("-"), y = +p[0], m = +p[1];
    var prevM = m === 1 ? 12 : m - 1, prevY = m === 1 ? y - 1 : y;
    var lastPrev = new Date(prevY, prevM, 0).getDate();
    var todayStr = new Date().toDateString();
    var out = [];
    for (var d = 25; d <= lastPrev; d++) {
      var dt = new Date(prevY, prevM - 1, d);
      out.push({ d: d, date: dt, isToday: dt.toDateString() === todayStr, dow: dt.getDay() });
    }
    for (var d2 = 1; d2 <= 24; d2++) {
      var dt2 = new Date(y, m - 1, d2);
      out.push({ d: d2, date: dt2, isToday: dt2.toDateString() === todayStr, dow: dt2.getDay() });
    }
    return out;
  }
  function periodLabel(ym) {
    var p = ym.split("-"), y = +p[0], m = +p[1];
    var sm = m === 1 ? 12 : m - 1, sy = m === 1 ? y - 1 : y;
    return MONTHS[sm - 1] + " 25" + (sy !== y ? " " + sy : "") + " – " + MONTHS[m - 1] + " 24, " + y;
  }

  // ── Shift times (replicated from the portal's shiftTimes) ────
  function shiftTimes(role, code, branch, dow) {
    var r = (role || "").toUpperCase();
    var isSM = r === "SM" || r === "SSM";
    var _b = branch || "";
    if (_b === "Sandown" || _b === "Table Bay") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) { if (code === "WE") return "08:00 - 17:00"; return "09:00 - 18:00"; }
      if (dow === 6 && _b === "Sandown") { if (code === "WE") return "08:00 - 17:00"; return "10:00 - 19:00"; }
      if (code === "WE") return "08:00 - 17:00";
      if (code === "WM") return "09:00 - 18:00";
      if (code === "WL") return "11:00 - 20:00";
      return "11:00 - 20:00";
    }
    if (_b === "Riverlands") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 6) return "09:00 - 18:00";
      if (dow === 0) return "08:30 - 17:00";
      if (code === "WE") return "09:00 - 18:00";
      if (code === "WB") return "08:00 - 17:00";
      if (code === "WL") return "10:00 - 19:00";
      return "10:00 - 19:00";
    }
    if (_b === "Ballito" || _b === "Mall of the South") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) return "08:00 - 17:00";
      if (code === "WE") return "08:00 - 17:00";
      if (code === "WM") return "09:00 - 18:00";
      if (code === "WL") return "10:00 - 19:00";
      return "10:00 - 19:00";
    }
    if (_b === "Fourways") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) { if (code === "WE") return "08:00 - 17:00"; return "10:00 - 19:00"; }
      if (code === "WM") return "10:00 - 19:00";
      if (code === "WL") return "11:00 - 20:00";
      return "11:00 - 20:00";
    }
    if (isSM) {
      if (dow === 0 || dow === 6) return "08:00 - 17:00";
      if (code === "WL") return "08:30 - 17:30";
      if (code === "WE") return "07:30 - 16:30";
      if (code === "WM") return "08:00 - 13:00";
      return "08:00 - 17:00";
    }
    if (dow === 6) return "09:00 - 18:00";
    if (dow === 0) return "08:30 - 17:00";
    if (code === "WL") return "10:00 - 19:00";
    if (code === "WE") return "08:30 - 18:00";
    if (code === "WM") return "09:00 - 13:00";
    if (code === "WB") return "08:00 - 19:00";
    if (code === "E")  return "09:00 - 18:30";
    return "09:00 - 18:30";
  }

  function ymdStr(dt) { return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate()); }
  // Decided (approved / declined), still-upcoming extra days for this tech —
  // drives the banners on their schedule. Reads only the tech's OWN rows via
  // the public RPC (no key); declined rows carry the manager's reason.
  function loadDecidedExtras(ec) {
    return sb.rpc("my_extra_day_requests", { p_ec: ec }).then(function (res) {
      if (res.error || !Array.isArray(res.data)) return [];
      var today = ymdStr(new Date());
      return res.data
        .filter(function (r) { return r && (r.status === "approved" || r.status === "declined") && r.work_date && r.work_date >= today; })
        .sort(function (a, b) { return String(a.work_date).localeCompare(String(b.work_date)); });
    });
  }
  function niceDate(ymd) {
    var p = String(ymd || "").split("-");
    if (p.length !== 3) return ymd;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d)) return ymd;
    return d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getFullYear();
  }
  var WORK_CODES = { W: 1, WE: 1, WL: 1, WM: 1, WB: 1, E: 1 };

  // ── SA public holidays (mirrors the portal's saHolidays) ─────
  function _easterSunday(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
  var _holCache = {};
  function saHolidays(year) {
    if (_holCache[year]) return _holCache[year];
    var out = {};
    var add = function (mo, d, name) {
      var dt = new Date(year, mo - 1, d);
      out[ymdStr(dt)] = name;
      if (dt.getDay() === 0) { var dt2 = new Date(year, mo - 1, d + 1); out[ymdStr(dt2)] = name + " (observed)"; }
    };
    add(1, 1, "New Year's Day"); add(3, 21, "Human Rights Day");
    var easter = _easterSunday(year);
    var gf = new Date(easter); gf.setDate(easter.getDate() - 2);
    var fd = new Date(easter); fd.setDate(easter.getDate() + 1);
    out[ymdStr(gf)] = "Good Friday"; out[ymdStr(fd)] = "Family Day";
    add(4, 27, "Freedom Day"); add(5, 1, "Workers' Day"); add(6, 16, "Youth Day");
    add(8, 9, "Women's Day"); add(9, 24, "Heritage Day"); add(12, 16, "Day of Reconciliation");
    add(12, 25, "Christmas Day"); add(12, 26, "Day of Goodwill");
    _holCache[year] = out;
    return out;
  }
  function holidayName(dt) { return saHolidays(dt.getFullYear())[ymdStr(dt)] || ""; }

  // Default nail-tech hours for normal stores (single shift every day).
  var NORMAL_TECH = { 1: "09:30 - 18:30", 6: "09:00 - 18:00", 0: "09:00 - 17:00" };
  // Stores where weekday techs are split into early/late shifts (so a plain "W"
  // weekday has no single time). Sandown/Fourways have full tables below.
  var SPLIT_STORES = { "Sandown": 1, "Table Bay": 1, "Fourways": 1, "Mall of the South": 1, "Ballito": 1 };

  // NAIL-TECH shift times, taken straight from the schedule tab's per-store
  // banners (these differ from the manager shiftTimes rules — e.g. Sandown WE
  // ends 17:30, Saturday WE starts 08:00). Keyed by store → day-bucket
  // (0=Sun, 6=Sat, 1=Mon–Fri) → code. Stores not listed fall back to the
  // generic rules (weekend single shift only) — see workSub.
  var TECH_TIMES = {
    "Sandown": {
      1: { WE: "08:00 - 17:30", WL: "11:00 - 20:00" },
      6: { WE: "08:00 - 17:30", WL: "10:00 - 19:00" },
      0: { W: "09:00 - 18:00" }
    },
    "Fourways": {
      1: { W: "09:30 - 18:30", WL: "11:00 - 20:00" },
      6: { W: "09:00 - 18:00", WL: "11:00 - 20:00" },
      0: { W: "09:00 - 18:00", WL: "10:00 - 19:00" }
    },
    "Table Bay": {
      1: { W: "09:30 - 18:30", WL: "11:00 - 20:00" },
      6: { W: "09:00 - 18:30", WL: "11:00 - 20:00" },
      0: { W: "09:00 - 18:00" }
    },
    "Ballito": {
      1: { W: "09:00 - 18:00", WL: "10:00 - 19:00" },
      6: { W: "09:00 - 18:00", WL: "10:00 - 19:00" },
      0: { W: "09:00 - 17:00" }
    },
    "Mall of the South": {
      1: { W: "09:00 - 18:00", WL: "10:00 - 19:00" },
      6: { W: "09:00 - 18:00", WL: "10:00 - 19:00" },
      0: { W: "09:00 - 17:00" }
    },
    "Riverlands": {
      1: { W: "09:30 - 18:30", WL: "10:00 - 19:00" },
      6: { W: "09:00 - 18:00" },
      0: { W: "09:00 - 17:00" }
    }
  };
  function techTime(store, dow, code) {
    var tbl = TECH_TIMES[store];
    if (!tbl) return null;                       // no defined tech table for this store
    var row = tbl[dow === 0 ? 0 : dow === 6 ? 6 : 1] || {};
    return row[code] || row.W || "";             // "" = store defined but this combo isn't
  }

  // Status for one date — matches Manager Coverage exactly: per-day custom hours
  // (boa_mgr_times_v1) win, else shiftTimes using the EFFECTIVE role (an AM on an
  // active SM trial is treated as an SM). A blank cell counts as a working day
  // for techs (their generator defaults blanks to W) but as OFF for managers
  // (coverage treats only explicit work codes as working).
  // The shift-time hours for a working day. Managers use the full Manager
  // Coverage logic (custom hours → shiftTimes by effective role). Techs are
  // only ever marked Work/Off in the portal — so we show a time ONLY when the
  // day carries an explicit shift code (WE/WL/WM/WB); a plain "W" shows no
  // invented time (it used to wrongly default to the store's closer shift).
  function workSub(c, dt) {
    if (state.isManager) {
      var custom = state.custom && state.custom[ymdStr(dt)];
      if (custom) return custom + " · custom hours";
      return shiftTimes(state.effRole || state.role, c || "W", state.store, dt.getDay());
    }
    var dow = dt.getDay();
    var code = (c === "WE" || c === "WL" || c === "WM" || c === "WB") ? c : "W";
    var variant = c === "WE" ? " · Early" : c === "WL" ? " · Late" : c === "WM" ? " · Mid" : "";

    // 1) Store with tech times defined on the schedule tab (Sandown, Fourways…).
    var tt = techTime(state.store, dow, code);
    if (tt !== null) return tt ? tt + variant : variant.replace(" · ", "");

    // 2) Split-shift store without a full table: explicit codes show their time;
    // a plain "W" only has one known time on weekends, weekdays show just "Work".
    if (SPLIT_STORES[state.store]) {
      if (code !== "W") return shiftTimes(state.role, code, state.store, dow) + variant;
      if (dow === 0 || dow === 6) return shiftTimes(state.role, "W", state.store, dow);
      return "";
    }

    // 3) Normal store: a single shift every day (Mon–Fri / Sat / Sun).
    return NORMAL_TECH[dow === 0 ? 0 : dow === 6 ? 6 : 1] + variant;
  }

  function cellStatus(row, dt) {
    var code = getCell(row, dt);
    var c = (code == null ? "" : String(code)).toUpperCase();
    if (c === "O") return { kind: "off", label: "Off", sub: "" };
    if (c === "R") return { kind: "off", label: "Off", sub: "Requested day off" };
    if (c === "L") return { kind: "leave", label: "On leave", sub: "" };
    if (c === "ML") return { kind: "leave", label: "Maternity leave", sub: "" };
    var working = c === "E" || WORK_CODES[c] || (c === "" && !state.isManager);
    if (!working && c !== "X" && c !== "P") return { kind: "off", label: "Off", sub: "" };

    // Working (incl. Extra / Pre-start). Public holidays pay double — same hours
    // as whatever weekday they fall on, flagged with 💰💰 and the holiday name.
    var hol = holidayName(dt);
    var time = (c === "X" || c === "P") ? "" : workSub(c, dt);
    if (hol) {
      var what = c === "E" ? "Extra day" : (c === "X" || c === "P") ? "Pre-start" : "Work";
      return { kind: "holiday", label: "💰💰 " + what, sub: hol + " · pays double" + (time ? " · " + time : "") };
    }
    if (c === "E") return { kind: "extra", label: "💰 Extra day", sub: time };
    if (c === "X" || c === "P") return { kind: "work", label: "Pre-start", sub: "" };
    return { kind: "work", label: "Work", sub: time };
  }

  // ── Data ─────────────────────────────────────────────────────
  // Tech schedules:    key boa_sched_<store>_<END-month ym>,  days by bare number.
  // Manager schedules: key boa_mgrsched_<store>_<START-month ym>, days by bare
  // number OR full "YYYY-MM-DD". We use the END-month ym as the canonical cycle
  // id everywhere and translate when building the storage key / reading a cell.
  function storageKey(ymEnd) {
    if (state.isManager) return "boa_mgrsched_" + state.store + "_" + shiftYm(ymEnd, -1);
    return "boa_sched_" + state.store + "_" + ymEnd;
  }
  function rowFor(grid) {
    if (!grid) return null;
    if (grid[state.ec]) return grid[state.ec];
    var up = state.ec.toUpperCase();
    for (var k in grid) { if (k.toUpperCase() === up) return grid[k]; }
    return null;
  }
  // A cell for a calendar date — handles both bare-day and YYYY-MM-DD keys.
  function getCell(row, dt) {
    if (!row) return undefined;
    var byNum = row[dt.getDate()];
    if (byNum != null) return byNum;
    var ymd = dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
    return row[ymd];
  }
  async function loadCycle(ymEnd) {
    if (state.cache[ymEnd] !== undefined) return state.cache[ymEnd];
    var res = await sb.from("app_state").select("value").eq("key", storageKey(ymEnd)).maybeSingle();
    var grid = (res && res.data && res.data.value && res.data.value.grid) || null;
    state.cache[ymEnd] = grid;
    return grid;
  }
  // Status for a specific calendar date (loads its cycle as needed).
  async function statusForDate(dt) {
    var grid = await loadCycle(ymForDate(dt));
    var row = rowFor(grid);
    if (!row) return { published: false };
    return { published: true, info: cellStatus(row, dt) };
  }

  // ── Screens ──────────────────────────────────────────────────
  function renderForm(msg) {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (_e) {}
    root.innerHTML = [
      '<a class="back" href="index.html">‹ My BOA</a>',
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<h1>My schedule</h1>',
      '<p class="sub">Enter your details to see your roster.</p>',
      msg ? '<p class="err" style="text-align:center">' + esc(msg) + '</p>' : '',
      '<div class="card">',
        '<label class="field"><span>Your store</span>',
          '<select id="store"><option value="">— choose your store —</option>',
            STORES.map(function (s) { return '<option' + (saved.store === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join(""),
          '</select></label>',
        '<label class="field"><span>Your employee code</span>',
          '<input type="text" id="ec" autocapitalize="characters" autocomplete="off" placeholder="e.g. B379" value="' + esc(saved.ec || "") + '" /></label>',
        '<button type="button" id="go" class="submit">View my schedule</button>',
        '<p class="err" id="err"></p>',
      '</div>',
      '<p class="foot">My BOA</p>'
    ].join("");
    document.getElementById("go").onclick = lookup;
    document.getElementById("ec").onkeydown = function (e) { if (e.key === "Enter") lookup(); };
  }

  // Raw grid fetch independent of state (used while we work out who they are).
  async function fetchGrid(store, isManager, ymEnd) {
    var key = (isManager ? "boa_mgrsched_" : "boa_sched_") + store + "_" + (isManager ? shiftYm(ymEnd, -1) : ymEnd);
    var res = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
    return (res && res.data && res.data.value && res.data.value.grid) || null;
  }
  function findEcKey(grid, ec) {
    if (!grid) return null;
    var up = ec.toUpperCase().trim();
    for (var k in grid) { if (String(k).toUpperCase().trim() === up) return k; }
    return null;
  }

  async function lookup() {
    var store = document.getElementById("store").value;
    var ec = (document.getElementById("ec").value || "").trim();
    setErr("");
    if (!store) { setErr("Please choose your store."); return; }
    if (!ec) { setErr("Please enter your employee code."); return; }

    setBusy(true);
    try {
      // Schedule-first: find the code in the published rosters (the grid is the
      // source of truth, keyed by employee code). This works even if the staff
      // table can't be read. We search current → next → previous cycle, tech
      // then manager, and stop at the first match.
      var ymEnd = currentSchedYm();
      var cycles = [ymEnd, shiftYm(ymEnd, 1), shiftYm(ymEnd, -1)];
      var found = null;
      for (var i = 0; i < cycles.length && !found; i++) {
        var techGrid = await fetchGrid(store, false, cycles[i]);
        var tk = findEcKey(techGrid, ec);
        if (tk) { found = { isManager: false, ecKey: tk, ym: cycles[i] }; break; }
        var mgrGrid = await fetchGrid(store, true, cycles[i]);
        var mk = findEcKey(mgrGrid, ec);
        if (mk) { found = { isManager: true, ecKey: mk, ym: cycles[i] }; break; }
      }
      if (!found) {
        setBusy(false);
        setErr("We couldn't find a schedule for " + esc(ec) + " at " + esc(store) + ". Check your code and store — your manager may not have published it yet.");
        return;
      }

      state.store = store;
      state.ec = found.ecKey;
      state.isManager = found.isManager;
      state.name = "";
      state.role = "";
      state.effRole = "";
      state.custom = {};
      state.cache = {};
      state.monthYm = found.ym || ymEnd;
      state.view = "soon";

      // Best-effort: name + role (for shift times), active SM-trial flag, and any
      // per-day custom hours — exactly what Manager Coverage uses. Never fatal.
      try {
        // Both grid keys AND staff employee_codes sometimes carry a trailing
        // space, so an exact match can silently miss (→ empty role → wrong
        // hours). Fetch by prefix and match on the trimmed code client-side.
        var ecTrim = found.ecKey.trim();
        var ecUp = ecTrim.toUpperCase();
        // NOTE: select only columns that exist on `staff` — referencing a
        // missing column (e.g. first_name) makes PostgREST reject the whole
        // query, which silently emptied the role (→ generic wrong hours).
        var rr = await Promise.all([
          sb.from("staff").select("employee_code,name,role,role_type").ilike("employee_code", ecTrim + "%").limit(10),
          sb.from("app_state").select("value").eq("key", "boa_sm_trial_v1").maybeSingle(),
          sb.from("app_state").select("value").eq("key", "boa_mgr_times_v1").maybeSingle()
        ]);
        var rows = (rr[0] && rr[0].data) || [];
        var row = rows.filter(function (x) { return String(x.employee_code || "").trim().toUpperCase() === ecUp; })[0];
        if (row) {
          state.name = (row.name || "").trim().split(" ")[0] || "";
          state.role = row.role || "";
          if (row.role_type === "manager") state.isManager = true;
        }
        // SM trial: an active trial makes an AM count as an SM for hours.
        var trials = rr[1] && rr[1].data && rr[1].data.value;
        var onSmTrial = Array.isArray(trials) && trials.some(function (t) {
          return t && t.status === "active" && t.ec && String(t.ec).toUpperCase().trim() === ecUp;
        });
        state.effRole = (state.role === "AM" && onSmTrial) ? "SM" : state.role;
        // Per-day custom hours map[ec][ymd].
        var times = rr[2] && rr[2].data && rr[2].data.value;
        if (times && typeof times === "object") {
          if (times[found.ecKey]) state.custom = times[found.ecKey];
          else { for (var tk in times) { if (String(tk).toUpperCase().trim() === ecUp) { state.custom = times[tk]; break; } } }
        }
      } catch (_e) {}

      try { localStorage.setItem(LS_KEY, JSON.stringify({ store: store, ec: found.ecKey })); } catch (_e) {}

      var today = new Date(), tom = new Date(); tom.setDate(tom.getDate() + 1);
      await Promise.all([loadCycle(ymForDate(today)), loadCycle(ymForDate(tom)), loadCycle(state.monthYm)]);
      try { state.decidedExtras = await loadDecidedExtras(found.ecKey); } catch (_e) { state.decidedExtras = []; }
      setBusy(false);
      renderDash();
    } catch (e) {
      setBusy(false);
      setErr("Sorry — could not load your schedule. Check your signal and try again.");
    }
  }

  function dayCard(dt, st, big) {
    var head = big ? (dt.toDateString() === new Date().toDateString() ? "Today" : "Tomorrow") : DOW[dt.getDay()];
    var date = dt.getDate() + " " + MONTHS[dt.getMonth()].slice(0, 3);
    var kind = st.published ? st.info.kind : "none";
    var label = st.published ? st.info.label : "Not published";
    var sub = st.published ? st.info.sub : "";
    var body = '<div class="st"><span class="pill k-' + kind + '">' + esc(label) + '</span>' +
      (sub ? '<span class="st-sub">' + esc(sub) + '</span>' : '') + '</div>';
    return '<div class="dayrow k-' + kind + (dt.toDateString() === new Date().toDateString() ? ' is-today' : '') + (big ? ' big' : '') + '">' +
      '<div class="dleft"><div class="dname">' + esc(head) + '</div><div class="ddate">' + esc(date) + '</div></div>' + body + '</div>';
  }

  async function renderDash() {
    var decided = state.decidedExtras || [];
    var appr = decided.filter(function (r) { return r.status === "approved"; });
    var decl = decided.filter(function (r) { return r.status === "declined"; });
    var banner = "";
    if (appr.length) {
      var days = appr.map(function (r) { return niceDate(r.work_date); }).join(", ");
      var many = appr.length > 1;
      banner += '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.5;color:#15803d;font-weight:600;margin-bottom:14px">'
        + '✅ Your extra ' + (many ? 'days' : 'day') + ' on <b>' + esc(days) + '</b> ' + (many ? 'were' : 'was')
        + ' approved — you’re booked to work, so please come in.'
        + '</div>';
    }
    decl.forEach(function (r) {
      banner += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.5;color:#b91c1c;margin-bottom:14px">'
        + '<span style="font-weight:600">✕ Your extra day on <b>' + esc(niceDate(r.work_date)) + '</b> wasn’t approved.</span>'
        + (r.decision_note ? '<div style="margin-top:5px;color:#7f1d1d;font-weight:400">Reason: ' + esc(r.decision_note) + '</div>' : '')
        + '</div>';
    });
    root.innerHTML = [
      '<a class="back" href="index.html">‹ My BOA</a>',
      '<div class="dashhead">',
        '<div><div class="hi">Hi ' + esc(state.name || "there") + ' 👋</div>',
        '<div class="meta">' + esc(state.store) + (state.role ? ' · ' + esc(state.role) : '') +
          (state.effRole === "SM" && state.role === "AM" ? ' (SM trial)' : '') +
          (state.isManager ? ' · Manager' : '') + '</div></div>',
        '<button type="button" id="chg" class="chg">Change</button>',
      '</div>',
      banner,
      '<div class="tabs">',
        tabBtn("soon", "Today / Tomorrow"),
        tabBtn("week", "This week"),
        tabBtn("month", "Month"),
      '</div>',
      '<div id="view"></div>',
      '<p class="foot">My BOA · schedules are set by your manager</p>'
    ].join("");
    document.getElementById("chg").onclick = function () { renderForm(); };
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.onclick = function () { state.view = b.getAttribute("data-v"); renderDash(); };
    });
    renderView();
  }
  function tabBtn(v, label) {
    return '<button type="button" class="tab' + (state.view === v ? ' on' : '') + '" data-v="' + v + '">' + label + '</button>';
  }

  async function renderView() {
    var el = document.getElementById("view");
    el.innerHTML = '<p class="sub">Loading…</p>';

    if (state.view === "soon") {
      var today = new Date(), tom = new Date(); tom.setDate(tom.getDate() + 1);
      var a = await statusForDate(today), b = await statusForDate(tom);
      el.innerHTML = '<div class="card pad">' + dayCard(today, a, true) + dayCard(tom, b, true) + '</div>';
      return;
    }

    if (state.view === "week") {
      // Current week: Monday → Sunday containing today.
      var now = new Date(); now.setHours(0, 0, 0, 0);
      var mondayOffset = (now.getDay() + 6) % 7;
      var monday = new Date(now); monday.setDate(now.getDate() - mondayOffset);
      var days = [];
      for (var i = 0; i < 7; i++) { var d = new Date(monday); d.setDate(monday.getDate() + i); days.push(d); }
      var sts = await Promise.all(days.map(statusForDate));
      el.innerHTML = '<div class="weeklbl">Week of ' + monday.getDate() + " " + MONTHS[monday.getMonth()].slice(0, 3) + '</div>' +
        '<div class="card pad">' + days.map(function (d, i) { return dayCard(d, sts[i], false); }).join("") + '</div>';
      return;
    }

    // Month (cycle) view with prev/next.
    var ym = state.monthYm;
    await loadCycle(ym);
    var days2 = periodDays(ym);
    var rows = days2.map(function (x) {
      var st = { published: false };
      var grid = state.cache[ym], row = rowFor(grid);
      if (row) st = { published: true, info: cellStatus(row, x.date) };
      return dayCard(x.date, st, false);
    }).join("");
    el.innerHTML =
      '<div class="monthnav">' +
        '<button type="button" id="prev" class="navb">‹</button>' +
        '<div class="mlbl">' + esc(periodLabel(ym)) + '</div>' +
        '<button type="button" id="next" class="navb">›</button>' +
      '</div>' +
      '<div class="card pad">' + rows + '</div>';
    document.getElementById("prev").onclick = function () { state.monthYm = shiftYm(ym, -1); renderView(); };
    document.getElementById("next").onclick = function () { state.monthYm = shiftYm(ym, 1); renderView(); };
  }

  // ── Helpers ──────────────────────────────────────────────────
  function setErr(m) { var e = document.getElementById("err"); if (e) e.textContent = m || ""; }
  function setBusy(b) {
    state.busy = b; var go = document.getElementById("go");
    if (go) { go.disabled = b; go.textContent = b ? "Looking…" : "View my schedule"; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Merge any stores added after launch, then show the form.
  sb.from("app_state").select("value").eq("key", "boa_custom_salons").maybeSingle()
    .then(function (res) {
      var v = res && res.data && res.data.value;
      if (Array.isArray(v)) {
        v.forEach(function (s) { var nm = s && (s.name || s.branch); if (nm && STORES.indexOf(nm) === -1) STORES.push(nm); });
        STORES.sort();
      }
    }).catch(function () {}).then(function () { renderForm(); });
})();
