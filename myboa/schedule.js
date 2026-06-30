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
    homeBranch: "", typedStore: "",   // typedStore = what they entered; store = home anchor
    transferring: false, transferTo: "", transferDate: "",   // permanent branch move (effective date)
    custom: {},              // ymd -> "HH:MM - HH:MM" custom hours for this person
    view: "soon",            // soon | week | month
    monthYm: null,
    cache: {},               // "<branch>|<ymEnd>" -> grid object (effective branch can vary per day)
    awayMap: {},             // "<branch>|<ymEnd>" -> { ymd: { branch, code } } — loan_out day resolution
    mgrRoles: {},            // EC(upper/trim) -> role, for split-store shift labelling
    smTrialEcs: {},          // EC(upper/trim) -> 1 for AMs on an active SM trial
    covLabels: {},           // ym -> re-derived WE/WM/WL grid (mirrors Manager Coverage)
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
    var isAM = r === "AM";
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
      if (dow === 0) return isAM ? "08:30 - 17:00" : "08:00 - 17:00";
      if (code === "WE") return "08:00 - 17:00";
      if (code === "WM") return "09:00 - 18:00";
      if (code === "WL") return "10:00 - 19:00";
      return "10:00 - 19:00";
    }
    if (_b === "Fourways") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) { if (code === "WE") return "08:00 - 17:00"; return "10:00 - 19:00"; }
      if (code === "WE") return "08:00 - 17:00";   // AM opener when no SM is in
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

  // ── PER-STORE MANAGER SHIFT LABELLING (mirrors the portal) ───
  // The saved manager grid stores a plain "W" or a possibly-stale label; the
  // portal's schedule tab + Manager Coverage re-derive WE/WM/WL at render time
  // from WHO is working each day (applyBranchShiftRules), so the shift TIME a
  // manager sees can differ from the raw saved cell. We replicate that here so
  // the viewer shows the same hours Coverage shows. Ported verbatim from
  // app.jsx (applyMgrShiftSplit / applyRiverlandsShifts / applyBallitoShifts /
  // applyFourwaysShifts) — all re-run-safe: working cells reset to "W" first,
  // then re-assign purely from the work/off pattern + roles.
  var SPLIT_SHIFT_STORES = { "Sandown": 1, "Table Bay": 1, "Riverlands": 1, "Ballito": 1, "Mall of the South": 1, "Fourways": 1 };
  function _isSMrole(m) { return /^(SSM|SM)$/i.test((m && m.role) || ""); }
  function _pickLowest(list, counter) {
    var sorted = list.slice().sort(function (a, b) {
      return ((counter[a.ec] || 0) - (counter[b.ec] || 0)) || String(a.ec || "").localeCompare(String(b.ec || ""));
    });
    var w = sorted[0];
    counter[w.ec] = (counter[w.ec] || 0) + 1;
    return w;
  }
  function _workersOn(grid, managers, dy, withWB) {
    return (managers || []).filter(function (m) {
      if (!(m && m.ec && grid[m.ec])) return false;
      var v = grid[m.ec][dy.d];
      return v === "W" || v === "WE" || v === "WM" || v === "WL" || (withWB && v === "WB");
    });
  }
  // Sandown (Mon–Fri WM) / Table Bay (Mon–Sat WM). wmDows = { dow: 1 }.
  function applyMgrShiftSplit(grid, dates, managers, wmDows) {
    if (!grid) return;
    var earlyCount = {}, middleCount = {};
    (managers || []).forEach(function (m) { earlyCount[m.ec] = 0; middleCount[m.ec] = 0; });
    (dates || []).forEach(function (dy) {
      var workers = _workersOn(grid, managers, dy, false);
      if (workers.length === 0) return;
      workers.forEach(function (m) { grid[m.ec][dy.d] = "W"; });
      var wmAllowedToday = wmDows && wmDows[dy.dow];
      var sm = null; for (var i = 0; i < workers.length; i++) { if (_isSMrole(workers[i])) { sm = workers[i]; break; } }
      var ams = workers.filter(function (m) { return !_isSMrole(m); });
      if (sm) {
        grid[sm.ec][dy.d] = "WE";
        if (wmAllowedToday && ams.length >= 2) {
          var mid = _pickLowest(ams, middleCount);
          grid[mid.ec][dy.d] = "WM";
          ams.filter(function (m) { return m.ec !== mid.ec; }).forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
        } else {
          ams.forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
        }
      } else if (ams.length > 0) {
        var opener = _pickLowest(ams, earlyCount);
        grid[opener.ec][dy.d] = "WE";
        var rest = ams.filter(function (m) { return m.ec !== opener.ec; });
        if (wmAllowedToday && rest.length >= 2) {
          var mid2 = _pickLowest(rest, middleCount);
          grid[mid2.ec][dy.d] = "WM";
          rest.filter(function (m) { return m.ec !== mid2.ec; }).forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
        } else {
          rest.forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
        }
      }
    });
  }
  // Riverlands — Mon–Fri WE/WL split with a 4+ "WB" bonus-early; Sat/Sun single WE.
  function applyRiverlandsShifts(grid, dates, managers) {
    if (!grid) return;
    var earlyCount = {}, extraEarlyCount = {};
    (managers || []).forEach(function (m) { earlyCount[m.ec] = 0; extraEarlyCount[m.ec] = 0; });
    (dates || []).forEach(function (dy) {
      var workers = _workersOn(grid, managers, dy, true);
      if (workers.length === 0) return;
      workers.forEach(function (m) { grid[m.ec][dy.d] = "W"; });
      var isMonFri = dy.dow >= 1 && dy.dow <= 5;
      if (!isMonFri) { workers.forEach(function (m) { grid[m.ec][dy.d] = "WE"; }); return; }
      var ams = workers;   // Riverlands labels by lineup regardless of role
      var opener = _pickLowest(ams, earlyCount);
      grid[opener.ec][dy.d] = "WE";
      var rest = ams.filter(function (m) { return m.ec !== opener.ec; });
      if (workers.length >= 4 && rest.length >= 1) {
        var extra = _pickLowest(rest, extraEarlyCount);
        grid[extra.ec][dy.d] = "WB";
        rest.filter(function (m) { return m.ec !== extra.ec; }).forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
      } else {
        rest.forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
      }
    });
  }
  // Ballito / Mall of the South — Mon–Sat: SM=WE, else WM(opener)+WL; Sunday single WE.
  function applyBallitoShifts(grid, dates, managers) {
    if (!grid) return;
    var middleCount = {};
    (managers || []).forEach(function (m) { middleCount[m.ec] = 0; });
    (dates || []).forEach(function (dy) {
      var workers = _workersOn(grid, managers, dy, true);
      if (workers.length === 0) return;
      workers.forEach(function (m) { grid[m.ec][dy.d] = "W"; });
      var isMonSat = dy.dow >= 1 && dy.dow <= 6;
      if (!isMonSat) { workers.forEach(function (m) { grid[m.ec][dy.d] = "WE"; }); return; }
      var sm = null; for (var i = 0; i < workers.length; i++) { if (_isSMrole(workers[i])) { sm = workers[i]; break; } }
      var ams = workers.filter(function (m) { return !_isSMrole(m); });
      if (sm) {
        grid[sm.ec][dy.d] = "WE";
        if (ams.length >= 2) {
          var mid = _pickLowest(ams, middleCount);
          grid[mid.ec][dy.d] = "WM";
          ams.filter(function (m) { return m.ec !== mid.ec; }).forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
        } else {
          ams.forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
        }
      } else if (ams.length === 1) {
        grid[ams[0].ec][dy.d] = "WL";
      } else if (ams.length > 0) {
        var mid2 = _pickLowest(ams, middleCount);
        grid[mid2.ec][dy.d] = "WM";
        ams.filter(function (m) { return m.ec !== mid2.ec; }).forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
      }
    });
  }
  // Fourways — SM always WE; no-SM Mon–Sat gives a WE opener + WL; Sunday WE+WL.
  function applyFourwaysShifts(grid, dates, managers) {
    if (!grid) return;
    var middleCount = {}, earlyCount = {};
    (managers || []).forEach(function (m) { middleCount[m.ec] = 0; earlyCount[m.ec] = 0; });
    (dates || []).forEach(function (dy) {
      var workers = _workersOn(grid, managers, dy, true);
      if (workers.length === 0) return;
      workers.forEach(function (m) { grid[m.ec][dy.d] = "W"; });
      var sms = workers.filter(_isSMrole);
      var ams = workers.filter(function (m) { return !_isSMrole(m); });
      sms.forEach(function (m) { grid[m.ec][dy.d] = "WE"; });
      var isSun = dy.dow === 0;
      if (isSun) {
        if (sms.length >= 1) {
          ams.forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
        } else if (ams.length === 1) {
          grid[ams[0].ec][dy.d] = "WE";
        } else if (ams.length > 0) {
          var opener0 = _pickLowest(ams, earlyCount);
          grid[opener0.ec][dy.d] = "WE";
          ams.filter(function (m) { return m.ec !== opener0.ec; }).forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
        }
        return;
      }
      if (ams.length === 0) {
        // pure SM day — already handled
      } else if (sms.length >= 1) {
        if (ams.length >= 2) {
          var mid = _pickLowest(ams, middleCount);
          grid[mid.ec][dy.d] = "WM";
          ams.filter(function (m) { return m.ec !== mid.ec; }).forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
        } else {
          ams.forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
        }
      } else if (ams.length === 1) {
        grid[ams[0].ec][dy.d] = "WE";
      } else {
        var opener = _pickLowest(ams, earlyCount);
        grid[opener.ec][dy.d] = "WE";
        ams.filter(function (m) { return m.ec !== opener.ec; }).forEach(function (m) { grid[m.ec][dy.d] = "WL"; });
      }
    });
  }
  function applyBranchShiftRules(grid, dates, managers, branch) {
    if (!grid) return;
    if (branch === "Sandown") return applyMgrShiftSplit(grid, dates, managers, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 });
    if (branch === "Table Bay") return applyMgrShiftSplit(grid, dates, managers, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 });
    if (branch === "Riverlands") return applyRiverlandsShifts(grid, dates, managers);
    if (branch === "Ballito") return applyBallitoShifts(grid, dates, managers);
    if (branch === "Mall of the South") return applyBallitoShifts(grid, dates, managers);
    if (branch === "Fourways") return applyFourwaysShifts(grid, dates, managers);
  }

  // Effective role for any EC (AM on an active SM trial counts as SM — matches
  // the portal's _effectiveRole, which Coverage feeds into the labellers).
  function effRoleFor(ec) {
    var up = String(ec).toUpperCase().trim();
    var role = state.mgrRoles[up] || "";
    if (role === "AM" && state.smTrialEcs[up]) return "SM";
    return role;
  }
  // Re-derive the cycle's manager shift labels (cached per cycle+branch). Returns
  // an ec -> { ymd: code } grid, or null when not a split store / grid not loaded.
  function buildMgrLabels(ymEnd, branch) {
    branch = branch || state.store;
    if (!state.isManager || !SPLIT_SHIFT_STORES[branch]) return null;
    var ck = branch + "|" + ymEnd;
    if (state.covLabels[ck]) return state.covLabels[ck];
    var src = state.cache[ck];
    if (!src) return null;                       // grid not loaded yet — caller falls back to raw
    var mgrs = [];
    for (var ec in src) { if (Object.prototype.hasOwnProperty.call(src, ec)) mgrs.push({ ec: ec, role: effRoleFor(ec) }); }
    var days = periodDays(ymEnd);
    var dates = [];
    var g2 = {};
    for (var i = 0; i < days.length; i++) {
      var dt = days[i].date, ymd = ymdStr(dt);
      dates.push({ d: ymd, dow: dt.getDay() });
      for (var j = 0; j < mgrs.length; j++) {
        var mec = mgrs[j].ec;
        if (!g2[mec]) g2[mec] = {};
        var raw = getCell(src[mec], dt);
        g2[mec][ymd] = (raw == null ? "" : String(raw).toUpperCase());
      }
    }
    applyBranchShiftRules(g2, dates, mgrs, branch);
    state.covLabels[ck] = g2;
    return g2;
  }
  // The re-derived shift code for THIS person on a date (or null to use raw).
  function derivedMgrCode(dt, branch) {
    var g = buildMgrLabels(ymForDate(dt), branch);
    if (!g) return null;
    var row = g[state.ec];
    if (!row) return null;
    var ymd = ymdStr(dt);
    return Object.prototype.hasOwnProperty.call(row, ymd) ? row[ymd] : null;
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
  function workSub(c, dt, branch) {
    branch = branch || state.store;
    if (state.isManager) {
      var custom = state.custom && state.custom[ymdStr(dt)];
      if (custom) return custom + " · custom hours";
      return shiftTimes(state.effRole || state.role, c || "W", branch, dt.getDay());
    }
    var dow = dt.getDay();
    var code = (c === "WE" || c === "WL" || c === "WM" || c === "WB") ? c : "W";
    var variant = c === "WE" ? " · Early" : c === "WL" ? " · Late" : c === "WM" ? " · Mid" : "";

    // 1) Store with tech times defined on the schedule tab (Sandown, Fourways…).
    var tt = techTime(branch, dow, code);
    if (tt !== null) return tt ? tt + variant : variant.replace(" · ", "");

    // 2) Split-shift store without a full table: explicit codes show their time;
    // a plain "W" only has one known time on weekends, weekdays show just "Work".
    if (SPLIT_STORES[branch]) {
      if (code !== "W") return shiftTimes(state.role, code, branch, dow) + variant;
      if (dow === 0 || dow === 6) return shiftTimes(state.role, "W", branch, dow);
      return "";
    }

    // 3) Normal store: a single shift every day (Mon–Fri / Sat / Sun).
    return NORMAL_TECH[dow === 0 ? 0 : dow === 6 ? 6 : 1] + variant;
  }

  // Maternity overlay — once HR flips someone to maternity, reflect ML
  // immediately. With a start date, ML shows from that date on (real shifts
  // before it are untouched); with no date yet ("dates TBC"), they read as on
  // leave throughout. This wins over whatever the saved grid cell says, so the
  // app updates the instant HR sets the status — no roster regenerate needed.
  function matMlOn(dt) {
    if (state.matStatus !== "on_mat" && state.matStatus !== "dates_tbc") return false;
    if (!state.matStart) return true;
    var ymd = dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
    return ymd >= state.matStart;
  }
  var ML_INFO = { kind: "leave", label: "Maternity leave", sub: "" };

  // Legal unpaid-leave overlay (Compliance "Unpaid Leave (Legal)") — staff kept
  // off the roster while documents (e.g. work permits) are sorted. Like
  // maternity, it wins over the saved grid cell so the schedule reflects it the
  // instant HR sets it. start/end may be null (open-ended → whole period).
  function legalUnpaidOn(dt) {
    if (!state.legalOn) return false;
    var ymd = dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
    if (state.legalStart && ymd < state.legalStart) return false;
    if (state.legalEnd && ymd > state.legalEnd) return false;
    return true;
  }
  var LEGAL_INFO = { kind: "leave", label: "Unpaid leave (legal)", sub: "" };

  // Cross-store day-loans (boa_mgr_loans_v1 / boa_tech_loans_v1) for this person,
  // keyed by date. A loan day means they're borrowed to loan.toBranch.
  function loanForDate(dt) {
    var map = state.loans || {};
    return map[ymdStr(dt)] || null;
  }
  function loanInfo(loan) {
    return {
      kind: "work",
      label: "🔄 Working at " + (loan.toBranch || "another store"),
      sub: "Borrowed" + (loan.fromBranch ? " from " + loan.fromBranch : "") + (loan.note ? " · " + loan.note : "") + " — hours are set by that store"
    };
  }

  // Status for a date, resolved against `branch` (the person's EFFECTIVE store that
  // day — home, or the transfer destination once the transfer date has passed).
  function cellStatus(row, dt, branch) {
    branch = branch || state.store;
    if (matMlOn(dt)) return ML_INFO;
    if (legalUnpaidOn(dt)) return LEGAL_INFO;
    // Cross-store day-loan (swap/borrow): borrowed to ANOTHER branch this day.
    var loan = loanForDate(dt);
    if (loan && loan.toBranch && loan.toBranch !== branch) return loanInfo(loan);
    var code = getCell(row, dt);
    var c = (code == null ? "" : String(code)).toUpperCase();
    // Grid-level loan_out: working at another store that day — resolve which.
    if (c === "LOAN_OUT") {
      var away = (state.awayMap[branch + "|" + ymForDate(dt)] || {})[ymdStr(dt)];
      if (away && away.branch) {
        var ah = (state.custom && state.custom[ymdStr(dt)]) ? state.custom[ymdStr(dt)] + " · custom hours"
          : (state.isManager
              ? shiftTimes(state.effRole || state.role, away.code || "W", away.branch, dt.getDay())
              : (techTime(away.branch, dt.getDay(), WORK_CODES[away.code] ? away.code : "W") || ""));
        return { kind: "work", label: "🔄 Working at " + away.branch, sub: (ah ? ah + " · " : "") + "hours set by " + away.branch };
      }
      return { kind: "work", label: "🔄 Working at another store", sub: "Borrowed out — hours are set by that store" };
    }
    if (c === "O") return { kind: "off", label: "Off", sub: "" };
    if (c === "R") return { kind: "off", label: "Off", sub: "Requested day off" };
    if (c === "L") return { kind: "leave", label: "On leave", sub: "" };
    if (c === "ML") return { kind: "leave", label: "Maternity leave", sub: "" };
    var working = c === "E" || WORK_CODES[c] || (c === "" && !state.isManager);
    if (!working && c !== "X" && c !== "P") return { kind: "off", label: "Off", sub: "" };

    // Working (incl. Extra / Pre-start). Public holidays pay double — same hours
    // as whatever weekday they fall on, flagged with 💰💰 and the holiday name.
    var hol = holidayName(dt);
    // Split-store managers: trust the PUBLISHED snapshot's resolved label
    // (WE/WM/WL). The portal bakes the rotation AND the manual shift pins into the
    // snapshot at publish, so the saved cell IS the authoritative shift. Only
    // re-derive when the snapshot left a bare "W" (legacy / pre-resolution cell).
    // Re-deriving an already-resolved cell dropped the manual pins and showed the
    // wrong hours (e.g. a pinned WE opener rendered as WM). Custom hours still win
    // inside workSub.
    var timeCode = c;
    if (working && state.isManager && SPLIT_SHIFT_STORES[branch] && c === "W" && !(state.custom && state.custom[ymdStr(dt)])) {
      var dc = derivedMgrCode(dt, branch);
      if (dc) timeCode = dc;
    }
    var time = (c === "X" || c === "P") ? "" : workSub(timeCode, dt, branch);
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
  function storageKey(ymEnd, branch) {
    branch = branch || state.store;
    if (state.isManager) return "boa_mgrsched_" + branch + "_" + shiftYm(ymEnd, -1);
    return "boa_sched_" + branch + "_" + ymEnd;
  }
  // The branch a person is effectively at on a date — after a branch transfer's
  // effective date, that's the destination store (mirrors the portal's
  // effHomeBranch). Drives per-day anchoring so a mid-cycle transfer flips the
  // source-of-truth schedule to the new store, off days and all.
  function effectiveBranchOn(dt) {
    if (state.transferring && state.transferTo && state.transferDate && state.transferDate <= ymdStr(dt)) return state.transferTo;
    return state.homeBranch || state.store;
  }
  // Approved (PUBLISHED) snapshot key — same store + ym convention as the live
  // key, just the "…approved_" prefix. Value is an array of snapshots, newest
  // first; the live grid (storageKey) can hold an unpublished draft, so we read
  // the published snapshot for display.
  function approvedKey(store, isManager, ymEnd) {
    return (isManager ? "boa_mgrschedapproved_" : "boa_schedapproved_") + store + "_" + (isManager ? shiftYm(ymEnd, -1) : ymEnd);
  }
  // Is this cycle later than the one containing today? (string "YYYY-MM" compares lexically)
  function isFutureCycle(ymEnd) { return ymEnd > currentSchedYm(); }
  // The newest PUBLISHED grid for a store+cycle, or null if never published.
  async function fetchApprovedGrid(store, isManager, ymEnd) {
    var res = await sb.from("app_state").select("value").eq("key", approvedKey(store, isManager, ymEnd)).maybeSingle();
    var arr = res && res.data && res.data.value;
    return (Array.isArray(arr) && arr.length && arr[0] && arr[0].grid) || null;
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
  // Display the PUBLISHED schedule only. If a cycle has an approved snapshot, use
  // it (the published truth, even if the live grid was since re-drafted). If not
  // published and the cycle is in the future → null, so the "Not published yet"
  // greyed state shows (no draft leaks out). For the current/past with no
  // snapshot, fall back to the live grid (stores that don't formally publish, and
  // history, keep working).
  async function loadCycle(ymEnd, branch) {
    branch = branch || state.store;
    var ck = branch + "|" + ymEnd;
    if (state.cache[ck] !== undefined) return state.cache[ck];
    var grid = await fetchApprovedGrid(branch, state.isManager, ymEnd);
    if (!grid && !isFutureCycle(ymEnd)) {
      var res = await sb.from("app_state").select("value").eq("key", storageKey(ymEnd, branch)).maybeSingle();
      grid = (res && res.data && res.data.value && res.data.value.grid) || null;
    }
    state.cache[ck] = grid;
    return grid;
  }
  function isLoanOut(v) { return String(v == null ? "" : v).toUpperCase().trim() === "LOAN_OUT"; }
  function isWorkCode(v) { var c = String(v == null ? "" : v).toUpperCase().trim(); return c === "E" || !!WORK_CODES[c]; }

  // Resolve grid-level day loans: a `loan_out` cell in the (effective) branch's
  // grid means they're working at ANOTHER store that day. We find which by
  // scanning every other store's PUBLISHED snapshot for a work code (one batched
  // query per cycle+branch, cached). Only fires when there's a loan_out cell, so
  // ordinary off days cost nothing. (Permanent transfers are handled separately by
  // effectiveBranchOn, so we don't second-guess plain off days here.)
  async function ensureAwayMap(ymEnd, branch) {
    branch = branch || state.store;
    var ck = branch + "|" + ymEnd;
    if (state.awayMap[ck] !== undefined) return state.awayMap[ck];
    var grid = state.cache[ck];
    var row = rowFor(grid);
    var loanDays = row ? periodDays(ymEnd).filter(function (x) { return isLoanOut(getCell(row, x.date)); }) : [];
    if (!loanDays.length) { state.awayMap[ck] = {}; return state.awayMap[ck]; }

    var prefix = state.isManager ? "boa_mgrschedapproved_" : "boa_schedapproved_";
    var ymPart = state.isManager ? shiftYm(ymEnd, -1) : ymEnd;
    var keys = STORES.filter(function (s) { return s !== branch; })
      .map(function (s) { return prefix + s + "_" + ymPart; });
    var byBranch = {};
    try {
      var res = await sb.from("app_state").select("key,value").in("key", keys);
      (res && res.data || []).forEach(function (r) {
        var arr = r && r.value;                                  // approved = array, newest first
        var g = (Array.isArray(arr) && arr.length && arr[0] && arr[0].grid) || null;
        if (!g) return;
        byBranch[String(r.key).slice(prefix.length, String(r.key).length - (ymPart.length + 1))] = g;
      });
    } catch (_e) { /* empty → loan_out shows neutral "working elsewhere" */ }

    var map = {};
    loanDays.forEach(function (x) {
      var hit = null;
      for (var b in byBranch) {
        if (!Object.prototype.hasOwnProperty.call(byBranch, b)) continue;
        var k = findEcKey(byBranch[b], state.ec);
        if (k && isWorkCode(getCell(byBranch[b][k], x.date))) { hit = { branch: b, code: String(getCell(byBranch[b][k], x.date)).toUpperCase().trim() }; break; }
      }
      map[ymdStr(x.date)] = hit || { branch: null };
    });
    state.awayMap[ck] = map;
    return map;
  }
  // Status for a specific calendar date (loads its cycle as needed).
  async function statusForDate(dt) {
    // Maternity wins even if this cycle's roster hasn't been published yet.
    if (matMlOn(dt)) return { published: true, info: ML_INFO };
    var branch = effectiveBranchOn(dt);                 // home, or transfer destination from its date on
    var grid = await loadCycle(ymForDate(dt), branch);
    await ensureAwayMap(ymForDate(dt), branch);
    var row = rowFor(grid);
    if (!row) {
      var loan = loanForDate(dt);
      if (loan && loan.toBranch && loan.toBranch !== branch) return { published: true, info: loanInfo(loan) };
      return { published: false };
    }
    return { published: true, info: cellStatus(row, dt, branch) };
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
      state.homeBranch = "";
      state.typedStore = "";
      state.transferring = false;
      state.transferTo = "";
      state.transferDate = "";
      state.matStatus = "";
      state.matStart = null;
      state.legalOn = false;
      state.legalStart = null;
      state.legalEnd = null;
      state.custom = {};
      state.cache = {};
      state.awayMap = {};
      state.mgrRoles = {};
      state.smTrialEcs = {};
      state.covLabels = {};
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
          sb.from("staff").select("employee_code,name,role,role_type,branch,transferring,transfer_to,transfer_date").ilike("employee_code", ecTrim + "%").limit(10),
          sb.from("app_state").select("value").eq("key", "boa_sm_trial_v1").maybeSingle(),
          sb.from("app_state").select("value").eq("key", "boa_mgr_times_v1").maybeSingle(),
          // Maternity record — so the schedule flips to ML straight from the
          // start date the moment HR sets it, without waiting for the roster
          // to be regenerated.
          sb.from("maternity").select("employee_code,mat_status,mat_start").ilike("employee_code", ecTrim + "%").limit(10),
          // Legal unpaid-leave records (Compliance → "Unpaid Leave (Legal)") so
          // EL shows the moment HR puts someone on it — same as maternity, no
          // roster regenerate needed.
          sb.from("app_state").select("value").eq("key", "boa_unpaid_legal_v1").maybeSingle()
        ]);
        var rows = (rr[0] && rr[0].data) || [];
        var row = rows.filter(function (x) { return String(x.employee_code || "").trim().toUpperCase() === ecUp; })[0];
        if (row) {
          state.name = (row.name || "").trim().split(" ")[0] || "";
          state.role = row.role || "";
          state.homeBranch = (row.branch || "").trim();   // their base store
          // Branch transfer (permanent move with an effective date): from
          // transfer_date on, the destination store becomes their home/truth.
          state.transferring = !!row.transferring;
          state.transferTo = (row.transfer_to || "").trim();
          state.transferDate = row.transfer_date ? String(row.transfer_date).replace(/\//g, "-") : "";
          if (row.role_type === "manager") state.isManager = true;
          if (state.role) state.mgrRoles[ecUp] = state.role;   // self always known for the lineup
        }
        // SM trial: an active trial makes an AM count as an SM for hours.
        var trials = rr[1] && rr[1].data && rr[1].data.value;
        var onSmTrial = Array.isArray(trials) && trials.some(function (t) {
          return t && t.status === "active" && t.ec && String(t.ec).toUpperCase().trim() === ecUp;
        });
        state.effRole = (state.role === "AM" && onSmTrial) ? "SM" : state.role;
        // Every active SM trial (for re-deriving OTHER managers' labels too).
        if (Array.isArray(trials)) trials.forEach(function (t) {
          if (t && t.status === "active" && t.ec) state.smTrialEcs[String(t.ec).toUpperCase().trim()] = 1;
        });
        // Per-day custom hours map[ec][ymd].
        var times = rr[2] && rr[2].data && rr[2].data.value;
        if (times && typeof times === "object") {
          if (times[found.ecKey]) state.custom = times[found.ecKey];
          else { for (var tk in times) { if (String(tk).toUpperCase().trim() === ecUp) { state.custom = times[tk]; break; } } }
        }
        // Maternity status + start date (trim-tolerant EC match, same as above).
        var matRows = (rr[3] && rr[3].data) || [];
        var matRow = matRows.filter(function (x) { return String(x.employee_code || "").trim().toUpperCase() === ecUp; })[0];
        if (matRow) {
          state.matStatus = matRow.mat_status || "";
          state.matStart = matRow.mat_start || null;
        }
        // Legal unpaid leave (status "on_leave"; start/end may be null = open).
        // Trim/upper-tolerant EC match, same as the others.
        var legalRecs = (rr[4] && rr[4].data && rr[4].data.value);
        if (Array.isArray(legalRecs)) {
          var legalRow = legalRecs.filter(function (r) {
            return r && r.status === "on_leave" && String(r.ec || "").trim().toUpperCase() === ecUp;
          })[0];
          if (legalRow) {
            state.legalOn = true;
            state.legalStart = legalRow.startDate || null;
            state.legalEnd = legalRow.endDate || null;
          }
        }
      } catch (_e) {}

      // Split-shift stores re-derive WE/WM/WL labels from who's working each day
      // (matching Manager Coverage), which needs EVERY manager's role — fetch the
      // company's manager roles once and match by trimmed/upper code. Only managers
      // at these stores hit this; techs and plain stores skip it.
      if (state.isManager && (SPLIT_SHIFT_STORES[state.homeBranch || state.store] || (state.transferTo && SPLIT_SHIFT_STORES[state.transferTo]))) {
        try {
          var mr = await sb.from("staff").select("employee_code,role,role_type").eq("role_type", "manager").limit(2000);
          var mrows = (mr && mr.data) || [];
          mrows.forEach(function (x) {
            var up = String(x.employee_code || "").toUpperCase().trim();
            if (up) state.mgrRoles[up] = x.role || "";
          });
        } catch (_e) { state.mgrRoles = {}; }
      }

      // Cross-store day-loans for this person (Manager Coverage / Movements).
      // Without these a borrowed day would wrongly read as "Off".
      state.loans = {};
      try {
        var loanKey = state.isManager ? "boa_mgr_loans_v1" : "boa_tech_loans_v1";
        var lr = await sb.from("app_state").select("value").eq("key", loanKey).maybeSingle();
        var loans = (lr && lr.data && lr.data.value) || [];
        var ecUpL = String(found.ecKey).toUpperCase().trim();
        (Array.isArray(loans) ? loans : []).forEach(function (l) {
          if (l && l.ec && l.date && String(l.ec).toUpperCase().trim() === ecUpL) state.loans[l.date] = l;
        });
      } catch (_e) { state.loans = {}; }

      // Anchor display to the person's home branch (typed store only finds them).
      // Each day then resolves to its EFFECTIVE branch — after a transfer's
      // effective date, that's the destination store — via effectiveBranchOn().
      state.typedStore = store;
      if (state.homeBranch) { state.store = state.homeBranch; state.cache = {}; state.awayMap = {}; }

      try { localStorage.setItem(LS_KEY, JSON.stringify({ store: store, ec: found.ecKey })); } catch (_e) {}

      var today = new Date(), tom = new Date(); tom.setDate(tom.getDate() + 1);
      await Promise.all([
        loadCycle(ymForDate(today), effectiveBranchOn(today)),
        loadCycle(ymForDate(tom), effectiveBranchOn(tom)),
        loadCycle(state.monthYm, effectiveBranchOn(today))
      ]);
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
    var label = st.published ? st.info.label : "Not published yet";
    var sub = st.published ? st.info.sub : "Your manager hasn’t published this roster yet";
    var body = '<div class="st"><span class="pill k-' + kind + '">' + esc(label) + '</span>' +
      (sub ? '<span class="st-sub">' + esc(sub) + '</span>' : '') + '</div>';
    return '<div class="dayrow k-' + kind + (dt.toDateString() === new Date().toDateString() ? ' is-today' : '') + (big ? ' big' : '') + '">' +
      '<div class="dleft"><div class="dname">' + esc(head) + '</div><div class="ddate">' + esc(date) + '</div></div>' + body + '</div>';
  }

  async function renderDash() {
    // Header reflects where they are TODAY (their effective branch) + any pending
    // or recent transfer, so the label isn't stale once a move takes effect.
    var headBranch = effectiveBranchOn(new Date());
    var transferNote = "";
    if (state.transferring && state.transferTo && state.transferDate) {
      var todayYmd = ymdStr(new Date());
      transferNote = state.transferDate > todayYmd
        ? "Transferring to " + state.transferTo + " on " + niceDate(state.transferDate)
        : "Transferred from " + state.homeBranch + " on " + niceDate(state.transferDate);
    }
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
        '<div class="meta">' + esc(headBranch) + (state.role ? ' · ' + esc(state.role) : '') +
          (state.effRole === "SM" && state.role === "AM" ? ' (SM trial)' : '') +
          (state.isManager ? ' · Manager' : '') + '</div>' +
          (transferNote ? '<div class="meta" style="font-size:11px;opacity:.8">🔄 ' + esc(transferNote) + '</div>' : '') +
          (state.typedStore && state.typedStore !== headBranch
            ? '<div class="meta" style="font-size:11px;opacity:.8">You entered ' + esc(state.typedStore) + ' — showing your full schedule</div>'
            : '') + '</div>',
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

    // Month (cycle) view with prev/next. The effective branch can change mid-cycle
    // (a transfer), so preload every branch the cycle touches, then resolve per day.
    var ym = state.monthYm;
    var days2 = periodDays(ym);
    var effBranches = {};
    days2.forEach(function (x) { effBranches[effectiveBranchOn(x.date)] = 1; });
    for (var eb in effBranches) { if (Object.prototype.hasOwnProperty.call(effBranches, eb)) { await loadCycle(ym, eb); await ensureAwayMap(ym, eb); } }
    var rows = days2.map(function (x) {
      var st = { published: false };
      if (matMlOn(x.date)) { st = { published: true, info: ML_INFO }; }
      else {
        var eff = effectiveBranchOn(x.date);
        var grid = state.cache[eff + "|" + ym], row = rowFor(grid);
        if (row) st = { published: true, info: cellStatus(row, x.date, eff) };
        else { var loan = loanForDate(x.date); if (loan && loan.toBranch && loan.toBranch !== eff) st = { published: true, info: loanInfo(loan) }; }
      }
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
