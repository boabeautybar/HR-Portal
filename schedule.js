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
    ec: "", store: "", name: "", role: "", isManager: false,
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

  // Interpret a cell code into a display status.
  function codeInfo(code, role, branch, dow) {
    var c = (code == null ? "" : String(code)).toUpperCase();
    if (c === "O") return { kind: "off", label: "Off", sub: "" };
    if (c === "R") return { kind: "off", label: "Off", sub: "Requested day off" };
    if (c === "L") return { kind: "leave", label: "On leave", sub: "" };
    if (c === "ML") return { kind: "leave", label: "Maternity leave", sub: "" };
    if (c === "X" || c === "P") return { kind: "work", label: "Pre-start", sub: "" };
    // Everything else (blank, W, WE, WL, WM, WB, E) is a working day.
    var times = shiftTimes(role, c || "W", branch, dow);
    var variant = c === "WE" ? "Early" : c === "WL" ? "Late" : c === "WM" ? "Mid" : c === "E" ? "Extra cover" : "";
    return { kind: "work", label: "Work", sub: times + (variant ? " · " + variant : "") };
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
    return { published: true, info: codeInfo(getCell(row, dt), state.role, state.store, dt.getDay()) };
  }

  // ── Screens ──────────────────────────────────────────────────
  function renderForm(msg) {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (_e) {}
    root.innerHTML = [
      '<a class="back" href="myboa.html">‹ My BOA</a>',
      '<div class="brand"><img src="BOA.png" alt="BOA" /></div>',
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
      state.cache = {};
      state.monthYm = found.ym || ymEnd;
      state.view = "soon";

      // Best-effort: get a friendly name + role (for shift times). Never fatal.
      try {
        var res = await sb.from("staff").select("name,first_name,role,role_type").ilike("employee_code", found.ecKey).limit(1);
        var row = res && res.data && res.data[0];
        if (row) {
          state.name = row.first_name || (row.name || "").split(" ")[0] || "";
          state.role = row.role || "";
          if (row.role_type === "manager") state.isManager = true;
        }
      } catch (_e) {}

      try { localStorage.setItem(LS_KEY, JSON.stringify({ store: store, ec: found.ecKey })); } catch (_e) {}

      var today = new Date(), tom = new Date(); tom.setDate(tom.getDate() + 1);
      await Promise.all([loadCycle(ymForDate(today)), loadCycle(ymForDate(tom)), loadCycle(state.monthYm)]);
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
    var body;
    if (!st.published) {
      body = '<div class="st st-none">Not published yet</div>';
    } else {
      var i = st.info;
      body = '<div class="st st-' + i.kind + '">' + esc(i.label) + (i.sub ? '<span class="st-sub">' + esc(i.sub) + '</span>' : '') + '</div>';
    }
    return '<div class="dayrow' + (dt.toDateString() === new Date().toDateString() ? ' is-today' : '') + (big ? ' big' : '') + '">' +
      '<div class="dleft"><div class="dname">' + esc(head) + '</div><div class="ddate">' + esc(date) + '</div></div>' + body + '</div>';
  }

  async function renderDash() {
    root.innerHTML = [
      '<a class="back" href="myboa.html">‹ My BOA</a>',
      '<div class="dashhead">',
        '<div><div class="hi">Hi ' + esc(state.name || "there") + ' 👋</div>',
        '<div class="meta">' + esc(state.store) + (state.role ? ' · ' + esc(state.role) : '') + (state.isManager ? ' · Manager' : '') + '</div></div>',
        '<button type="button" id="chg" class="chg">Change</button>',
      '</div>',
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
      if (row) st = { published: true, info: codeInfo(getCell(row, x.date), state.role, state.store, x.dow) };
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
