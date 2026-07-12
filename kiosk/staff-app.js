/* ============================================================
   BOA Check-in App — Staff Dashboard
   Two tiles: Check In/Out  and  Cash Up
   ============================================================ */
(function () {
  var root = null;
  var cfg  = window.APP_CONFIG || {};
  if (cfg._picker) return;     // branch picker showing — skip bootstrapping

  // Configurable hooks used by the render functions below. Defaults match
  // staff-mode behaviour. Manager-mode reuses these flows by calling
  // window.BOA_FLOWS.configure(...) before invoking a render function.
  var _mainElId   = "staff-main";          // element render functions write into
  var _backHandler = function () { renderLanding(); }; // what "← Back" does

  document.addEventListener("app:authed", function (e) {
    if (e.detail.role !== "staff") return;
    boot();
  });

  function getGreeting() {
    var h = new Date().getHours();
    if (h >= 5  && h < 12) return "Good morning";
    if (h >= 12 && h < 17) return "Good afternoon";
    if (h >= 17 && h < 21) return "Good evening";
    return "Good night";
  }

  // Shift codes that mean a tech is rostered to work that day. Mirrors the HR
  // portal's "working" set (W, WE, WL, WB, WM, E) so the check-in shows every
  // working tech regardless of shift — not just W / WL / E (which used to drop
  // WE "work early" techs from the roster).
  function isWorkingShift(code) {
    return code === "W" || code === "WE" || code === "WL" || code === "WB" || code === "WM" || code === "E";
  }

  function boot() {
    root = document.getElementById("app-root");
    if (!root) return;
    // Head Office is a restricted STAFF kiosk: branch ONCE here into its own
    // landing/menu/clock-in path rather than threading a flag through every
    // salon render function. Salon kiosks (no cfg.headOffice) are untouched.
    if (cfg.headOffice) { bootHeadOffice(); return; }
    var nextMonth = window.APP_DATA ? window.APP_DATA.nextMonthLabel().split(" ")[0] : "Off";
    root.innerHTML =
      '<header class="app-header gp-header">' +
        '<div class="gp-header-inner">' +
        '<div class="gp-left">' +
          '<div class="boa-logo"><img class="boa-logo-img" src="boa-logo.png" alt="BOA Beauty Bar"></div>' +
          '<div class="gp-greeting">' +
            '<div class="gp-greeting-line">' + esc(getGreeting()) + ' · ' + esc(cfg.branchDisplayName || cfg.branchName || "BOA Check-in") + '</div>' +
            '<div class="gp-sublabel" id="gp-sublabel">HOME</div>' +
          '</div>' +
        '</div>' +
        '<div class="gp-actions">' +
          '<button class="gp-btn"  data-action="home"     type="button"><span>🏠</span> Home</button>' +
          '<button class="gp-btn"  data-action="news"     type="button"><span>📰</span> News<span class="gp-badge" id="gp-news-count" style="display:none">0</span></button>' +
          '<button class="gp-btn"  data-action="schedule" type="button"><span>📅</span> Schedule</button>' +
          '<button class="gp-btn"  data-action="offreq"   type="button" id="gp-btn-off"><span>📝</span> ' + esc(nextMonth) + ' Off</button>' +
          '<button class="gp-btn gp-logout" data-action="logout" type="button">LOG OUT</button>' +
        '</div>' +
        '<div class="gp-header-right">' +
          '<button class="gp-home-quick" id="gp-home-quick" type="button" aria-label="Home" title="Home">🏠</button>' +
          '<button class="gp-menu-toggle" id="gp-menu-toggle" type="button" aria-label="Menu">☰</button>' +
        '</div>' +
        '</div>' +
      '</header>' +
      '<main id="staff-main"></main>';

    var gpActions = document.querySelector(".gp-actions");
    function closeMenu() { if (gpActions) gpActions.classList.remove("open"); }
    var gpHome = document.getElementById("gp-home-quick");
    if (gpHome) gpHome.addEventListener("click", function () { closeMenu(); renderLanding(); });
    var gpToggle = document.getElementById("gp-menu-toggle");
    if (gpToggle) gpToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      if (gpActions) gpActions.classList.toggle("open");
    });
    document.addEventListener("click", function (e) {
      if (!gpActions || !gpActions.classList.contains("open")) return;
      if (gpActions.contains(e.target) || (gpToggle && gpToggle.contains(e.target))) return;
      closeMenu();
    });

    gpActions.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]"); if (!btn) return;
      var a = btn.dataset.action;
      closeMenu();
      if (a === "logout")   window.APP_LOGOUT();
      if (a === "home")     renderLanding();
      if (a === "news")     renderNews();
      if (a === "schedule") renderSchedule();
      if (a === "offreq")   renderOffRequests();
    });

    refreshNewsBadge();
    setInterval(refreshNewsBadge, 60 * 1000);
    // Re-check the submit-your-check-in nag each minute so it appears the
    // moment the clock passes 10:30 and clears as soon as the day is signed off.
    setInterval(refreshCheckinNag, 60 * 1000);
    setInterval(function () { if (document.getElementById("eval-due-slot")) refreshEvalNag(); }, 60 * 1000);

    renderLanding();
  }

  /* ============================================================
     Head Office kiosk (cfg.headOffice)
     A single-PIN staff kiosk with a restricted surface:
       Menu:  Home · Schedule · Today · Staff · Log out
       Tiles: Clock In (selfie mandatory) · Request Off
     Clock-in mirrors the manager photo flow (clockins row +
     boa_mgrclockin_meta_<id> sidecar) and marks the person
     present on the branch attendance grid (boa_att_Head Office_*).
     NOTE: the portal Attendance + "Head office check ins" surfaces
     that read these writes land in Phase 5 — until they ship, the
     rows/selfies are recorded but not yet visible in the portal, and
     the schedule grid the roster reads must be published from the HR
     portal (there is no HO scheduling UI yet either).
     ============================================================ */
  function bootHeadOffice() {
    // Reused flows (Request Off, Schedule) call _backHandler on "← Back" — point
    // it at the HO landing so Back never drops into the salon dashboard.
    _backHandler = function () { renderHoLanding(); };
    root.innerHTML =
      '<header class="app-header gp-header">' +
        '<div class="gp-header-inner">' +
        '<div class="gp-left">' +
          '<div class="boa-logo"><img class="boa-logo-img" src="boa-logo.png" alt="BOA Beauty Bar"></div>' +
          '<div class="gp-greeting">' +
            '<div class="gp-greeting-line">' + esc(getGreeting()) + ' · ' + esc(cfg.branchDisplayName || cfg.branchName || "Head Office") + '</div>' +
            '<div class="gp-sublabel" id="gp-sublabel">HOME</div>' +
          '</div>' +
        '</div>' +
        '<div class="gp-actions">' +
          '<button class="gp-btn" data-action="home"     type="button"><span>🏠</span> Home</button>' +
          '<button class="gp-btn" data-action="schedule" type="button"><span>📅</span> Schedule</button>' +
          '<button class="gp-btn" data-action="today"    type="button"><span>🕐</span> Today</button>' +
          '<button class="gp-btn" data-action="staff"    type="button"><span>👥</span> Staff</button>' +
          '<button class="gp-btn gp-logout" data-action="logout" type="button">LOG OUT</button>' +
        '</div>' +
        '<div class="gp-header-right">' +
          '<button class="gp-home-quick" id="gp-home-quick" type="button" aria-label="Home" title="Home">🏠</button>' +
          '<button class="gp-menu-toggle" id="gp-menu-toggle" type="button" aria-label="Menu">☰</button>' +
        '</div>' +
        '</div>' +
      '</header>' +
      '<main id="staff-main"></main>';

    var gpActions = document.querySelector(".gp-actions");
    function closeMenu() { if (gpActions) gpActions.classList.remove("open"); }
    var gpHome = document.getElementById("gp-home-quick");
    if (gpHome) gpHome.addEventListener("click", function () { closeMenu(); renderHoLanding(); });
    var gpToggle = document.getElementById("gp-menu-toggle");
    if (gpToggle) gpToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      if (gpActions) gpActions.classList.toggle("open");
    });
    document.addEventListener("click", function (e) {
      if (!gpActions || !gpActions.classList.contains("open")) return;
      if (gpActions.contains(e.target) || (gpToggle && gpToggle.contains(e.target))) return;
      closeMenu();
    });
    gpActions.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]"); if (!btn) return;
      var a = btn.dataset.action;
      closeMenu();
      if (a === "logout")   window.APP_LOGOUT();
      if (a === "home")     renderHoLanding();
      if (a === "schedule") renderSchedule();
      if (a === "today")    renderHoClockin();
      if (a === "staff")    renderHoStaffList();
    });

    renderHoLanding();
  }

  function renderHoLanding() {
    setSublabel("HOME");
    setMain(
      '<div class="hero hero-big">' +
        '<div class="hero-brand">' + esc(cfg.branchDisplayName || cfg.branchName || "Head Office") + '</div>' +
        '<div class="hero-title">What would you like to do?</div>' +
      '</div>' +
      '<div id="sick-today-slot"></div>' +
      '<div class="tile-grid tile-grid-4">' +
        '<button class="tile tile-big" id="tile-ho-checkin" type="button">' +
          '<div class="tile-icon">🕐</div>' +
          '<div class="tile-label">Clock In</div>' +
          '<div class="tile-hint">SELFIE REQUIRED</div>' +
        '</button>' +
        '<button class="tile tile-big" id="tile-ho-offreq" type="button">' +
          '<div class="tile-icon">📝</div>' +
          '<div class="tile-label">Request Off</div>' +
          '<div class="tile-hint">TIME OFF</div>' +
        '</button>' +
      '</div>'
    );
    document.getElementById("tile-ho-checkin").onclick = renderHoClockin;
    document.getElementById("tile-ho-offreq").onclick  = renderOffRequests;
    refreshSickToday();
  }

  // Roster schedule for HO: prefer the PUBLISHED snapshot [0], fall back to the
  // live draft only for a cycle that was never published (mirrors the manager
  // kiosk — commit d9f6db6). Uses tech-style keys (boa_sched(approved)_<br>_<ym>).
  async function _loadHoSchedule(ym) {
    if (window.APP_DATA.getApprovedSchedule) {
      try {
        var ap = await window.APP_DATA.getApprovedSchedule(ym, "tech");
        if (ap && ap.grid && Object.keys(ap.grid).length) return ap;
      } catch (_e) { /* fall through to draft */ }
    }
    try { return await window.APP_DATA.getSchedule(ym, "tech"); }
    catch (_e2) { return { grid: {} }; }
  }

  // Selfie is MANDATORY: resolves to a dataUrl, or null if the person cancels —
  // and null aborts the clock-in (there is no photo-less path to a clockins row).
  function _hoSelfie(name) {
    return window.BOA_CAMERA.capture({
      facingMode: "user",
      title: "Selfie required for " + (name || "you"),
      crop: { mode: "cover", w: 400, h: 500, quality: 0.7 }
    });
  }

  // Latest clock-in state per staff_id from today's rows (newest-first).
  function _hoClockStateById(clockins) {
    var byId = {};
    (clockins || []).forEach(function (r) {
      if (r && r.staff_id && !byId[r.staff_id]) byId[r.staff_id] = r;
    });
    return byId;
  }

  // Today's working HO roster. A person is on the roster if their published-
  // snapshot cell for today is a working code, OR they have an open clock-in
  // today — the latter so a mid-cycle re-publish that flips someone's cell to
  // off can't strand them clocked-in with no way to clock out. Leave, maternity
  // and off-boarding are honoured via categorizeStaff (its `active` bucket
  // already excludes people away today), so an HO employee on approved leave
  // whose stale grid cell still reads "work" never shows as "Not clocked in".
  async function _hoTodayRoster() {
    var now = new Date();
    var ym = window.APP_DATA.ymForDate(now);
    var dayKey = String(now.getDate());
    var loaded = await Promise.all([
      window.APP_DATA.categorizeStaff(now),
      _loadHoSchedule(ym),
      window.APP_DATA.listTodayClockins()
    ]);
    var staff     = (loaded[0] && loaded[0].active) || [];
    var grid      = (loaded[1] && loaded[1].grid) || {};
    var clockins  = loaded[2] || [];
    var stateById = _hoClockStateById(clockins);
    var working = staff.filter(function (s) {
      var cell = grid[s.employee_code] && grid[s.employee_code][dayKey];
      var openClockIn = stateById[s.id] && stateById[s.id].type === "in";
      return isWorkingShift(cell) || openClockIn;
    }).sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    return {
      roster: working,
      stateById: stateById,
      ym: ym,
      dayKey: dayKey,
      scheduleLoaded: Object.keys(grid).length > 0
    };
  }

  function _fmtClockTime(iso) {
    try { return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); }
    catch (_e) { return ""; }
  }

  async function renderHoClockin() {
    setSublabel("Clock-in");
    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>🕐 Head Office Clock-in</h2>' +
          '<div style="display:flex;gap:8px">' +
            '<button class="link-btn" id="ho-clock-refresh">Refresh</button>' +
            '<button class="link-btn link-btn-dark" id="ho-clock-back">← Back</button>' +
          '</div>' +
        '</div>' +
        '<div class="dly-sub">Tap your name, then take a quick selfie to confirm you\'re here. ' +
          'A selfie is required — one clock-in per person per day.</div>' +
        '<div id="ho-clock-list">Loading roster…</div>' +
      '</div>'
    );
    document.getElementById("ho-clock-back").onclick    = function () { renderHoLanding(); };
    document.getElementById("ho-clock-refresh").onclick = renderHoClockin;
    if (!window.APP_DATA || !window.APP_DATA.isConfigured()) {
      document.getElementById("ho-clock-list").innerHTML = configMissingHtml();
      return;
    }
    await _paintHoClockList(true, "ho-clock-list");
  }

  // Renders the clock-in roster into the container named by listId. When
  // interactive, each row gets a Clock In / Clock Out button; on the read-only
  // Staff view it's a badge only. The caller names its own container (and we bail
  // if it's gone) so an in-flight repaint can never land in a different view —
  // otherwise a clock write finishing after the user navigated to the read-only
  // Staff view would inject live Clock In/Out buttons into it.
  async function _paintHoClockList(interactive, listId) {
    var listEl = document.getElementById(listId);
    if (!listEl) return;
    var data;
    try { data = await _hoTodayRoster(); }
    catch (e) { listEl.innerHTML = '<div class="warn">Could not load the roster: ' + esc((e && e.message) || String(e)) + '</div>'; return; }
    var roster = data.roster, stateById = data.stateById;
    if (roster.length === 0) {
      listEl.innerHTML = data.scheduleLoaded
        ? '<div class="dly-empty" style="padding:24px;text-align:center;color:var(--gray-500)">No one is scheduled to work at Head Office today.</div>'
        : '<div class="dly-empty" style="padding:24px;text-align:center;color:var(--gray-500)">No schedule has been published for Head Office yet.<br>Publish the Head Office schedule from the HR portal to populate this roster.</div>';
      return;
    }
    var rowsHtml = roster.map(function (s) {
      var st = stateById[s.id];
      var badge, action = "";
      if (!st) {
        badge = '<span class="dly-status-badge" style="background:#fef2f2;color:#b91c1c">Not clocked in</span>';
        if (interactive) action = '<button class="dly-act" data-ho-clock="in" data-id="' + esc(s.id) + '" data-ec="' + esc(s.employee_code || "") + '" data-name="' + esc(s.name || "") + '" type="button">Clock In</button>';
      } else if (st.type === "in") {
        badge = '<span class="dly-status-badge" style="background:#ecfdf5;color:#047857">In · ' + esc(_fmtClockTime(st.ts)) + '</span>';
        if (interactive) action = '<button class="dly-act" data-ho-clock="out" data-id="' + esc(s.id) + '" data-ec="' + esc(s.employee_code || "") + '" data-name="' + esc(s.name || "") + '" type="button">Clock Out</button>';
      } else {
        badge = '<span class="dly-status-badge" style="background:#f3f4f6;color:#374151">Out · ' + esc(_fmtClockTime(st.ts)) + '</span>';
      }
      return '<div class="dly-row" data-ec="' + esc(s.employee_code || "") + '" style="display:flex;align-items:center;gap:12px;padding:12px 8px;border-bottom:1px solid var(--pink-100)">' +
        '<div style="flex:1">' +
          '<div style="font-weight:700;color:var(--pink-800)">' + esc(s.name || s.employee_code || "—") + '</div>' +
          '<div style="font-size:12px;color:var(--gray-500)">' + esc(s.role || "Head Office") + '</div>' +
        '</div>' +
        badge + action +
      '</div>';
    }).join("");
    listEl.innerHTML = rowsHtml;
    if (interactive) {
      listEl.querySelectorAll("button[data-ho-clock]").forEach(function (btn) {
        btn.onclick = function () {
          _doHoClock(
            { id: btn.dataset.id, employee_code: btn.dataset.ec, name: btn.dataset.name },
            btn.dataset.hoClock
          );
        };
      });
    }
  }

  async function _doHoClock(person, type) {
    var dataUrl = await _hoSelfie(person.name);
    if (!dataUrl) return;   // cancelled — no photo, no clock-in
    try {
      await window.APP_DATA.addManagerClockinWithMeta(person.id, type, { photoDataUrl: dataUrl, flags: [] });
    } catch (e) {
      window.alert("Could not record: " + ((e && e.message) || e));
      return;
    }
    // Mark present on the branch attendance grid the portal reads. Only on
    // clock-IN — a clock-out doesn't change the fact that they were here.
    if (type === "in" && person.employee_code) {
      try {
        var now = new Date();
        await window.APP_DATA.setAttendanceStatus(window.APP_DATA.ymForDate(now), String(now.getDate()), person.employee_code, "on");
      } catch (e) { console.warn("HO attendance status write failed (non-fatal):", e); }
    }
    // Repaint the clock-in view only. If the user has since navigated to the
    // read-only Staff view, #ho-clock-list is gone and the paint no-ops — it
    // must never fall through to #ho-staff-list and add live buttons there.
    await _paintHoClockList(true, "ho-clock-list");
  }

  // Read-only "Staff" view: today's HO roster with clock-in status, no buttons.
  async function renderHoStaffList() {
    setSublabel("Staff");
    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>👥 Head Office · Today</h2>' +
          '<button class="link-btn link-btn-dark" id="ho-staff-back">← Back</button>' +
        '</div>' +
        '<div class="dly-sub">Everyone scheduled at Head Office today and whether they\'ve clocked in.</div>' +
        '<div id="ho-staff-list">Loading roster…</div>' +
      '</div>'
    );
    document.getElementById("ho-staff-back").onclick = function () { renderHoLanding(); };
    if (!window.APP_DATA || !window.APP_DATA.isConfigured()) {
      document.getElementById("ho-staff-list").innerHTML = configMissingHtml();
      return;
    }
    await _paintHoClockList(false, "ho-staff-list");
  }

  function setMain(html) {
    var el = document.getElementById(_mainElId);
    if (el) el.innerHTML = html;
  }
  function setSublabel(t) { var e = document.getElementById("gp-sublabel"); if (e) e.textContent = t; }

  async function refreshNewsBadge() {
    if (!window.APP_DATA || !window.APP_DATA.isConfigured()) return;
    var n = (await window.APP_DATA.listNews()).length;
    var b = document.getElementById("gp-news-count");
    if (b) { b.textContent = n; b.style.display = n > 0 ? "" : "none"; }
  }

  function renderLanding() {
    setSublabel("HOME");
    setMain(
      '<div class="hero hero-big">' +
        '<div class="hero-brand">' + esc(cfg.branchDisplayName || cfg.branchName || "BOA Check-in") + '</div>' +
        '<div class="hero-title">What would you like to do?</div>' +
      '</div>' +
      '<div id="eval-due-slot"></div>' +
      '<div id="sick-today-slot"></div>' +
      '<div id="checkin-nag-slot"></div>' +
      '<div id="cashup-nag-slot"></div>' +
      '<div class="tile-grid tile-grid-4">' +
        '<button class="tile tile-big" id="tile-checkin" type="button">' +
          '<div class="tile-icon">✍️</div>' +
          '<div class="tile-label">Daily Check In</div>' +
          '<div class="tile-hint">SIGN IN FOR TODAY</div>' +
        '</button>' +
        '<button class="tile tile-big" id="tile-schedule" type="button">' +
          '<div class="tile-icon">📅</div>' +
          '<div class="tile-label">Schedule</div>' +
          '<div class="tile-hint">VIEW THIS PERIOD</div>' +
        '</button>' +
        '<button class="tile tile-big" id="tile-offreq" type="button">' +
          '<div class="tile-icon">📝</div>' +
          '<div class="tile-label">Request Days</div>' +
          '<div class="tile-hint">TIME OFF</div>' +
        '</button>' +
        '<button class="tile tile-big" id="tile-cashup" type="button">' +
          '<div class="tile-icon">💵</div>' +
          '<div class="tile-label">Cash Up</div>' +
          '<div class="tile-hint">SUBMIT DAILY TOTALS</div>' +
        '</button>' +
      '</div>'
    );
    document.getElementById("tile-checkin").onclick  = renderCheckin;
    document.getElementById("tile-schedule").onclick = renderSchedule;
    document.getElementById("tile-offreq").onclick   = renderOffRequests;
    document.getElementById("tile-cashup").onclick   = function () { renderCashup(); };
    refreshEvalNag();
    refreshCheckinNag();
    refreshCashupNag();
    refreshSickToday();
  }

  // Home-screen URGENT banner (pink neon) for trial-tech evaluations that are
  // due RIGHT NOW — a tech has reached 5 days (Week 1) or 10 days (Final) and
  // the manager still has to complete the evaluation form. Tapping a row jumps
  // straight into the form so it can't be missed.
  async function refreshEvalNag() {
    var el = document.getElementById("eval-due-slot");
    if (!el) return;
    if (!window.APP_DATA || !window.APP_DATA.listTrialCandidates) { el.innerHTML = ""; return; }
    var myBranch = cfg.branchName || "";
    var due = [];
    try {
      var cands = (await window.APP_DATA.listTrialCandidates()) || [];
      cands.forEach(function (c) {
        if (!c || c.branch !== myBranch) return;
        var role = String(c.role || "nt").toLowerCase();
        if (role !== "nt" && role !== "am") return;   // nail techs + AM final reviews
        var which = trialEvalDue(c);
        if (which) due.push({ c: c, which: which });
      });
    } catch (e) { console.warn("eval nag check failed (non-fatal):", e); el.innerHTML = ""; return; }
    if (!due.length) { el.innerHTML = ""; return; }

    var rows = due.map(function (d) {
      var worked = trialWorkedDays(d.c);
      var label = d.which === "mid" ? "Week 1 evaluation" : "Final evaluation";
      return '<div class="eval-neon-row">' +
               '<div style="min-width:0">' +
                 '<div style="font-weight:800;font-size:14px">' + esc(d.c.name || "Trial staff") + '</div>' +
                 '<div style="font-size:11.5px;opacity:0.85">' + esc(label) + ' · ' + worked + '/10 days done</div>' +
               '</div>' +
               '<button class="btn eval-neon-do" data-id="' + esc(d.c._id) + '" data-which="' + d.which + '">📋 Evaluate now →</button>' +
             '</div>';
    }).join("");
    el.innerHTML =
      '<div class="eval-neon" role="alert">' +
        '<div class="eval-neon-head">🔔 EVALUATION DUE — ' + due.length + ' TRIAL ' + (due.length === 1 ? 'MEMBER' : 'MEMBERS') + '</div>' +
        '<div class="eval-neon-sub">A trial team member has done enough days and needs their evaluation completed to move forward. Tap <strong>Evaluate now</strong> — it only takes a few minutes.</div>' +
        '<div style="margin-top:6px">' + rows + '</div>' +
      '</div>';
    Array.prototype.forEach.call(el.querySelectorAll(".eval-neon-do"), function (btn) {
      btn.onclick = async function () {
        var cands = (await window.APP_DATA.listTrialCandidates()) || [];
        var c = cands.find(function (x) { return String(x._id) === String(btn.dataset.id); });
        if (!c) { refreshEvalNag(); return; }
        // Open the form on top of the daily check-in screen so its post-submit
        // refresh has a screen to land on.
        await renderCheckin();
        openTrialEvalModal(c, btn.dataset.which);
      };
    });
  }

  // ---------------- News (read-only viewer) ----------------
  async function renderNews() {
    setSublabel("News");
    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>📰 Daily Updates</h2>' +
          '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
        '</div>' +
        '<div id="news-body">Loading…</div>' +
      '</div>'
    );
    document.getElementById("back-home").onclick = function () { _backHandler(); };
    if (!window.APP_DATA || !window.APP_DATA.isConfigured()) {
      document.getElementById("news-body").innerHTML = configMissingHtml();
      return;
    }
    var posts = await window.APP_DATA.listNews();
    var body = document.getElementById("news-body");
    if (posts.length === 0) {
      body.innerHTML = '<div class="empty">📭 No updates yet. Check back later!</div>';
      return;
    }
    body.innerHTML = '<div class="news-list">' +
      posts.map(function (n) {
        return '<div class="news-item">' +
                 '<div class="news-time">' + esc(formatRelative(n.ts)) + '</div>' +
                 '<div class="news-body">' + esc(n.body || "") + '</div>' +
               '</div>';
      }).join("") + '</div>';
  }

  // ---------------- Off-day Requests ----------------
  async function renderOffRequests() {
    var label = window.APP_DATA ? window.APP_DATA.nextMonthLabel() : "";
    setSublabel("Time-Off Requests");
    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>📝 ' + esc(label) + ' Off Requests</h2>' +
          '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
        '</div>' +
        '<div id="offreq-body">Loading…</div>' +
      '</div>'
    );
    document.getElementById("back-home").onclick = function () { _backHandler(); };
    if (!window.APP_DATA || !window.APP_DATA.isConfigured()) {
      document.getElementById("offreq-body").innerHTML = configMissingHtml();
      return;
    }
    await refreshOffRequests();
  }

  async function refreshOffRequests() {
    var body = document.getElementById("offreq-body");
    if (!body) return;
    var targetYm = window.APP_DATA.nextMonthYm();
    var label    = window.APP_DATA.nextMonthLabel();
    // Cycle-aware roster: who belongs to THIS branch during the TARGET cycle,
    // not who is here today. Today's roster wrongly hid people who ARE on next
    // month's schedule — anyone away on leave right now, and techs whose
    // transfer into this branch lands before/during the cycle. Maternity and
    // whole-cycle leave are still excluded. Managers stay in the picker —
    // addOffRequest routes their entries to boa_mgr_requests_v1 and techs to
    // boa_tech_requests_v1, both of which the HR portal already reads.
    // (Fallback to the old today-roster if a cached data.js predates the API.)
    var staff = window.APP_DATA.listOffRequestStaff
      ? await window.APP_DATA.listOffRequestStaff(targetYm)
      : (await window.APP_DATA.categorizeStaff(new Date(), { activeOnly: true })).active;
    var existing = await window.APP_DATA.listOffRequests(targetYm);

    // Render the cycle, not the calendar month. For "June" (targetYm
    // "2026-06") that's May 25 → June 24. periodDays returns the cycle as
    // a 30-or-31-day array of {day, monthIdx, year} entries.
    var cycleDays = window.APP_DATA.periodDays(targetYm);
    var cycleLabel = window.APP_DATA.periodLabel(targetYm);  // "May 25 — June 24, 2026"
    var firstEntry = cycleDays[0];
    var firstDt    = new Date(firstEntry.year, firstEntry.monthIdx, firstEntry.day);
    var firstIdx   = (firstDt.getDay() + 6) % 7;
    var DOW        = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    var monthAbbr  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    var html =
      '<label class="lbl">Staff member</label>' +
      '<select id="off-staff" class="input">' +
        '<option value="">Choose person…</option>' +
        // Managers first, in BOA pink so they stand out at a glance
        (function () {
          var mgrs  = staff.filter(function (s) { return isManagerStaff(s); });
          var techs = staff.filter(function (s) { return !isManagerStaff(s); });
          var optHtml = "";
          if (mgrs.length > 0) {
            optHtml += '<optgroup label="👑 Managers">' +
              mgrs.map(function (s) {
                return '<option value="' + s.id + '" style="color:#BE185D;font-weight:700;background:#FCE7F3">' +
                  esc(s.name) + (s.employee_code ? " · " + esc(s.employee_code) : "") +
                '</option>';
              }).join("") +
            '</optgroup>';
          }
          if (techs.length > 0) {
            optHtml += '<optgroup label="Nail Techs">' +
              techs.map(function (s) {
                return '<option value="' + s.id + '">' +
                  esc(s.name) + (s.employee_code ? " · " + esc(s.employee_code) : "") +
                '</option>';
              }).join("") +
            '</optgroup>';
          }
          return optHtml;
        })() +
      '</select>' +
      '<label class="lbl">Days off requested · ' + esc(cycleLabel) + '</label>' +
      '<div class="off-day-grid">';
    DOW.forEach(function (d) { html += '<div class="off-dow">' + d + '</div>'; });
    for (var i = 0; i < firstIdx; i++) html += '<button class="off-day off-spacer" type="button" disabled></button>';
    cycleDays.forEach(function (cd, idx) {
      var dt   = new Date(cd.year, cd.monthIdx, cd.day);
      var dow  = dt.getDay();
      var weekend = dow === 0 || dow === 6;
      var ymd  = window.APP_DATA.isoDate(dt);
      // Show the month abbreviation on the very first day of the cycle and
      // on the 1st of any new month inside it, so May 25 / Jun 1 read clearly.
      var lbl  = (idx === 0 || cd.day === 1) ? (cd.day + ' ' + monthAbbr[cd.monthIdx]) : String(cd.day);
      html += '<button class="off-day' + (weekend ? ' off-weekend' : '') +
              '" type="button" data-date="' + ymd + '">' + lbl + '</button>';
    });
    html += '</div>' +
      '<label class="lbl">Notes (optional)</label>' +
      '<textarea id="off-notes" class="input" rows="2" placeholder="Reason or context (e.g. wedding, doctor, family commitment)"></textarea>' +
      '<div class="btn-row"><button class="btn btn-primary" id="off-submit" disabled>Submit Request</button></div>' +
      '<div class="off-existing-head">Off-day requests (' + existing.length + ')</div>' +
      '<div class="off-existing-list">' +
        (existing.length === 0
          ? '<div class="empty">None yet — either nothing has been submitted or marked as Requested in the HR portal schedule.</div>'
          : existing.map(function (r) {
              var fromSchedule = r.source === "schedule";
              var chips = (r.dates && r.dates.length)
                ? r.dates.map(function (iso) { return '<span class="off-chip">' + esc(formatChipDate(iso)) + '</span>'; }).join("")
                : (r.days || []).map(function (d) { return '<span class="off-chip">' + d + '</span>'; }).join("");
              var sourceBadge = fromSchedule
                ? '<span class="pill pill-ok" style="margin-left:8px">From schedule</span>'
                : '<span class="pill pill-warn" style="margin-left:8px">Submitted</span>';
              var actionBtn = fromSchedule
                ? '<span class="off-item-time" style="margin:0;color:var(--gray-500)">Edit in HR portal schedule</span>'
                : '<button class="link-btn link-btn-dark off-del" type="button">Delete</button>';
              return '<div class="off-item" data-id="' + r.id + '" data-source="' + r.source + '">' +
                       '<div class="off-item-head">' +
                         '<span class="off-item-name">' + esc(r.name || "") + sourceBadge + '</span>' +
                         actionBtn +
                       '</div>' +
                       '<div class="off-item-days">' + chips + '</div>' +
                       (r.notes ? '<div class="off-item-notes">' + esc(r.notes) + '</div>' : "") +
                       (fromSchedule ? "" : '<div class="off-item-time">Submitted ' + esc(formatRelative(r.ts)) + '</div>') +
                     '</div>';
            }).join("")
        ) +
      '</div>';
    body.innerHTML = html;

    // Wire day grid — selectedDates holds full YYYY-MM-DD strings so we
    // get the right month (May vs June) for cycle days that span the
    // 25th-of-the-previous-month rollover.
    var selectedDates = new Set();
    Array.prototype.forEach.call(body.querySelectorAll(".off-day:not(.off-spacer)"), function (b) {
      b.addEventListener("click", function () {
        var ymd = b.dataset.date;
        if (selectedDates.has(ymd)) { selectedDates.delete(ymd); b.classList.remove("off-day-on"); }
        else { selectedDates.add(ymd); b.classList.add("off-day-on"); }
        updateState();
      });
    });
    var staffSel  = document.getElementById("off-staff");
    var notesEl   = document.getElementById("off-notes");
    var submitBtn = document.getElementById("off-submit");
    function updateState() { submitBtn.disabled = !staffSel.value || selectedDates.size === 0; }
    staffSel.onchange = updateState;

    submitBtn.onclick = async function () {
      submitBtn.disabled = true;
      var picked = staff.find(function (s) { return s.id === staffSel.value; });
      try {
        await window.APP_DATA.addOffRequest(targetYm, {
          ec:       picked && picked.employee_code,
          name:     picked && picked.name,
          roleType: picked && picked.role_type,    // routes to mgr vs tech key
          dates:    Array.from(selectedDates),
          notes:    notesEl.value
        });
        await refreshOffRequests();
      } catch (e) {
        alert("Could not save: " + (e.message || e));
        submitBtn.disabled = false;
      }
    };

    // Wire delete on existing items
    Array.prototype.forEach.call(body.querySelectorAll(".off-del"), function (b) {
      b.onclick = async function () {
        if (!confirm("Delete this off request?")) return;
        var id = b.closest(".off-item").dataset.id;
        try {
          await window.APP_DATA.deleteOffRequest(targetYm, id);
          await refreshOffRequests();
        } catch (e) { alert("Could not delete: " + (e.message || e)); }
      };
    });
  }

  function formatChipDate(iso) {
    // "2026-06-05" → "5 Jun"
    try {
      var p = iso.split("-");
      var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return parseInt(p[2], 10) + " " + months[parseInt(p[1], 10) - 1];
    } catch (_e) { return iso; }
  }

  function formatRelative(ts) {
    var d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return "Today, " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    var yest = new Date(now); yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) {
      return "Yesterday, " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    var days = Math.floor((now - d) / 86400000);
    if (days < 7) return days + " days ago";
    return d.toLocaleDateString();
  }

  // ---------------- Schedule (read-only view from HR portal) ----------------
  // Top-level entry: show a picker so the manager chooses which roster to
  // look at — managers vs. nail techs. Mixing them on one big table made
  // the kiosk hard to scan, and the two groups follow different shift
  // codes (managers have W only; techs have WE/WL/E too).
  async function renderSchedule() {
    setSublabel("Schedule");
    // Salon kiosks split the schedule by ROLE (managers vs nail techs). Head
    // Office has neither, so it splits by DEPARTMENT instead — back-office
    // people vs the Call Centre & Sales floor — over its single HO grid.
    var pickerBtns = cfg.headOffice
      ? (
          '<button class="sched-picker-btn" data-kind="office" type="button">' +
            '<span class="sched-picker-icon">🏢</span>' +
            '<span class="sched-picker-lbl">Office Staff</span>' +
            '<span class="sched-picker-sub">Admin, Marketing &amp; Operations</span>' +
          '</button>' +
          '<button class="sched-picker-btn" data-kind="ccsales" type="button">' +
            '<span class="sched-picker-icon">📞</span>' +
            '<span class="sched-picker-lbl">Call Centre &amp; Sales</span>' +
            '<span class="sched-picker-sub">Call Centre &amp; Sales agents</span>' +
          '</button>'
        )
      : (
          '<button class="sched-picker-btn" data-kind="mgr" type="button">' +
            '<span class="sched-picker-icon">👔</span>' +
            '<span class="sched-picker-lbl">Manager Schedule</span>' +
            '<span class="sched-picker-sub">SMs, AMs &amp; Senior SMs</span>' +
          '</button>' +
          '<button class="sched-picker-btn" data-kind="tech" type="button">' +
            '<span class="sched-picker-icon">💅</span>' +
            '<span class="sched-picker-lbl">Nail Tech Schedule</span>' +
            '<span class="sched-picker-sub">All nail technicians</span>' +
          '</button>'
        );
    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>📅 Schedule</h2>' +
          '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
        '</div>' +
        '<div class="sched-picker">' + pickerBtns + '</div>' +
      '</div>'
    );
    document.getElementById("back-home").onclick = function () { _backHandler(); };
    Array.prototype.forEach.call(document.querySelectorAll(".sched-picker-btn"), function (btn) {
      btn.onclick = function () { renderScheduleKind(btn.getAttribute("data-kind")); };
    });
  }

  // Render one of the two schedule views (kind: "mgr" | "tech"). Pulled
  // Bump a "YYYY-MM" period key forward by one cycle. BOA cycles run
  // 25th → 24th of the next month, so the period key already represents
  // the END-month — just add 1. (e.g. "2026-05" = 25 Apr → 24 May,
  // "2026-06" = 25 May → 24 Jun.)
  function _nextSchedYm(ym) {
    if (!ym) return ym;
    var p = ym.split("-"); var y = +p[0], m = +p[1];
    m += 1; if (m > 12) { m = 1; y += 1; }
    return y + "-" + String(m).padStart(2, "0");
  }

  // South African public holidays for a year, mirroring the HR portal's
  // saHolidays() (Public Holidays Act 1994, with Sunday→Monday observed
  // rule). Used to exclude holidays when counting a trial's 10 working
  // days so the kiosk matches the portal exactly. Returns { ymd: name }.
  var _saHolCache = {};
  function _easterSunday(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31);
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
  function _saHolidays(year) {
    if (_saHolCache[year]) return _saHolCache[year];
    var out = {};
    var dk = function (y, m, d) { return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0"); };
    var add = function (m, d, name) {
      var dt = new Date(year, m - 1, d);
      out[dk(year, m, d)] = name;
      if (dt.getDay() === 0) {
        var dt2 = new Date(year, m - 1, d + 1);
        out[dk(dt2.getFullYear(), dt2.getMonth() + 1, dt2.getDate())] = name + " (observed)";
      }
    };
    add(1, 1, "New Year's Day");
    add(3, 21, "Human Rights Day");
    var easter = _easterSunday(year);
    var gf = new Date(easter); gf.setDate(easter.getDate() - 2);
    var fd = new Date(easter); fd.setDate(easter.getDate() + 1);
    out[dk(gf.getFullYear(), gf.getMonth() + 1, gf.getDate())] = "Good Friday";
    out[dk(fd.getFullYear(), fd.getMonth() + 1, fd.getDate())] = "Family Day";
    add(4, 27, "Freedom Day");
    add(5, 1, "Workers' Day");
    add(6, 16, "Youth Day");
    add(8, 9, "Women's Day");
    add(9, 24, "Heritage Day");
    add(12, 16, "Day of Reconciliation");
    add(12, 25, "Christmas Day");
    add(12, 26, "Day of Goodwill");
    _saHolCache[year] = out;
    return out;
  }
  // Build the set of trial working-day dates (YYYY-MM-DD) for a trial
  // candidate: 10 days from startDate, Monday–Friday only, skipping
  // weekends and public holidays. Matches the HR portal's trial overlay.
  function _trialDaySet(startDate) {
    var set = {};
    if (!startDate) return set;
    var start = new Date(startDate + "T12:00:00");
    if (isNaN(start)) return set;
    var cur = new Date(start), count = 0;
    for (var guard = 0; guard < 60 && count < 10; guard++) {
      var y = cur.getFullYear(), m = cur.getMonth() + 1, dd = cur.getDate();
      var ymd = y + "-" + String(m).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
      var dow = cur.getDay();
      if (dow !== 0 && dow !== 6 && !_saHolidays(y)[ymd]) { set[ymd] = true; count++; }
      cur.setDate(cur.getDate() + 1);
    }
    return set;
  }

  // ── Nail-tech trial evaluation form ──────────────────────────────────────
  // The BOA Beauty Bar Nail Technician Evaluation Form: 26 criteria across 5
  // sections, each scored 1–5, for a maximum of 130 points. Items flagged
  // `key:true` are the "Key Indicators" on the form. Keep this in lock-step
  // with the identical definition in the HR portal (app.jsx) so a form filled
  // on the kiosk renders the same scores back to HR.
  var TRIAL_EVAL_SECTIONS = [
    { title: "Customer Service & Experience", max: 50, items: [
      { k: "greeting", label: "Client Greeting & Warmth", desc: "Greets clients politely, introduces herself with name, maintains positive energy and friendly presence." },
      { k: "consultation", label: "Consultation Clarity", desc: "Asks questions, confirms service, length, shape, design, price before starting." },
      { k: "comfort", label: "Client Comfort", key: true, desc: "Ensures client is comfortable, checks in during treatment, gentle handling." },
      { k: "quality", label: "Service Quality", key: true, desc: "Nail work is clean, precise, balanced and meets BOA quality standards." },
      { k: "time", label: "Time Management", desc: "Completes work efficiently without rushing or compromising quality." },
      { k: "complaints", label: "Handling Complaints", desc: "Remains calm, solution-focused, involves manager where needed." },
      { k: "presentation", label: "Professional Presentation", desc: "Wears clean uniform, neat grooming, fresh appearance." },
      { k: "aftercare", label: "Aftercare Education", desc: "Explains upkeep, refill cycles, and product recommendations." },
      { k: "retail", label: "Retail & Upgrades", desc: "Suggests appropriate treatments and products confidently." },
      { k: "feedback", label: "Client Feedback", desc: "Encourages positive Fresha reviews and responds well to feedback." }
    ] },
    { title: "Teamwork & Workplace Conduct", max: 25, items: [
      { k: "communication", label: "Communication", key: true, desc: "Speaks respectfully to colleagues and managers." },
      { k: "support", label: "Support & Collaboration", desc: "Helps team during busy times without being asked." },
      { k: "reliability", label: "Reliability", key: true, desc: "Arrives on time, prepared, no lateness or absenteeism." },
      { k: "attitude", label: "Professional Attitude", desc: "Avoids conflict, gossip, negative behavior." },
      { k: "leadership", label: "Respect for Leadership", key: true, desc: "Follows manager instructions without attitude or resistance." }
    ] },
    { title: "Cleanliness & Hygiene Compliance", max: 25, items: [
      { k: "toolsan", label: "Tool Sanitation", desc: "Fully follows BOA autoclave and sanitation procedures." },
      { k: "workstation", label: "Workstation Cleanliness", desc: "Keeps table/pedi station clean before, during and after service." },
      { k: "towel", label: "Towel & Product Use", desc: "Does not waste products; follows towel and cleaning procedures." },
      { k: "hygiene", label: "Personal Hygiene", desc: "Fresh, tidy, and clean presentation at all times." },
      { k: "infection", label: "Infection Control", desc: "Identifies nail infections, follows safe refusal and escalation process." }
    ] },
    { title: "Policy & Operational Compliance", max: 20, items: [
      { k: "timekeeping", label: "Time Keeping", key: true, desc: "Clocks in/out correctly, updates statuses, no misuse." },
      { k: "phone", label: "Phone Rules", desc: "Adheres to cellphone restrictions." },
      { k: "language", label: "Language", desc: "Speaks English and does not speak to colleagues during treatments." },
      { k: "procedure", label: "Procedure Following", desc: "Follows BOA protocols exactly (fixes, complaints, upselling, etc)." }
    ] },
    { title: "Brand Ambassadorship & Professionalism", max: 10, items: [
      { k: "brand", label: "Brand Image", desc: "Acts as the face of BOA in demeanor and attitude." },
      { k: "community", label: "Community Presence", desc: "Promotes BOA positively in local and online spaces." }
    ] }
  ];
  var TRIAL_EVAL_MAX = 130;        // 26 criteria × 5
  var TRIAL_EVAL_PASS = 91;        // 70% of 130
  var TRIAL_EVAL_KEY_MIN = 3;      // every Key Indicator must be ≥ 3/5

  // Assistant-Manager evaluation (BOA Manager Evaluation Form) — kept in
  // lock-step with AM_EVAL_SECTIONS in the HR portal (app.jsx). 27 criteria,
  // 135 points, 9 Key Indicators. Pass = 70% (95/135) AND every Key Indicator
  // ≥ 4. Used for the AM FINAL review the store completes on the kiosk (the
  // Week-1 review is done by the trainers in the HR portal).
  var TRIAL_EVAL_AM_SECTIONS = [
    { title: "Customer Service Excellence", max: 50, items: [
      { k: "greeting_ssco", label: "Client Greeting – SSCO", key: true, desc: "Greets all clients warmly using Stand–Smile–Confirm–Offer." },
      { k: "booking_conf", label: "Booking Confirmation", desc: "Confirms booking and treatment details before the appointment time." },
      { k: "proactive", label: "Proactive Service", desc: "Anticipates client needs and ensures comfort." },
      { k: "recovery", label: "Service Recovery", desc: "Handles complaints effectively, maintains calmness." },
      { k: "presentation", label: "Professional Presentation", key: true, desc: "Displays neat grooming and welcoming demeanor. Wears full BOA uniform." },
      { k: "wait_mgmt", label: "Wait Management", desc: "Informs clients of delays courteously." },
      { k: "product_know", label: "Product Knowledge", desc: "Explains services and retail confidently." },
      { k: "feedback", label: "Feedback Collection", desc: "Encourages positive Google Reviews." },
      { k: "upsell", label: "Upselling & Retail", desc: "Suggests appropriate upgrades and aftercare." },
      { k: "brand_rep", label: "Brand Representation", desc: "Creates a calm, elegant atmosphere in line with BOA." }
    ] },
    { title: "Leadership & Team Management", max: 25, items: [
      { k: "team_comm", label: "Team Communication", desc: "Holds regular briefings and maintains professionalism." },
      { k: "fairness", label: "Fairness & Discipline", desc: "Applies HR policies consistently and fairly." },
      { k: "motivation", label: "Motivation & Recognition", desc: "Supports and recognizes team effort." },
      { k: "scheduling", label: "Scheduling", key: true, desc: "Manages shifts, off-days, and attendance accurately." },
      { k: "conflict", label: "Conflict Resolution", desc: "Resolves disputes respectfully and promptly." }
    ] },
    { title: "Cleanliness & Hygiene Compliance", max: 20, items: [
      { k: "tool_san", label: "Tool Sanitation Checks", desc: "Verifies clean tools and sends photo proof on Basket Check Day before 10 a.m." },
      { k: "salon_appear", label: "Salon Appearance", key: true, desc: "Maintains spotless and inviting salon atmosphere." },
      { k: "product_mgmt", label: "Product Management", desc: "Prevents waste, monitors stock use." },
      { k: "staff_hygiene", label: "Staff Hygiene", desc: "Ensures uniforms and grooming standards are met." }
    ] },
    { title: "Operational & Policy Adherence", max: 25, items: [
      { k: "hr_policy", label: "HR Policy Compliance", key: true, desc: "Enforces attendance, cellphone and language rules." },
      { k: "cash_digital", label: "Cash & Digital Handling", key: true, desc: "Enforces only accepted payment methods." },
      { k: "report_sub", label: "Report Submission", desc: "Submits accurate End-Day-Reports." },
      { k: "fresha_usage", label: "Fresha Usage", key: true, desc: "Uses Fresha accurately and efficiently." },
      { k: "stock_takes", label: "Stock Takes", key: true, desc: "Conducts accurate stock takes and places orders timely." }
    ] },
    { title: "Brand Ambassadorship & Professionalism", max: 15, items: [
      { k: "brand_image", label: "Brand Image", key: true, desc: "Acts as the face of BOA in demeanor and attitude." },
      { k: "community", label: "Community Presence", desc: "Promotes BOA positively in local and online spaces." },
      { k: "ethical", label: "Ethical Leadership", desc: "Displays honesty, fairness, and discretion." }
    ] }
  ];
  var TRIAL_EVAL_AM_MAX = 135, TRIAL_EVAL_AM_PASS = 95, TRIAL_EVAL_AM_KEY_MIN = 4;

  // Resolve the right evaluation form for a candidate role.
  function evalFormForRole(role) {
    return String(role || "nt").toLowerCase() === "am"
      ? { sections: TRIAL_EVAL_AM_SECTIONS, max: TRIAL_EVAL_AM_MAX, pass: TRIAL_EVAL_AM_PASS, keyMin: TRIAL_EVAL_AM_KEY_MIN }
      : { sections: TRIAL_EVAL_SECTIONS, max: TRIAL_EVAL_MAX, pass: TRIAL_EVAL_PASS, keyMin: TRIAL_EVAL_KEY_MIN };
  }

  // Score a set of {criterionKey: 1..5} answers against the role's form. Pass
  // requires BOTH the 70% total AND the minimum on every Key Indicator.
  function scoreTrialEval(scores, role) {
    var form = evalFormForRole(role);
    var total = 0, keyOk = true, answered = 0, count = 0;
    form.sections.forEach(function (sec) {
      sec.items.forEach(function (it) {
        count++;
        var v = Number(scores[it.k]);
        if (isFinite(v) && v >= 1) { total += v; answered++; }
        if (it.key && (!isFinite(v) || v < form.keyMin)) keyOk = false;
      });
    });
    return {
      total: total, max: form.max,
      complete: answered === count,
      keyOk: keyOk,
      pass: total >= form.pass && keyOk
    };
  }

  // Count the trial working days a candidate has actually worked (On Time or
  // Late). This drives when each evaluation falls due (5 → week 1, 10 → final).
  function trialWorkedDays(c) {
    var m = (c && c.checkins && !Array.isArray(c.checkins)) ? c.checkins : {};
    return Object.keys(m).filter(function (d) { return m[d] === "on" || m[d] === "late"; }).length;
  }

  // Which evaluation (if any) is due for a candidate right now:
  //   "mid"   — finished 5 days in week 1, week-1 form not yet submitted
  //   "final" — passed week 1 and finished 10 days, final form not submitted
  //   null    — nothing due
  function trialEvalDue(c) {
    var worked = trialWorkedDays(c);
    var midDone = !!(c.midEval && c.midEval.submittedAt);
    var finalDone = !!(c.finalEval && c.finalEval.submittedAt);
    var isAm = String(c.role || "nt").toLowerCase() === "am";
    // AM Week-1 reviews are completed by the trainers in the HR portal, so the
    // store kiosk only surfaces the AM FINAL review. Nail techs do both here.
    if (!isAm && c.status === "trial_w1" && worked >= 5 && !midDone) return "mid";
    if (c.status === "trial_w2" && worked >= 10 && !finalDone) return "final";
    return null;
  }

  // out of renderSchedule so the picker can call it without re-running
  // the picker UI. Back button returns to the picker.
  // Head Office department buckets for the schedule split: the Call Centre &
  // Sales floor — agents ("CC"), the Call Centre Manager ("MCC"), and any
  // future "SALES" — vs everyone else ("Office Staff": HR, Marketing, Admin,
  // Recruiter, Trainer, Payroll, Hygienist, EPA, and anyone with no department).
  function _hoIsCcSales(s) {
    var r = String((s && s.role) || "").trim().toUpperCase();
    return r === "CC" || r === "MCC" || r === "SALES";
  }
  // True when a branch string is Head Office (tolerant of casing/whitespace),
  // mirroring the portal's isHeadOfficeBranch.
  function _isHoBranch(b) { return String(b == null ? "" : b).trim().toLowerCase() === "head office"; }
  // Case/whitespace-tolerant lookup into a custom-hours map (boa_mgr_times_v1):
  // Coverage may store the EC in a different case than the kiosk staff row
  // carries, and a strict lookup silently drops the override (staff then see
  // the code-default hours, not their real custom hours).
  function _custHoursRow(map, ec) {
    if (!map || ec == null) return null;
    var raw = String(ec);
    if (map[raw]) return map[raw];
    var t = raw.trim();
    if (map[t]) return map[t];
    var u = t.toUpperCase(), keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) { if (String(keys[i]).trim().toUpperCase() === u) return map[keys[i]]; }
    return null;
  }
  // Head Office shift hours — the single source of truth for both the per-cell
  // times (_shiftTimes) and the schedule hours banner (_techHoursBannerHtml).
  // Call Centre & Sales work an early/late split (WE / WL); "Office Staff" work
  // one day shift. Change the hours here and both surfaces follow.
  var HO_HOURS = {
    ccEarly: { start: "07:00", end: "16:00" },  // WE — Call Centre & Sales early
    ccLate:  { start: "09:00", end: "18:30" },  // WL — Call Centre & Sales late
    office:  { start: "08:00", end: "17:00" }   // everyone else
  };
  function _hoCellHours(h) { return h.start + " - " + h.end; }  // per-cell: "07:00 - 16:00"
  function _hoDashHours(h) { return h.start + "–" + h.end; }    // banner:   "07:00–16:00"

  async function renderScheduleKind(kind, ym) {
    // Head Office has no manager/tech split — its two views are DEPARTMENT
    // filters over the one HO grid (office staff vs Call Centre & Sales), so
    // isMgr is always false there and both views read the tech-style grid.
    var isHo   = !!cfg.headOffice;
    var isMgr  = !isHo && kind === "mgr";
    var hoDept = isHo ? (kind === "ccsales" ? "ccsales" : "office") : null;
    var label  = isHo
      ? (hoDept === "ccsales" ? "Call Centre & Sales" : "Office Staff")
      : (isMgr ? "Manager Schedule" : "Nail Tech Schedule");
    var icon   = isHo
      ? (hoDept === "ccsales" ? "📞" : "🏢")
      : (isMgr ? "👔" : "💅");
    setSublabel(label);
    var currentYm = window.APP_DATA ? window.APP_DATA.currentSchedYm() : "";
    var nextYm    = _nextSchedYm(currentYm);
    // Default to the current cycle; callers can pass the next-cycle key
    // to render that one instead. Anything else falls back to current.
    if (!ym || (ym !== currentYm && ym !== nextYm)) ym = currentYm;
    var isNext = ym === nextYm;
    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>' + icon + ' ' + esc(label) + '</h2>' +
          '<button class="link-btn link-btn-dark" id="back-sched-picker">← Schedule menu</button>' +
        '</div>' +
        // Cycle toggle — flip between the current cycle (e.g. 25 Apr →
        // 24 May) and the next cycle (25 May → 24 Jun) without going
        // back to the picker. Lets managers plan ahead from the kiosk.
        '<div class="sched-cycle-toggle" role="tablist">' +
          '<button type="button" role="tab" class="sched-cycle-tab' + (!isNext ? ' sched-cycle-tab-active' : '') + '" data-ym="' + esc(currentYm) + '">' +
            'This cycle' +
            '<span class="sched-cycle-sub">' + esc(window.APP_DATA.periodLabel(currentYm)) + '</span>' +
          '</button>' +
          '<button type="button" role="tab" class="sched-cycle-tab' + (isNext ? ' sched-cycle-tab-active' : '') + '" data-ym="' + esc(nextYm) + '">' +
            'Next cycle' +
            '<span class="sched-cycle-sub">' + esc(window.APP_DATA.periodLabel(nextYm)) + '</span>' +
          '</button>' +
        '</div>' +
        '<div class="sched-period">' + esc(window.APP_DATA.periodLabel(ym)) + ' · View only · live schedule</div>' +
        '<div id="sched-body">Loading schedule…</div>' +
      '</div>'
    );
    document.getElementById("back-sched-picker").onclick = renderSchedule;
    Array.prototype.forEach.call(document.querySelectorAll(".sched-cycle-tab"), function (tab) {
      tab.onclick = function () {
        var nextSel = tab.getAttribute("data-ym");
        if (nextSel === ym) return; // already viewing
        renderScheduleKind(kind, nextSel);
      };
    });

    if (!window.APP_DATA || !window.APP_DATA.isConfigured()) {
      document.getElementById("sched-body").innerHTML = configMissingHtml();
      return;
    }

    var thisBranch = cfg.branchName || "";
    var staff = await window.APP_DATA.listStaff({ activeOnly: false });
    // Merge in techs transferring INTO this branch — their home record still
    // lives at another store, so listStaff (branch-filtered) misses them, but
    // their shifts are stored under this branch's grid. Cells before the
    // transfer_date are blanked below so the row only fills from arrival.
    if (window.APP_DATA.listTransfersInto) {
      var transfersIn = await window.APP_DATA.listTransfersInto(thisBranch);
      (transfersIn || []).forEach(function (t) {
        if (!t || !t.employee_code) return;
        if (staff.some(function (s) { return s.employee_code === t.employee_code; })) return;
        t._transferredIn = true;
        staff.push(t);
      });
    }
    // For HO, `kind` names a department (office/ccsales), not a data source —
    // both read the one HO (tech-style) grid.
    var dataKind = isHo ? "tech" : kind;
    var sched = await window.APP_DATA.getSchedule(ym, dataKind);
    var grid  = (sched && sched.grid) || {};
    // Mirror the HR portal's Manager Coverage resolution exactly, so the kiosk
    // can never disagree with it:
    //   1. canonicalise rows onto each person's CURRENT employee code
    //   2. Leave-Planner overlay (leave wins over the saved grid)
    //   3. live grid cell
    //   4. fall back to the newest APPROVED snapshot when the live cell is empty
    var approvedGrid = {};
    var approvedNames = {};
    var approvedHours = {};   // Phase 1.1: portal-baked hours { ec: { ymd: {t,c} } }
    if ((isMgr || isHo) && window.APP_DATA.getApprovedSchedule) {
      try {
        // HO renders the PUBLISHED truth like managers do — read its tech-style
        // snapshot [0] (same source-of-truth as the HO check-in roster), so the
        // schedule view can't disagree with Today/Staff or show unpublished edits.
        var _ap = await window.APP_DATA.getApprovedSchedule(ym, isMgr ? "mgr" : "tech");
        approvedGrid = (_ap && _ap.grid) || {};
        approvedNames = (_ap && _ap.names) || {};
        approvedHours = (_ap && _ap.hours) || {};
      } catch (_apErr) { /* fallback only — never block the live view */ }
    }
    // Leave-Planner overlay: ec → { ymd: true } for every covered leave day
    // (same construction as the portal's coverage view). Applies to nail techs
    // AND managers — it used to be managers-only, so a nail tech with approved
    // Leave Planner leave never showed as "L" on the kiosk schedule.
    var leaveByEcYmd = {};
    if (window.APP_DATA.listLeaveRecords) {
      try {
        var _lvs = (await window.APP_DATA.listLeaveRecords()) || [];
        _lvs.forEach(function (lv) {
          if (!lv || !lv.ec || !lv.startDate || !lv.endDate) return;
          var lec = String(lv.ec).trim();
          for (var cur = new Date(lv.startDate + "T00:00:00"); cur <= new Date(lv.endDate + "T00:00:00"); cur.setDate(cur.getDate() + 1)) {
            var lymd = cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0") + "-" + String(cur.getDate()).padStart(2, "0");
            (leaveByEcYmd[lec] = leaveByEcYmd[lec] || {})[lymd] = true;
          }
        });
      } catch (_lvErr) { /* overlay only */ }
    }
    // Maternity overlay: ec → mat_start ("" = no date yet). on_mat / dates_tbc
    // people read as Maternity leave (ML) from their start date on — exactly
    // like the HR portal grid and My BOA, which compute this live from the
    // maternity record rather than the saved cell. Without it, anyone flipped
    // to maternity AFTER the roster was published kept showing their stale
    // working shifts here (the grid cell is frozen at generation time).
    var matStartByEc = {};
    if (window.APP_DATA.listMaternity) {
      try {
        var _mats = (await window.APP_DATA.listMaternity()) || [];
        _mats.forEach(function (m) {
          if (!m || !m.employee_code) return;
          if (m.mat_status !== "on_mat" && m.mat_status !== "dates_tbc") return;
          matStartByEc[String(m.employee_code).trim().toUpperCase()] =
            m.mat_start ? String(m.mat_start).replace(/\//g, "-") : "";
        });
      } catch (_matErr) { /* overlay only */ }
    }
    // Legal unpaid leave (Compliance "Unpaid Leave (Legal)") — overlay EL the
    // same way as maternity so someone HR puts on it reads as EL straight away
    // instead of their stale saved shifts. status "on_leave"; start/end may be
    // null (open-ended). Keyed by trimmed/upper employee code.
    var legalRangeByEc = {};
    if (window.APP_DATA.listUnpaidLegal) {
      try {
        var _legal = (await window.APP_DATA.listUnpaidLegal()) || [];
        _legal.forEach(function (r) {
          if (!r || r.status !== "on_leave" || !r.ec) return;
          legalRangeByEc[String(r.ec).trim().toUpperCase()] = { start: r.startDate || null, end: r.endDate || null };
        });
      } catch (_legalErr) { /* overlay only */ }
    }
    // Canonicalise grid rows onto each person's CURRENT employee code — an
    // employee-code change (or a "B872 " vs "B872" variant) leaves a
    // duplicate/legacy row in the saved grid; without this the kiosk reads the
    // stale row while the portal (which canonicalises) reads the right one.
    // Current code wins for overlapping days; a legacy row only fills gaps.
    // Code maps are built from ALL staff (not role-filtered) so a role
    // mis-classification can't break the mapping; codes are unique per person.
    var _canonGrid = (function () {
      var _normCode = function (s) { return String(s == null ? "" : s).replace(/[^A-Za-z0-9]/g, "").toUpperCase(); };
      var _normNm   = function (s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); };
      var codeByNorm = {}, codeByName = {};
      staff.forEach(function (s) {
        var c = String(s.employee_code || "").trim(); if (!c) return;
        var n = _normCode(c); if (!(n in codeByNorm)) codeByNorm[n] = c;
        var nm = _normNm(s.name); if (nm && !(nm in codeByName)) codeByName[nm] = c;
      });
      return function (g, savedNames) {
        var canon = {}, changed = false;
        Object.keys(g || {}).forEach(function (k) {
          var c = codeByNorm[_normCode(k)];
          if (!c && savedNames && savedNames[k]) { var byName = codeByName[_normNm(savedNames[k])]; if (byName) c = byName; }
          c = c || k;
          if (c !== k) changed = true;
          if (k === c) canon[c] = Object.assign({}, canon[c] || {}, g[k]);   // current key wins overlaps
          else        canon[c] = Object.assign({}, g[k], canon[c] || {});    // legacy fills gaps only
        });
        return changed ? canon : (g || {});
      };
    })();
    grid = _canonGrid(grid, (sched && sched.names) || {});
    approvedGrid = _canonGrid(approvedGrid, approvedNames);
    // Canonicalise baked hours onto the SAME current-code keys as approvedGrid
    // (structurally identical — key → {ymd:…} map — so _canonGrid re-homes it
    // the same way), so an ec lookup below hits both grid and hours alike.
    approvedHours = _canonGrid(approvedHours, approvedNames);
    // Per-manager custom shift hours (set in the HR portal coverage view),
    // layered over the computed times on the Manager Schedule view.
    var customTimes = (isMgr && window.APP_DATA.getMgrTimes) ? ((await window.APP_DATA.getMgrTimes()) || {}) : {};
    // Manager day-loans (boa_mgr_loans_v1) — the DURABLE "away" signal. Keyed
    // ec → { ymd: toBranch } for loans OUT of this branch, so a manager loaned
    // to another store renders as "→ dest" here even when a re-publish clobbered
    // her home cell back to a work code (the bug this guards against). Manager
    // view only; mirrors Manager Coverage + My BOA, which honour the record too.
    var mgrLoanByEcYmd = {};
    if (isMgr && window.APP_DATA.listMgrLoans) {
      try {
        var _mls = (await window.APP_DATA.listMgrLoans()) || [];
        _mls.forEach(function (l) {
          if (!l || !l.ec || !l.date || !l.toBranch) return;
          if (l.fromBranch !== thisBranch || l.toBranch === thisBranch) return;   // only loans OUT of here
          var _le = String(l.ec).trim();
          (mgrLoanByEcYmd[_le] = mgrLoanByEcYmd[_le] || {})[l.date] = l.toBranch;
        });
      } catch (_mlErr) { /* overlay only — never block the schedule view */ }
    }
    var days  = window.APP_DATA.periodDays(ym);
    // Re-derived split-shift manager labels (WE/WM/WL/WB) so the kiosk shows the
    // SAME shift Manager Coverage / myboa show, instead of the raw saved "W".
    // null for non-split stores (and tech view) → callers keep the raw cell.
    var _mgrLabelGrid = isMgr ? buildMgrLabelGrid(thisBranch, grid, approvedGrid, days, staff, leaveByEcYmd) : null;
    var monthAbbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var _pad2 = function (n) { return String(n).padStart(2, "0"); };
    var _ymdOf = function (d) { return d.year + "-" + _pad2(d.monthIdx + 1) + "-" + _pad2(d.day); };

    var cycStartYmd = days.length ? _ymdOf(days[0]) : null;
    var cycEndYmd   = days.length ? _ymdOf(days[days.length - 1]) : null;

    // Show staff who have employee_codes that match the schedule grid AND
    // whose role lines up with the chosen view (managers vs. techs). Transfer
    // rows that fall entirely outside their tenure at this branch are dropped:
    // an outgoing tech gone before the cycle starts, or an incoming tech who
    // only arrives after it ends.
    var rows = staff.filter(function (s) {
      if (!s.employee_code) return false;
      if (!grid[s.employee_code] && !approvedGrid[s.employee_code]) return false;
      if (isHo) {
        // Department split: Call Centre & Sales on one view, all other HO staff on the other.
        if (hoDept === "ccsales" ? !_hoIsCcSales(s) : _hoIsCcSales(s)) return false;
      } else if (isMgr ? !isManagerStaff(s) : isManagerStaff(s)) return false;
      var xfer = (s.transferring && s.transfer_date) ? s.transfer_date : null;
      if (xfer) {
        if (s.transfer_to && s.transfer_to !== thisBranch && cycStartYmd && xfer <= cycStartYmd) return false;
        if (s.transfer_to === thisBranch && s.branch !== thisBranch && cycEndYmd && xfer > cycEndYmd) return false;
      }
      return true;
    });
    rows.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });

    // Trial nail techs — read-only yellow ghost rows (nail-tech view only).
    // They have no employee code and aren't in the saved grid, so they're a
    // pure overlay showing their 10 trial working days for this cycle.
    var trialGhostRows = [];
    if (!isMgr && window.APP_DATA.listTrialCandidates) {
      var trialCands = (await window.APP_DATA.listTrialCandidates()) || [];
      trialCands.forEach(function (c) {
        if (!c || c.branch !== thisBranch) return;
        if (String(c.role || "nt").toLowerCase() !== "nt") return;   // nail techs only (excludes AM/SM/managers, any case)
        if (c.status === "passed" || c.status === "failed" || c.status === "hired") return;
        if (c.status === "induction") return;  // not on the floor until HR starts the in-store trial
        if (!c.startDate) return;
        var daySet = _trialDaySet(c.startDate);
        var inCycle = days.some(function (d) { return daySet[_ymdOf(d)]; });
        if (!inCycle) return;                                        // no trial day this cycle
        var _keys = Object.keys(daySet).sort();
        trialGhostRows.push({ name: c.name || "Trial tech", startDate: c.startDate, daySet: daySet, lastYmd: _keys[_keys.length - 1] || null });
      });
    }

    var body = document.getElementById("sched-body");
    if (rows.length === 0 && trialGhostRows.length === 0) {
      body.innerHTML = isHo
        ? '<div class="empty">No schedule has been published for ' + esc(label) + ' this period yet, or they don\'t have employee codes matching the HR portal.</div>'
        : '<div class="empty">No ' + (isMgr ? "manager" : "nail tech") + ' schedule has been posted for this period yet, or ' + (isMgr ? "managers" : "techs") + " don't have employee codes matching the HR portal.</div>";
      return;
    }

    var dowAbbr = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    // Week boundary: mark the start of every Mon–Sun work week so the
    // table reads as discrete weeks at a glance. First column is never
    // a boundary (nothing before it to separate from).
    var weekStartAt = function (d, i) {
      if (i === 0) return false;
      var dt = new Date(d.year, d.monthIdx, d.day);
      return dt.getDay() === 1; // Monday
    };
    // Branch-aware "manager hours" banner shown once above the grid on
    // the Manager Schedule view. Keeps the rows visually clean — no
    // repeated subtitle under each name. The cells themselves still
    // expose the exact time as a hover tooltip via the title attr below.
    var html = '';
    if (isMgr) {
      html += _hoursBannerHtml(thisBranch);
    } else {
      html += _techHoursBannerHtml(thisBranch, hoDept);
    }
    html += '<div class="sched-wrap"><table class="sched-table">';
    html += '<thead><tr><th class="sched-name-h">Staff</th>';
    days.forEach(function (d, i) {
      var dt = new Date(d.year, d.monthIdx, d.day);
      var dow = dowAbbr[dt.getDay()];
      var isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      var classes = '';
      if (d.isToday)       classes += ' sched-today';
      if (isWeekend)       classes += ' sched-weekend';
      if (weekStartAt(d, i)) classes += ' sched-week-start';
      html += '<th class="' + classes.trim() + '">' +
                '<div class="sched-day-num">' + d.day + '</div>' +
                '<div class="sched-mon">' + monthAbbr[d.monthIdx] + '</div>' +
                '<div class="sched-dow">' + dow + '</div>' +
              '</th>';
    });
    html += '</tr></thead><tbody>';
    var customList = [];   // collected custom-hours days for the summary below
    rows.forEach(function (s) {
      // Direction-aware transfer blanking, mirroring the HR portal:
      //   • outgoing (leaving this branch): cells on/after transfer_date blank
      //   • incoming (arriving here):       cells before transfer_date blank
      var _xfer = (s.transferring && s.transfer_date) ? s.transfer_date : null;
      var _outgoing = !!_xfer && s.transfer_to && s.transfer_to !== thisBranch;
      var _incoming = !!_xfer && s.transfer_to === thisBranch && s.branch !== thisBranch;
      html += '<tr><td class="sched-name" title="' + esc(s.name) + '">' + esc(s.name) + '</td>';
      days.forEach(function (d, i) {
        var _ymd = _ymdOf(d);
        var blanked = (_outgoing && _ymd >= _xfer) || (_incoming && _ymd < _xfer);
        // Leave-Planner overlay wins, then the PUBLISHED snapshot, then the live
        // draft only for a day the snapshot leaves empty. (Coverage on the portal
        // is the producer and reads live-first + re-derives; consumer surfaces
        // like this one render the published truth verbatim instead.)
        var cell = false;
        if (!blanked) {
          var _ecT = String(s.employee_code || "").trim();
          // Read the PUBLISHED snapshot first, then the live draft only for a day
          // the snapshot leaves empty (unpublished cycle). Managers render the
          // published truth verbatim — the draft can carry a stale raw code.
          var _raw = (approvedGrid[s.employee_code] && approvedGrid[s.employee_code][d.day])
                  || (grid[s.employee_code] && grid[s.employee_code][d.day]);
          // Leave-Planner overlay wins for a working/blank day, but a scheduled
          // OFF / ghost day inside the leave window stays as-is (matches the
          // portal schedule + attendance — you don't "take leave" on a day off).
          if (leaveByEcYmd[_ecT] && leaveByEcYmd[_ecT][_ymd] && _raw !== "O" && _raw !== "R" && _raw !== "X") {
            cell = "L";
          } else {
            // Prefer the re-derived split-shift label for a WORKING cell so the
            // kiosk matches Manager Coverage — EXCEPT on days with a custom-hours
            // override, where Coverage keeps the raw saved code. Off / loan / etc.
            // codes always pass through as the raw value.
            var _derived = _mgrLabelGrid && _mgrLabelGrid[s.employee_code] && _mgrLabelGrid[s.employee_code][d.day];
            var _ctRow = customTimes[s.employee_code] || customTimes[_ecT];
            var _hasCustom = !!(_ctRow && _ctRow[_ymd]);
            cell = (_derived && _MGR_WORK_CODES[_derived] && !_hasCustom) ? _derived : _raw;
          }
          // Maternity wins over the saved cell from mat_start on (whole cycle
          // when no date yet) — same precedence as My BOA / the portal grid.
          var _matStart = matStartByEc[_ecT.toUpperCase()];
          if (_matStart !== undefined && (!_matStart || _ymd >= _matStart)) cell = "ML";
          // Legal unpaid leave wins over the saved cell too (same precedence).
          var _legalR = legalRangeByEc[_ecT.toUpperCase()];
          if (_legalR && (!_legalR.start || _ymd >= _legalR.start) && (!_legalR.end || _ymd <= _legalR.end)) cell = "EL";
        }
        var classes = '';
        if (d.isToday) classes += ' sched-today';
        if (weekStartAt(d, i)) classes += ' sched-week-start';
        // On loan to another store this day — driven by the durable loan record
        // (or a leftover loan_out cell). Show "→ dest" instead of a home shift or
        // the literal "loan_out" text. Maternity / legal / leave still win above.
        var _awayTo = (!blanked && isMgr) ? (mgrLoanByEcYmd[String(s.employee_code || "").trim()] || {})[_ymd] : null;
        if ((_awayTo || cell === "loan_out") && cell !== "ML" && cell !== "EL" && cell !== "L") {
          var _awayDest = _awayTo || "another store";
          var _awayShort = _awayDest.length > 8 ? _awayDest.slice(0, 7) + "…" : _awayDest;
          html += '<td class="sched-cell sched-st-away' + classes + '" style="text-align:center;background:#eff6ff;color:#1e3a8a;font-weight:700;font-size:11px" title="' + esc("On loan to " + _awayDest + " this day — not working at " + thisBranch) + '">→ ' + esc(_awayShort) + '</td>';
        } else if (cell) {
          // Hover-only full time on Manager view so the cell stays
          // visually clean but the exact hours are reachable on tap.
          var _title = "";
          var _custCls = "";
          var _mark = "";
          if (isMgr && (cell === "W" || cell === "WE" || cell === "WL" || cell === "WM" || cell === "WB" || cell === "E")) {
            var _dt = new Date(d.year, d.monthIdx, d.day);
            // Hours precedence (Phase 1.1): live custom override wins; else the
            // portal-baked snapshot hours (when the baked code still matches this
            // cell — a post-publish code change invalidates it); else this
            // kiosk's own shiftTimes copy. Reading baked keeps the kiosk showing
            // the EXACT times the portal published even if the two shiftTimes
            // copies have drifted. Employee codes can carry a trailing space in
            // older data, so lookups fall back to the trimmed/upper key.
            var _custRow = _custHoursRow(customTimes, s.employee_code);
            var _cust = _custRow && _custRow[_ymd];
            var _hrs;
            if (_cust) {
              _hrs = _cust;
              _custCls = " sched-cell-custom";
              _mark = '<span class="sched-cust-star" aria-hidden="true">★</span>';
              customList.push({ name: s.name, mon: monthAbbr[d.monthIdx], day: d.day, dow: dowAbbr[_dt.getDay()], hrs: _cust });
            } else {
              var _bkRow = _custHoursRow(approvedHours, s.employee_code);
              var _bk = _bkRow && _bkRow[_ymd];
              _hrs = (_bk && _bk.c === cell) ? _bk.t : _shiftTimes(s.role, cell, thisBranch, _dt.getDay());
            }
            if (_hrs) _title = ' title="' + esc(_hrs + (_cust ? " (custom hours)" : "")) + '"';
          }
          html += '<td class="sched-cell sched-st-' + cell + classes + _custCls + '"' + _title + '>' + cell + _mark + '</td>';
        } else {
          html += '<td class="' + classes.trim() + '"></td>';
        }
      });
      html += '</tr>';
    });
    // Trial nail-tech ghost rows — yellow "T" on each of their 10 trial days.
    trialGhostRows.forEach(function (t) {
      var startLbl = new Date(t.startDate + "T12:00:00").toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
      html += '<tr class="sched-trial-row"><td class="sched-name" title="' + esc(t.name) + ' · 10-day trial (started ' + esc(startLbl) + ')">' +
              esc(t.name) + ' <span class="sched-trial-tag">🧪 TRIAL</span></td>';
      days.forEach(function (d, i) {
        var _ymd = _ymdOf(d);
        var classes = '';
        if (d.isToday) classes += ' sched-today';
        if (weekStartAt(d, i)) classes += ' sched-week-start';
        // Pre-start days grey out (X); trial working days are yellow (T);
        // weekends & public holidays inside the trial window read as off (O).
        if (t.startDate && _ymd < t.startDate) {
          html += '<td class="sched-cell sched-st-X' + classes + '" title="' + esc(t.name + ' · not started yet') + '">X</td>';
        } else if (t.daySet[_ymd]) {
          html += '<td class="sched-cell sched-cell-trial' + classes + '" title="' + esc(t.name + ' · trial working day (Mon–Fri, excl. weekends & public holidays)') + '">T</td>';
        } else if (t.lastYmd && _ymd <= t.lastYmd) {
          html += '<td class="sched-cell sched-st-O' + classes + '" title="' + esc(t.name + ' · off (weekend / public holiday during trial)') + '">O</td>';
        } else {
          html += '<td class="' + classes.trim() + '"></td>';
        }
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="sched-legend">' +
              '<span><span class="sched-st-W">W</span> Work</span>' +
              (!isMgr ? '<span><span class="sched-st-WE">WE</span> Work early</span>' : '') +
              (!isMgr ? '<span><span class="sched-st-WL">WL</span> Work late</span>' : '') +
              (!isMgr ? '<span><span class="sched-st-E">E</span> Extra (covering)</span>' : '') +
              '<span><span class="sched-st-O">O</span> Off</span>' +
              '<span><span class="sched-st-R">R</span> Requested off</span>' +
              '<span><span class="sched-st-L">L</span> Leave</span>' +
              '<span><span class="sched-st-ML">ML</span> Maternity</span>' +
              '<span><span class="sched-st-EL">EL</span> Unpaid (legal)</span>' +
              (!isMgr && trialGhostRows.length ? '<span><span class="sched-cell-trial">T</span> Trial day</span>' : '') +
              '<span class="sched-legend-note">Today highlighted</span>' +
              (isMgr && customList.length ? '<span class="sched-legend-note">★ custom hours</span>' : '') +
            '</div>';

    // Custom-hours summary — spells out the special hours per manager/day
    // so the exact times are visible without hovering each starred cell.
    if (isMgr && customList.length) {
      customList.sort(function (a, b) { return (a.day - b.day) || (a.name || "").localeCompare(b.name || ""); });
      html += '<div class="sched-custom-hours">' +
                '<div class="sched-custom-hours-title">⏰ Custom hours this cycle</div>' +
                customList.map(function (c) {
                  return '<div class="sched-custom-hours-row"><strong>' + esc(c.name) + '</strong> · ' +
                         esc(c.dow + ' ' + c.day + ' ' + c.mon) + ' — ' + esc(c.hrs) + '</div>';
                }).join("") +
              '</div>';
    }
    body.innerHTML = html;
  }

  // ---------------- Daily Check-in (attendance-grid style) ----------------
  // Mirrors the HR portal's Attendance tab. Writes directly to
  // app_state under boa_att_<branch>_<ym>, which the HR portal reads
  // through its sync shim, so totals on the HR Attendance tab update.
  var _dlyCurrentDate = null;

  // ── Borrow Tech (walk-in flow) ─────────────────────────────────────────
  // Opened from the Daily Check-in toolbar. Loads every active tech across
  // branches PLUS today's tech-loans + today's schedule grids per branch,
  // then filters the candidate pool to techs who are:
  //   - based at a different branch than this kiosk
  //   - scheduled to WORK today at their home branch (W / WL / E)
  //   - not already loaned in to this branch today
  // Picking a row writes a one-day loan record and returns to the check-in
  // page, where the guest now appears in the roster (PR #70 logic).
  async function renderBorrowTech() {
    setSublabel("Borrow Tech");
    var today = new Date();
    var todayIso  = window.APP_DATA ? window.APP_DATA.isoDate(today)
                                     : (today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,"0") + "-" + String(today.getDate()).padStart(2,"0"));
    var todayLbl  = today.toLocaleDateString("en-ZA", { weekday: "long", day: "2-digit", month: "long" });
    var thisBranch = (window.APP_CONFIG && window.APP_CONFIG.branchName) || "";

    // A completed branch transfer (transfer_date on/before today) moves a tech
    // to their new store, but the HR portal leaves the staff row's `branch`
    // pointing at the OLD branch until someone re-saves it — every portal view
    // derives the move live instead. Mirror that here so the borrow picker
    // shows the right home, checks the right branch's schedule for eligibility,
    // and attributes the loan to the new branch rather than the stale one.
    function effBranch(s) {
      if (s && s.transferring && s.transfer_to && s.transfer_date && todayIso >= s.transfer_date) return s.transfer_to;
      return (s && s.branch) || "";
    }

    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>🔀 Borrow a Tech for Today</h2>' +
          '<button class="link-btn link-btn-dark" id="bt-back">← Back to check-in</button>' +
        '</div>' +
        '<div class="dly-sub">' + esc(todayLbl) + ' · ' + esc((window.APP_CONFIG && window.APP_CONFIG.branchDisplayName) || thisBranch) + '</div>' +
        '<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;padding:12px 14px;margin:12px 0;font-size:12px;color:#78350F;line-height:1.5">' +
          'A tech from another store working here today? Only staff who are <b>scheduled to work today</b> at their home branch can be borrowed. ' +
          'Hours stay with their home branch for payroll; this kiosk records their attendance.' +
        '</div>' +
        '<div id="bt-today-strip" style="font-size:12px;color:var(--gray-600);margin-bottom:10px"></div>' +
        '<input id="bt-search" type="search" autocomplete="off" placeholder="Search by name or EC…" ' +
          'class="input" style="padding:11px 14px;font-size:15px;border:2px solid var(--pink-200);border-radius:12px;margin-bottom:10px">' +
        '<div id="bt-results" style="display:flex;flex-direction:column;gap:8px">Loading staff list…</div>' +
      '</div>'
    );
    document.getElementById("bt-back").onclick = function () { renderCheckin(); };

    if (!window.APP_DATA || !window.APP_DATA.isConfigured()) {
      document.getElementById("bt-results").innerHTML = configMissingHtml();
      return;
    }

    // The tech-schedule cycle for today (END-month convention; matches the
    // boa_sched_<branch>_<ym> key format).
    var schedYm = window.APP_DATA.ymForDate(today);
    var dayKey  = String(today.getDate());

    var allStaff = [];
    var loansToday = [];
    var schedByBranch = {};
    try {
      var loaded = await Promise.all([
        window.APP_DATA.listStaffAllBranches(),
        window.APP_DATA.listTechLoans(todayIso)
      ]);
      allStaff = loaded[0] || [];
      loansToday = loaded[1] || [];
      var branchesToCheck = {};
      allStaff.forEach(function (s) { var hb = effBranch(s); if (hb && hb !== thisBranch) branchesToCheck[hb] = true; });
      schedByBranch = await window.APP_DATA.getSchedulesForBranches(Object.keys(branchesToCheck), schedYm);
    } catch (e) {
      document.getElementById("bt-results").innerHTML =
        '<div style="color:#7f1d1d;padding:14px">Could not load: ' + esc(String((e && e.message) || e)) + '</div>';
      return;
    }

    // 'Already here today' strip
    var incomingToday = loansToday.filter(function (l) { return l && l.toBranch === thisBranch && l.fromBranch !== thisBranch; });
    var stripEl = document.getElementById("bt-today-strip");
    if (incomingToday.length > 0) {
      stripEl.innerHTML =
        '<b>Already here today (' + incomingToday.length + '):</b> ' +
        incomingToday.map(function (l) {
          return '<span style="display:inline-block;background:#FEF3C7;color:#78350F;border:1px solid #FDE68A;border-radius:99px;padding:2px 9px;margin:2px 4px 2px 0;font-weight:700;font-size:11px">' +
            esc(l.name || l.ec) + ' ← ' + esc(l.fromBranch || "") + '</span>';
        }).join("");
    } else {
      stripEl.innerHTML = '<span style="font-style:italic;color:var(--gray-500)">No one borrowed in yet today.</span>';
    }

    // Eligibility: another branch + scheduled to WORK today at home + not already loaned in here.
    var alreadyIncomingEcs = {};
    incomingToday.forEach(function (l) { alreadyIncomingEcs[l.ec] = true; });
    var eligible = allStaff.filter(function (s) {
      if (!s || !s.employee_code || !s.branch) return false;
      var hb = effBranch(s);
      if (hb === thisBranch) return false;
      if (alreadyIncomingEcs[s.employee_code]) return false;
      var grid = schedByBranch[hb];
      if (!grid) return false;
      var v = grid[s.employee_code] && grid[s.employee_code][dayKey];
      // Any working shift (W / WE / WL / WB / WM / E) makes the tech borrowable.
      return isWorkingShift(v);
    });

    var inp = document.getElementById("bt-search");
    var resultsEl = document.getElementById("bt-results");

    function renderResults() {
      var q = (inp.value || "").trim().toLowerCase();
      var matches = (q === "") ? eligible : eligible.filter(function (s) {
        return (s.name || "").toLowerCase().indexOf(q) !== -1 ||
               (s.employee_code || "").toLowerCase().indexOf(q) !== -1;
      });
      matches = matches.slice(0, 50);
      if (matches.length === 0) {
        resultsEl.innerHTML = '<div style="color:var(--gray-500);font-style:italic;padding:14px;text-align:center">' +
          (q === "" ? "No staff are scheduled to work elsewhere today, so nobody is eligible to borrow." : "No matches for &quot;" + esc(q) + "&quot; among scheduled techs.") +
          '</div>';
        return;
      }
      resultsEl.innerHTML = matches.map(function (s) {
        return (
          '<div class="bt-row" data-ec="' + esc(s.employee_code) + '" data-name="' + esc(s.name || "") + '" data-branch="' + esc(effBranch(s) || "") + '" ' +
              'style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#fff;border:1px solid var(--pink-100);border-radius:12px">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:700;color:var(--pink-900);font-size:14px">' + esc(s.name || "(no name)") + '</div>' +
              '<div style="font-size:11px;color:var(--gray-500);margin-top:2px">' +
                '<span style="font-family:monospace">' + esc(s.employee_code || "—") + '</span> · 📍 ' + esc(effBranch(s) || "—") +
              '</div>' +
            '</div>' +
            '<button type="button" class="bt-btn" style="background:var(--pink-700);color:#fff;border:none;border-radius:8px;padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer">Borrow</button>' +
          '</div>'
        );
      }).join("");
    }
    renderResults();
    inp.addEventListener("input", renderResults);

    resultsEl.addEventListener("click", async function (e) {
      var btn = e.target.closest && e.target.closest(".bt-btn");
      if (!btn) return;
      var row = btn.closest(".bt-row"); if (!row) return;
      var ec = row.dataset.ec || "";
      var name = row.dataset.name || "";
      var branch = row.dataset.branch || "";
      if (!ec) return;
      var ok = window.confirm("Borrow " + (name || ec) + " from " + branch + " for today?\n\nShe'll appear on today's roster here; her hours stay attributed to " + branch + ".");
      if (!ok) return;
      btn.disabled = true; btn.textContent = "Saving…";
      var loan = {
        _id: "ln_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
        ec: ec, name: name, date: todayIso,
        fromBranch: branch, toBranch: thisBranch,
        note: "Walk-in via " + ((window.APP_CONFIG && window.APP_CONFIG.branchDisplayName) || thisBranch) + " kiosk",
        createdBy: "kiosk:" + thisBranch,
        createdAt: new Date().toISOString()
      };
      try {
        await window.APP_DATA.saveTechLoan(loan);
        // Bounce back to the daily check-in - the guest now lands in the
        // roster via the PR #70 categorizeStaff hook.
        renderCheckin();
      } catch (err) {
        btn.disabled = false; btn.textContent = "Borrow";
        alert("Could not save loan: " + ((err && err.message) || err));
      }
    });

    setTimeout(function () { try { inp.focus(); } catch (_) {} }, 50);
  }

  async function renderCheckin() {
    setSublabel("Daily Check-in");
    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>⚠️ Daily Check-in</h2>' +
          '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
        '</div>' +
        '<div class="dly-sub">Quick attendance log for one store, one day. Mark exceptions and the totals on the Attendance tab update automatically.</div>' +

        '<div class="dly-toolbar">' +
          '<div class="dly-date-nav">' +
            '<button class="dly-nav-btn" data-act="prev" type="button">‹</button>' +
            '<div class="dly-date" id="dly-date-label"></div>' +
            '<button class="dly-nav-btn" data-act="next" type="button">›</button>' +
          '</div>' +
          '<div class="dly-status-badge" id="dly-status-badge"></div>' +
          '<button id="dly-borrow-btn" type="button" title="Borrow a tech from another branch for today" ' +
            'style="margin-left:auto;background:#fff;color:var(--pink-700);border:2px solid var(--pink-200);border-radius:10px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer">' +
            '🔀 Borrow Tech</button>' +
        '</div>' +

        '<div class="dly-progress" id="dly-progress"></div>' +

        '<div class="dly-section-head" id="dly-section-head"></div>' +

        '<div id="dly-list">Loading roster…</div>' +
      '</div>'
    );
    document.getElementById("back-home").onclick = function () { _backHandler(); };
    document.getElementById("dly-borrow-btn").onclick = function () { renderBorrowTech(); };

    if (!window.APP_DATA || !window.APP_DATA.isConfigured()) {
      document.getElementById("dly-list").innerHTML = configMissingHtml();
      return;
    }

    _dlyCurrentDate = new Date();

    document.querySelector('[data-act="prev"]').onclick = function () {
      _dlyCurrentDate.setDate(_dlyCurrentDate.getDate() - 1);
      renderDay();
    };
    document.querySelector('[data-act="next"]').onclick = function () {
      // Don't allow check-ins for future dates — the next button stops at today.
      if (_isToday(_dlyCurrentDate)) return;
      _dlyCurrentDate.setDate(_dlyCurrentDate.getDate() + 1);
      renderDay();
    };

    await renderDay();
  }

  // True if `d` is on today's calendar date (local time).
  function _isToday(d) {
    var t = new Date();
    return d.getFullYear() === t.getFullYear()
        && d.getMonth()    === t.getMonth()
        && d.getDate()     === t.getDate();
  }
  // True if `d`'s calendar date is strictly after today.
  function _isFuture(d) {
    var dm = new Date(d.getTime()); dm.setHours(0,0,0,0);
    var tm = new Date();            tm.setHours(0,0,0,0);
    return dm > tm;
  }

  async function renderDay() {
    // Defensive: if the current date is somehow in the future (e.g. dev
    // tools tampered with state), snap back to today before rendering so
    // a manager can't mark attendance ahead of time.
    if (_isFuture(_dlyCurrentDate)) _dlyCurrentDate = new Date();

    var date = _dlyCurrentDate;
    document.getElementById("dly-date-label").textContent =
      date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    // Grey out the › button when we're already on today.
    var nextBtn = document.querySelector('[data-act="next"]');
    if (nextBtn) {
      var atToday = _isToday(date);
      nextBtn.disabled        = atToday;
      nextBtn.style.opacity   = atToday ? "0.3" : "";
      nextBtn.style.cursor    = atToday ? "not-allowed" : "";
      nextBtn.title           = atToday ? "Can't check in for future dates" : "";
    }

    var ym     = window.APP_DATA.ymForDate(date);
    var dayKey = String(date.getDate());

    // Bucket staff into active / on-maternity / on-annual-leave for the
    // viewed date. Maternity/leave staff are excluded from the roster and
    // off-today section entirely — they appear in their own read-only
    // sections below so the manager can still see they're away.
    //
    // All seven of these reads are independent of each other, so we fire
    // them in parallel via Promise.all. This used to be 7 sequential
    // round-trips (≈800ms+ on tablet data); now it's the cost of the
    // single slowest one.
    var loaded = await Promise.all([
      window.APP_DATA.categorizeStaff(date, { activeOnly: true }),
      window.APP_DATA.getSchedule(ym),
      window.APP_DATA.getAttendance(ym),
      window.APP_DATA.getDailyRecord(date),
      window.APP_DATA.getSwaps(ym),
      window.APP_DATA.getExtras(ym),
      window.APP_DATA.getAbsences(ym),
      window.APP_DATA.getEarlyLeaves(ym),
      window.APP_DATA.listTrialCandidates()
    ]);
    var cats         = loaded[0];
    var staff        = cats.active;
    var staffOnMat   = cats.onMat;
    var staffOnLeave = cats.onLeave;
    var staffLeft    = cats.leftCompany || [];
    var sched        = loaded[1];
    var attendance   = loaded[2];
    var dailyRec     = loaded[3];
    var swaps        = loaded[4];
    var extras       = loaded[5];
    var absences     = loaded[6];
    var earlyLeaves  = loaded[7] || {};
    var trialCand    = loaded[8] || [];
    var grid       = (sched && sched.grid) || {};
    // Day is locked once signed off — only proof-uploads (sick → sick+note,
    // absent → sick+note / FRL+proof) are allowed afterwards.
    var alreadySigned = !!(dailyRec && dailyRec.signedBy);
    // A day in the past is also locked: managers can browse to inspect the
    // record (and attach notes/proof that surfaced later) but can't change
    // any status — that would silently rewrite history.
    var isPast     = (function () {
      var dm = new Date(date.getTime()); dm.setHours(0,0,0,0);
      var tm = new Date();              tm.setHours(0,0,0,0);
      return dm < tm;
    })();
    var isLocked   = alreadySigned || isPast;
    // The "Left early" tag is a separate, looser gate than isLocked:
    // it stays editable AFTER the day's check-ins are submitted, but only
    // until 20:00 that same calendar day. Past days are still off-limits.
    var isEarlyEditAllowed = (function () {
      if (!_isToday(date)) return false;
      var now = new Date();
      var cutoff = new Date(now.getTime());
      cutoff.setHours(20, 0, 0, 0);
      return now < cutoff;
    })();
    var attGrid    = (attendance && attendance.grid) || {};
    var todayIso   = window.APP_DATA.isoDate(date);

    // The seven explicit status codes managers can click. The green ✓
    // (dly-confirmed) and the "confirmed" progress counter ONLY treat these
    // as a real tagging — placement markers like swap_i / swap_o / ext are
    // structural, not a check-in decision, so they don't earn the tick on
    // their own (the manager still needs to record on-time/late/etc).
    var TAGGED_STATUSES = { on: 1, late: 1, sick_n: 1, sick: 1, absent: 1, no: 1, frl: 1 };
    function isTagged(st) { return !!(st && TAGGED_STATUSES[st]); }

    // Helper: for an EC, find a swap that touches today and return partner info.
    // Includes the swap id so the row can offer an "Undo swap" button.
    function findSwapInfoFor(ec) {
      for (var i = 0; i < swaps.length; i++) {
        var s = swaps[i];
        if (s.dateA === todayIso) {
          if (s.oweEc   === ec) return { id: s.id, partner: s.coverName, otherDate: s.dateB, isBack: false, role: "off"   };
          if (s.coverEc === ec) return { id: s.id, partner: s.oweName,   otherDate: s.dateB, isBack: false, role: "cover" };
        }
        if (s.dateB === todayIso) {
          if (s.oweEc   === ec) return { id: s.id, partner: s.coverName, otherDate: s.dateA, isBack: true,  role: "cover" };
          if (s.coverEc === ec) return { id: s.id, partner: s.oweName,   otherDate: s.dateA, isBack: true,  role: "off"   };
        }
      }
      return null;
    }
    function approverFor(ec) {
      var rec = extras[dayKey] && extras[dayKey][ec];
      return rec ? rec.approvedBy : null;
    }
    function absenceReasonFor(ec) {
      var rec = absences[dayKey] && absences[dayKey][ec];
      return rec ? rec.reason : null;
    }
    function earlyLeaveFor(ec) {
      var rec = earlyLeaves[dayKey] && earlyLeaves[dayKey][ec];
      return rec || null;
    }

    // Helper: is this person flagged as an Extra Day worker today? The
    // canonical source is the extras sidecar. We also accept legacy data
    // where the attendance grid was written as "ext" (older versions of
    // recordExtraDay did that — newer ones don't, so on-time/late can be
    // tagged on top without losing the Extra Day designation).
    function hasExtraDayFor(ec) {
      if (extras[dayKey] && extras[dayKey][ec]) return true;
      var att = attGrid[ec] && attGrid[ec][dayKey];
      return att === "ext";
    }

    // Roster = ONLY active staff who are scheduled to work today
    //          (W = work, WL = work late, E = extra cover) or who have
    //          been flagged in as a same-day cover.
    //
    // We deliberately do NOT pull anyone in just because they have an
    // attendance value set today: stale attendance from past clicking would
    // otherwise leak ex-employees and unscheduled people back onto the list.
    //
    // Exceptions for genuine same-day covers:
    //   - swap_i (the off-day person who came in to cover)
    //   - an extras sidecar entry (Extra Day approved)
    //   - legacy attendance value "ext" (pre-fix records still in Supabase)
    var rosterMap = {};
    staff.forEach(function (s) {
      if (!s.employee_code) return;
      if (isManagerStaff(s)) return;   // managers check in via their own tile
      var schSt = grid[s.employee_code] && grid[s.employee_code][dayKey];
      var attSt = attGrid[s.employee_code] && attGrid[s.employee_code][dayKey];
      var isScheduled      = isWorkingShift(schSt);
      var isSameDayCoverer = (attSt === "swap_i" || hasExtraDayFor(s.employee_code));
      // Guests loaned in from another branch are unconditionally in today's
      // roster. Their schedule entry lives in their home branch's grid so
      // the isScheduled test wouldn't catch them here. Loaned-out staff
      // also stay on their home roster (locked) so the manager can see
      // where they are even if the schedule didn't put them at work today.
      var isLoanInvolved   = !!(s._guest || s._loanedOut);
      if (isScheduled || isSameDayCoverer || isLoanInvolved) {
        rosterMap[s.id] = { staff: s, schedStatus: schSt || null, current: attSt || null };
      }
    });
    var scheduled = Object.keys(rosterMap).map(function (k) { return rosterMap[k]; });
    scheduled.sort(function (a, b) { return (a.staff.name || "").localeCompare(b.staff.name || ""); });

    // If the schedule for this period hasn't been loaded at all, surface
    // that distinct from "no one is scheduled today" so the manager knows
    // it's a data issue and not literally nobody-working.
    var scheduleHasAnyEntries = false;
    var gridKeys = Object.keys(grid);
    for (var gi = 0; gi < gridKeys.length; gi++) {
      if (grid[gridKeys[gi]] && Object.keys(grid[gridKeys[gi]]).length > 0) {
        scheduleHasAnyEntries = true; break;
      }
    }

    // All staff scheduled off today (used for the grey "Off today" section).
    // Includes O/R/L/X. Action buttons are only enabled for O and R though —
    // L (Leave) and X (Pre-start) are informational.
    var offTodayAll = staff.filter(function (s) {
      if (!s.employee_code) return false;
      if (isManagerStaff(s)) return false;   // managers aren't part of the tech check-in
      if (rosterMap[s.id]) return false;
      var st = grid[s.employee_code] && grid[s.employee_code][dayKey];
      return st === "O" || st === "R" || st === "L" || st === "X";
    }).sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });

    // Subset of the above eligible for swap/extra (O or R only)
    var offToday = offTodayAll.filter(function (s) {
      var st = grid[s.employee_code] && grid[s.employee_code][dayKey];
      return st === "O" || st === "R";
    });

    var listEl  = document.getElementById("dly-list");
    var headEl  = document.getElementById("dly-section-head");
    var progEl  = document.getElementById("dly-progress");
    var badgeEl = document.getElementById("dly-status-badge");

    var myBranch = cfg.branchName || "";
    var myTrialCand = trialCand.filter(function(c) {
      // Trial AMs live on the Manager Clock-in page instead — they don't
      // belong with the nail-tech roster.
      if (String(c.role || "nt").toLowerCase() !== "nt") return false;
      return c.branch === myBranch && c.status && c.status.indexOf("trial") === 0;
    });

    if (scheduled.length === 0 && myTrialCand.length === 0) {
      headEl.textContent  = "";
      progEl.innerHTML    = "";
      badgeEl.textContent = "";
      badgeEl.className   = "dly-status-badge";
      // Two distinct empty states: schedule simply has no one in today,
      // versus no schedule loaded at all for this branch + cycle.
      if (!scheduleHasAnyEntries) {
        listEl.innerHTML =
          '<div class="empty" style="text-align:left;line-height:1.5">' +
            '<strong>No schedule loaded for this period.</strong><br>' +
            'The check-in list only shows staff who are scheduled to work today ' +
            '(per the schedule saved in Supabase for this store). Make sure the ' +
            'schedule for this cycle has been published from the HR portal, then ' +
            'reload this page.' +
          '</div>';
      } else {
        listEl.innerHTML = '<div class="empty">No one is scheduled to work on this day.</div>';
      }
      return;
    }

    // Counters
    // Note: `scheduled` contains rosterMap entries of shape
    // { staff, schedStatus, current }, so the attendance status is on
    // r.current (already pulled from attGrid during the roster build).
    // Looking up r.employee_code directly is a bug — that field lives on
    // r.staff.employee_code — and was previously freezing confirmed at 0.
    var confirmed = 0, onTime = 0, total = 0, loanedOutCount = 0;
    scheduled.forEach(function (r) {
      // Loaned-out techs are working at another store today — their status is
      // recorded by that store's kiosk and their home row is locked, so they
      // must NOT count toward "needs a status" (otherwise the home manager can
      // never reach all-confirmed and submit). They still show in the roster,
      // chipped with their destination, for visibility.
      if (r.staff && r.staff._loanedOut) { loanedOutCount++; return; }
      total++;
      var st = r.current;
      if (isTagged(st)) confirmed++;
      if (st === "on") onTime++;
    });

    // Trial nail techs are COMPULSORY to check in: a trial tech who has a trial
    // working day today (per their 10-day Mon–Fri schedule) must be marked On
    // Time / Late / Absent before the manager can sign the day off — otherwise
    // a manager could close the day for everyone except the trial techs. We
    // fold their counts straight into the same confirmed/total gate.
    var today = window.APP_DATA.todayStr();
    var trialActiveToday = myTrialCand.filter(function (c) {
      if (c.status !== "trial_w1" && c.status !== "trial_w2") return false;
      var ds = _trialDaySet(c.startDate);
      return !!ds[today];
    });
    trialActiveToday.forEach(function (c) {
      var m = (c.checkins && !Array.isArray(c.checkins)) ? c.checkins : {};
      var st = m[today];
      total++;
      if (st === "on" || st === "late" || st === "absent") confirmed++;
      if (st === "on") onTime++;
    });

    var awaySuffix = loanedOutCount > 0 ? ' · ' + loanedOutCount + ' away' : '';
    if (total === 0) {
      badgeEl.innerHTML = loanedOutCount > 0 ? '✓ All techs loaned out today' : '';
      badgeEl.className  = 'dly-status-badge' + (loanedOutCount > 0 ? ' dly-status-good' : '');
    }
    else if (onTime === total)   { badgeEl.innerHTML = '✓ All ' + total + ' On Time' + awaySuffix; badgeEl.className = 'dly-status-badge dly-status-good'; }
    else if (confirmed === total){ badgeEl.innerHTML = '✓ All confirmed' + awaySuffix;             badgeEl.className = 'dly-status-badge dly-status-good'; }
    else                         { badgeEl.innerHTML = (total - confirmed) + ' need a status' + awaySuffix; badgeEl.className = 'dly-status-badge dly-status-pending'; }

    var pct = total > 0 ? Math.round((confirmed / total) * 100) : 100;
    progEl.innerHTML =
      '<div class="dly-progress-text">Progress: <strong>' + confirmed + '/' + total + ' confirmed</strong>' +
        (confirmed < total ? ' — ' + (total - confirmed) + ' still need a status' : '') +
      '</div>' +
      '<div class="dly-progress-bar"><div class="dly-progress-fill" style="width:' + pct + '%"></div></div>';

    headEl.innerHTML = '📍 Scheduled to work · ' + total + ' staff' +
      (loanedOutCount > 0 ? ' · ' + loanedOutCount + ' loaned out' : '');

    var statusButtons = [
      { code: "on",     label: "On Time"       },
      { code: "late",   label: "Late"          },
      { code: "sick_n", label: "Sick + note"   },
      { code: "sick",   label: "Sick NO note"  },
      { code: "absent", label: "Absent"        },
      { code: "no",     label: "NO SHOW"       },
      { code: "frl",    label: "FRL + proof"   }
    ];

    // Trial techs get only three honest statuses — On Time / Late / Absent.
    // No "sick / FRL / no-show" reasons during a trial: the manager records
    // exactly what happened on a trial day, nothing else.
    var trialStatusButtons = [
      { code: "on",     label: "On Time" },
      { code: "late",   label: "Late"    },
      { code: "absent", label: "Absent"  }
    ];
    var STAGE_LABEL = { trial_w1: "Trial Week 1", trial_w2: "Trial Week 2", passed: "Passed", induction: "Induction" };

    var trialHtml = "";
    if (myTrialCand.length > 0) {
      trialHtml = '<div class="dly-section-head" style="margin-top:20px">📍 Trial Candidates</div>' +
        myTrialCand.map(function(c) {
          var checkinMap = (c.checkins && !Array.isArray(c.checkins)) ? c.checkins : {};
          var workedDays = trialWorkedDays(c);
          var currentStatus = checkinMap[today];
          var isTrialDayToday = !!_trialDaySet(c.startDate)[today];

          var buttonsHtml = trialStatusButtons.map(function(b) {
            var isActive = currentStatus === b.code;
            return '<button type="button" class="trial-act dly-act-' + b.code +
                   (isActive ? ' dly-act-active' : '') +
                   '" style="padding:7px 12px;border-radius:6px;font-size:12px;font-weight:700;border:1px solid #e5e7eb;background:' + (isActive ? '#BE185D' : '#fff') + ';color:' + (isActive ? '#fff' : '#374151') + ';cursor:pointer" ' +
                   'data-id="' + esc(c._id) + '" data-status="' + b.code + '">' + b.label + '</button>';
          }).join("");

          // Evaluation state — a due form (call to action), an already-passed
          // result, or one held back for HR because it scored below the bar.
          var due = trialEvalDue(c);
          var evalHtml = "";
          ["mid", "final"].forEach(function (which) {
            var ev = which === "mid" ? c.midEval : c.finalEval;
            if (!ev || !ev.submittedAt) return;
            var ttl = which === "mid" ? "Week 1 evaluation" : "Final evaluation";
            if (ev.pass) {
              evalHtml += '<div style="font-size:11px;color:#03543f;background:#def7ec;border-radius:6px;padding:5px 8px;margin-top:6px">✓ ' + ttl + ' passed · ' + ev.total + '/' + ev.max + '</div>';
            } else {
              evalHtml += '<div style="font-size:11px;color:#9b1c1c;background:#fde8e8;border-radius:6px;padding:5px 8px;margin-top:6px">⏳ ' + ttl + ' submitted · ' + ev.total + '/' + ev.max + ' — held for HR review</div>';
            }
          });
          var dueBtn = due
            ? '<button type="button" class="trial-eval-open eval-neon-do" data-id="' + esc(c._id) + '" data-which="' + due + '" ' +
                'style="margin-top:8px;width:100%;padding:11px;white-space:normal">' +
                '📋 ' + (due === "mid" ? "Week 1" : "Final") + ' evaluation due — complete now</button>'
            : "";

          var needsMark = isTrialDayToday && (c.status === "trial_w1" || c.status === "trial_w2") && !(currentStatus === "on" || currentStatus === "late" || currentStatus === "absent");
          var borderColor = needsMark ? "#f59e0b" : "#FBCFE8";

          return '<div class="dly-row" style="display:flex;flex-direction:column;gap:8px;padding:10px 14px;background:#fff;border:1px solid ' + borderColor + ';border-radius:12px;margin-bottom:8px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<div>' +
                '<div style="font-weight:700;color:#BE185D;font-size:14px">' + esc(c.name || "(no name)") +
                  ' <span class="pill" style="background:#ede9fe;color:#6b21a8">🧪 ' + esc(STAGE_LABEL[c.status] || c.status) + '</span>' +
                  (needsMark ? ' <span class="pill" style="background:#fef3c7;color:#92400e">needs check-in</span>' : '') +
                '</div>' +
                '<div style="font-size:11px;color:var(--gray-500);margin-top:2px">' +
                  'Trial days worked: ' + workedDays + '/10' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              buttonsHtml +
            '</div>' +
            evalHtml +
            dueBtn +
          '</div>';
        }).join("");
    }

    listEl.innerHTML = scheduled.map(function (r) {
      var s         = r.staff;
      var current   = r.current;
      // hasStatus drives the green ✓ — only TRUE when the manager has
      // explicitly clicked one of the seven status buttons. Placement
      // markers (swap_i / swap_o / ext) DON'T earn the tick on their own.
      var hasStatus = isTagged(current);
      var schedSt   = r.schedStatus;
      var isExtraDay = hasExtraDayFor(s.employee_code);
      // Indicate WHY this person is in the roster: scheduled, or here via
      // swap, or marked Extra Day. The Extra Day tag is derived from the
      // sidecar so it stays visible even after the manager tags On Time /
      // Late on top.
      var rosterTag = "";
      if (schedSt === "WL")                       rosterTag = '<span class="row-tag row-tag-warn">WL · work late</span>';
      else if (schedSt === "WE")                  rosterTag = '<span class="row-tag row-tag-info">WE · work early</span>';
      else if (schedSt === "E")                   rosterTag = '<span class="row-tag row-tag-info">E · extra cover</span>';
      else if (isExtraDay)                        rosterTag = '<span class="row-tag row-tag-info">Extra cover</span>';
      else if (!schedSt && current === "swap_i")  rosterTag = '<span class="row-tag row-tag-swap">Covering (swap-in)</span>';
      else if (!schedSt && current === "swap_o")  rosterTag = '<span class="row-tag row-tag-swap">Off (swap-out)</span>';

      // Swap targets: ONLY staff who are off today (O or R). Two scheduled
      // staff cannot swap with each other — both are needed.
      var swapOff = offToday.map(function (other) {
        var st = grid[other.employee_code] && grid[other.employee_code][dayKey];
        var lbl = other.name + " — off today (" + st + ")";
        return '<option value="off:' + esc(other.employee_code) + '">' + esc(lbl) + '</option>';
      });
      var swapPlaceholder = swapOff.length === 0
        ? '<option value="" disabled>No off-today staff available to swap</option>'
        : '<option value="">⇄ Swap with off-today staff…</option>';

      // Build a footnote line under the name+code if this row is part of a
      // swap, or has an Extra-Day approver attached.
      var swapInfo = findSwapInfoFor(s.employee_code);
      var noteLine = "";
      if (swapInfo) {
        var dateTxt = formatChipDate(swapInfo.otherDate);
        if (swapInfo.role === "cover") {
          noteLine = swapInfo.isBack
            ? '↩ Working in return for <strong>' + esc(swapInfo.partner) + '</strong> · original swap ' + esc(dateTxt)
            : '↪ Covering <strong>' + esc(swapInfo.partner) + '</strong> · returns ' + esc(dateTxt);
        } else { // off
          noteLine = swapInfo.isBack
            ? '↩ Off, paid back by <strong>' + esc(swapInfo.partner) + '</strong> · original swap ' + esc(dateTxt)
            : '↪ Off — <strong>' + esc(swapInfo.partner) + '</strong> covering · returns ' + esc(dateTxt);
        }
      } else if (isExtraDay) {
        var who = approverFor(s.employee_code);
        noteLine = who
          ? '＋ Extra Day · approved by <strong>' + esc(who) + '</strong>'
          : '＋ Extra Day';
      } else if (current === "absent") {
        var why = absenceReasonFor(s.employee_code);
        if (why) noteLine = '🚫 Absent · reason: <strong>' + esc(why) + '</strong> · counts as unpaid';
        else     noteLine = '🚫 Absent · counts as unpaid';
      }

      // Early-leave note line (appended below any other note). HR portal
      // deducts these hours from the tech's day total.
      var earlyRec = earlyLeaveFor(s.employee_code);
      if (earlyRec && earlyRec.hours) {
        var earlyHtml = '🏃 Left <strong>' + earlyRec.hours + 'h</strong> early · counts as deduction' +
          (earlyRec.recordedBy ? ' · recorded by <strong>' + esc(earlyRec.recordedBy) + '</strong>' : '');
        noteLine = noteLine ? (noteLine + '<br>' + earlyHtml) : earlyHtml;
      }

      // After signoff (or when viewing a past day) the day is locked. Status
      // buttons go disabled and we surface a single "Upload proof" path for
      // the two allowed transitions:
      //   sick   → sick+note  (proof: doctor's note)
      //   absent → sick+note  OR  FRL+proof
      // Everything else is read-only.
      var actionsHtml;
      if (isLocked) {
        var locked = statusButtons.map(function (b) {
          return '<button type="button" disabled class="dly-act dly-act-' + b.code +
                 (current === b.code ? ' dly-act-active' : '') +
                 '" style="opacity:0.45;cursor:not-allowed" data-status="' + b.code + '">' + b.label + '</button>';
        }).join("");
        var convert = "";
        if (current === "sick") {
          convert =
            '<button type="button" class="dly-act dly-act-convert" data-convert="sick_n" ' +
            'style="background:#fef3c7;color:#78350f;border:1px solid #fbbf24" ' +
            'title="Tech brought a doctor\'s note — upload it to upgrade Sick → Sick + note">' +
            '📎 Add sick note → Sick + note</button>';
        } else if (current === "absent") {
          convert =
            '<button type="button" class="dly-act dly-act-convert" data-convert="sick_n" ' +
            'style="background:#fef3c7;color:#78350f;border:1px solid #fbbf24" ' +
            'title="Tech provided a doctor\'s note — upgrade Absent → Sick + note">' +
            '📎 Add sick note → Sick + note</button>' +
            '<button type="button" class="dly-act dly-act-convert" data-convert="frl" ' +
            'style="background:#dbeafe;color:#1e3a8a;border:1px solid #93c5fd" ' +
            'title="Tech provided FRL proof — upgrade Absent → FRL + proof">' +
            '📎 Add FRL proof → FRL + proof</button>';
        }
        actionsHtml = locked + (convert ? '<div class="dly-convert-row" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' + convert + '</div>' : '');
      } else {
        actionsHtml = statusButtons.map(function (b) {
          return '<button type="button" class="dly-act dly-act-' + b.code + (current === b.code ? ' dly-act-active' : '') + '" data-status="' + b.code + '">' + b.label + '</button>';
        }).join("");
      }

      // "Left early" sub-row — runs on its own gate, independent of isLocked:
      // editable today until 20:00 even after the day's been signed off, so
      // a tech leaving at 17:30 can be recorded after the daily sign-off at,
      // say, 18:00. After 20:00 (or on any other day), the row just shows
      // the note above without any edit buttons.
      if (isEarlyEditAllowed) {
        var earlyBtnLabel = earlyRec && earlyRec.hours
          ? '🏃 Left ' + earlyRec.hours + 'h early · change'
          : '🏃 Mark left early';
        actionsHtml +=
          '<div class="dly-early-row" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
            '<button type="button" class="dly-act dly-act-early" data-ec="' + esc(s.employee_code) + '" data-name="' + esc(s.name) + '" ' +
              'style="background:#FFEDD5;color:#9A3412;border:1px solid #FB923C;font-weight:700">' +
              earlyBtnLabel +
            '</button>' +
            (earlyRec && earlyRec.hours
              ? '<button type="button" class="dly-act dly-act-early-clear" data-ec="' + esc(s.employee_code) + '" data-name="' + esc(s.name) + '" ' +
                  'style="background:#fff;color:#9A3412;border:1px solid #FB923C">' +
                  '✕ Clear early' +
                '</button>'
              : '') +
          '</div>';
      }

      // Swap area: if the row is already part of a swap AND the day is not
      // locked, show an "Undo swap" button instead of the swap dropdown.
      // Once the day is signed off, the undo disappears (locked state).
      var swapAreaHtml;
      if (!isLocked && swapInfo) {
        swapAreaHtml =
          '<button type="button" class="dly-undo-swap" data-swap-id="' + esc(swapInfo.id) + '" ' +
            'title="Undo this swap — both dates will be reverted (only allowed before the day is signed off)" ' +
            'style="padding:8px 12px;border-radius:9px;border:1px solid #FBCFE8;background:#fff;color:#831843;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">' +
            '↺ Undo swap' +
          '</button>';
      } else {
        swapAreaHtml =
          '<select class="dly-swap" data-ec="' + esc(s.employee_code) + '" data-name="' + esc(s.name) + '"' +
            ((swapOff.length === 0 || isLocked) ? ' disabled' : '') + '>' +
            swapPlaceholder +
            swapOff.join("") +
          '</select>';
      }

      // Loaned-out staff stay on the home roster so the manager can see at
      // a glance where they are - but they don't need a status; clockin is
      // recorded by the receiving branch's kiosk. Lock the row, replace the
      // status actions with a friendly note, and chip the destination.
      var loanedOut = !!s._loanedOut;
      var loanedOutChip = loanedOut
        ? ' <span class="dly-loaned-chip" title="Working at ' + esc(s._awayAt || "") + ' today">→ ' + esc(s._awayAt || "") + '</span>'
        : '';
      var rowActionsHtml = loanedOut
        ? '<div class="dly-loaned-note">Working at ' + esc(s._awayAt || "") + ' today · no action needed</div>'
        : actionsHtml;
      var rowSwapHtml = loanedOut ? '' : swapAreaHtml;
      return '<div class="dly-row' + (hasStatus ? ' dly-confirmed' : '') + ((isLocked || loanedOut) ? ' dly-locked' : '') + (loanedOut ? ' dly-row-loaned' : '') + '" data-ec="' + esc(s.employee_code) + '" data-id="' + s.id + '" data-name="' + esc(s.name) + '" data-start="' + esc(s.start_date || s.startDate || "") + '">' +
        '<div class="dly-row-info">' +
          '<div class="dly-checkmark">' + (loanedOut ? '→' : (hasStatus ? '✓' : '')) + '</div>' +
          '<div class="dly-row-text">' +
            '<div class="dly-name">' + esc(s.name) +
              (s._guest ? ' <span class="dly-guest-chip" title="Loaned in from ' + esc(s._homeBranch || "") + '">← ' + esc(s._homeBranch || "") + '</span>' : '') +
              loanedOutChip +
            '</div>' +
            '<div class="dly-code">' + esc(s.employee_code) + (rosterTag ? ' · ' + rosterTag : '') + '</div>' +
            (noteLine ? '<div class="dly-note">' + noteLine + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="dly-actions">' + rowActionsHtml + '</div>' +
        rowSwapHtml +
      '</div>';
    }).join("") + trialHtml;

    // Optimistic UI helpers — paint the row immediately on click so the
    // manager doesn't wait for the round-trip before seeing feedback.
    // If the save then fails, we alert + re-render so the canonical
    // server state takes over.
    function paintRowStatus(row, status) {
      // Re-style status buttons in this row to reflect the new active code.
      var acts = row.querySelectorAll(".dly-act");
      Array.prototype.forEach.call(acts, function (b) {
        if (b.dataset.convert) return; // post-signoff convert buttons untouched
        if (status && b.dataset.status === status) b.classList.add("dly-act-active");
        else                                       b.classList.remove("dly-act-active");
      });
      // Checkmark + confirmed class follow whether ANY status is set.
      var cm = row.querySelector(".dly-checkmark");
      if (cm) cm.textContent = status ? "✓" : "";
      if (status) row.classList.add("dly-confirmed");
      else        row.classList.remove("dly-confirmed");
    }
    function setRowSaving(row, saving) {
      var acts = row.querySelectorAll(".dly-act, .dly-swap");
      Array.prototype.forEach.call(acts, function (el) { el.disabled = !!saving; });
      row.classList.toggle("dly-saving", !!saving);
    }

    // Wire status buttons (toggle off if same code clicked again).
    // For sick_n and frl, intercept and open the proof-upload modal first.
    // For absent, prompt for a reason. After signoff the disabled buttons
    // are skipped (browser blocks the click) and the dedicated `data-convert`
    // buttons take over for the two allowed transitions.
    Array.prototype.forEach.call(listEl.querySelectorAll(".trial-act"), function (btn) {
      btn.onclick = async function () {
        if (btn.disabled) return;
        var candidateId = btn.dataset.id;
        var status = btn.dataset.status;
        
        var row = btn.closest(".dly-row");
        var acts = row.querySelectorAll(".trial-act");
        Array.prototype.forEach.call(acts, function (el) { el.disabled = true; });
        
        try {
          await window.APP_DATA.recordTrialCheckin(candidateId, status);
          await renderDay();
        } catch (e) {
          alert("Could not record check-in: " + (e.message || e));
          Array.prototype.forEach.call(acts, function (el) { el.disabled = false; });
        }
      };
    });

    // Wire the "evaluation due" buttons — open the full evaluation form.
    Array.prototype.forEach.call(listEl.querySelectorAll(".trial-eval-open"), function (btn) {
      btn.onclick = function () {
        var c = myTrialCand.find(function (x) { return String(x._id) === String(btn.dataset.id); });
        if (c) openTrialEvalModal(c, btn.dataset.which);
      };
    });

    Array.prototype.forEach.call(listEl.querySelectorAll(".dly-act"), function (btn) {
      btn.onclick = async function () {
        if (btn.disabled) return;

        var row    = btn.closest(".dly-row");
        var ec     = row.dataset.ec;
        var name   = row.dataset.name;
        var cur    = attGrid[ec] && attGrid[ec][dayKey];

        // Post-signoff conversion path: only sick→sick_n and absent→sick_n/frl
        // are reachable, and they must go through the proof modal.
        if (btn.dataset.convert) {
          var target = btn.dataset.convert;
          if (isLocked && cur !== "sick" && cur !== "absent") return;
          // FRL balance gate — block paid FRL with no days left; use Unpaid.
          if (target === "frl" && window.APP_DATA.frlMarkGuard) {
            var gC = await window.APP_DATA.frlMarkGuard(ec, row.dataset.start, ym, dayKey);
            if (gC && gC.block) { alert("⚠ " + name + "\n\n" + gC.message); return; }
          }
          openProofModal({
            status:    target,
            label:     target === "sick_n" ? "Sick + note" : "FRL + proof",
            staffEc:   ec,
            staffName: name,
            ym:        ym,
            dayKey:    dayKey,
            requireProof: true,    // no "Save without proof" fallback after signoff
            onSaved:   async function () {
              // If converting from absent, drop the absence reason metadata —
              // it's now superseded by the paid leave classification.
              if (cur === "absent") {
                try { await window.APP_DATA.clearAbsence(ym, dayKey, ec); } catch (_e) {}
              }
              await renderDay();
            }
          });
          return;
        }

        var status = btn.dataset.status;

        // Toggle off if same code (clears any sidecar absence metadata too)
        if (cur === status) {
          // Optimistic: clear visually first, lock the row, then save.
          paintRowStatus(row, null);
          setRowSaving(row, true);
          try {
            await window.APP_DATA.setAttendanceStatus(ym, dayKey, ec, null);
            if (status === "absent") { try { await window.APP_DATA.clearAbsence(ym, dayKey, ec); } catch (_e) {} }
            await renderDay();
          } catch (e) {
            alert("Could not save: " + (e.message || e));
            await renderDay(); // resync — the optimistic paint may now be wrong
          }
          return;
        }

        // Sick + note OR FRL → require proof (or downgrade to unpaid)
        if (status === "sick_n" || status === "frl") {
          // FRL balance gate — block paid FRL with no days left; use Unpaid.
          if (status === "frl" && window.APP_DATA.frlMarkGuard) {
            var gF = await window.APP_DATA.frlMarkGuard(ec, row.dataset.start, ym, dayKey);
            if (gF && gF.block) { alert("⚠ " + name + "\n\n" + gF.message); return; }
          }
          openProofModal({
            status:   status,
            label:    status === "sick_n" ? "Sick + note" : "FRL + proof",
            staffEc:  ec,
            staffName: name,
            ym:       ym,
            dayKey:   dayKey,
            onSaved:  renderDay
          });
          return;
        }

        // Absent → require a reason (≥2 chars). Without a reason the manager
        // should be using NO SHOW instead.
        if (status === "absent") {
          var reason = window.prompt(
            "Mark " + name + " as Absent\n\n" +
            "Absent days count as UNPAID and always require an explanation.\n" +
            "If there's no communication from " + name + ", click NO SHOW instead.\n\n" +
            "If proof (sick note / FRL letter) arrives later, you'll be able to\n" +
            "upgrade this from the locked day to Sick + note or FRL + proof.\n\n" +
            "Why is " + name + " absent today?"
          );
          if (reason === null) return;
          reason = String(reason).trim();
          if (reason.length < 2) {
            alert("A reason is required to mark someone Absent.\nIf there's no communication, click NO SHOW.");
            return;
          }
          try {
            await window.APP_DATA.recordAbsence(ym, dayKey, ec, reason);
            await renderDay();
          } catch (e) { alert("Could not save: " + (e.message || e)); }
          return;
        }

        // Default path — fast statuses (on / late / sick / no). We paint
        // the row immediately so the click feels instant, then save in
        // the background. If the save fails we re-render to resync from
        // the server.
        paintRowStatus(row, status);
        setRowSaving(row, true);
        try {
          await window.APP_DATA.setAttendanceStatus(ym, dayKey, ec, status);
          await renderDay();
        } catch (e) {
          alert("Could not save: " + (e.message || e));
          await renderDay(); // resync — the optimistic paint may now be wrong
        }
      };
    });

    // Wire swap selects — every swap goes through the modal (which captures
    // the required swap-back date inside the same payroll cycle).
    Array.prototype.forEach.call(listEl.querySelectorAll(".dly-swap"), function (sel) {
      sel.onchange = function () {
        var v = sel.value;
        if (!v || v.indexOf("off:") !== 0) return;
        var oweEc     = sel.dataset.ec;
        var oweName   = sel.dataset.name;
        var coverEc   = v.slice(4);
        var coverObj  = offToday.find(function (o) { return o.employee_code === coverEc; });
        var coverName = (coverObj && coverObj.name) || coverEc;
        openSwapModal({
          currentDate: date, ym: ym, dayKey: dayKey,
          oweEc: oweEc, oweName: oweName, coverEc: coverEc, coverName: coverName,
          schedGrid: grid,
          onDone: renderDay
        });
        sel.value = "";
      };
    });

    // Wire "🏃 Mark left early" buttons. Opens a small modal to capture the
    // number of hours, then writes to the boa_early_<branch>_<ym> sidecar
    // for the HR portal to deduct. Only present on un-locked days.
    Array.prototype.forEach.call(listEl.querySelectorAll(".dly-act-early"), function (btn) {
      btn.onclick = function () {
        var ec       = btn.dataset.ec;
        var nm       = btn.dataset.name;
        var existing = earlyLeaveFor(ec);
        openEarlyLeaveModal({
          staffName: nm,
          staffEc:   ec,
          prevHours: existing ? existing.hours : null,
          prevBy:    existing ? existing.recordedBy : "",
          onSave: async function (hours, by) {
            try {
              await window.APP_DATA.recordEarlyLeave(ym, dayKey, ec, hours, by);
              await renderDay();
            } catch (e) {
              alert("Could not save early leave: " + (e.message || e));
            }
          }
        });
      };
    });

    // Wire "✕ Clear early" — removes the early-leave record for this row.
    Array.prototype.forEach.call(listEl.querySelectorAll(".dly-act-early-clear"), function (btn) {
      btn.onclick = async function () {
        var ec = btn.dataset.ec;
        var nm = btn.dataset.name;
        if (!window.confirm("Remove the early-leave record for " + nm + "?")) return;
        btn.disabled = true;
        try {
          await window.APP_DATA.clearEarlyLeave(ym, dayKey, ec);
          await renderDay();
        } catch (e) {
          alert("Could not clear: " + (e.message || e));
          btn.disabled = false;
        }
      };
    });

    // Wire "↺ Undo swap" buttons. Only present on non-locked days for rows
    // that are part of a swap. The data layer refuses if either touched
    // day was signed off in the meantime.
    Array.prototype.forEach.call(listEl.querySelectorAll(".dly-undo-swap"), function (btn) {
      btn.onclick = async function () {
        var swapId = btn.dataset.swapId;
        var swap = null;
        for (var i = 0; i < swaps.length; i++) {
          if (swaps[i] && swaps[i].id === swapId) { swap = swaps[i]; break; }
        }
        if (!swap) {
          alert("Swap not found — the list may be out of date. Refreshing.");
          await renderDay();
          return;
        }
        var ok = window.confirm(
          "Undo this swap?\n\n" +
          (swap.oweName || swap.oweEc)  + " — off " + formatChipDate(swap.dateA) + "\n" +
          (swap.coverName || swap.coverEc) + " — covering " + formatChipDate(swap.dateA) +
          ", paying it back on " + formatChipDate(swap.dateB) + "\n\n" +
          "Both dates' swap entries will be cleared. " +
          "This can only be done before either day is signed off."
        );
        if (!ok) return;
        var originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = "Undoing…";
        try {
          await window.APP_DATA.undoSwap(ym, swapId);
          await renderDay();
        } catch (e) {
          alert("Could not undo swap: " + (e.message || e));
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      };
    });

    // ---------------- Off-today section (greyed) ----------------
    var offEl = document.getElementById("dly-off-section");
    if (!offEl) {
      offEl = document.createElement("div");
      offEl.id = "dly-off-section";
      listEl.parentNode.insertBefore(offEl, listEl.nextSibling);
    }
    if (offTodayAll.length === 0) {
      offEl.innerHTML = "";
    } else {
      var offHtml =
        '<div class="dly-section-head dly-section-head-off">🌿 Off today · ' + offTodayAll.length + ' staff</div>' +
        '<div class="dly-list dly-list-off">' +
          offTodayAll.map(function (s) {
            var st = grid[s.employee_code] && grid[s.employee_code][dayKey];
            var canAct = (st === "O" || st === "R");
            var stLbl = ({O:"Off", R:"Requested off", L:"Leave", X:"Pre-start"})[st] || st;
            // Build swap target list (the scheduled-to-work people on this day)
            var swapTargets = scheduled
              .filter(function (r) { return r.staff.id !== s.id; })
              .map(function (r) { return '<option value="off-row:' + esc(r.staff.employee_code) + '">' + esc(r.staff.name) + '</option>'; });
            var swapPh = swapTargets.length === 0
              ? '<option value="" disabled>No scheduled staff to swap with</option>'
              : '<option value="">⇄ Cover for…</option>';

            // After signoff (or when viewing a past day) the off-today
            // section is read-only too: no Mark-Extra-Day, no swaps. Off
            // staff who'd otherwise be actionable just show a lock label.
            var actionHtml = isLocked
              ? '<span class="dly-no-action">🔒 ' + (alreadySigned ? 'Day signed off' : 'Past day · view only') + '</span>'
              : (canAct
                  ? '<button type="button" class="dly-act dly-act-extra" data-action="extra">＋ Mark Extra Day</button>'
                  : '<span class="dly-no-action">No action</span>');
            var swapHtml = (isLocked || !canAct)
              ? '<span></span>'
              : '<select class="dly-swap dly-swap-off" data-ec="' + esc(s.employee_code) + '" data-name="' + esc(s.name) + '"' +
                  (swapTargets.length === 0 ? ' disabled' : '') + '>' +
                  swapPh + swapTargets.join("") +
                '</select>';

            return '<div class="dly-row dly-row-off" data-ec="' + esc(s.employee_code) + '" data-id="' + s.id + '" data-name="' + esc(s.name) + '">' +
              '<div class="dly-row-info">' +
                '<div class="dly-checkmark dly-checkmark-off">·</div>' +
                '<div class="dly-row-text">' +
                  '<div class="dly-name">' + esc(s.name) + '</div>' +
                  '<div class="dly-code">' + esc(s.employee_code) + ' · <span class="row-tag row-tag-off">' + esc(st) + ' · ' + esc(stLbl) + '</span></div>' +
                '</div>' +
              '</div>' +
              '<div class="dly-actions">' + actionHtml + '</div>' +
              swapHtml +
            '</div>';
          }).join("") +
        '</div>';
      offEl.innerHTML = offHtml;

      // Wire "Mark Extra Day" buttons.
      // Extra days pay at a higher rate, so the company requires written
      // approval from a higher manager. We capture that name and store it
      // alongside the attendance.
      Array.prototype.forEach.call(offEl.querySelectorAll('.dly-act-extra'), function (btn) {
        btn.onclick = async function () {
          var row  = btn.closest(".dly-row");
          var ec   = row.dataset.ec;
          var name = row.dataset.name;

          var approver = window.prompt(
            "Mark " + name + " as Extra Day\n\n" +
            "Extra days are paid at a higher rate. The company requires sign-off " +
            "by a higher manager before paying for unscheduled cover.\n\n" +
            "Which higher manager approved this?\n" +
            "(Type their full name to record the approval.)"
          );
          if (approver === null) return;                  // cancelled
          approver = String(approver).trim();
          if (approver.length < 2) {
            window.alert("Approver name is required to mark an Extra Day.");
            return;
          }
          try {
            await window.APP_DATA.recordExtraDay(ym, dayKey, ec, approver);
            await renderDay();
          } catch (e) { window.alert("Could not save: " + ((e && e.message) || e)); }
        };
      });

      // Wire swap dropdowns from off-rows: this row's person becomes the
      // cover (working today), the picked scheduled person becomes the owe
      // (taking today off).
      Array.prototype.forEach.call(offEl.querySelectorAll('.dly-swap-off'), function (sel) {
        sel.onchange = function () {
          var v = sel.value;
          if (!v || v.indexOf("off-row:") !== 0) return;
          var oweEc   = v.slice("off-row:".length);
          var coverEc = sel.dataset.ec;
          var coverName = sel.dataset.name;
          var oweRow = scheduled.find(function (r) { return r.staff.employee_code === oweEc; });
          var oweName = oweRow ? oweRow.staff.name : oweEc;
          openSwapModal({
            currentDate: date, ym: ym, dayKey: dayKey,
            oweEc: oweEc, oweName: oweName, coverEc: coverEc, coverName: coverName,
            schedGrid: grid,
            onDone: renderDay
          });
          sel.value = "";
        };
      });
    }

    // ---------------- Maternity & Annual leave sections (read-only) ----------------
    // These staff are excluded from the daily roster entirely. They render
    // in their own greyed sections below so the manager can confirm who's
    // away without being able to mark them on/late/sick/etc.
    var awayEl = document.getElementById("dly-away-section");
    if (!awayEl) {
      awayEl = document.createElement("div");
      awayEl.id = "dly-away-section";
      listEl.parentNode.insertBefore(awayEl, listEl.nextSibling.nextSibling || null);
    }
    var awayHtml = "";
    if (staffOnMat.length > 0) {
      awayHtml +=
        '<div class="dly-section-head dly-section-head-off">🍼 Staff on maternity leave · ' + staffOnMat.length + '</div>' +
        '<div class="dly-list dly-list-off">' +
          staffOnMat.map(function (m) {
            var s = m.staff, rec = m.record || {};
            var until = rec.return_date || rec.mat_end;
            var untilTxt = until ? ' · returns ' + esc(formatChipDate(until)) : '';
            return '<div class="dly-row dly-row-off">' +
              '<div class="dly-row-info">' +
                '<div class="dly-checkmark dly-checkmark-off">·</div>' +
                '<div class="dly-row-text">' +
                  '<div class="dly-name">' + esc(s.name) + '</div>' +
                  '<div class="dly-code">' + esc(s.employee_code || "") +
                    ' · <span class="row-tag row-tag-off">🍼 Maternity</span>' + untilTxt +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="dly-actions"><span class="dly-no-action">No action</span></div>' +
              '<span></span>' +
            '</div>';
          }).join("") +
        '</div>';
    }
    if (staffOnLeave.length > 0) {
      awayHtml +=
        '<div class="dly-section-head dly-section-head-off">🌴 Staff on annual leave · ' + staffOnLeave.length + '</div>' +
        '<div class="dly-list dly-list-off">' +
          staffOnLeave.map(function (l) {
            var s = l.staff, rec = l.record || {};
            var range = "";
            if (rec.startDate && rec.endDate) range = ' · ' + esc(formatChipDate(rec.startDate)) + ' → ' + esc(formatChipDate(rec.endDate));
            else if (rec.endDate)             range = ' · until ' + esc(formatChipDate(rec.endDate));
            return '<div class="dly-row dly-row-off">' +
              '<div class="dly-row-info">' +
                '<div class="dly-checkmark dly-checkmark-off">·</div>' +
                '<div class="dly-row-text">' +
                  '<div class="dly-name">' + esc(s.name) + '</div>' +
                  '<div class="dly-code">' + esc(s.employee_code || "") +
                    ' · <span class="row-tag row-tag-off">🌴 Annual leave</span>' + range +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="dly-actions"><span class="dly-no-action">No action</span></div>' +
              '<span></span>' +
            '</div>';
          }).join("") +
        '</div>';
    }
    // Staff who left mid-month: kept on the manager kiosk roster (greyed,
    // at the very bottom) until the calendar rolls into the next month so
    // the manager can still see who used to be there. No action buttons —
    // their check-in days ended on left_date. The data layer drops them
    // automatically once a new month starts.
    if (staffLeft.length > 0) {
      awayHtml +=
        '<div class="dly-section-head dly-section-head-off dly-section-head-left">👋 Left the company · ' + staffLeft.length + '</div>' +
        '<div class="dly-list dly-list-off dly-list-left">' +
          staffLeft.map(function (s) {
            var leftTxt = s._leftDate ? ' · left ' + esc(formatChipDate(s._leftDate)) : '';
            return '<div class="dly-row dly-row-off dly-row-left">' +
              '<div class="dly-row-info">' +
                '<div class="dly-checkmark dly-checkmark-off">·</div>' +
                '<div class="dly-row-text">' +
                  '<div class="dly-name">' + esc(s.name) + '</div>' +
                  '<div class="dly-code">' + esc(s.employee_code || "") +
                    ' · <span class="row-tag row-tag-off">👋 Left company</span>' + leftTxt +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="dly-actions"><span class="dly-no-action">No action</span></div>' +
              '<span></span>' +
            '</div>';
          }).join("") +
        '</div>';
    }
    awayEl.innerHTML = awayHtml;

    // ---------------- Sign-off section ----------------
    var signoffEl = document.getElementById("dly-signoff");
    if (!signoffEl) {
      signoffEl = document.createElement("div");
      signoffEl.id = "dly-signoff";
      signoffEl.className = "dly-signoff";
      // place after the list
      listEl.parentNode.appendChild(signoffEl);
    }
    // Submittable once every PRESENT tech has a status. total>0 is the normal
    // case; loanedOutCount>0 covers a day where every scheduled tech was
    // loaned out (nothing to tag at home, but the day should still close).
    var allConfirmed = (confirmed === total) && (total > 0 || loanedOutCount > 0);

    if (alreadySigned) {
      // Day is locked. No "Re-edit" — only the per-row proof-conversion
      // buttons (sick → sick+note, absent → sick+note / FRL+proof) can change
      // a status from here on.
      signoffEl.innerHTML =
        '<div class="dly-signed">' +
          '<div class="dly-signed-head">🔒 Day signed off — attendance locked</div>' +
          '<div class="dly-signed-body">By <strong>' + esc(dailyRec.signedBy) + '</strong>' +
            (dailyRec.signedRole ? ' (' + esc(dailyRec.signedRole) + ')' : '') +
            ' at ' + esc(fmtTime(dailyRec.signedAt)) +
            ' · ' + esc(String(dailyRec.staffCount)) + ' staff' +
          '</div>' +
          '<div class="dly-signed-body" style="margin-top:8px;font-size:12px;line-height:1.5;color:#7f1d1d">' +
            'Statuses can no longer be changed. The only allowed updates are:<br>' +
            '· <strong>Sick NO note → Sick + note</strong> if a doctor\'s note arrives later<br>' +
            '· <strong>Absent → Sick + note / FRL + proof</strong> if proof arrives later<br>' +
            'Use the 📎 buttons on each row to upload the proof.' +
          '</div>' +
        '</div>';
    } else if (isPast) {
      // Past day, never signed off: no signoff form (you can't sign off a
      // day you weren't there for), no status edits. Notes/proof can still
      // be attached via the per-row 📎 buttons.
      signoffEl.innerHTML =
        '<div class="dly-signed">' +
          '<div class="dly-signed-head">🔒 Past day — view only</div>' +
          '<div class="dly-signed-body" style="font-size:12px;line-height:1.5;color:#7f1d1d">' +
            'You\'re looking at a previous day. Statuses can no longer be changed. ' +
            'The only updates still allowed are:<br>' +
            '· <strong>Sick NO note → Sick + note</strong> if a doctor\'s note arrives later<br>' +
            '· <strong>Absent → Sick + note / FRL + proof</strong> if proof arrives later<br>' +
            'Use the 📎 buttons on each row to upload the proof.' +
          '</div>' +
        '</div>';
    } else {
      renderSignoffForm();
    }

    function renderSignoffForm() {
      signoffEl.innerHTML =
        '<div class="dly-signoff-head">📝 Confirm and sign off</div>' +
        '<div class="dly-signoff-info">' +
          (allConfirmed
            ? (total === 0
                ? 'All techs are loaned out to other stores today. Sign off to finalise the day — totals on the HR portal\'s Attendance tab will update automatically.'
                : 'All ' + total + ' staff confirmed' + (loanedOutCount > 0 ? ' (' + loanedOutCount + ' loaned out)' : '') + '. Sign off to finalise the day — totals on the HR portal\'s Attendance tab will update automatically.')
            : '<strong>' + (total - confirmed) + ' staff still need a status above</strong> before you can sign off.') +
        '</div>' +
        '<div class="dly-signoff-form">' +
          '<input id="dly-signoff-name" class="input" type="text" placeholder="Manager full name" autocomplete="name">' +
          '<input id="dly-signoff-role" class="input" type="text" placeholder="Role (e.g. Store Manager)">' +
        '</div>' +
        '<button id="dly-signoff-submit" class="btn btn-primary" disabled>Confirm and submit attendance</button>' +
        '<div class="dly-signoff-msg" style="margin-top:8px;font-size:11px;color:#7f1d1d;line-height:1.4">' +
          '⚠ Once submitted, statuses are <strong>locked</strong>. The only later changes allowed are upgrading ' +
          'Sick (no note) → Sick + note, and Absent → Sick / FRL when proof arrives.' +
        '</div>' +
        '<div id="dly-signoff-msg" class="dly-signoff-msg"></div>';

      var nameEl = document.getElementById("dly-signoff-name");
      var roleEl = document.getElementById("dly-signoff-role");
      var subBtn = document.getElementById("dly-signoff-submit");
      function refreshDisabled() {
        var hasName = nameEl.value.trim().length >= 2;
        var hasRole = roleEl.value.trim().length >= 2;
        subBtn.disabled = !(allConfirmed && hasName && hasRole);
      }
      nameEl.addEventListener("input", refreshDisabled);
      roleEl.addEventListener("input", refreshDisabled);
      subBtn.onclick = async function () {
        // Final confirmation — make the lock crystal clear before we save.
        var ok = window.confirm(
          "Submit attendance for " +
          date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
          "?\n\n" +
          "After this, statuses are LOCKED. The only updates allowed afterwards are:\n" +
          "  • Sick NO note → Sick + note (if the tech brings a doctor's note later)\n" +
          "  • Absent → Sick + note / FRL + proof (if proof arrives later)\n\n" +
          "Everything else is final. Proceed?"
        );
        if (!ok) return;
        subBtn.disabled = true;
        try {
          // Submit a COMPLETE record: ensure every confirmed tech has a kiosk-log
          // entry (it's otherwise only written when a status is actively tapped),
          // so the HR portal's Check-ins tab + attendance tooltip match the day.
          try { await window.APP_DATA.backfillCheckinLog(ym, dayKey); } catch (_e) {}
          await window.APP_DATA.saveDailyRecord(date, nameEl.value, roleEl.value, total);
          await renderDay();
        } catch (e) {
          document.getElementById("dly-signoff-msg").textContent = "Could not save: " + (e.message || e);
          subBtn.disabled = false;
        }
      };
    }
  }

  // ---------------- Swap-back modal ----------------
  // Opened when the manager picks an off-today person from the swap dropdown.
  // Only offers dates where, per the current schedule:
  //   - the cover person is scheduled to work (W/WL/E), AND
  //   - the owe person is scheduled to be off (O/R)
  // ...within the current payroll period (before the next 25th).
  function findSwapBackCandidates(currentDate, oweEc, coverEc, schedGrid) {
    var start = new Date(currentDate.getTime());
    start.setDate(start.getDate() + 1);
    var end = window.APP_DATA.endOfSchedulePeriod(currentDate);
    // Swap-back must be a regular work day for the cover person — W or WL only.
    // E (Extra) days are paid at a higher rate and aren't used to balance swaps.
    var WORK_SWAPPABLE = { W: 1, WL: 1 };
    var OFF            = { O: 1, R: 1 };
    var out = [];
    for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      var dayKey  = String(d.getDate());
      var coverSt = schedGrid[coverEc] && schedGrid[coverEc][dayKey];
      var oweSt   = schedGrid[oweEc]   && schedGrid[oweEc][dayKey];
      if (WORK_SWAPPABLE[coverSt] && OFF[oweSt]) {
        out.push({
          iso:       window.APP_DATA.isoDate(d),
          dayLabel:  d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
          coverSt:   coverSt,
          oweSt:     oweSt
        });
      }
    }
    return out;
  }

  // ---------------- Proof-upload modal (sick_n / frl) ----------------
  // Without proof, the status is downgraded to "unpaid" — this is the
  // policy: paid sick/FRL requires a doctor's note or letter.
  // When opened post-signoff (opts.requireProof === true) the "Save without
  // proof" fallback is hidden — the only way to convert is by uploading proof.
  // ---------------- Early-leave modal ----------------
  // Asks the manager how many hours early the tech left. Writes through
  // the data layer's recordEarlyLeave, which appends to the kiosk audit log
  // so the HR portal can deduct those hours on the attendance grid.
  function openEarlyLeaveModal(opts) {
    var prev = document.getElementById("boa-early-modal");
    if (prev) prev.remove();

    var modal = document.createElement("div");
    modal.id = "boa-early-modal";
    modal.className = "boa-modal-backdrop";
    var prevHours = (opts.prevHours != null) ? String(opts.prevHours) : "";
    var prevBy    = opts.prevBy || "";
    modal.innerHTML =
      '<div class="boa-modal-card">' +
        '<h2 class="boa-modal-title">🏃 Left early — ' + esc(opts.staffName) + '</h2>' +
        '<p class="boa-modal-body">' +
          'How many hours early did ' + esc(opts.staffName) + ' leave? The HR portal will ' +
          'deduct these hours from their day total on the attendance grid.' +
        '</p>' +
        '<label class="lbl" style="margin-top:10px">Hours early (30-minute intervals)</label>' +
        '<input id="boa-early-hours" type="number" class="input" min="0.5" max="12" step="0.5" ' +
          'placeholder="e.g. 1.5" value="' + esc(prevHours) + '" autocomplete="off">' +
        '<label class="lbl" style="margin-top:10px">Recorded by (optional)</label>' +
        '<input id="boa-early-by" type="text" class="input" ' +
          'placeholder="Manager name" value="' + esc(prevBy) + '" autocomplete="off">' +
        '<div id="boa-early-err" class="err-line"></div>' +
        '<div class="btn-row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">' +
          '<button type="button" class="link-btn link-btn-dark" id="boa-early-cancel">Cancel</button>' +
          '<button type="button" class="btn btn-primary" id="boa-early-save">' +
            (prevHours ? 'Update' : 'Save') +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    var hoursEl  = document.getElementById("boa-early-hours");
    var byEl     = document.getElementById("boa-early-by");
    var errEl    = document.getElementById("boa-early-err");
    var saveBtn  = document.getElementById("boa-early-save");
    var cancelBtn= document.getElementById("boa-early-cancel");
    function close() { modal.remove(); }
    cancelBtn.onclick = close;
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    setTimeout(function () { try { hoursEl.focus(); hoursEl.select(); } catch (_e) {} }, 50);

    saveBtn.onclick = function () {
      errEl.textContent = "";
      var raw = (hoursEl.value || "").trim();
      var h   = Number(raw);
      if (!raw || !isFinite(h) || h <= 0) {
        errEl.textContent = "Enter a positive number of hours (e.g. 1.5).";
        return;
      }
      if (h > 12) {
        errEl.textContent = "12 hours is the max — please double-check the value.";
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      Promise.resolve(opts.onSave(h, byEl.value)).then(function () { close(); }).catch(function () {
        saveBtn.disabled = false; saveBtn.textContent = "Save";
      });
    };

    hoursEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") saveBtn.click();
    });
  }

  // ---------------- Trial evaluation modal ----------------
  // The manager scores the trial tech on the BOA evaluation form (26 criteria,
  // 1–5 each). On submit we compute the result and, if it passes (≥91/130 AND
  // every Key Indicator ≥3), auto-advance the tech to the next trial stage. A
  // below-pass score is saved and held for an HR decision — never auto-failed.
  // Either way the completed form lands on the candidate record for HR.
  function openTrialEvalModal(candidate, which) {
    var prev = document.getElementById("boa-eval-modal");
    if (prev) prev.remove();
    var isFinal = which === "final";
    var title = isFinal ? "Final evaluation" : "Week 1 evaluation";
    var role = String(candidate.role || "nt").toLowerCase();
    var form = evalFormForRole(role);   // role-aware sections / max / pass / keyMin
    var scores = {};

    function sectionHtml(sec) {
      var rows = sec.items.map(function (it) {
        var opts = [1, 2, 3, 4, 5].map(function (n) {
          return '<button type="button" class="eval-score" data-k="' + it.k + '" data-v="' + n + '" ' +
            'style="flex:1;min-width:34px;padding:8px 0;border-radius:7px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-weight:800;font-size:13px;cursor:pointer">' + n + '</button>';
        }).join("");
        // Each criterion carries a ⓘ button that reveals the form's own
        // description of what it means, so the manager scores consistently.
        return '<div style="padding:8px 0;border-top:1px solid #f3f4f6">' +
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">' +
            '<span style="font-size:12.5px;font-weight:700;color:#374151">' + esc(it.label) + '</span>' +
            (it.key ? '<span class="pill" style="background:#fef3c7;color:#92400e">Key · min ' + form.keyMin + '</span>' : '') +
            (it.desc ? '<button type="button" class="eval-info" data-k="' + it.k + '" title="Tap for what this means" style="display:inline-flex;align-items:center;gap:4px;border:1px solid #c4b5fd;background:#ede9fe;color:#6b21a8;border-radius:99px;padding:2px 9px 2px 6px;font-size:10px;font-weight:800;cursor:pointer;line-height:1.4;flex:0 0 auto">' +
              '<span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:99px;background:#6b21a8;color:#fff;font-size:9px;font-weight:900;line-height:1">i</span>Details</button>' : '') +
          '</div>' +
          (it.desc ? '<div class="eval-desc" data-desc="' + it.k + '" style="display:none;font-size:11.5px;color:#6b21a8;background:#f5f3ff;border:1px solid #ede9fe;border-radius:7px;padding:6px 9px;margin-bottom:7px;line-height:1.45">' + esc(it.desc) + '</div>' : '') +
          '<div style="display:flex;gap:5px" data-row="' + it.k + '">' + opts + '</div>' +
        '</div>';
      }).join("");
      return '<div style="margin-top:14px">' +
        '<div style="font-size:13px;font-weight:800;color:#6b21a8">' + esc(sec.title) + ' <span style="font-weight:600;color:#9ca3af">(' + sec.max + ' pts)</span></div>' +
        rows +
      '</div>';
    }

    var modal = document.createElement("div");
    modal.id = "boa-eval-modal";
    modal.className = "boa-modal-backdrop";
    modal.innerHTML =
      '<div class="boa-modal-card" style="max-width:560px;max-height:88vh;overflow-y:auto">' +
        '<h2 class="boa-modal-title">📋 ' + esc(title) + ' — ' + esc(candidate.name || "trial tech") + '</h2>' +
        '<p class="boa-modal-body">Score each criterion from 1 (poor) to 5 (excellent). A pass needs <strong>' + form.pass + '/' + form.max + '</strong> and at least <strong>' + form.keyMin + '/5 on every Key Indicator</strong>. This form is sent to HR either way.</p>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0 2px">' +
          '<button type="button" id="boa-eval-guide" style="border:1px solid #ddd6fe;background:#f5f3ff;color:#6b21a8;border-radius:8px;padding:6px 11px;font-size:11.5px;font-weight:800;cursor:pointer">ⓘ Show guidance for every point</button>' +
        '</div>' +
        '<div style="background:#f5f3ff;border:1px solid #ede9fe;border-radius:8px;padding:7px 10px;margin:6px 0 2px;font-size:11px;color:#6b21a8;line-height:1.5">' +
          '<strong>Scoring scale:</strong> 1 = well below standard · 2 = needs work · 3 = meets BOA standard (minimum for Key Indicators) · 4 = strong · 5 = excellent.' +
        '</div>' +
        form.sections.map(sectionHtml).join("") +
        '<label class="lbl" style="margin-top:14px">Evaluator name</label>' +
        '<input id="boa-eval-by" type="text" class="input" placeholder="Manager full name" autocomplete="name">' +
        '<label class="lbl" style="margin-top:10px">Notes (optional)</label>' +
        '<textarea id="boa-eval-notes" class="input" rows="2" placeholder="Anything HR should know"></textarea>' +
        '<div id="boa-eval-tally" style="margin-top:12px;font-size:13px;font-weight:800;color:#6b21a8">Total: 0 / ' + form.max + '</div>' +
        '<div id="boa-eval-err" class="err-line"></div>' +
        '<div class="btn-row" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:6px">' +
          '<button type="button" class="link-btn link-btn-dark" id="boa-eval-cancel">Cancel</button>' +
          '<button type="button" class="btn btn-primary" id="boa-eval-save">Submit evaluation</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    var byEl = document.getElementById("boa-eval-by");
    var notesEl = document.getElementById("boa-eval-notes");
    var tallyEl = document.getElementById("boa-eval-tally");
    var errEl = document.getElementById("boa-eval-err");
    var saveBtn = document.getElementById("boa-eval-save");
    var cancelBtn = document.getElementById("boa-eval-cancel");
    function close() { modal.remove(); }
    cancelBtn.onclick = close;
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

    function refreshTally() {
      var r = scoreTrialEval(scores, role);
      tallyEl.innerHTML = 'Total: ' + r.total + ' / ' + form.max +
        (r.complete ? (r.pass ? ' · <span style="color:#03543f">PASS ✓</span>' : ' · <span style="color:#9b1c1c">below pass — will hold for HR</span>') : ' · ' + 'score all criteria');
    }

    Array.prototype.forEach.call(modal.querySelectorAll(".eval-score"), function (b) {
      b.onclick = function () {
        var k = b.dataset.k, v = Number(b.dataset.v);
        scores[k] = v;
        Array.prototype.forEach.call(modal.querySelectorAll('[data-row="' + k + '"] .eval-score'), function (el) {
          var on = Number(el.dataset.v) === v;
          el.style.background = on ? "#7c3aed" : "#fff";
          el.style.color = on ? "#fff" : "#374151";
        });
        refreshTally();
      };
    });

    // Per-criterion ⓘ — reveal that point's description.
    Array.prototype.forEach.call(modal.querySelectorAll(".eval-info"), function (b) {
      b.onclick = function () {
        var d = modal.querySelector('.eval-desc[data-desc="' + b.dataset.k + '"]');
        if (!d) return;
        var show = (d.style.display === "none" || !d.style.display);
        d.style.display = show ? "block" : "none";
        // Reflect the open/closed state on the button so it's obviously a toggle.
        if (b.lastChild && b.lastChild.nodeType === 3) b.lastChild.textContent = show ? "Hide" : "Details";
        b.style.background = show ? "#6b21a8" : "#ede9fe";
        b.style.color = show ? "#fff" : "#6b21a8";
      };
    });
    // Global guidance toggle — show / hide every description at once.
    var guideBtn = document.getElementById("boa-eval-guide");
    var guideOn = false;
    guideBtn.onclick = function () {
      guideOn = !guideOn;
      Array.prototype.forEach.call(modal.querySelectorAll(".eval-desc"), function (d) { d.style.display = guideOn ? "block" : "none"; });
      guideBtn.textContent = guideOn ? "ⓘ Hide guidance" : "ⓘ Show guidance for every point";
    };

    saveBtn.onclick = async function () {
      errEl.textContent = "";
      var r = scoreTrialEval(scores, role);
      if (!r.complete) { errEl.textContent = "Please score every criterion (1–5) before submitting."; return; }
      if (!(byEl.value || "").trim()) { errEl.textContent = "Please enter the evaluator's name."; return; }
      var confirmMsg = r.pass
        ? candidate.name + " scored " + r.total + "/" + form.max + " — PASS.\n\nSubmit and advance them to the next stage?"
        : candidate.name + " scored " + r.total + "/" + form.max + (r.keyOk ? "" : " (a Key Indicator is below " + form.keyMin + ")") + " — below the pass mark.\n\nSubmit and send to HR to review? They will NOT be auto-failed.";
      if (!window.confirm(confirmMsg)) return;
      saveBtn.disabled = true; saveBtn.textContent = "Submitting…";
      var evalObj = {
        submittedAt: new Date().toISOString(),
        submittedBy: byEl.value.trim(),
        which: isFinal ? "final" : "mid",
        scores: scores,
        total: r.total, max: form.max,
        keyOk: r.keyOk, pass: r.pass,
        heldForHr: !r.pass,
        notes: (notesEl.value || "").trim()
      };
      // Auto-advance only on a pass: mid → Week 2, final → Passed. A fail keeps
      // the current status and is flagged for HR on their dashboard.
      var newStatus = null;
      if (r.pass) newStatus = isFinal ? "passed" : "trial_w2";
      try {
        await window.APP_DATA.saveTrialEvaluation(candidate._id, isFinal ? "finalEval" : "midEval", evalObj, newStatus);
        close();
        await renderDay();
      } catch (e) {
        saveBtn.disabled = false; saveBtn.textContent = "Submit evaluation";
        errEl.textContent = "Could not save: " + (e.message || e);
      }
    };
  }

  function openProofModal(opts) {
    var prev = document.getElementById("boa-proof-modal");
    if (prev) prev.remove();

    var hint = (opts.status === "sick_n")
      ? "Upload a doctor's note or sick certificate."
      : "Upload proof for family responsibility leave (e.g. school letter, hospital appointment, funeral notice).";

    var bodySub = opts.requireProof
      ? 'Proof is required to upgrade ' + esc(opts.staffName) + '\'s status. Cancel if you don\'t have it yet.'
      : 'Without proof, ' + esc(opts.staffName) + '\'s status will be saved as <strong>Unpaid</strong>.';

    var modal = document.createElement("div");
    modal.id = "boa-proof-modal";
    modal.className = "boa-modal-backdrop";
    modal.innerHTML =
      '<div class="boa-modal-card">' +
        '<h2 class="boa-modal-title">📎 Proof for ' + esc(opts.label) + '</h2>' +
        '<p class="boa-modal-body">' +
          esc(hint) + '<br>' +
          bodySub +
        '</p>' +
        '<input id="boa-proof-file" type="file" accept="image/*" capture="environment" class="input">' +
        '<div id="boa-proof-preview" style="margin-top:10px"></div>' +
        '<div id="boa-proof-err" class="err-line"></div>' +
        '<div class="btn-row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">' +
          '<button type="button" class="link-btn link-btn-dark" id="boa-proof-cancel">Cancel</button>' +
          '<div style="display:flex;gap:8px">' +
            (opts.requireProof
              ? ''
              : '<button type="button" class="link-btn link-btn-dark" id="boa-proof-skip">Save without proof (Unpaid)</button>') +
            '<button type="button" class="btn btn-primary" id="boa-proof-save" disabled>Save with proof</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    var fileEl    = document.getElementById("boa-proof-file");
    var saveBtn   = document.getElementById("boa-proof-save");
    var skipBtn   = document.getElementById("boa-proof-skip");
    var cancelBtn = document.getElementById("boa-proof-cancel");
    var errEl     = document.getElementById("boa-proof-err");
    var prevEl    = document.getElementById("boa-proof-preview");
    var compressedDataUrl = null;

    function close() { modal.remove(); }
    cancelBtn.onclick = close;
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

    fileEl.onchange = function () {
      errEl.textContent = "";
      var file = fileEl.files[0];
      if (!file) {
        compressedDataUrl = null;
        prevEl.innerHTML = "";
        saveBtn.disabled = true;
        return;
      }
      compressImage(file, 1600, 0.8, function (dataUrl, err) {
        if (err) { errEl.textContent = err; saveBtn.disabled = true; return; }
        compressedDataUrl = dataUrl;
        prevEl.innerHTML = '<img src="' + dataUrl + '" alt="proof" style="max-width:100%;max-height:240px;border-radius:8px;display:block;border:1px solid var(--pink-100)">';
        saveBtn.disabled = false;
      });
    };

    saveBtn.onclick = async function () {
      if (!compressedDataUrl) return;
      saveBtn.disabled = true; saveBtn.textContent = "Saving…";
      try {
        await window.APP_DATA.setProof(opts.ym, opts.staffEc, opts.dayKey, compressedDataUrl);
        await window.APP_DATA.setAttendanceStatus(opts.ym, opts.dayKey, opts.staffEc, opts.status);
        close();
        if (opts.onSaved) await opts.onSaved();
      } catch (e) {
        errEl.textContent = (e && e.message) || String(e);
        saveBtn.disabled = false; saveBtn.textContent = "Save with proof";
      }
    };

    if (skipBtn) {
      skipBtn.onclick = async function () {
        skipBtn.disabled = true;
        try {
          // Save as Unpaid — no proof = no paid leave
          await window.APP_DATA.setAttendanceStatus(opts.ym, opts.dayKey, opts.staffEc, "unpaid");
          close();
          if (opts.onSaved) await opts.onSaved();
        } catch (e) {
          errEl.textContent = (e && e.message) || String(e);
          skipBtn.disabled = false;
        }
      };
    }
  }

  // Compress an image File into a JPEG data-URL bounded by maxDim and quality.
  // Falls back to FileReader's raw data-URL if the file isn't actually an image.
  function compressImage(file, maxDim, quality, callback) {
    if (!file.type || file.type.indexOf("image/") !== 0) {
      callback(null, "Only image files are accepted as proof.");
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { callback(null, "Could not read file."); };
    reader.onload  = function () {
      var img = new Image();
      img.onerror = function () { callback(null, "Couldn't load image."); };
      img.onload  = function () {
        var ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
        var w = Math.round(img.width  * ratio);
        var h = Math.round(img.height * ratio);
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        try {
          callback(canvas.toDataURL("image/jpeg", quality), null);
        } catch (e) {
          callback(null, "Could not compress image.");
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // Uses the browser's native prompt() — matches the simpler iOS-style window.
  async function openSwapModal(opts) {
    var grid = opts.schedGrid || {};
    var candidates = findSwapBackCandidates(opts.currentDate, opts.oweEc, opts.coverEc, grid);

    if (candidates.length === 0) {
      window.alert(
        "No valid swap-back days remain in this payroll cycle.\n\n" +
        opts.coverName + " needs a future day where they're scheduled to work AND " +
        opts.oweName + " is scheduled off — and there isn't one before the next 25th.\n\n" +
        "Adjust the schedule first if you still want to swap."
      );
      return;
    }

    var listStr = candidates.map(function (c, i) {
      return (i + 1) + ") " + c.dayLabel;
    }).join("\n");

    var msg = "Pick the future day this week where they swap back\n\n" + listStr + "\n\nEnter the number:";

    var answer = window.prompt(msg, "1");
    if (answer === null) return; // cancelled

    var n = parseInt(String(answer).trim(), 10);
    if (isNaN(n) || n < 1 || n > candidates.length) {
      window.alert("Please pick a number from 1 to " + candidates.length + ".");
      return openSwapModal(opts);  // re-prompt
    }

    var chosen = candidates[n - 1];
    try {
      await window.APP_DATA.recordSwap({
        dateA:     window.APP_DATA.isoDate(opts.currentDate),
        dateB:     chosen.iso,
        oweEc:     opts.oweEc,    oweName:   opts.oweName,
        coverEc:   opts.coverEc,  coverName: opts.coverName
      });
      if (opts.onDone) await opts.onDone();
    } catch (e) {
      window.alert("Could not save: " + ((e && e.message) || e));
    }
  }

  // ---- Yoco balance photo capture (rear camera) ----
  // Photograph the Yoco machine screen showing the day's transaction totals.
  // Returns Promise<dataUrl|null>. Uses the shared camera helper (live preview
  // where it works on this device, system camera otherwise).
  function captureYocoPhoto() {
    return window.BOA_CAMERA.capture({
      facingMode: "environment",
      title: "📸 Photograph the Yoco Balances",
      hint: "Point the camera at the Yoco machine screen showing today's transaction totals, then tap Capture.",
      crop: { mode: "fit", maxDim: 1200, quality: 0.8 }
    });
  }

  // ---------------- Cash-up ----------------
  async function renderCashup(targetDate) {
    setSublabel("Cash Up");
    // targetDate (YYYY-MM-DD) lets a store complete a PREVIOUS day's cash-up
    // they missed — reached from the home-screen reminder. Defaults to today.
    var today   = window.APP_DATA && window.APP_DATA.todayStr ? window.APP_DATA.todayStr() : null;
    var forDate = (typeof targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) ? targetDate : today;
    var isBackfill = !!forDate && !!today && forDate !== today;
    var prettyDate = forDate ? new Date(forDate + "T12:00:00").toLocaleDateString("en-ZA", { weekday: "long", day: "2-digit", month: "long" }) : "";
    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>Cash Up' + (isBackfill ? ' · ' + esc(prettyDate) : '') + '</h2>' +
          '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
        '</div>' +
        (isBackfill
          ? '<div class="checkin-nag" role="alert" style="margin-bottom:12px">' +
              '<div class="checkin-nag-icon">📅</div>' +
              '<div class="checkin-nag-text">' +
                '<div class="checkin-nag-title">MISSED CASH-UP — ' + esc(prettyDate.toUpperCase()) + '</div>' +
                '<div class="checkin-nag-sub">You\'re completing the cash-up for a <strong>previous day</strong> that wasn\'t submitted. Enter that day\'s totals (not today\'s). Today\'s cash-up is still done separately.</div>' +
              '</div>' +
            '</div>'
          : '') +
        '<div id="cashup-body">Loading…</div>' +
      '</div>'
    );
    document.getElementById("back-home").onclick = function () { _backHandler(); };

    if (!window.APP_DATA || !window.APP_DATA.isConfigured()) {
      document.getElementById("cashup-body").innerHTML = configMissingHtml();
      return;
    }

    var existing = await window.APP_DATA.cashupForDate(forDate);
    if (existing) {
      document.getElementById("cashup-body").innerHTML =
        '<div class="result-card result-ok">' +
          '<div class="result-icon">✓</div>' +
          '<div class="result-title">' + (isBackfill ? esc(prettyDate) + '\'s' : 'Today\'s') + ' cash-up already submitted</div>' +
          '<div class="result-sub">Signed by ' + esc(existing.signed_by) + ' at ' + fmtTime(existing.created_at) + '</div>' +
        '</div>' +
        '<div class="cashup-summary">' +
          row("Yoco (Card)",         existing.yoco) +
          row("Yoco Payment Link",   existing.yoco_link) +
          row("Cash",                existing.cash) +
          row("Card Tips",           existing.card_tips) +
          row("Vouchers purchased",  existing.vouchers) +
          row("Gift card redemption", existing.gift_card) +
          row("Manual Discounts",    -Math.abs(existing.manual_discounts || 0), true) +
          (existing.manual_discount_reason ? '<div class="cashup-row"><span>Reason</span><span>' + esc(existing.manual_discount_reason) + '</span></div>' : "") +
          row("Total",               existing.total, false, true) +
          (Number(existing.card_tips) > 0
            ? '<div class="cashup-row" style="font-size:0.85em;color:#6b7280"><span>+ Card Tips (not included in total)</span><span>' + fmtMoney(existing.card_tips) + '</span></div>'
            : "") +
          (existing.notes ? '<div class="cashup-notes">"' + esc(existing.notes) + '"</div>' : "") +
          (existing.cash_banked === true || existing.cash_banked === false
            ? '<div class="cashup-banking-summary" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--pink-100)">' +
                '<div class="lbl" style="margin-bottom:6px">🏦 Banking</div>' +
                (existing.cash_banked
                  ? '<div class="cashup-row"><span>Cash banked today</span><span>Yes</span></div>'
                    + row("Amount banked", existing.amount_banked)
                    + (existing.banking_ref ? '<div class="cashup-row"><span>Reference</span><span>' + esc(existing.banking_ref) + '</span></div>' : "")
                    + (existing.banked_by   ? '<div class="cashup-row"><span>Banked by</span><span>' + esc(existing.banked_by)   + '</span></div>' : "")
                    + (existing.banking_slip ? '<div style="margin-top:8px"><a href="' + existing.banking_slip + '" target="_blank" rel="noopener"><img src="' + existing.banking_slip + '" alt="banking slip" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--pink-100)"></a></div>' : "")
                  : '<div class="cashup-row"><span>Cash banked today</span><span>No</span></div>'
                ) +
              '</div>'
            : "") +
          (existing.yoco_photo
            ? '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--pink-100)">' +
                '<div class="lbl" style="margin-bottom:6px">📸 Yoco Machine Balances</div>' +
                '<a href="' + existing.yoco_photo + '" target="_blank" rel="noopener">' +
                  '<img src="' + existing.yoco_photo + '" alt="Yoco balances" style="max-width:100%;max-height:240px;border-radius:8px;border:1px solid var(--pink-100);display:block">' +
                '</a>' +
              '</div>'
            : "") +
        '</div>';
      return;
    }

    document.getElementById("cashup-body").innerHTML =
      '<div class="cashup-form">' +
        amountField("yoco",       "💳 Yoco (Card)") +
        amountField("yoco_link",  "🔗 Yoco Payment Link") +
        amountField("cash",       "💵 Cash") +
        amountField("card_tips",  "💰 Card Tips") +
        amountField("vouchers",   "🎟️ Vouchers purchased") +
        amountField("gift_card",  "🎁 Gift card redemption") +
        amountField("manual_discounts", "− Manual Discounts") +
        '<div id="cu-manual-reason-wrap" style="display:none;margin-top:-4px;margin-bottom:10px">' +
          '<label class="lbl" for="cu-manual-reason">Reason for manual discount <span style="color:#b53">required</span></label>' +
          '<textarea id="cu-manual-reason" class="input" rows="2" placeholder="e.g. service complaint, staff family, manager approval…"></textarea>' +
        '</div>' +

        '<div class="cashup-total-box">' +
          '<div><div class="lbl">Total Revenue</div>' +
          '<div class="cashup-breakdown" id="cu-brk">Enter amounts above</div></div>' +
          '<div class="cashup-total" id="cu-total">R 0.00</div>' +
        '</div>' +
        '<div id="cu-tips-warn" style="display:none;margin-top:8px;padding:8px 10px;border-radius:8px;background:#fef3c7;border:1px solid #fde68a;color:#92400e;font-size:0.85em;font-weight:600"></div>' +

        '<div id="cu-banking" class="cashup-banking" style="display:none;margin-top:14px;padding:12px;border:1px solid var(--pink-100);border-radius:10px;background:#fff7fb">' +
          '<div class="lbl" style="margin-bottom:8px">🏦 Banking Information <span style="color:#b53">required</span></div>' +
          '<div class="cashup-fineprint" style="margin-bottom:8px">Cash received must be banked the same day. Capture the deposit slip to protect the store.</div>' +
          '<label class="lbl">Cash banked today?</label>' +
          '<div class="btn-row" style="gap:8px;margin-bottom:8px">' +
            '<label style="display:flex;align-items:center;gap:6px"><input type="radio" name="cu-banked" id="cu-banked-yes" value="yes"> Yes</label>' +
            '<label style="display:flex;align-items:center;gap:6px"><input type="radio" name="cu-banked" id="cu-banked-no"  value="no"> No</label>' +
          '</div>' +
          '<div id="cu-bank-yes" style="display:none">' +
            amountField("amount_banked", "Amount banked") +
            '<label class="lbl" for="cu-banking-ref">Banking reference number</label>' +
            '<input id="cu-banking-ref" class="input" type="text" placeholder="e.g. deposit slip / EFT ref">' +
            '<label class="lbl" for="cu-banked-by">Who banked it</label>' +
            '<input id="cu-banked-by" class="input" type="text" autocomplete="name" placeholder="Full name of person who banked">' +
            '<label class="lbl" for="cu-banking-slip">Banking slip photo</label>' +
            '<input id="cu-banking-slip" class="input" type="file" accept="image/*" capture="environment">' +
            '<div id="cu-banking-slip-preview" style="margin-top:8px"></div>' +
            '<div id="cu-banking-slip-err" class="err-line"></div>' +
          '</div>' +
          '<div id="cu-bank-no" class="cashup-fineprint" style="display:none;color:#b53;margin-top:6px">' +
            '⚠ Cash not banked today. Explain in the Notes field below (e.g. weekend, safe drop, will bank tomorrow).' +
          '</div>' +
        '</div>' +

        '<label class="lbl">Notes (optional)</label>' +
        '<textarea id="cu-notes" class="input" rows="3" placeholder="Till shortage, banking done, anything unusual…"></textarea>' +

        '<div style="margin-top:14px;padding:14px;border:2px solid var(--pink-200);border-radius:10px;background:#fff7fb">' +
          '<div class="lbl" style="margin-bottom:4px">📸 Yoco Machine Balances <span style="color:#b53">required</span></div>' +
          '<div class="cashup-fineprint" style="margin-bottom:10px">Take a photo of the Yoco machine screen showing today\'s transaction totals before submitting.</div>' +
          '<div id="cu-yoco-photo-preview" style="margin-bottom:10px"></div>' +
          '<button type="button" class="btn btn-primary" id="cu-yoco-photo-btn" style="width:100%">📸 Take Photo of Yoco Balances</button>' +
        '</div>' +

        '<label class="lbl">Your full name (sign-off)</label>' +
        '<input id="cu-name" class="input" type="text" autocomplete="name" placeholder="Type your name to sign off">' +
        '<div class="cashup-fineprint">🔒 By entering your name you confirm these figures are accurate and complete.</div>' +

        '<div class="btn-row"><button class="btn btn-primary" id="cu-submit" disabled>Submit Cash Up</button></div>' +
        '<div id="cu-result"></div>' +
      '</div>';

    var ids = ["yoco", "yoco_link", "cash", "card_tips", "vouchers", "gift_card", "manual_discounts", "amount_banked"];
    ids.forEach(function (id) {
      var el = document.getElementById("cu-" + id);
      if (el) el.addEventListener("input", recalc);
    });
    document.getElementById("cu-name").addEventListener("input", recalc);
    document.getElementById("cu-manual-reason").addEventListener("input", recalc);
    document.getElementById("cu-banking-ref").addEventListener("input", recalc);
    document.getElementById("cu-banked-by").addEventListener("input", recalc);
    document.getElementById("cu-banked-yes").addEventListener("change", onBankedToggle);
    document.getElementById("cu-banked-no").addEventListener("change", onBankedToggle);

    var bankingSlipDataUrl = null;
    document.getElementById("cu-banking-slip").addEventListener("change", function () {
      var errEl = document.getElementById("cu-banking-slip-err");
      var prev  = document.getElementById("cu-banking-slip-preview");
      errEl.textContent = "";
      var file = this.files && this.files[0];
      if (!file) { bankingSlipDataUrl = null; prev.innerHTML = ""; recalc(); return; }
      compressImage(file, 1600, 0.8, function (dataUrl, err) {
        if (err) { errEl.textContent = err; bankingSlipDataUrl = null; prev.innerHTML = ""; recalc(); return; }
        bankingSlipDataUrl = dataUrl;
        prev.innerHTML = '<img src="' + dataUrl + '" alt="banking slip" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--pink-100)">';
        recalc();
      });
    });

    var yocoPhotoDataUrl = null;
    document.getElementById("cu-yoco-photo-btn").onclick = async function () {
      var btn = this;
      var photo = await captureYocoPhoto();
      if (photo) {
        yocoPhotoDataUrl = photo;
        document.getElementById("cu-yoco-photo-preview").innerHTML =
          '<img src="' + photo + '" alt="Yoco balances" style="max-width:100%;max-height:240px;border-radius:8px;border:1px solid var(--pink-100);display:block">';
        btn.textContent = "↺ Retake Photo";
        btn.style.background = "#f3f4f6";
        btn.style.color = "#374151";
      }
      recalc();
    };

    function onBankedToggle() {
      var yes = document.getElementById("cu-banked-yes").checked;
      document.getElementById("cu-bank-yes").style.display = yes ? "" : "none";
      document.getElementById("cu-bank-no").style.display  = yes ? "none" : (document.getElementById("cu-banked-no").checked ? "" : "none");
      recalc();
    }

    document.getElementById("cu-submit").onclick = async function () {
      var btn = this; btn.disabled = true;
      var resEl = document.getElementById("cu-result");
      // Sanity check the figures before saving — catches fat-finger mistakes
      // like a R28 000 tip (an extra zero or wrong field) before they land in
      // payroll/finance. Soft guard: warn and let the manager confirm, so a
      // genuinely big-but-correct day still goes through.
      var _y = val("yoco"), _yl = val("yoco_link"), _c = val("cash"), _ct = val("card_tips"),
          _v = val("vouchers"), _gc = val("gift_card"), _md = val("manual_discounts");
      var _turnover = Math.max(0, _y + _yl + _c + _v + _gc - _md);
      var _warn = [];
      // Tips are normally a small slice of takings. More than half the day's
      // turnover (and over R1 000) is almost always a typo.
      if (_ct > 1000 && _ct > _turnover * 0.5) {
        _warn.push("Card Tips of " + fmtMoney(_ct) + " is more than half the day's takings (" + fmtMoney(_turnover) + "). Tips are usually small — did you maybe mean " + fmtMoney(_ct / 100) + "?");
      }
      // Any single line of R100 000+ is worth a second look (likely an extra 0).
      [["Yoco", _y], ["Yoco Link", _yl], ["Cash", _c], ["Card Tips", _ct], ["Vouchers", _v], ["Gift card", _gc]].forEach(function (p) {
        if (p[1] >= 100000) _warn.push(p[0] + " of " + fmtMoney(p[1]) + " looks very high — please double-check.");
      });
      if (_warn.length && !window.confirm("⚠ Please double-check before submitting:\n\n• " + _warn.join("\n\n• ") + "\n\nSubmit these figures anyway?")) {
        btn.disabled = false; return;
      }
      var cashBankedYes = document.getElementById("cu-banked-yes").checked;
      var cashBankedNo  = document.getElementById("cu-banked-no").checked;
      var cashBanked    = cashBankedYes ? true : (cashBankedNo ? false : null);
      try {
        await window.APP_DATA.addCashup({
          date:       forDate,
          yoco:       val("yoco"),
          yoco_link:  val("yoco_link"),
          cash:       val("cash"),
          card_tips:  val("card_tips"),
          vouchers:   val("vouchers"),
          gift_card:  val("gift_card"),
          manual_discounts:       val("manual_discounts"),
          manual_discount_reason: document.getElementById("cu-manual-reason").value,
          notes:      document.getElementById("cu-notes").value,
          signedBy:   document.getElementById("cu-name").value,
          cash_banked:   cashBanked,
          amount_banked: cashBankedYes ? val("amount_banked") : 0,
          banking_ref:   cashBankedYes ? document.getElementById("cu-banking-ref").value : "",
          banked_by:     cashBankedYes ? document.getElementById("cu-banked-by").value  : "",
          banking_slip:  cashBankedYes ? bankingSlipDataUrl : null,
          yoco_photo:    yocoPhotoDataUrl
        });
        resEl.innerHTML = '<div class="result-card result-ok"><div class="result-icon">✓</div><div class="result-title">Cash-up saved. Thank you!</div></div>';
        setTimeout(function () { renderCashup(forDate); }, 800);
      } catch (err) {
        resEl.innerHTML = '<div class="result-card result-err">Could not save: ' + esc(err.message || err) + '</div>';
        btn.disabled = false;
      }
    };
  }

  function amountField(id, label) {
    return '<div class="cashup-field">' +
             '<label class="lbl" for="cu-' + id + '">' + label + '</label>' +
             '<div class="amount-wrap"><span class="amount-prefix">R</span>' +
               '<input id="cu-' + id + '" class="input amount-input" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00">' +
             '</div>' +
           '</div>';
  }
  function val(id) { return parseFloat(document.getElementById("cu-" + id).value) || 0; }
  function recalc() {
    var y  = val("yoco"),
        yl = val("yoco_link"),
        c  = val("cash"),
        ct = val("card_tips"),
        v  = val("vouchers"),
        gc = val("gift_card"),
        md = val("manual_discounts");
    var t = Math.max(0, y + yl + c + v + gc - md);
    document.getElementById("cu-total").textContent = fmtMoney(t);
    var parts = [];
    if (y)  parts.push("Yoco "       + fmtMoney(y));
    if (yl) parts.push("Yoco Link "  + fmtMoney(yl));
    if (c)  parts.push("Cash "       + fmtMoney(c));
    if (ct) parts.push("Tips "       + fmtMoney(ct));
    if (v)  parts.push("Vouchers "   + fmtMoney(v));
    if (gc) parts.push("Gift card "  + fmtMoney(gc));
    if (md) parts.push("− Manual "   + fmtMoney(md));
    document.getElementById("cu-brk").textContent = parts.length ? parts.join(" · ") : "Enter amounts above";
    // Live heads-up if a figure looks like a typo (e.g. a tip bigger than the
    // takings) so it's caught while typing, not after submit.
    var warnEl = document.getElementById("cu-tips-warn");
    if (warnEl) {
      var w = "";
      if (ct > 1000 && ct > t * 0.5) w = "⚠ Card Tips (" + fmtMoney(ct) + ") is more than half the takings — please double-check it's not a typo.";
      else if (Math.max(y, yl, c, ct, v, gc) >= 100000) w = "⚠ One of these amounts is very high — please double-check before submitting.";
      warnEl.textContent = w;
      warnEl.style.display = w ? "" : "none";
    }
    var hasAmt = (y > 0 || yl > 0 || c > 0 || v > 0 || gc > 0);
    var name   = document.getElementById("cu-name").value.trim();

    var reasonWrap = document.getElementById("cu-manual-reason-wrap");
    var manualReason = document.getElementById("cu-manual-reason").value.trim();
    var manualOk = true;
    if (md > 0) {
      reasonWrap.style.display = "";
      manualOk = manualReason.length >= 3;
    } else {
      reasonWrap.style.display = "none";
    }

    var bankingBox = document.getElementById("cu-banking");
    var bankingOk  = true;
    if (c > 0) {
      bankingBox.style.display = "";
      var yes = document.getElementById("cu-banked-yes").checked;
      var no  = document.getElementById("cu-banked-no").checked;
      document.getElementById("cu-bank-yes").style.display = yes ? "" : "none";
      document.getElementById("cu-bank-no").style.display  = no  ? "" : "none";
      if (!yes && !no) {
        bankingOk = false;
      } else if (yes) {
        var amt    = val("amount_banked");
        var ref    = document.getElementById("cu-banking-ref").value.trim();
        var by     = document.getElementById("cu-banked-by").value.trim();
        var slipEl = document.getElementById("cu-banking-slip");
        var hasSlip = slipEl && slipEl.files && slipEl.files.length > 0;
        bankingOk = (amt > 0 && ref.length > 0 && by.length >= 2 && hasSlip);
      }
    } else {
      bankingBox.style.display = "none";
    }

    // recalc() is module-scoped (not nested in renderCashup), so it cannot see
    // the yocoPhotoDataUrl closure var — read the captured-photo state from the
    // DOM instead, the same way banking-slip presence is checked above.
    var yocoPrev = document.getElementById("cu-yoco-photo-preview");
    var hasYocoPhoto = !!(yocoPrev && yocoPrev.querySelector("img"));

    document.getElementById("cu-submit").disabled = !(hasAmt && name.length >= 2 && bankingOk && manualOk && hasYocoPhoto);
  }

  // ---------------- helpers ----------------
  function row(label, n, neg, big) {
    return '<div class="cashup-row' + (big ? " cashup-row-total" : "") + '">' +
             '<span>' + esc(label) + '</span>' +
             '<span>' + (neg ? "− " : "") + fmtMoney(Math.abs(n)) + '</span>' +
           '</div>';
  }
  function fmtMoney(n) {
    var v = Number(n) || 0;
    return "R " + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (_e) { return iso; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ── PER-STORE MANAGER SHIFT LABELLING (mirrors the HR portal + myboa) ──
  // The saved manager grid stores a plain "W" (or a possibly-stale label) for
  // split-shift stores; the portal's Schedule tab, Manager Coverage and the
  // myboa app all RE-DERIVE WE/WM/WL/WB at render time from WHO works each day
  // (applyBranchShiftRules). The kiosk previously printed the raw cell, so it
  // showed "W"/stale codes while every other surface showed the real shift.
  // Ported verbatim from myboa/schedule.js (itself a verbatim port of app.jsx)
  // so the kiosk matches them exactly. All re-run-safe: working cells reset to
  // "W" first, then re-assign purely from the work/off pattern + roles.
  var SPLIT_SHIFT_STORES = { "Sandown": 1, "Table Bay": 1, "Riverlands": 1, "Ballito": 1, "Mall of the South": 1, "Fourways": 1 };
  var _MGR_WORK_CODES = { W: 1, WE: 1, WL: 1, WM: 1, WB: 1, E: 1 };
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
      var ams = workers;
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
  function _mgrCodeNorm(s) { return String(s == null ? "" : s).replace(/[^A-Za-z0-9]/g, "").toUpperCase(); }
  // Build an ec -> { dayNum: code } grid of RE-DERIVED manager shift labels for
  // a split-shift store, seeded from the live grid (approved-snapshot fallback),
  // keyed by day-of-month to match the kiosk's collapsed grid + render. Returns
  // null for non-split stores so callers keep the raw cell.
  function buildMgrLabelGrid(branch, grid, approvedGrid, days, staffList, leaveByEcYmd) {
    if (!SPLIT_SHIFT_STORES[branch]) return null;
    var roleByNorm = {};
    (staffList || []).forEach(function (s) {
      var c = _mgrCodeNorm(s.employee_code); if (c && !(c in roleByNorm)) roleByNorm[c] = s.role || "";
    });
    var dates = (days || []).map(function (d) {
      return { d: d.day, dow: new Date(d.year, d.monthIdx, d.day).getDay() };
    });
    var mgrs = [];
    var out = {};
    // Enumerate the UNION of the published snapshot and the draft, and read the
    // PUBLISHED snapshot FIRST per cell. The snapshot is the resolved truth
    // (WE/WM/WL rotation + manual shift pins baked at publish); the draft
    // (boa_mgrsched_*) is a stale working copy whose raw rotation can disagree
    // with what was actually published, so a pinned/re-drafted manager rendered
    // the wrong hours (e.g. WL 11–20 for a published WM 09–18). The draft only
    // fills cells the snapshot lacks (a cycle that was never published).
    var _ecUnion = {};
    Object.keys(grid || {}).forEach(function (ec) { _ecUnion[ec] = true; });
    Object.keys(approvedGrid || {}).forEach(function (ec) { if (!(ec in _ecUnion)) _ecUnion[ec] = true; });
    Object.keys(_ecUnion).forEach(function (ec) {
      mgrs.push({ ec: ec, role: roleByNorm[_mgrCodeNorm(ec)] || "" });
      out[ec] = {};
      var _ect = String(ec).trim();
      (days || []).forEach(function (d) {
        var raw = (approvedGrid && approvedGrid[ec] && approvedGrid[ec][d.day]) ||
                  (grid[ec] && grid[ec][d.day]) || "";
        var up = String(raw).toUpperCase();
        // A manager on Leave-Planner leave is OFF that day, so seed "L" — this
        // keeps them OUT of the day's working lineup (matches the portal, which
        // derives labels from readWithFallback where leave reads as "L"), so the
        // remaining managers get the correct opener/late labels.
        if (leaveByEcYmd && leaveByEcYmd[_ect]) {
          var ymd = d.year + "-" + String(d.monthIdx + 1).padStart(2, "0") + "-" + String(d.day).padStart(2, "0");
          if (leaveByEcYmd[_ect][ymd] && up !== "O" && up !== "R" && up !== "X") up = "L";
        }
        out[ec][d.day] = up;
      });
    });
    // Trust the PUBLISHED snapshot's resolved labels (WE/WM/WL/WB). The portal
    // bakes the rotation AND the manual shift pins into the snapshot at publish,
    // so a resolved cell is authoritative. Only run the rotation to fill cells the
    // snapshot left as a bare "W" (legacy / pre-resolution), then restore the
    // resolved cells — re-deriving a resolved cell dropped the manual pins and
    // showed the wrong hours (e.g. a pinned WE opener rendered as WM).
    var _resolved = {}, _hasBareW = false;
    Object.keys(out).forEach(function (ec) {
      _resolved[ec] = {};
      Object.keys(out[ec]).forEach(function (day) {
        var v = out[ec][day];
        if (v === "WE" || v === "WM" || v === "WL" || v === "WB") _resolved[ec][day] = v;
        else if (v === "W") _hasBareW = true;
      });
    });
    if (_hasBareW) {
      applyBranchShiftRules(out, dates, mgrs, branch);
      Object.keys(_resolved).forEach(function (ec) {
        Object.keys(_resolved[ec]).forEach(function (day) { out[ec][day] = _resolved[ec][day]; });
      });
    }
    return out;
  }

  // Mirror of the HR portal's shiftTimes() so the kiosk Manager Schedule
  // view can stamp each working cell with its actual hours. Kept in sync
  // with the portal copy (app.jsx Manager Coverage) and with the
  // equivalent helper in manager-app.js — those two are the source of
  // truth, this one just renders the schedule grid.
  //   role: "SM" | "SSM" | "AM"
  //   code: W / WE / WL / WM / WB / E
  //   branchName: store name (APP_CONFIG.branchName)
  //   dow: 0=Sun … 6=Sat
  function _shiftTimes(role, code, branchName, dow) {
    var r = (role || "").toUpperCase();
    var isSM = r === "SM" || r === "SSM";
    var isAM = r === "AM";
    var b = branchName || "";

    // Head Office hours (mirrors the portal): office staff a single day shift;
    // the Call Centre & Sales floor a two-shift early/late split (WE / WL).
    if (_isHoBranch(b)) {
      if (_hoIsCcSales({ role: r })) return _hoCellHours(code === "WL" ? HO_HOURS.ccLate : HO_HOURS.ccEarly);
      return _hoCellHours(HO_HOURS.office);
    }

    if (b === "Sandown" || b === "Table Bay") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) {
        if (code === "WE") return "08:00 - 17:00";
        return "09:00 - 18:00";
      }
      if (dow === 6 && b === "Sandown") {
        if (code === "WE") return "08:00 - 17:00";
        return "10:00 - 19:00";
      }
      if (code === "WE") return "08:00 - 17:00";
      if (code === "WM") return "09:00 - 18:00";
      return "11:00 - 20:00";
    }
    if (b === "Riverlands") {
      if (isSM) return "08:00 - 17:00";               // SM/SSM always 08:00-17:00, every day
      if (dow === 6) return "09:00 - 18:00";
      if (dow === 0) return "08:30 - 17:00";          // Sun single AM (08:30 open)
      if (code === "WE") return "09:00 - 18:00";
      if (code === "WB") return "08:00 - 17:00";
      if (code === "WM") return "09:00 - 18:00";      // AM mid shift
      return "10:00 - 19:00";
    }
    if (b === "Ballito" || b === "Mall of the South") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) return isAM ? "08:30 - 17:00" : "08:00 - 17:00";
      if (code === "WE") return "08:00 - 17:00";
      if (code === "WM") return "09:00 - 18:00";
      return "10:00 - 19:00";
    }
    if (b === "Fourways") {
      if (isSM) return "08:00 - 17:00";   // SM/SSM always open, never close
      if (dow === 0) {
        if (code === "WE") return "08:00 - 17:00";
        return "10:00 - 19:00";
      }
      if (code === "WE") return "08:00 - 17:00";   // AM opener when no SM is in
      if (code === "WM") return "10:00 - 19:00";
      return "11:00 - 20:00";
    }
    // Generic stores. SM flat 08-17 on weekends. AM Sat 09-18, Sun 8:30-17.
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
  // Compact a "HH:MM - HH:MM" range so it fits in a narrow grid cell:
  //   "09:00 - 18:00" → "9–18"
  //   "08:30 - 17:00" → "8:30–17"
  //   "09:00 - 18:30" → "9–18:30"
  function _compactShift(s) {
    if (!s) return "";
    return String(s).replace(/0(\d):00/g, "$1").replace(/(\d\d):00/g, "$1").replace(/\s*-\s*/, "–");
  }
  // One-shot info banner shown above the Manager Schedule grid. Lists
  // SM/SSM and AM hours for this branch so the rows themselves stay
  // clean (just W/WL/O codes). Generic stores get the Mon-Fri / Sat /
  // Sun triple. Special stores spell out the per-code times since at
  // those branches the code drives the shift, not the day of week.
  function _hoursBannerHtml(branchName) {
    var b = branchName || "";
    var lines = [];
    if (b === "Sandown") {
      lines.push("SM / SSM — 08:00–17:00 every day");
      lines.push("AM Mon–Fri · WE 08:00–17:00 · WM 09:00–18:00 · WL 11:00–20:00");
      lines.push("AM Saturday · WE 08:00–17:00 · WL 10:00–19:00");
      lines.push("AM Sunday · WE 08:00–17:00 · WL 09:00–18:00");
    } else if (b === "Table Bay") {
      lines.push("SM / SSM — 08:00–17:00 every day");
      lines.push("AM Mon–Sat · WE 08:00–17:00 · WM 09:00–18:00 · WL 11:00–20:00");
      lines.push("AM Sunday · WE 08:00–17:00 · WL 09:00–18:00");
    } else if (b === "Riverlands") {
      lines.push("SM — 08:00–17:00 Mon–Fri");
      lines.push("AM Mon–Fri · WE/WM 09:00–18:00 · WL 10:00–19:00 · WB 08:00–17:00");
      lines.push("Saturday — single 09:00–18:00 shift");
      lines.push("Sunday — AM 08:30–17:00 · SM 08:00–17:00");
    } else if (b === "Ballito" || b === "Mall of the South") {
      lines.push("SM — 08:00–17:00 every day");
      lines.push("AM Mon–Sat · WM 09:00–18:00 · WL 10:00–19:00");
      lines.push("Sunday — single 08:00–17:00 shift");
    } else if (b === "Fourways") {
      lines.push("SM / SSM — 08:00–17:00 every day");
      lines.push("AM Mon–Sat (SM in) · WM 10:00–19:00 · WL 11:00–20:00");
      lines.push("AM Mon–Sat (no SM) · WE 08:00–17:00 opener + WL 11:00–20:00");
      lines.push("AM Sunday · WE 08:00–17:00 · WL 10:00–19:00");
    } else {
      lines.push("SM / SSM — 08:00–17:00 every day");
      lines.push("AM Mon–Fri — 09:00–18:30");
      lines.push("AM Saturday — 09:00–18:00");
      lines.push("AM Sunday — 08:30–17:00");
    }
    var rows = lines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join("");
    return '<div class="sched-hours-banner">' +
             '<div class="sched-hours-banner-title">🕐 Manager hours · ' + esc(b || "this store") + '</div>' +
             '<div class="sched-hours-banner-rows">' + rows + '</div>' +
           '</div>';
  }
  // Same banner pattern, but for the Nail Tech schedule view. Only the
  // stores that publish a known tech-side WL split are listed; anything
  // else gets an empty string so we don't render a banner at all.
  function _techHoursBannerHtml(branchName, hoDept) {
    var b = branchName || "";
    var isHoBanner = _isHoBranch(b);
    var lines = [];
    if (isHoBanner) {
      if (hoDept === "ccsales") lines.push("Early (WE) " + _hoDashHours(HO_HOURS.ccEarly) + " · Late (WL) " + _hoDashHours(HO_HOURS.ccLate));
      else lines.push(_hoDashHours(HO_HOURS.office) + " · Mon–Fri");
    } else if (b === "Fourways") {
      lines.push("Mon–Fri · W 09:30–18:30 · WL 11:00–20:00 (4 techs)");
      lines.push("Saturday · W 09:00–18:00 · WL 11:00–20:00 (4 techs)");
      lines.push("Sunday · W 09:00–18:00 · WL 10:00–19:00 (2–3 techs, alternates by parity)");
    } else if (b === "Sandown") {
      lines.push("Mon–Fri · WE 08:00–17:30 · WL 11:00–20:00");
      lines.push("Saturday · WE 08:00–17:30 · WL 10:00–19:00");
      lines.push("Sunday · all shifts 09:00–18:00 (no early/late split)");
    } else if (b === "Table Bay") {
      lines.push("Up to 3 nail techs per day on the late shift (WL).");
    }
    if (lines.length === 0) return "";
    var rows = lines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join("");
    var _title = isHoBanner
      ? ("🕐 " + (hoDept === "ccsales" ? "Call Centre & Sales" : "Office Staff") + " hours")
      : ("🕐 Nail tech hours · " + esc(b));
    return '<div class="sched-hours-banner">' +
             '<div class="sched-hours-banner-title">' + _title + '</div>' +
             '<div class="sched-hours-banner-rows">' + rows + '</div>' +
           '</div>';
  }
  // A staff row is a manager if it's tagged as one in the DB, OR its employee
  // code follows the manager convention. Branch managers use codes ending in
  // "M" (e.g. B147M) and head-office managers use an "M###" prefix (e.g. M005);
  // neither ends in the "-M" suffix the HR portal's role_type derivation looks
  // for, so some manager rows land in the DB with role_type "tech". Checking
  // the code pattern too keeps them out of the Nail Tech Check-in regardless
  // of how their role_type was stored — managers clock in via their own tile.
  // Defers to the shared data-layer predicate so the rule stays in one place.
  function isManagerStaff(s) {
    if (window.APP_DATA && typeof window.APP_DATA.isManagerRow === "function") {
      return window.APP_DATA.isManagerRow(s);
    }
    if (!s) return false;
    if (s.role_type === "manager") return true;
    var code = (s.employee_code || "").toUpperCase().trim();
    return !!code && (/\dM$/.test(code) || /^M\d/.test(code));
  }
  function configMissingHtml() {
    return '<div class="warn">' +
             '<strong>Supabase isn\'t connected yet.</strong><br>' +
             'Open <code>config.js</code> and fill in the URL and anon key, then reload.' +
           '</div>';
  }

  // ---------- "Submit today's check-in" home-screen nag ----------
  // Submitting the daily nail-tech check-in is the store's duty. If it's past
  // 10:30 and today still isn't signed off — while techs are scheduled to work
  // — the home screen shows a big blinking warning until it's submitted.
  var CHECKIN_NAG_AFTER_MIN = 10 * 60 + 30;   // 10:30 local time

  async function shouldNagUnsubmittedCheckin() {
    try {
      if (!window.APP_DATA || !window.APP_DATA.isConfigured()) return false;
      var now = new Date();
      if (now.getHours() * 60 + now.getMinutes() < CHECKIN_NAG_AFTER_MIN) return false;
      // Already submitted today? Then nothing to nag about.
      var daily = await window.APP_DATA.getDailyRecord(now);
      if (daily && daily.signedBy) return false;
      // Only nag on days the store is actually operating — i.e. at least one
      // nail tech is scheduled to work (W / WL / E) today. Manager-coded ECs
      // are skipped: they clock in via the Manager Check-in tile, not here.
      var sched = await window.APP_DATA.getSchedule(window.APP_DATA.ymForDate(now));
      var grid  = (sched && sched.grid) || {};
      var dayKey = String(now.getDate());
      for (var ec in grid) {
        var st = grid[ec] && grid[ec][dayKey];
        if (!isWorkingShift(st)) continue;
        // Route through the shared, HO-aware predicate instead of a private
        // regex copy so manager/HO classification stays in one place.
        if (isManagerStaff({ employee_code: ec })) continue;    // manager code
        return true;
      }
      return false;
    } catch (e) {
      console.warn("check-in nag check failed (non-fatal):", e);
      return false;
    }
  }

  function checkinNagHtml() {
    return '<div class="checkin-nag" role="alert">' +
             '<div class="checkin-nag-icon">⚠️</div>' +
             '<div class="checkin-nag-text">' +
               '<div class="checkin-nag-title">CHECK-IN NOT SUBMITTED</div>' +
               '<div class="checkin-nag-sub">It\'s after 10:30 and today\'s nail tech check-in still hasn\'t been submitted. ' +
                 'Open <strong>Daily Check-in</strong>, confirm everyone and sign off — it\'s the store\'s duty to submit it.</div>' +
             '</div>' +
           '</div>';
  }

  // Populate (or clear) the #checkin-nag-slot on whichever landing is showing.
  // Safe to call when the slot isn't present (e.g. on a sub-screen) — no-ops.
  async function refreshCheckinNag() {
    var el = document.getElementById("checkin-nag-slot");
    if (!el) return;
    var nag = await shouldNagUnsubmittedCheckin();
    el.innerHTML = nag ? checkinNagHtml() : "";
  }

  // Home-screen reminder for PREVIOUS days the store missed its cash-up.
  // Each day gets a "Complete now" button that opens the cash-up form for
  // that exact date. Today is never listed (still in progress). Non-blocking.
  async function refreshCashupNag() {
    var el = document.getElementById("cashup-nag-slot");
    if (!el) return;
    if (!window.APP_DATA || !window.APP_DATA.outstandingCashupDates) { el.innerHTML = ""; return; }
    var dates;
    try { dates = await window.APP_DATA.outstandingCashupDates(7); }
    catch (e) { console.warn("cashup nag check failed (non-fatal):", e); el.innerHTML = ""; return; }
    if (!dates || !dates.length) { el.innerHTML = ""; return; }
    var rows = dates.map(function (d) {
      var pretty = new Date(d + "T12:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" });
      return '<div class="cashup-nag-row" style="display:flex;align-items:center;gap:10px;justify-content:space-between;padding:7px 0;border-top:1px solid rgba(255,255,255,0.25)">' +
               '<span style="font-weight:700">' + esc(pretty) + '</span>' +
               '<button class="btn btn-primary cashup-nag-do" data-date="' + d + '" style="padding:6px 14px">Complete now →</button>' +
             '</div>';
    }).join("");
    el.innerHTML =
      '<div class="checkin-nag" role="alert" style="flex-direction:column;align-items:stretch">' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<div class="checkin-nag-icon">💵</div>' +
          '<div class="checkin-nag-text">' +
            '<div class="checkin-nag-title">CASH-UP STILL OWED — ' + dates.length + ' DAY' + (dates.length === 1 ? '' : 'S') + '</div>' +
            '<div class="checkin-nag-sub">A previous day\'s cash-up wasn\'t submitted. Tap <strong>Complete now</strong> to enter that day\'s totals — today\'s cash-up is still done separately.</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:8px">' + rows + '</div>' +
      '</div>';
    Array.prototype.forEach.call(el.querySelectorAll(".cashup-nag-do"), function (btn) {
      btn.onclick = function () { renderCashup(btn.dataset.date); };
    });
  }

  // Home-screen, READ-ONLY notice of who called in sick / absent for today via
  // My BOA — scoped to this branch (home staff not loaned out, plus anyone
  // loaned in). The kiosk only shows it; it can't review or change anything
  // (absences are handled by regional managers in the HR portal).
  async function refreshSickToday() {
    var el = document.getElementById("sick-today-slot");
    if (!el) return;
    if (!window.APP_DATA || !window.APP_DATA.calledInTodayForBranch) { el.innerHTML = ""; return; }
    var list;
    try { list = await window.APP_DATA.calledInTodayForBranch(); }
    catch (e) { console.warn("called-in-today check failed (non-fatal):", e); el.innerHTML = ""; return; }
    if (!list || !list.length) { el.innerHTML = ""; return; }
    var mgrs = list.filter(function (p) { return p.role === "manager"; });
    var techs = list.filter(function (p) { return p.role !== "manager"; });
    var parts = [];
    if (techs.length) parts.push(techs.length + " nail tech" + (techs.length === 1 ? "" : "s"));
    if (mgrs.length) parts.push(mgrs.length + " manager" + (mgrs.length === 1 ? "" : "s"));
    var summary = parts.join(" and ");
    var rows = list.map(function (p) {
      var tag = p.type === "sick" ? "🤒 sick" : "🚫 absent";
      var role = p.role === "manager" ? " · manager" : "";
      var borrowed = p.borrowed ? " (borrowed in)" : "";
      return '<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;padding:6px 0;border-top:1px solid rgba(255,255,255,0.25)">' +
               '<span style="font-weight:700">' + esc(p.name) + esc(borrowed) + '</span>' +
               '<span style="opacity:.9;font-size:13px">' + tag + role + '</span>' +
             '</div>';
    }).join("");
    el.innerHTML =
      '<div class="checkin-nag" role="status" style="flex-direction:column;align-items:stretch">' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<div class="checkin-nag-icon">🤒</div>' +
          '<div class="checkin-nag-text">' +
            '<div class="checkin-nag-title">OUT TODAY — ' + esc(summary) + '</div>' +
            '<div class="checkin-nag-sub">Called in via My BOA. For your information only.</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:8px">' + rows + '</div>' +
      '</div>';
  }

  // ---------- Shared flows (used by manager-app.js too) ----------
  // Manager dashboard reuses these so we don't duplicate ~600 lines of UI.
  // Call configure() once to redirect output to a different element and
  // override what "← Back" does, then invoke any render function.
  window.BOA_FLOWS = {
    configure: function (opts) {
      opts = opts || {};
      if (opts.mainElId) _mainElId = opts.mainElId;
      if (typeof opts.onBack === "function") _backHandler = opts.onBack;
    },
    renderCheckin:      function () { return renderCheckin.apply(null, arguments); },
    renderCashup:       function () { return renderCashup.apply(null, arguments); },
    renderOffRequests:  function () { return renderOffRequests.apply(null, arguments); },
    renderSchedule:     function () { return renderSchedule.apply(null, arguments); },
    renderNews:         function () { return renderNews.apply(null, arguments); },
    refreshNewsBadge:   function () { return refreshNewsBadge.apply(null, arguments); },
    refreshCheckinNag:  function () { return refreshCheckinNag.apply(null, arguments); },
    refreshCashupNag:   function () { return refreshCashupNag.apply(null, arguments); },
    refreshEvalNag:     function () { return refreshEvalNag.apply(null, arguments); }
  };
})();

