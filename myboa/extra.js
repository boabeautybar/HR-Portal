/* ============================================================
   My BOA — Offer an extra day (staff & managers, own phone).
   They enter their employee code + branch; we read the PUBLISHED
   schedule and let them offer ONLY a day they're scheduled OFF
   (working days aren't "extra"). The regional manager reviews
   and approves in the HR portal's "Extra-Day Requests" tab; only
   then does it flip to an extra day on the schedule / kiosk.
   Insert-only via submit_extra_day_request RPC.
   ============================================================ */
(function () {
  var cfg = window.BOA_SUPABASE_CONFIG || {};
  var root = document.getElementById("root");
  if (!cfg.url || !cfg.anonKey || !window.supabase) {
    root.innerHTML = '<p class="sub" style="color:#b91c1c">Sorry — the form could not load. Please tell HR.</p>';
    return;
  }
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });

  var STORES = [
    "Sea Point", "Bree", "Kloof", "Claremont", "Rondebosch", "Durbanville",
    "Table Bay", "Somerset West", "Riverlands", "Kuils River", "Westlake",
    "Green Point", "Plumstead", "Sandown", "Cape Gate", "Winelands", "Betty",
    "Fourways", "Eastgate", "Mall of the South", "Mushroom Farm", "Verdi", "Ballito"
  ];
  var WORK_CODES = { W: 1, WE: 1, WL: 1, WM: 1, WB: 1, E: 1 };
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var state = { busy: false, name: "", store: "", ec: "", isManager: false, offDays: [] };

  // ── Cycle helpers (mirror the schedule viewer / portal 25th→24th logic) ──
  function pad(n) { return String(n).padStart(2, "0"); }
  function currentSchedYm() {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
    if (d.getDate() > 24) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + "-" + pad(m);
  }
  function shiftYm(ym, delta) {
    var p = ym.split("-"), y = +p[0], m = +p[1] + delta;
    while (m > 12) { m -= 12; y += 1; } while (m < 1) { m += 12; y -= 1; }
    return y + "-" + pad(m);
  }
  function periodDays(ym) {
    var p = ym.split("-"), y = +p[0], m = +p[1];
    var prevM = m === 1 ? 12 : m - 1, prevY = m === 1 ? y - 1 : y;
    var lastPrev = new Date(prevY, prevM, 0).getDate();
    var out = [];
    for (var d = 25; d <= lastPrev; d++) out.push(new Date(prevY, prevM - 1, d));
    for (var d2 = 1; d2 <= 24; d2++) out.push(new Date(y, m - 1, d2));
    return out;
  }
  function ymdStr(dt) { return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate()); }

  function fetchGrid(store, isManager, ymEnd) {
    var key = (isManager ? "boa_mgrsched_" : "boa_sched_") + store + "_" + (isManager ? shiftYm(ymEnd, -1) : ymEnd);
    return sb.from("app_state").select("value").eq("key", key).maybeSingle().then(function (res) {
      return (res && res.data && res.data.value && res.data.value.grid) || null;
    });
  }
  function findEcKey(grid, ec) {
    if (!grid) return null;
    var up = ec.toUpperCase().trim();
    for (var k in grid) { if (String(k).toUpperCase().trim() === up) return k; }
    return null;
  }
  function getCell(row, dt) {
    if (!row) return undefined;
    var byNum = row[dt.getDate()];
    if (byNum != null) return byNum;
    return row[ymdStr(dt)];
  }
  // A day is an eligible OFF day to offer (not working, not on leave).
  function cellOff(code, isManager) {
    var c = (code == null ? "" : String(code)).toUpperCase();
    if (c === "L" || c === "ML") return false;                 // on leave → not available
    if (c === "O" || c === "R") return true;                   // off / requested off
    var working = c === "E" || WORK_CODES[c] || (c === "" && !isManager);
    return (!working && c !== "X" && c !== "P");                // any other non-work, non-pre-start = off
  }

  // ── Step 1: identify ──────────────────────────────────────────
  function renderIdentify(msg) {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("myboa_sched_v1") || "{}"); } catch (_e) {}
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<h1>Offer an extra day</h1>',
      '<p class="sub">Put yourself forward to work on one of your OFF days. Your regional manager reviews and approves it.</p>',
      '<div class="note">You can only offer a day you\'re scheduled <b>off</b> — a normal working day isn\'t extra. Extra days only count once your <b>regional manager approves</b> them.</div>',
      msg ? '<p class="err" style="text-align:center">' + esc(msg) + '</p>' : '',
      '<div class="card">',
        '<label class="field"><span>Full name</span>',
          '<input type="text" id="name" placeholder="First and last name" /></label>',
        '<label class="field"><span>Employee code</span>',
          '<input type="text" id="ec" autocapitalize="characters" autocomplete="off" placeholder="e.g. B379" value="' + esc(saved.ec || "") + '" /></label>',
        '<label class="field"><span>Branch</span>',
          '<select id="store"><option value="">— choose —</option>',
            STORES.map(function (s) { return '<option' + (saved.store === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join(""),
          '</select></label>',
        '<button type="button" id="find" class="submit">Find my off days</button>',
        '<p class="err" id="err"></p>',
      '</div>',
      '<p class="foot">My BOA · reviewed by your regional manager</p>'
    ].join("");
    document.getElementById("find").onclick = findOffDays;
  }

  function findOffDays() {
    if (state.busy) return;
    var name = (val("name") || "").trim();
    var ec = (val("ec") || "").trim();
    var store = val("store");
    setErr("");
    if (!name) { setErr("Please enter your full name."); focus("name"); return; }
    if (!ec) { setErr("Please enter your employee code."); focus("ec"); return; }
    if (!store) { setErr("Please choose your branch."); return; }

    setBusy(true, "find", "Looking up…");
    var ymEnd = currentSchedYm();
    var cycles = [ymEnd, shiftYm(ymEnd, 1)];
    var found = { isManager: false, ecKey: null };

    // Find the person (tech then manager) in this or next cycle.
    (function chain(i) {
      if (i >= cycles.length) return Promise.resolve();
      return fetchGrid(store, false, cycles[i]).then(function (techGrid) {
        var tk = findEcKey(techGrid, ec);
        if (tk) { found = { isManager: false, ecKey: tk }; return; }
        return fetchGrid(store, true, cycles[i]).then(function (mgrGrid) {
          var mk = findEcKey(mgrGrid, ec);
          if (mk) { found = { isManager: true, ecKey: mk }; return; }
          return chain(i + 1);
        });
      });
    })(0).then(function () {
      if (!found.ecKey) {
        setBusy(false, "find", "Find my off days");
        setErr("We couldn't find a published schedule for " + ec + " at " + store + ". Check your code and branch — your manager may not have published it yet.");
        return;
      }
      state.name = name; state.store = store; state.ec = found.ecKey; state.isManager = found.isManager;
      try { localStorage.setItem("myboa_sched_v1", JSON.stringify({ store: store, ec: found.ecKey })); } catch (_e) {}
      // Collect OFF days that are today or later, from the CURRENT pay cycle only
      // (25th → 24th). Next cycle isn't offered — extra days are for this cycle.
      var today = new Date(); today.setHours(0, 0, 0, 0);
      return fetchGrid(store, found.isManager, ymEnd).then(function (grid) {
        var offs = [];
        if (grid) {
          var row = grid[found.ecKey];
          periodDays(ymEnd).forEach(function (dt) {
            if (dt < today) return;
            if (cellOff(getCell(row, dt), found.isManager)) offs.push(dt);
          });
        }
        offs.sort(function (a, b) { return a - b; });
        state.offDays = offs;
        setBusy(false, "find", "Find my off days");
        if (!offs.length) { renderIdentify("You have no remaining off days in this pay cycle, so there's no extra day to offer."); return; }
        renderPick();
      });
    }).catch(function () {
      setBusy(false, "find", "Find my off days");
      setErr("Sorry — could not load your schedule. Check your signal and try again.");
    });
  }

  // ── Step 2: pick an off day + submit ──────────────────────────
  function renderPick() {
    var opts = state.offDays.map(function (dt) {
      return '<option value="' + ymdStr(dt) + '">' + DOW[dt.getDay()] + " " + dt.getDate() + " " + MON[dt.getMonth()] + '</option>';
    }).join("");
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<h1>Offer an extra day</h1>',
      '<p class="sub">' + esc(state.name) + ' · ' + esc(state.store) + ' · ' + esc(state.ec) + '</p>',
      '<div class="note">Pick one of <b>your off days</b> below to offer. It only counts once your <b>regional manager approves</b> it.</div>',
      '<div class="card">',
        '<label class="field"><span>Off day you\'re offering to work</span>',
          '<select id="day">' + opts + '</select></label>',
        '<label class="field"><span>Purpose</span>',
          '<select id="purpose">',
            '<option value="extra">Extra availability — I\'d like to work an extra day</option>',
            '<option value="catch_up">Catch-up — to make up a day I missed</option>',
          '</select></label>',
        '<label class="field"><span>Note <em style="font-weight:400;color:#a07487">(optional)</em></span>',
          '<textarea id="note" placeholder="Anything your manager should know — e.g. available from 10am."></textarea></label>',
        '<div class="note">Please note: once approved, an extra day is a <b>committed shift</b>. If you don\'t show up for an approved extra day, it will be recorded as a <b>no-show</b>.</div>',
        '<button type="button" id="submit" class="submit">Send to regional manager</button>',
        '<p class="err" id="err"></p>',
        '<p style="text-align:center;margin:10px 0 0"><a href="#" id="reset" style="color:#9d6a82;font-size:13px;font-weight:600">‹ Use a different code</a></p>',
      '</div>',
      '<p class="foot">My BOA · reviewed by your regional manager</p>'
    ].join("");
    document.getElementById("submit").onclick = submit;
    document.getElementById("reset").onclick = function (e) { e.preventDefault(); renderIdentify(); };
  }

  function submit() {
    if (state.busy) return;
    var day = val("day");
    setErr("");
    if (!day) { setErr("Please pick the off day you're offering."); return; }
    if (!window.confirm("Once approved, this is a committed shift. If you don't show up for an approved extra day, it will be recorded as a no-show.\n\nSend this offer to your regional manager?")) return;
    var payload = {
      p_store: state.store,
      p_ec: state.ec || null,
      p_name: state.name,
      p_purpose: val("purpose") || "extra",
      p_work_date: day,
      p_note: (val("note") || "").trim() || null
    };
    setBusy(true, "submit", "Sending…");
    sb.rpc("submit_extra_day_request", payload).then(function (res) {
      setBusy(false, "submit", "Send to regional manager");
      if (res.error) { setErr("Sorry — could not send. Please try again. (" + (res.error.message || "error") + ")"); return; }
      done(res.data);
    }).catch(function () {
      setBusy(false, "submit", "Send to regional manager");
      setErr("Sorry — could not send. Check your signal and try again.");
    });
  }

  function done(ref) {
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<div class="done">',
        '<div class="tick">✅</div>',
        '<h2>Sent to your regional manager</h2>',
        (ref ? '<div class="ref">' + esc(ref) + '</div>' : ''),
        '<p>Your offer to work an extra day has been received. It only counts once your regional manager approves it — they\'ll be in touch.</p>',
        '<p style="margin-top:18px"><a href="index.html" style="color:#BE185D;font-weight:700">Back to My BOA</a></p>',
      '</div>',
      '<p class="foot">My BOA</p>'
    ].join("");
  }

  function val(id) { var e = document.getElementById(id); return e ? e.value : ""; }
  function focus(id) { var e = document.getElementById(id); if (e) e.focus(); }
  function setErr(m) { var e = document.getElementById("err"); if (e) e.textContent = m || ""; }
  function setBusy(b, btnId, label) { state.busy = b; var btn = document.getElementById(btnId); if (btn) { btn.disabled = b; btn.textContent = label; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  sb.from("app_state").select("value").eq("key", "boa_custom_salons").maybeSingle()
    .then(function (res) {
      var v = res && res.data && res.data.value;
      if (Array.isArray(v)) { v.forEach(function (s) { var nm = s && (s.name || s.branch); if (nm && STORES.indexOf(nm) === -1) STORES.push(nm); }); STORES.sort(); }
    }).catch(function () {}).then(function () { renderIdentify(); });
})();
