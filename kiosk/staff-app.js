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
    var nextMonth = window.APP_DATA ? window.APP_DATA.nextMonthLabel().split(" ")[0] : "Off";
    root.innerHTML =
      '<header class="app-header gp-header">' +
        '<div class="gp-greeting">' +
          '<div class="gp-greeting-line">' + esc(getGreeting()) + ' · ' + esc(cfg.branchDisplayName || cfg.branchName || "BOA Check-in") + '</div>' +
          '<div class="gp-sublabel" id="gp-sublabel">HOME</div>' +
        '</div>' +
        '<div class="gp-actions">' +
          '<button class="gp-btn"  data-action="home"     type="button"><span>🏠</span> Home</button>' +
          '<button class="gp-btn"  data-action="news"     type="button"><span>📰</span> News<span class="gp-badge" id="gp-news-count" style="display:none">0</span></button>' +
          '<button class="gp-btn"  data-action="schedule" type="button"><span>📅</span> Schedule</button>' +
          '<button class="gp-btn"  data-action="offreq"   type="button" id="gp-btn-off"><span>📝</span> ' + esc(nextMonth) + ' Off</button>' +
          '<button class="gp-btn gp-logout" data-action="logout" type="button">LOG OUT</button>' +
        '</div>' +
      '</header>' +
      '<main id="staff-main"></main>';

    document.querySelector(".gp-actions").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]"); if (!btn) return;
      var a = btn.dataset.action;
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

    renderLanding();
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
      '<div id="checkin-nag-slot"></div>' +
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
    document.getElementById("tile-cashup").onclick   = renderCashup;
    refreshCheckinNag();
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
    // Exclude staff currently on maternity / annual leave (already away).
    // Managers stay in the picker — addOffRequest routes their entries to
    // boa_mgr_requests_v1 and techs to boa_tech_requests_v1, both of which
    // the HR portal already reads.
    var cats     = await window.APP_DATA.categorizeStaff(new Date(), { activeOnly: true });
    var staff    = cats.active;
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
    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>📅 Schedule</h2>' +
          '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
        '</div>' +
        '<div class="sched-picker">' +
          '<button class="sched-picker-btn" data-kind="mgr" type="button">' +
            '<span class="sched-picker-icon">👔</span>' +
            '<span class="sched-picker-lbl">Manager Schedule</span>' +
            '<span class="sched-picker-sub">SMs, AMs &amp; Senior SMs</span>' +
          '</button>' +
          '<button class="sched-picker-btn" data-kind="tech" type="button">' +
            '<span class="sched-picker-icon">💅</span>' +
            '<span class="sched-picker-lbl">Nail Tech Schedule</span>' +
            '<span class="sched-picker-sub">All nail technicians</span>' +
          '</button>' +
        '</div>' +
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

  // out of renderSchedule so the picker can call it without re-running
  // the picker UI. Back button returns to the picker.
  async function renderScheduleKind(kind, ym) {
    var isMgr = kind === "mgr";
    var label = isMgr ? "Manager Schedule" : "Nail Tech Schedule";
    var icon  = isMgr ? "👔" : "💅";
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
        '<div class="sched-period">' + esc(window.APP_DATA.periodLabel(ym)) + ' · View only · last approved version</div>' +
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
    var sched = await window.APP_DATA.getSchedule(ym, kind);
    var grid  = (sched && sched.grid) || {};
    var days  = window.APP_DATA.periodDays(ym);
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
      if (!s.employee_code || !grid[s.employee_code]) return false;
      if (isMgr ? !isManagerStaff(s) : isManagerStaff(s)) return false;
      var xfer = (s.transferring && s.transfer_date) ? s.transfer_date : null;
      if (xfer) {
        if (s.transfer_to && s.transfer_to !== thisBranch && cycStartYmd && xfer <= cycStartYmd) return false;
        if (s.transfer_to === thisBranch && s.branch !== thisBranch && cycEndYmd && xfer > cycEndYmd) return false;
      }
      return true;
    });
    rows.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });

    var body = document.getElementById("sched-body");
    if (rows.length === 0) {
      body.innerHTML = '<div class="empty">No ' + (isMgr ? "manager" : "nail tech") + ' schedule has been posted for this period yet, or ' + (isMgr ? "managers" : "techs") + " don't have employee codes matching the HR portal.</div>";
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
        var cell = !blanked && grid[s.employee_code] && grid[s.employee_code][d.day];
        var classes = '';
        if (d.isToday) classes += ' sched-today';
        if (weekStartAt(d, i)) classes += ' sched-week-start';
        if (cell) {
          // Hover-only full time on Manager view so the cell stays
          // visually clean but the exact hours are reachable on tap.
          var _title = "";
          if (isMgr && (cell === "W" || cell === "WE" || cell === "WL" || cell === "WM" || cell === "WB" || cell === "E")) {
            var _dt = new Date(d.year, d.monthIdx, d.day);
            var _hrs = _shiftTimes(s.role, cell, thisBranch, _dt.getDay());
            if (_hrs) _title = ' title="' + esc(_hrs) + '"';
          }
          html += '<td class="sched-cell sched-st-' + cell + classes + '"' + _title + '>' + cell + '</td>';
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
              '<span class="sched-legend-note">Today highlighted</span>' +
            '</div>';
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
      allStaff.forEach(function (s) { if (s && s.branch && s.branch !== thisBranch) branchesToCheck[s.branch] = true; });
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
      if (s.branch === thisBranch) return false;
      if (alreadyIncomingEcs[s.employee_code]) return false;
      var grid = schedByBranch[s.branch];
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
          '<div class="bt-row" data-ec="' + esc(s.employee_code) + '" data-name="' + esc(s.name || "") + '" data-branch="' + esc(s.branch || "") + '" ' +
              'style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#fff;border:1px solid var(--pink-100);border-radius:12px">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:700;color:var(--pink-900);font-size:14px">' + esc(s.name || "(no name)") + '</div>' +
              '<div style="font-size:11px;color:var(--gray-500);margin-top:2px">' +
                '<span style="font-family:monospace">' + esc(s.employee_code || "—") + '</span> · 📍 ' + esc(s.branch || "—") +
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
      if ((c.role || "nt") === "am") return false;
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

    var trialHtml = "";
    if (myTrialCand.length > 0) {
      var today = window.APP_DATA.todayStr();
      trialHtml = '<div class="dly-section-head" style="margin-top:20px">📍 Trial Candidates</div>' +
        myTrialCand.map(function(c) {
          var checkinMap = c.checkins || {};
          var workedDays = Object.values(checkinMap).filter(function(st) { return st === "on" || st === "late"; }).length;
          var currentStatus = checkinMap[today];
          
          var buttonsHtml = statusButtons.map(function(b) {
            var isActive = currentStatus === b.code;
            return '<button type="button" class="trial-act dly-act-' + b.code +
                   (isActive ? ' dly-act-active' : '') +
                   '" style="padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;border:1px solid #e5e7eb;background:' + (isActive ? '#BE185D' : '#fff') + ';color:' + (isActive ? '#fff' : '#374151') + ';cursor:pointer" ' +
                   'data-id="' + esc(c._id) + '" data-status="' + b.code + '">' + b.label + '</button>';
          }).join("");
          
          return '<div class="dly-row" style="display:flex;flex-direction:column;gap:8px;padding:10px 14px;background:#fff;border:1px solid #FBCFE8;border-radius:12px;margin-bottom:8px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<div>' +
                '<div style="font-weight:700;color:#BE185D;font-size:14px">' + esc(c.name || "(no name)") + '</div>' +
                '<div style="font-size:11px;color:var(--gray-500);margin-top:2px">' +
                  'Status: ' + esc(c.status) + ' · Worked Days: ' + workedDays + '/5' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              buttonsHtml +
            '</div>' +
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
      return '<div class="dly-row' + (hasStatus ? ' dly-confirmed' : '') + ((isLocked || loanedOut) ? ' dly-locked' : '') + (loanedOut ? ' dly-row-loaned' : '') + '" data-ec="' + esc(s.employee_code) + '" data-id="' + s.id + '" data-name="' + esc(s.name) + '">' +
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
  // Opens a full-screen camera overlay (rear-facing) so the staff member can
  // photograph the Yoco machine screen showing the day's transaction totals.
  // Returns Promise<dataUrl|null>. Cancel / camera-denied returns null.
  function captureYocoPhoto() {
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.id = "yoco-cam-overlay";
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;font-family:inherit";
      overlay.innerHTML =
        '<div style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px;text-align:center">📸 Photograph the Yoco Balances</div>' +
        '<div style="color:#9ca3af;font-size:12px;margin-bottom:14px;text-align:center;max-width:420px;line-height:1.5">' +
          'Point the camera at the Yoco machine screen showing today\'s transaction totals, then tap <strong style="color:#fff">Capture</strong>.' +
        '</div>' +
        '<div style="position:relative;background:#000;border-radius:12px;overflow:hidden;max-width:520px;width:100%">' +
          '<video id="yoco-cam-video" autoplay playsinline muted style="display:block;width:100%;max-height:60vh;background:#000"></video>' +
          '<canvas id="yoco-cam-still" style="display:none;width:100%;max-height:60vh"></canvas>' +
        '</div>' +
        '<div id="yoco-cam-controls" style="margin-top:14px;display:flex;gap:10px"></div>';
      document.body.appendChild(overlay);

      var stream = null;
      var videoEl = document.getElementById("yoco-cam-video");
      var stillEl = document.getElementById("yoco-cam-still");
      var controls = document.getElementById("yoco-cam-controls");
      var lastDataUrl = null;

      function cleanup(result) {
        try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_e) { }
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(result);
      }
      function showLive() {
        videoEl.style.display = "block";
        stillEl.style.display = "none";
        controls.innerHTML =
          '<button id="yoco-cam-cancel" style="padding:10px 18px;border-radius:9px;border:1px solid rgba(255,255,255,0.3);background:transparent;color:#fff;font-family:inherit;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="yoco-cam-capture" style="padding:10px 22px;border-radius:9px;border:none;background:#BE185D;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">📸 Capture</button>';
        document.getElementById("yoco-cam-cancel").onclick = function () { cleanup(null); };
        document.getElementById("yoco-cam-capture").onclick = doCapture;
      }
      function showStill() {
        videoEl.style.display = "none";
        stillEl.style.display = "block";
        controls.innerHTML =
          '<button id="yoco-cam-retake" style="padding:10px 18px;border-radius:9px;border:1px solid rgba(255,255,255,0.3);background:transparent;color:#fff;font-family:inherit;font-size:13px;cursor:pointer">↺ Retake</button>' +
          '<button id="yoco-cam-confirm" style="padding:10px 22px;border-radius:9px;border:none;background:#16a34a;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">✓ Confirm</button>';
        document.getElementById("yoco-cam-retake").onclick = showLive;
        document.getElementById("yoco-cam-confirm").onclick = function () { cleanup(lastDataUrl); };
      }
      function doCapture() {
        var vw = videoEl.videoWidth || 640, vh = videoEl.videoHeight || 480;
        var maxDim = 1200;
        var ratio = Math.min(maxDim / vw, maxDim / vh, 1);
        var w = Math.round(vw * ratio), h = Math.round(vh * ratio);
        stillEl.width = w; stillEl.height = h;
        stillEl.getContext("2d").drawImage(videoEl, 0, 0, w, h);
        lastDataUrl = stillEl.toDataURL("image/jpeg", 0.8);
        showStill();
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Camera not available on this device/browser.\n\nA photo of the Yoco balances is required. Open the kiosk over HTTPS in a supported browser, then try again.");
        cleanup(null);
        return;
      }

      navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      })
        .then(function (s) { stream = s; videoEl.srcObject = s; showLive(); })
        .catch(function (err) {
          alert("Camera access denied: " + (err.message || err) + "\n\nA photo of the Yoco balances is required. Allow camera in browser settings, then try again.");
          cleanup(null);
        });
    });
  }

  // ---------------- Cash-up ----------------
  async function renderCashup() {
    setSublabel("Cash Up");
    setMain(
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>Cash Up</h2>' +
          '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
        '</div>' +
        '<div id="cashup-body">Loading…</div>' +
      '</div>'
    );
    document.getElementById("back-home").onclick = function () { _backHandler(); };

    if (!window.APP_DATA || !window.APP_DATA.isConfigured()) {
      document.getElementById("cashup-body").innerHTML = configMissingHtml();
      return;
    }

    var existing = await window.APP_DATA.todaysCashup();
    if (existing) {
      document.getElementById("cashup-body").innerHTML =
        '<div class="result-card result-ok">' +
          '<div class="result-icon">✓</div>' +
          '<div class="result-title">Today\'s cash-up already submitted</div>' +
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
      var cashBankedYes = document.getElementById("cu-banked-yes").checked;
      var cashBankedNo  = document.getElementById("cu-banked-no").checked;
      var cashBanked    = cashBankedYes ? true : (cashBankedNo ? false : null);
      try {
        await window.APP_DATA.addCashup({
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
        setTimeout(renderCashup, 800);
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
    var b = branchName || "";

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
      if (dow === 6) return "09:00 - 18:00";
      if (dow === 0) return "08:00 - 17:00";
      if (isSM) return "08:00 - 17:00";
      if (code === "WE") return "09:00 - 18:00";
      if (code === "WB") return "08:00 - 17:00";
      return "10:00 - 19:00";
    }
    if (b === "Ballito" || b === "Mall of the South") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) return "08:00 - 17:00";
      if (code === "WE") return "08:00 - 17:00";
      if (code === "WM") return "09:00 - 18:00";
      return "10:00 - 19:00";
    }
    if (b === "Fourways") {
      if (isSM) {
        if (code === "WL") return "11:00 - 20:00";
        return "08:00 - 17:00";
      }
      if (dow === 0) {
        if (code === "WE") return "08:00 - 17:00";
        return "10:00 - 19:00";
      }
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
    return "09:30 - 18:30";
  }
  // Compact a "HH:MM - HH:MM" range so it fits in a narrow grid cell:
  //   "09:00 - 18:00" → "9–18"
  //   "08:30 - 17:00" → "8:30–17"
  //   "09:30 - 18:30" → "9:30–18:30"
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
      lines.push("AM Mon–Fri · WE 09:00–18:00 · WL 10:00–19:00 · WB 08:00–17:00");
      lines.push("Saturday — single 09:00–18:00 shift");
      lines.push("Sunday — single 08:00–17:00 shift");
    } else if (b === "Ballito" || b === "Mall of the South") {
      lines.push("SM — 08:00–17:00 every day");
      lines.push("AM Mon–Sat · WM 09:00–18:00 · WL 10:00–19:00");
      lines.push("Sunday — single 08:00–17:00 shift");
    } else if (b === "Fourways") {
      lines.push("SM / SSM — WE 08:00–17:00 · WL 11:00–20:00 (rotated when 2+ on duty)");
      lines.push("AM Mon–Sat · WM 10:00–19:00 · WL 11:00–20:00");
      lines.push("AM Sunday · WE 08:00–17:00 · WL 10:00–19:00");
    } else {
      lines.push("SM / SSM — 08:00–17:00 every day");
      lines.push("AM Mon–Fri — 09:30–18:30");
      lines.push("AM Saturday — 09:00–18:00");
      lines.push("AM Sunday — 08:30–17:00");
    }
    var rows = lines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join("");
    return '<div class="sched-hours-banner">' +
             '<div class="sched-hours-banner-title">🕐 Manager hours · ' + esc(b || "this store") + '</div>' +
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
        var code = String(ec).toUpperCase();
        if (/\dM$/.test(code) || /^M\d/.test(code)) continue;   // manager code
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
    refreshCheckinNag:  function () { return refreshCheckinNag.apply(null, arguments); }
  };
})();