/* ============================================================
   Shared camera capture — window.BOA_CAMERA.capture(opts)
   ------------------------------------------------------------
   iOS standalone PWAs often render the live <video> black (a WebKit
   autoplay/compositing bug, version-dependent). We harden the live path
   (explicit play() + a short watchdog) and fall back to the system camera
   (<input type=file capture>), which always works and needs no web camera
   permission. Returns Promise<dataUrl|null>. Used by the Yoco photo (staff)
   and the clock-in selfie (manager).
   opts = { facingMode:"environment"|"user", title, hint,
            crop:{mode:"fit",maxDim,quality} | {mode:"cover",w,h,quality} }
   ============================================================ */
(function () {
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Draw a source (live video frame or loaded <img>) to a canvas per the crop
  // spec → JPEG dataURL. "fit" scales down within maxDim; "cover" centre-crops
  // to exact w×h.
  function cropToDataUrl(src, sw, sh, crop) {
    crop = crop || { mode: "fit", maxDim: 1200 };
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    if (crop.mode === "cover") {
      var dw = crop.w || 400, dh = crop.h || 500;
      canvas.width = dw; canvas.height = dh;
      var srcAspect = sw / sh, dstAspect = dw / dh, cx, cy, cw, ch;
      if (srcAspect > dstAspect) { ch = sh; cw = sh * dstAspect; cx = (sw - cw) / 2; cy = 0; }
      else { cw = sw; ch = sw / dstAspect; cx = 0; cy = (sh - ch) / 2; }
      ctx.drawImage(src, cx, cy, cw, ch, 0, 0, dw, dh);
      return canvas.toDataURL("image/jpeg", crop.quality || 0.7);
    }
    var maxDim = crop.maxDim || 1200;
    var ratio = Math.min(maxDim / sw, maxDim / sh, 1);
    var w = Math.round(sw * ratio), h = Math.round(sh * ratio);
    canvas.width = w; canvas.height = h;
    ctx.drawImage(src, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", crop.quality || 0.8);
  }

  function capture(opts) {
    opts = opts || {};
    var facing = opts.facingMode === "user" ? "user" : "environment";
    var crop = opts.crop || { mode: "fit", maxDim: 1200 };
    return new Promise(function (resolve) {
      var settled = false, stream = null, watchdog = null, nativeInput = null, lastDataUrl = null;

      var overlay = document.createElement("div");
      overlay.id = "boa-cam-overlay";
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;font-family:inherit";
      overlay.innerHTML =
        '<div style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px;text-align:center">' + esc(opts.title || "Take a photo") + '</div>' +
        (opts.hint ? '<div style="color:#9ca3af;font-size:12px;margin-bottom:14px;text-align:center;max-width:420px;line-height:1.5">' + esc(opts.hint) + '</div>' : '<div style="margin-bottom:6px"></div>') +
        '<div style="position:relative;background:#000;border-radius:12px;overflow:hidden;max-width:520px;width:100%">' +
          '<video id="boa-cam-video" autoplay playsinline muted style="display:block;width:100%;max-height:60vh;background:#000"></video>' +
          '<canvas id="boa-cam-still" style="display:none;width:100%;max-height:60vh"></canvas>' +
        '</div>' +
        '<div id="boa-cam-status" style="color:#9ca3af;font-size:11px;margin-top:8px;min-height:14px;text-align:center"></div>' +
        '<div id="boa-cam-controls" style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center"></div>';
      document.body.appendChild(overlay);

      var videoEl  = overlay.querySelector("#boa-cam-video");
      var stillEl  = overlay.querySelector("#boa-cam-still");
      var statusEl = overlay.querySelector("#boa-cam-status");
      var controls = overlay.querySelector("#boa-cam-controls");
      videoEl.muted = true; videoEl.playsInline = true; videoEl.setAttribute("playsinline", "");

      function stopStream() {
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_e) {}
        stream = null;
      }
      function done(v) {
        if (settled) return; settled = true;
        stopStream();
        if (nativeInput && nativeInput.parentNode) nativeInput.parentNode.removeChild(nativeInput);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(v);
      }
      function setControls(html) { controls.innerHTML = html; }
      function previewStill(dataUrl) {
        var img = new Image();
        img.onload = function () { stillEl.width = img.naturalWidth; stillEl.height = img.naturalHeight; stillEl.getContext("2d").drawImage(img, 0, 0); };
        img.src = dataUrl;
      }

      function showLive() {
        videoEl.style.display = "block"; stillEl.style.display = "none";
        setControls(
          '<button id="boa-cam-cancel" style="padding:10px 18px;border-radius:9px;border:1px solid rgba(255,255,255,0.3);background:transparent;color:#fff;font-family:inherit;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="boa-cam-native" style="padding:10px 18px;border-radius:9px;border:1px solid rgba(255,255,255,0.3);background:transparent;color:#fff;font-family:inherit;font-size:13px;cursor:pointer">Use device camera</button>' +
          '<button id="boa-cam-capture" style="padding:10px 22px;border-radius:9px;border:none;background:#BE185D;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">📸 Capture</button>');
        overlay.querySelector("#boa-cam-cancel").onclick = function () { done(null); };
        overlay.querySelector("#boa-cam-native").onclick = function () { openNative(); };
        overlay.querySelector("#boa-cam-capture").onclick = doCapture;
      }
      function showStill() {
        videoEl.style.display = "none"; stillEl.style.display = "block";
        setControls(
          '<button id="boa-cam-retake" style="padding:10px 18px;border-radius:9px;border:1px solid rgba(255,255,255,0.3);background:transparent;color:#fff;font-family:inherit;font-size:13px;cursor:pointer">↺ Retake</button>' +
          '<button id="boa-cam-confirm" style="padding:10px 22px;border-radius:9px;border:none;background:#16a34a;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">✓ Confirm</button>');
        overlay.querySelector("#boa-cam-retake").onclick = function () { startLive(); };
        overlay.querySelector("#boa-cam-confirm").onclick = function () { done(lastDataUrl); };
      }
      function showNativePrompt(msg) {
        videoEl.style.display = "none"; stillEl.style.display = "none";
        statusEl.textContent = msg || "";
        setControls(
          '<button id="boa-cam-cancel2" style="padding:10px 18px;border-radius:9px;border:1px solid rgba(255,255,255,0.3);background:transparent;color:#fff;font-family:inherit;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="boa-cam-open" style="padding:10px 22px;border-radius:9px;border:none;background:#BE185D;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">📷 Open camera</button>');
        overlay.querySelector("#boa-cam-cancel2").onclick = function () { done(null); };
        overlay.querySelector("#boa-cam-open").onclick = triggerNative;
      }
      function doCapture() {
        var vw = videoEl.videoWidth || 640, vh = videoEl.videoHeight || 480;
        lastDataUrl = cropToDataUrl(videoEl, vw, vh, crop);
        previewStill(lastDataUrl);
        showStill();
      }

      // ---- System camera fallback (always works; no web permission needed) ----
      function triggerNative() {
        if (!nativeInput) {
          nativeInput = document.createElement("input");
          nativeInput.type = "file";
          nativeInput.accept = "image/*";
          nativeInput.setAttribute("capture", facing);
          nativeInput.style.display = "none";
          nativeInput.addEventListener("change", function () {
            var file = nativeInput.files && nativeInput.files[0];
            if (!file) return; // cancel → stay on the native prompt
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
              lastDataUrl = cropToDataUrl(img, img.naturalWidth || img.width, img.naturalHeight || img.height, crop);
              URL.revokeObjectURL(url);
              previewStill(lastDataUrl);
              showStill();
            };
            img.onerror = function () { URL.revokeObjectURL(url); showNativePrompt("Could not read that photo — try again."); };
            img.src = url;
          });
          overlay.appendChild(nativeInput);
        }
        nativeInput.value = "";
        nativeInput.click();
      }
      function openNative(msg) {
        stopStream();
        showNativePrompt(msg || "");
        triggerNative();
      }

      // ---- Live preview path ----
      function startLive() {
        stopStream();
        showLive();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { openNative("This device has no in-app camera — using the system camera."); return; }
        statusEl.textContent = "Starting camera…";
        navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
          .then(function (s) {
            if (settled) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (_e) {} return; }
            stream = s; videoEl.srcObject = s;
            var tryPlay = function () { var p = videoEl.play(); if (p && p.catch) p.catch(function () {}); };
            videoEl.onloadedmetadata = tryPlay; tryPlay();
            // If no frames shortly (standalone-PWA black-video bug), use the system camera.
            watchdog = setTimeout(function () {
              if (settled) return;
              if (!videoEl.videoWidth || videoEl.readyState < 2 || videoEl.paused) {
                openNative("Live preview isn't supported here — using the system camera.");
              } else { statusEl.textContent = ""; }
            }, 2500);
          })
          .catch(function () {
            // Permission/hardware error → the system camera still works without it.
            openNative("Using the system camera.");
          });
      }

      startLive();
    });
  }

  window.BOA_CAMERA = { capture: capture };
})();
