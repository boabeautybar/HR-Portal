/* ============================================================
   BOA Check-in App — Manager Dashboard
   ------------------------------------------------------------
   Landing: 4 big tiles
     1. Nail Tech Check-in   (daily attendance grid — shared with staff)
     2. Manager Check-in     (PIN + selfie clock-in/out)
     3. Cash Up              (daily totals form — shared with staff)
     4. Request <next month> Off  (off-day request — shared with staff)

   The shared flows live in staff-app.js and are exposed on
   window.BOA_FLOWS so we don't duplicate hundreds of lines here.
   On boot we configure BOA_FLOWS so its "← Back" button returns
   to renderManagerLanding (instead of the staff landing).

   Manager-only screens (Staff CRUD, Today's Check-ins, Cash-up
   history) live behind header buttons.
   ============================================================ */
(function () {
  var cfg = window.APP_CONFIG || {};
  if (cfg._picker) return;     // branch picker showing — skip bootstrapping


  // PWA Install Prompt handling
  var deferredInstallPrompt = window.globalDeferredPrompt || null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    window.globalDeferredPrompt = e;
    var btn = document.getElementById("pwa-install-btn");
    if (btn) btn.style.display = "inline-flex";
  });

  document.addEventListener("app:authed", function (e) {
    if (e.detail.role !== "manager") return;
    boot();
  });

  function getGreeting() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return "Good morning";
    if (h >= 12 && h < 17) return "Good afternoon";
    if (h >= 17 && h < 21) return "Good evening";
    return "Good night";
  }

  async function boot() {
    var root = document.getElementById("app-root");
    if (!root) return;

    // Wire the shared staff-flow render functions to write into OUR container,
    // and route their "← Back" button to the manager landing.
    if (window.BOA_FLOWS) {
      window.BOA_FLOWS.configure({
        mainElId: "staff-main",
        onBack: renderManagerLanding
      });
    }

    root.innerHTML =
      '<header class="app-header gp-header">' +
      '<div class="gp-greeting">' +
      '<div class="gp-greeting-line">' + esc(getGreeting()) + ' · ' + esc(cfg.branchDisplayName || cfg.branchName || "BOA Check-in") + '</div>' +
      '<div class="gp-sublabel" id="gp-sublabel">MANAGER</div>' +
      '</div>' +
      '<div class="gp-actions">' +
      '<button class="gp-btn" id="pwa-install-btn" style="display:none; margin-right:12px; font-weight:700;" type="button"><span>⬇️</span> Install to Device</button>' +
      '<button class="gp-btn"  data-action="home"     type="button"><span>🏠</span> Home</button>' +
      '<button class="gp-btn"  data-action="news"     type="button"><span>📰</span> News<span class="gp-badge" id="gp-news-count" style="display:none">0</span></button>' +
      '<button class="gp-btn"  data-action="schedule" type="button"><span>📅</span> Schedule</button>' +
      '<button class="gp-btn"  data-action="staff"    type="button"><span>👥</span> Staff</button>' +
      '<button class="gp-btn"  data-action="today"    type="button"><span>🕒</span> Today</button>' +
      '<button class="gp-btn"  data-action="cashlist" type="button"><span>📊</span> Cash History</button>' +
      '<button class="gp-btn gp-logout" data-action="logout" type="button">LOG OUT</button>' +
      '</div>' +
      '</header>' +
      '<main id="staff-main"></main>';

    document.querySelector(".gp-actions").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]"); if (!btn) return;
      var a = btn.dataset.action;
      if (a === "logout") { window.APP_LOGOUT(); return; }
      // While the store-open gate is showing, only LOG OUT is allowed —
      // every other nav action is blocked so the manager can't navigate
      // away from the gate without first marking the store as open.
      if (document.body.classList.contains("store-gate-active")) return;
      if (a === "home") { renderManagerLanding(); return; }
      if (a === "news" && window.BOA_FLOWS) { window.BOA_FLOWS.renderNews(); return; }
      if (a === "schedule" && window.BOA_FLOWS) { window.BOA_FLOWS.renderSchedule(); return; }
      if (a === "staff") { renderStaff(); return; }
      if (a === "today") { renderCheckins(); return; }
      if (a === "cashlist") { renderCashups(); return; }
    });

    // PWA Install Button Logic
    var installBtn = document.getElementById("pwa-install-btn");
    var isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (installBtn && !isStandalone) {
      if ('onbeforeinstallprompt' in window) {
        if (window.globalDeferredPrompt) {
          installBtn.style.display = "inline-flex";
        } else {
          setTimeout(function() {
            if (window.globalDeferredPrompt) installBtn.style.display = "inline-flex";
            else installBtn.style.display = "none";
          }, 800);
        }
      } else {
        installBtn.style.display = "inline-flex";
      }

      window.addEventListener('appinstalled', function() {
        installBtn.style.display = "none";
      });

      installBtn.addEventListener("click", async function () {
        if (isIos) {
          alert("To install this app on your iOS device:\n\n1. Tap the Share button (square with an up arrow)\n2. Select 'Add to Home Screen'");
        } else if (deferredInstallPrompt || window.globalDeferredPrompt) {
          var pwaPrompt = deferredInstallPrompt || window.globalDeferredPrompt;
          pwaPrompt.prompt();
          var choiceResult = await pwaPrompt.userChoice;
          if (choiceResult.outcome === 'accepted') {
            installBtn.style.display = "none";
          }
          deferredInstallPrompt = null;
          window.globalDeferredPrompt = null;
        } else {
          // Fallback if browser doesn't offer the programmatic prompt
          var ua = navigator.userAgent.toLowerCase();
          if (ua.indexOf('firefox') > -1) {
            alert("Firefox does not natively support installing web apps. Please open this page in Chrome, Safari, or Edge to install the Kiosk.");
          } else if (ua.indexOf('safari') > -1 && ua.indexOf('chrome') === -1) {
            alert("To install this app on Mac Safari:\n\n1. Click the Share button (square with an up arrow) at the top right\n2. Select 'Add to Dock'");
          } else {
            alert("To install this app to your computer, look for the 'Install' icon in your browser's address bar (near the bookmark star) or use the browser menu.");
          }
        }
      });
    }

    if (window.BOA_FLOWS) {
      window.BOA_FLOWS.refreshNewsBadge();
      setInterval(window.BOA_FLOWS.refreshNewsBadge, 60 * 1000);
      // Keep the "submit your check-in" warning live while the landing is open.
      setInterval(window.BOA_FLOWS.refreshCheckinNag, 60 * 1000);
    }

    // ── Store-open gate ─────────────────────────────────────────
    // Before anything else, check whether someone has marked the store as
    // open today. If not, show the gate and block all nav buttons (except
    // LOG OUT). Once opened we fall through to the normal landing.
    if (configMissing()) { renderManagerLanding(); return; }
    try {
      var opened = await window.APP_DATA.getStoreOpenedToday();
      if (opened && opened.openedAt) {
        renderManagerLanding();
      } else {
        renderOpenStoreGate();
      }
    } catch (err) {
      console.warn("store-open check failed; falling back to landing:", err);
      renderManagerLanding();
    }
  }

  // ---------------- Store-open gate ----------------
  // Earliest time of day at which a manager is allowed to mark the store
  // as open. Hard-coded to 06:30. Pulled out so it's easy to tweak later.
  var OPEN_GATE_HOUR = 6;
  var OPEN_GATE_MINUTE = 30;

  function setHeaderGated(gated) {
    if (gated) document.body.classList.add("store-gate-active");
    else document.body.classList.remove("store-gate-active");
    var actions = document.querySelectorAll(".gp-actions > button[data-action]");
    actions.forEach(function (b) {
      if (b.dataset.action === "logout") return;
      b.style.display = gated ? "none" : "";
    });
  }

  // Returns the minutes-until-allowed for the given Date, or 0 if it's
  // currently >= OPEN_GATE_HOUR:OPEN_GATE_MINUTE.
  function minutesUntilOpenAllowed(now) {
    var nowMins = now.getHours() * 60 + now.getMinutes();
    var gate = OPEN_GATE_HOUR * 60 + OPEN_GATE_MINUTE;
    return Math.max(0, gate - nowMins);
  }

  function fmtClock(d) {
    var p = function (n) { return String(n).padStart(2, "0"); };
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function renderOpenStoreGate() {
    setSublabel("OPEN THE STORE");
    setHeaderGated(true);

    setMain(
      '<div class="hero hero-big">' +
      '<div class="hero-brand">' + esc(cfg.branchDisplayName || cfg.branchName || "BOA Check-in") + ' · Manager</div>' +
      '<div class="hero-title">Open the store to continue</div>' +
      '</div>' +
      '<section class="panel" style="max-width:560px;margin:0 auto;text-align:center;padding:34px 28px">' +
      '<div style="font-size:64px;line-height:1;margin-bottom:14px">🔐</div>' +
      '<h2 style="margin:0 0 8px;font-family:\'Playfair Display\',serif;color:#831843;font-size:26px">Mark Store as Open</h2>' +
      '<p style="color:#6B7280;margin:0 0 22px;font-size:14px;line-height:1.5">' +
      'You must mark the store as open before using any other check-in features. ' +
      'The time will be recorded.' +
      '</p>' +
      '<div style="max-width:380px;margin:0 auto 18px;text-align:left">' +
      '<label for="sg-name" style="display:block;font-weight:700;margin-bottom:6px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#831843">Who is opening the store?</label>' +
      '<input id="sg-name" type="text" autocomplete="off" placeholder="Your full name" ' +
      'style="width:100%;padding:14px 16px;border:2px solid #FBCFE8;border-radius:10px;font-size:16px;font-family:inherit;background:#fff;box-sizing:border-box" />' +
      '</div>' +
      '<button id="sg-btn" type="button" disabled ' +
      'style="display:inline-flex;align-items:center;justify-content:center;gap:10px;' +
      'min-width:280px;padding:18px 26px;border:none;border-radius:14px;' +
      'background:#BE185D;color:#fff;font-family:inherit;font-size:17px;font-weight:800;' +
      'letter-spacing:0.02em;text-transform:uppercase;cursor:pointer;' +
      'box-shadow:0 12px 28px rgba(190,24,93,0.35);transition:all .15s;' +
      'opacity:0.55">' +
      '<span style="font-size:22px">🔓</span> Mark Store as Open' +
      '</button>' +
      '<div id="sg-status" style="margin-top:16px;font-size:13px;color:#6B7280;min-height:18px">&nbsp;</div>' +
      '</section>'
    );

    var nameEl = document.getElementById("sg-name");
    var btnEl = document.getElementById("sg-btn");
    var statEl = document.getElementById("sg-status");
    var tickHandle = null;
    var submitting = false;

    function updateButtonState() {
      if (submitting) return;
      var name = (nameEl.value || "").trim();
      var nameOk = name.length >= 2;
      var minsToWait = minutesUntilOpenAllowed(new Date());
      var timeOk = minsToWait === 0;
      var enabled = nameOk && timeOk;
      btnEl.disabled = !enabled;
      btnEl.style.opacity = enabled ? "1" : "0.55";
      btnEl.style.cursor = enabled ? "pointer" : "not-allowed";
      if (!timeOk) {
        statEl.textContent =
          "Store opening is available from " +
          String(OPEN_GATE_HOUR).padStart(2, "0") + ":" + String(OPEN_GATE_MINUTE).padStart(2, "0") +
          ". Current time " + fmtClock(new Date()) + " · please wait.";
        statEl.style.color = "#9CA3AF";
      } else if (!nameOk) {
        statEl.textContent = "Enter your name to enable the button.";
        statEl.style.color = "#9CA3AF";
      } else {
        statEl.textContent = "Ready when you are.";
        statEl.style.color = "#16a34a";
      }
    }

    nameEl.addEventListener("input", updateButtonState);

    // Re-evaluate every 15 seconds so the 06:30 lockout lifts automatically
    // for an early manager waiting at the tablet.
    tickHandle = setInterval(updateButtonState, 15 * 1000);
    updateButtonState();
    setTimeout(function () { try { nameEl.focus(); } catch (_e) { } }, 50);

    btnEl.addEventListener("click", async function () {
      if (btnEl.disabled || submitting) return;
      var name = (nameEl.value || "").trim();
      if (name.length < 2) { updateButtonState(); return; }
      if (minutesUntilOpenAllowed(new Date()) > 0) { updateButtonState(); return; }

      submitting = true;
      btnEl.disabled = true;
      btnEl.style.opacity = "0.7";
      nameEl.disabled = true;
      statEl.style.color = "#6B7280";
      statEl.textContent = "Saving…";

      try {
        var rec = await window.APP_DATA.markStoreOpened(name);
        if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
        statEl.style.color = "#16a34a";
        var openedAtClock = fmtClock(new Date(rec.openedAt));
        statEl.textContent = "✓ Store opened at " + openedAtClock + " by " + rec.openedBy + ". Loading…";
        setTimeout(function () {
          setHeaderGated(false);
          renderManagerLanding();
        }, 700);
      } catch (err) {
        submitting = false;
        btnEl.disabled = false;
        nameEl.disabled = false;
        btnEl.style.opacity = "1";
        statEl.style.color = "#B91C1C";
        statEl.textContent = "Couldn't save: " + (err && err.message ? err.message : err);
      }
    });
  }

  function setMain(html) {
    var el = document.getElementById("staff-main");
    if (el) el.innerHTML = html;
  }
  function setSublabel(t) {
    var e = document.getElementById("gp-sublabel"); if (e) e.textContent = t;
  }

  // Reminders panel — read-only "Today's reminders" cards shown above
  // the tile grid on the manager landing. Broadcast-only: the HR portal
  // writes records to boa_daily_tasks_v1 with target:"kiosk" and an
  // optional branches list; the kiosk fetches its slice on demand.
  // The panel is hidden until at least one matching reminder is found.
  function renderKioskRemindersHtml(items) {
    var DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var today = new Date();
    var dowLong = DOW_LONG[today.getDay()];
    var doneCount = items.filter(function (t) { return t._doneTodayHere; }).length;
    var allDone = doneCount === items.length;
    var headerBg = allDone
      ? "linear-gradient(135deg,#dcfce7 0%,#FFFFFF 60%)"
      : "linear-gradient(135deg,#FCE7F3 0%,#FFFFFF 60%)";
    var headerBorder = allDone ? "#86efac" : "#F472B6";
    var headerShadow = allDone ? "rgba(34,197,94,0.18)" : "rgba(244,114,182,0.18)";
    var cards = items.map(function (t) {
      var weekly = t.kind === "weekly";
      var done = !!t._doneTodayHere;
      var bar = done ? "#16a34a" : "#BE185D";
      var btnHtml = done
        ? '<button type="button" data-task-id="' + esc(t._id) + '" data-undo="1" class="kiosk-rem-btn" style="background:#fff;color:#15803d;border:1px solid #86efac;border-radius:10px;padding:10px 14px;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;white-space:nowrap">✓ Done · tap to undo</button>'
        : '<button type="button" data-task-id="' + esc(t._id) + '" data-undo="0" class="kiosk-rem-btn" style="background:#BE185D;color:#fff;border:none;border-radius:10px;padding:12px 20px;cursor:pointer;font-size:13px;font-weight:800;font-family:inherit;white-space:nowrap;box-shadow:0 2px 6px rgba(190,24,93,0.35)">✓ Mark done</button>';
      return (
        '<div style="background:#fff;border:1px solid ' + (done ? "#bbf7d0" : "#FBCFE8") + ';border-left:6px solid ' + bar + ';border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 1px 4px rgba(190,24,93,0.08);opacity:' + (done ? "0.85" : "1") + '">' +
        '<div style="font-size:22px;line-height:1">' + (done ? "✅" : "📌") + '</div>' +
        '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">' +
        '<span style="font-family:\'Outfit\',system-ui,sans-serif;font-size:16px;font-weight:800;color:#831843;text-decoration:' + (done ? "line-through" : "none") + '">' + esc(t.title || "") + '</span>' +
        (weekly
          ? '<span style="background:#ede9fe;color:#5b21b6;border:1px solid #ddd6fe;padding:1px 7px;border-radius:6px;font-size:9px;font-weight:800;letter-spacing:0.06em">WEEKLY</span>'
          : '') +
        '</div>' +
        (t.description
          ? '<div style="font-size:12px;color:#4b5563;white-space:pre-wrap;line-height:1.35">' + esc(t.description) + '</div>'
          : '') +
        (done && t._doneAtHere
          ? '<div style="font-size:10px;color:#15803d;font-weight:700;margin-top:4px">Ticked at ' + esc(new Date(t._doneAtHere).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })) + '</div>'
          : '') +
        '</div>' +
        btnHtml +
        '</div>'
      );
    }).join("");
    return (
      '<div style="background:' + headerBg + ';border:2px solid ' + headerBorder + ';border-radius:18px;padding:16px 20px;margin-bottom:18px;box-shadow:0 4px 18px ' + headerShadow + '">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<div style="font-size:24px">📋</div>' +
      '<div>' +
      '<div style="font-family:\'Outfit\',system-ui,sans-serif;font-size:10px;font-weight:800;color:' + (allDone ? "#15803d" : "#BE185D") + ';letter-spacing:0.18em;text-transform:uppercase">Today\'s Reminders</div>' +
      '<div style="font-family:\'Outfit\',system-ui,sans-serif;font-size:18px;font-weight:800;color:#831843;line-height:1.15;margin-top:1px">' +
      esc(dowLong) + ' · ' + items.length + ' reminder' + (items.length === 1 ? "" : "s") +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div style="background:' + (allDone ? "#16a34a" : "#BE185D") + ';color:#fff;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:0.04em">' +
      doneCount + ' / ' + items.length + ' done' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' + cards + '</div>' +
      '</div>'
    );
  }
  function loadKioskRemindersIntoPanel() {
    var panel = document.getElementById("kiosk-reminders");
    if (!panel) return;
    if (!window.APP_DATA || !window.APP_DATA.listKioskReminders) return;
    window.APP_DATA.listKioskReminders().then(function (items) {
      // Re-fetch the panel in case the user navigated away.
      var p = document.getElementById("kiosk-reminders");
      if (!p) return;
      if (!items || items.length === 0) { p.style.display = "none"; return; }
      p.innerHTML = renderKioskRemindersHtml(items);
      p.style.display = "block";
      wireKioskReminderButtons();
    }).catch(function (e) {
      console.warn("loadKioskReminders failed:", e);
    });
  }
  // Home-screen "haven't clocked in" nag — surfaces the same warning
  // the Manager Clock-in screen already shows per-row, here as a single
  // banner above the tiles so a manager passing the home screen sees
  // their colleagues' missing clock-ins without drilling in.
  async function loadMgrClockinNagIntoPanel() {
    var slot = document.getElementById("mgr-clockin-nag-slot");
    if (!slot) return;
    if (!window.APP_DATA || !window.APP_DATA.listAllManagers) return;
    try {
      var nowD = new Date();
      var todayK = _ymdToday(nowD);
      var cutH = (cfg.clockInWarningCutoffHour != null ? cfg.clockInWarningCutoffHour : 9);
      var cutM = (cfg.clockInWarningCutoffMinute != null ? cfg.clockInWarningCutoffMinute : 30);
      var nowMins = nowD.getHours() * 60 + nowD.getMinutes();
      if (nowMins < cutH * 60 + cutM) { slot.style.display = "none"; return; }

      var thisBranch = (cfg.branchName || "");
      var mgrs = await window.APP_DATA.listAllManagers();
      var hereMgrs = (mgrs || []).filter(function (m) { return m && m.branch === thisBranch; });
      if (hereMgrs.length === 0) { slot.style.display = "none"; return; }

      // Today's schedule for this branch's managers. getSchedule expects
      // an END-month ym (see the comment in renderMgrClockin) so we pass
      // currentMonth+1 if we're past the 25th, else just currentMonth —
      // the helper subtracts one internally to land on the right cycle
      // row. Without this we read last month's cell at this day-of-month
      // and a manager who was scheduled to WORK on the same date last
      // cycle but is OFF today incorrectly flagged as "not clocked in".
      var schedByEc = {};
      var _endY = nowD.getFullYear(), _endM = nowD.getMonth() + 1;
      if (nowD.getDate() >= 25) { _endM += 1; if (_endM > 12) { _endM = 1; _endY += 1; } }
      var schedYm = _endY + "-" + String(_endM).padStart(2, "0");
      try {
        if (window.APP_DATA.getSchedule) {
          var res = await window.APP_DATA.getSchedule(schedYm, "mgr");
          var grid = (res && res.grid) || {};
          Object.keys(grid).forEach(function (ec) {
            var row = grid[ec] || {};
            var v = row[todayK] != null ? row[todayK] : row[nowD.getDate()];
            if (v != null) schedByEc[ec] = v;
          });
        }
      } catch (_) {}
      var isWorking = function (v) { return v === "W" || v === "WL" || v === "WE" || v === "WB" || v === "WM" || v === "E"; };

      // Who clocked in already, who's been ROM-tagged.
      var clockedInEcs = {};
      try {
        var recent = await window.APP_DATA.listRecentManagerClockins(2);
        (recent || []).forEach(function (r) {
          if (!r || !r.staff || r.type !== "in") return;
          var k = (function () { var d = new Date(r.ts); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })();
          if (k !== todayK) return;
          clockedInEcs[String(r.staff.employee_code || "").trim()] = true;
        });
      } catch (_) {}
      var taggedStaffIds = {};
      try {
        if (window.APP_DATA.listManagerDayStatusesToday) {
          var tagged = await window.APP_DATA.listManagerDayStatusesToday();
          (tagged || []).forEach(function (r) { if (r && r.staff_id) taggedStaffIds[r.staff_id] = true; });
        }
      } catch (_) {}

      var missing = hereMgrs.filter(function (m) {
        var ec = String(m.employee_code || "").trim();
        if (!isWorking(schedByEc[ec])) return false;     // not scheduled today
        if (clockedInEcs[ec]) return false;              // already in
        if (taggedStaffIds[m.id]) return false;          // ROM explained
        return true;
      });

      if (missing.length === 0) { slot.style.display = "none"; return; }
      var names = missing.map(function (m) { return esc(m.name); }).join(", ");
      slot.innerHTML =
        '<div class="mgr-home-nag">' +
          '<div class="mgr-home-nag-icon">⚠</div>' +
          '<div class="mgr-home-nag-body">' +
            '<div class="mgr-home-nag-title">Manager' + (missing.length === 1 ? "" : "s") + " not clocked in yet</div>" +
            '<div class="mgr-home-nag-sub">' + names + " &mdash; no clock-in means an unpaid day. Open <strong>Manager Check-in</strong> to clock in.</div>" +
          '</div>' +
        '</div>';
      slot.style.display = "block";
    } catch (e) {
      console.warn("mgr-clockin-nag load failed:", e);
      slot.style.display = "none";
    }
  }
  // Wire every '✓ Mark done' / 'tap to undo' button on the reminders
  // panel. Tapping disables the button while the Supabase write is in
  // flight, then re-renders the panel from a fresh listKioskReminders
  // so the badge counts + side-bar colours update atomically.
  function wireKioskReminderButtons() {
    var btns = document.querySelectorAll(".kiosk-rem-btn");
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.onclick = function () {
          if (btn.disabled) return;
          var taskId = btn.getAttribute("data-task-id");
          var undo = btn.getAttribute("data-undo") === "1";
          btn.disabled = true;
          btn.textContent = undo ? "Undoing…" : "Saving…";
          var fn = undo ? window.APP_DATA.markKioskReminderUndone : window.APP_DATA.markKioskReminderDone;
          fn(taskId).then(function () {
            loadKioskRemindersIntoPanel();
          }).catch(function (e) {
            console.error("kiosk reminder write failed:", e);
            alert("Could not update reminder: " + ((e && e.message) || e));
            loadKioskRemindersIntoPanel();
          });
        };
      })(btns[i]);
    }
  }

  // ---------------- Tile landing ----------------
  function renderManagerLanding() {
    setSublabel("HOME");
    var nextMonth = window.APP_DATA ? window.APP_DATA.nextMonthLabel().split(" ")[0] : "Off";
    setMain(
      '<div class="hero hero-big">' +
      '<div class="hero-brand">' + esc(cfg.branchDisplayName || cfg.branchName || "BOA Check-in") + ' · Manager</div>' +
      '<div class="hero-title">What would you like to do?</div>' +
      '</div>' +
      // Big blinking warning when today's nail-tech check-in hasn't been
      // submitted yet (and it's past 10:30) — populated async below.
      '<div id="checkin-nag-slot"></div>' +
      // Reminders panel — populated async right after this innerHTML write.
      // Hidden by default; only flips visible when there's at least one
      // reminder firing today for this branch.
      '<div id="kiosk-reminders" style="display:none"></div>' +
      // "Haven't clocked in" nag — same logic as the per-row pill on the
      // Manager Clock-in screen, surfaced here on the home screen so it
      // catches a manager who walks in, opens the tablet, and stops at
      // the landing. Populated async by loadMgrClockinNagIntoPanel.
      '<div id="mgr-clockin-nag-slot" style="display:none"></div>' +
      '<div class="tile-grid tile-grid-4">' +
      '<button class="tile tile-big" id="tile-nailtech" type="button">' +
      '<div class="tile-icon">✍️</div>' +
      '<div class="tile-label">Nail Tech Check-in</div>' +
      '<div class="tile-hint">DAILY ATTENDANCE</div>' +
      '</button>' +
      '<button class="tile tile-big" id="tile-mgrclock" type="button">' +
      '<div class="tile-icon">🕐</div>' +
      '<div class="tile-label">Manager Check-in</div>' +
      '<div class="tile-hint">CLOCK IN / OUT</div>' +
      '</button>' +
      '<button class="tile tile-big" id="tile-cashup" type="button">' +
      '<div class="tile-icon">💵</div>' +
      '<div class="tile-label">Cash Up</div>' +
      '<div class="tile-hint">SUBMIT DAILY TOTALS</div>' +
      '</button>' +
      '<button class="tile tile-big" id="tile-offreq" type="button">' +
      '<div class="tile-icon">📝</div>' +
      '<div class="tile-label">Request ' + esc(nextMonth) + ' Off</div>' +
      '<div class="tile-hint">TIME OFF NEXT MONTH</div>' +
      '</button>' +
      '<button class="tile tile-big" id="tile-voucher" type="button">' +
      '<div class="tile-icon">🎟️</div>' +
      '<div class="tile-label">Voucher Code</div>' +
      '<div class="tile-hint">SHOPIFY → FRESHA</div>' +
      '</button>' +
      '</div>'
    );
    loadKioskRemindersIntoPanel();
    loadMgrClockinNagIntoPanel();
    if (window.BOA_FLOWS) window.BOA_FLOWS.refreshCheckinNag();
    document.getElementById("tile-nailtech").onclick = function () {
      if (window.BOA_FLOWS) window.BOA_FLOWS.renderCheckin();
    };
    document.getElementById("tile-mgrclock").onclick = function () { renderMgrClockin(); };
    document.getElementById("tile-cashup").onclick = function () {
      if (window.BOA_FLOWS) window.BOA_FLOWS.renderCashup();
    };
    document.getElementById("tile-offreq").onclick = function () {
      if (window.BOA_FLOWS) window.BOA_FLOWS.renderOffRequests();
    };
    document.getElementById("tile-voucher").onclick = function () { renderVoucherLookup(); };
  }

  // ---------------- Voucher code lookup (Shopify → Fresha) ----------------
  // Shopify only shows the seller the LAST 4 of a gift-voucher code, so the
  // store's sheet maps that last-4 (+ the voucher amount) to a Fresha code.
  // The manager is required to type the client's FULL code — there's no list,
  // no partial / live search — but the match is on the last 4 only. When two
  // vouchers share the same last 4, every match is shown with its amount so
  // the manager picks the one whose amount matches the client's voucher.
  function _fmtTxnDateTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return { date: String(iso || ""), time: "" };
      return {
        date: d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }),
        time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };
    } catch (_e) { return { date: String(iso || ""), time: "" }; }
  }
  function _voucherCard(m) {
    var hasRollup = (m.txn_count != null && Number(m.txn_count) > 0);
    var face = parseFloat(String(m.amount != null ? m.amount : "").replace(/[^0-9.\-]/g, ""));
    if (isNaN(face)) face = 0;
    var balance = (m.balance != null) ? Number(m.balance) : face;
    var used    = (m.used_total != null) ? Number(m.used_total) : 0;
    var balColor = balance <= 0 ? "#b91c1c" : "#065f46";

    var html = '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:12px;padding:14px 16px;margin-top:10px">' +
      (m.amount ? '<div style="font-size:13px;font-weight:800;color:#14532d">Amount: ' + esc(String(m.amount)) + '</div>' : '') +
      '<div style="font-size:11px;font-weight:700;color:#14532d;text-transform:uppercase;letter-spacing:0.06em;margin-top:' + (m.amount ? '6' : '0') + 'px">Fresha voucher code</div>' +
      '<div style="display:flex;align-items:center;gap:12px;margin-top:4px;flex-wrap:wrap">' +
        '<code style="font-size:22px;font-weight:800;color:#065f46;letter-spacing:0.04em">' + esc(m.fresha) + '</code>' +
        '<button type="button" class="vc-copy" data-code="' + esc(m.fresha) + '" style="background:#fff;border:1px solid #86efac;color:#065f46;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer">Copy</button>' +
      '</div>';

    html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #86efac">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">' +
        '<span style="font-size:12px;font-weight:700;color:#14532d;text-transform:uppercase;letter-spacing:0.05em">Balance remaining</span>' +
        '<span style="font-size:20px;font-weight:800;color:' + balColor + '">' + fmtMoney(balance) + '</span>' +
      '</div>';

    if (hasRollup) {
      html += '<div style="font-size:11px;color:#4b5563;margin-top:2px">Used ' + fmtMoney(used) + ' across ' + m.txn_count + ' transaction' + (Number(m.txn_count) === 1 ? '' : 's') + '</div>' +
        '<div style="margin-top:10px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr>' +
          '<th style="text-align:left;padding:4px 6px;color:#14532d;border-bottom:1px solid #86efac">Date</th>' +
          '<th style="text-align:left;padding:4px 6px;color:#14532d;border-bottom:1px solid #86efac">Time</th>' +
          '<th style="text-align:left;padding:4px 6px;color:#14532d;border-bottom:1px solid #86efac">Client</th>' +
          '<th style="text-align:left;padding:4px 6px;color:#14532d;border-bottom:1px solid #86efac">Branch</th>' +
          '<th style="text-align:left;padding:4px 6px;color:#14532d;border-bottom:1px solid #86efac">Appt ref</th>' +
          '<th style="text-align:right;padding:4px 6px;color:#14532d;border-bottom:1px solid #86efac">Amount</th>' +
        '</tr></thead><tbody>';
      (m.txns || []).forEach(function (t) {
        var dt = _fmtTxnDateTime(t.d);
        html += '<tr>' +
          '<td style="padding:4px 6px;border-bottom:1px solid #d1fae5">' + esc(dt.date) + '</td>' +
          '<td style="padding:4px 6px;border-bottom:1px solid #d1fae5">' + esc(dt.time) + '</td>' +
          '<td style="padding:4px 6px;border-bottom:1px solid #d1fae5">' + esc(String(t.c || "")) + '</td>' +
          '<td style="padding:4px 6px;border-bottom:1px solid #d1fae5">' + esc(String(t.b || "")) + '</td>' +
          '<td style="padding:4px 6px;border-bottom:1px solid #d1fae5"><code style="font-size:11px">' + esc(String(t.ap || "")) + '</code></td>' +
          '<td style="padding:4px 6px;border-bottom:1px solid #d1fae5;text-align:right">' + fmtMoney(t.a) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div style="font-size:11px;color:#4b5563;margin-top:2px">Not used yet — full balance.</div>';
    }
    html += '</div></div>';
    return html;
  }
  async function renderVoucherLookup() {
    setSublabel("Voucher Code");
    if (configMissing()) { setMain(configMissingHtml()); return; }
    setMain(
      '<section class="panel">' +
        '<div class="panel-head">' +
          '<h2>🎟️ Voucher Code Lookup</h2>' +
          '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
        '</div>' +
        '<div style="font-size:13px;color:#6b7280;margin-bottom:14px;line-height:1.5">' +
          'Enter the client\'s <strong>full 16-character Shopify voucher code</strong> and the <strong>voucher amount</strong>, then press <strong>Find</strong>. ' +
          'The matching Fresha code only appears once both are entered.' +
        '</div>' +
        '<form id="vc-form" autocomplete="off">' +
          '<label class="lbl" for="vc-input">Full Shopify voucher code (16 characters)</label>' +
          '<input id="vc-input" class="input" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="Type or paste the full code…">' +
          '<label class="lbl" for="vc-amount" style="margin-top:12px">Voucher amount</label>' +
          '<input id="vc-amount" class="input" type="number" inputmode="decimal" step="0.01" min="0" autocomplete="off" placeholder="e.g. 500">' +
          '<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" id="vc-find" type="submit">Find Fresha code</button></div>' +
        '</form>' +
        '<div id="vc-result" style="margin-top:16px"></div>' +
      '</section>'
    );
    document.getElementById("back-home").onclick = renderManagerLanding;

    var input    = document.getElementById("vc-input");
    var amountEl = document.getElementById("vc-amount");
    var form     = document.getElementById("vc-form");
    var resEl    = document.getElementById("vc-result");
    var findBtn  = document.getElementById("vc-find");

    // Clear any previous result the instant the code or amount is edited, so a
    // stale Fresha code is never left on screen against a different / partial entry.
    input.addEventListener("input", function () { resEl.innerHTML = ""; });
    amountEl.addEventListener("input", function () { resEl.innerHTML = ""; });

    function wireCopies() {
      Array.prototype.forEach.call(resEl.querySelectorAll(".vc-copy"), function (btn) {
        btn.onclick = function () {
          var code = btn.getAttribute("data-code") || "";
          try {
            navigator.clipboard.writeText(code).then(function () { btn.textContent = "Copied ✓"; }, function () { btn.textContent = "Copy failed"; });
          } catch (_) { btn.textContent = "Copy failed"; }
        };
      });
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var code = (input.value || "").trim();
      var amount = (amountEl.value || "").trim();
      if (!code) { resEl.innerHTML = '<div class="warn">Type the full voucher code first.</div>'; return; }
      if (!amount) { resEl.innerHTML = '<div class="warn">Enter the voucher amount too.</div>'; return; }
      findBtn.disabled = true; findBtn.textContent = "Searching…";
      try {
        var r = await window.APP_DATA.lookupFreshaVoucher(code, amount);
        if (r.tooShort) {
          resEl.innerHTML = '<div class="warn">Enter the client\'s <strong>full</strong> voucher code (at least ' + r.minLen + ' characters).</div>';
        } else if (!r.found) {
          resEl.innerHTML = '<div class="warn">No matching Fresha voucher found. Double-check the full code <strong>and the amount</strong> were entered correctly.</div>';
        } else if (r.matches.length === 1) {
          resEl.innerHTML = _voucherCard(r.matches[0]);
          wireCopies();
        } else {
          resEl.innerHTML =
            '<div class="warn" style="background:#fef3c7;border-color:#fde68a;color:#92400e">' +
              '<strong>' + r.matches.length + ' vouchers end in those digits.</strong> Pick the one whose <strong>amount</strong> matches the client\'s voucher.' +
            '</div>' +
            r.matches.map(_voucherCard).join("");
          wireCopies();
        }
      } catch (err) {
        resEl.innerHTML = '<div class="warn">Could not look that up: ' + esc((err && err.message) || err) + '</div>';
      } finally {
        findBtn.disabled = false; findBtn.textContent = "Find Fresha code";
      }
    });

    setTimeout(function () { try { input.focus(); } catch (_) {} }, 50);
  }

  // ---------------- Staff (read-only viewer) ----------------
  // Adding, removing, and re-adding staff is HR-portal-only — managers
  // can't accidentally drop a tech here. The list is still visible so
  // managers can confirm the roster shown to nail techs is correct.
  async function renderStaff() {
    setSublabel("Staff");
    if (configMissing()) { setMain(configMissingHtml()); return; }
    setMain(
      '<section class="panel">' +
      '<div class="panel-head">' +
      '<h2>👥 Staff</h2>' +
      '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
      '</div>' +
      '<div class="warn" style="margin-bottom:12px;background:#FDEEF5;border:1px solid #FBCFE8;color:#831843;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.5">' +
      'ℹ️ This list is <strong>read-only</strong>. To add, remove, or re-add a staff member, use the HR portal — changes appear here automatically.' +
      '</div>' +
      '<div id="staff-list" class="staff-list">Loading…</div>' +
      '</section>'
    );
    document.getElementById("back-home").onclick = renderManagerLanding;

    // Active staff + anyone who left in the current calendar month. Past
    // leavers (left_date before this month) are excluded so the list
    // reflects who's currently on the roster + who walked out this month.
    // The kiosk drops them on month rollover.
    //
    // We MUST consult boa_offboard_v1 in addition to the staff.left_date
    // column: HR portal's dedicated Off-boarding tab writes leftDate
    // there only — the staff row keeps active=true with no left_date.
    // Without this merge, anyone off-boarded via that tab would still
    // appear under "Current staff".
    var loaded = await Promise.all([
      window.APP_DATA.listStaff({ activeOnly: true, includeRecentLeavers: true }),
      window.APP_DATA.loadOffboarding ? window.APP_DATA.loadOffboarding() : Promise.resolve([])
    ]);
    var staff = loaded[0];
    var offList = loaded[1] || [];
    var listEl = document.getElementById("staff-list");
    if (staff.length === 0) {
      listEl.innerHTML = '<div class="empty">No staff in this branch yet. Add them in the HR portal.</div>';
      return;
    }

    var offByEc = {};
    offList.forEach(function (o) {
      if (!o || !o.ec) return;
      offByEc[String(o.ec).trim()] = o;
    });
    var todayIso = window.APP_DATA.todayStr();
    var monthStart = todayIso.slice(0, 8) + "01";

    // Split current staff from those who've left this month. Leavers go
    // in their own greyed section at the bottom, sorted by most-recent
    // leave date so the manager can see who walked out last. Historical
    // leavers (off-boarding leftDate before this month) are dropped.
    // Future leavers (leftDate still ahead) stay in "Current staff" so
    // they can still be checked in until their last day.
    var activeStaff = [];
    var leftStaff = [];
    staff.forEach(function (s) {
      var ec = s && s.employee_code && String(s.employee_code).trim();
      var off = ec ? offByEc[ec] : null;
      var eff = (off && off.leftDate) || s.left_date || null;
      if (!eff) { activeStaff.push(s); return; }
      if (eff < monthStart) return;          // historical, drop
      if (eff > todayIso) { activeStaff.push(s); return; } // future leaver
      s._leftDate = eff;
      s._offReason = (off && off.reason) || null;
      leftStaff.push(s);
    });
    leftStaff.sort(function (a, b) {
      var ad = a._leftDate || "", bd = b._leftDate || "";
      if (ad !== bd) return bd.localeCompare(ad);
      return (a.name || "").localeCompare(b.name || "");
    });

    function renderRow(s, leftMode) {
      var classes = "staff-row" + (leftMode ? " staff-inactive staff-row-left" : "");
      var trailing = "";
      if (leftMode) {
        trailing = s._leftDate
          ? ' <span class="pill pill-mute">👋 Left ' + esc(fmtDate(s._leftDate)) + '</span>'
          : ' <span class="pill pill-mute">👋 Left company</span>';
      }
      return '<div class="' + classes + '" data-id="' + s.id + '">' +
        '<div class="staff-row-main">' +
        '<div class="staff-name">' + esc(s.name) + trailing + '</div>' +
        '<div class="staff-code">' + (s.employee_code ? esc(s.employee_code) : "—") + '</div>' +
        '</div>' +
        '</div>';
    }

    // Split active and leavers further by role (managers vs nail techs)
    // so each list is grouped in the kiosk view. isManagerRow treats both the
    // role_type flag and the manager employee-code convention (e.g. B147M) as
    // manager, so a mis-tagged manager still groups with managers here.
    function isManager(s) { return window.APP_DATA.isManagerRow(s); }
    var techsActive = activeStaff.filter(function (s) { return !isManager(s); });
    var managersActive = activeStaff.filter(isManager);
    var techsLeft = leftStaff.filter(function (s) { return !isManager(s); });
    var managersLeft = leftStaff.filter(isManager);

    function section(title, rows, leftMode) {
      if (rows.length === 0) return "";
      var cls = leftMode ? "staff-section-head staff-section-head-left" : "staff-section-head";
      return '<div class="' + cls + '">' + title + ' · ' + rows.length + '</div>' +
        rows.map(function (s) { return renderRow(s, leftMode); }).join("");
    }

    var html = "";
    html += section("💅 Nail techs", techsActive, false);
    html += section("👔 Managers", managersActive, false);
    html += section("👋 Nail techs · left this month", techsLeft, true);
    html += section("👋 Managers · left this month", managersLeft, true);
    listEl.innerHTML = html;
  }

  // ---------------- Today's Check-ins ----------------
  async function renderCheckins() {
    setSublabel("Today's Check-ins");
    if (configMissing()) { setMain(configMissingHtml()); return; }
    setMain(
      '<section class="panel">' +
      '<div class="panel-head">' +
      '<h2>🕒 Today\'s Check-ins</h2>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="link-btn" id="ci-refresh">Refresh</button>' +
      '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
      '</div>' +
      '</div>' +
      '<div id="ci-body">Loading…</div>' +
      '</section>'
    );
    document.getElementById("back-home").onclick = renderManagerLanding;
    document.getElementById("ci-refresh").onclick = renderCheckins;
    var rows = await window.APP_DATA.listTodayClockins();
    if (rows.length === 0) {
      document.getElementById("ci-body").innerHTML = '<div class="empty">No check-ins yet today.</div>';
      return;
    }
    document.getElementById("ci-body").innerHTML =
      '<table class="data-table">' +
      '<thead><tr><th>Time</th><th>Name</th><th>Action</th></tr></thead>' +
      '<tbody>' +
      rows.map(function (r) {
        var name = (r.staff && r.staff.name) || "—";
        var typeLabel = r.type === "in" ? '<span class="pill pill-ok">IN</span>' : '<span class="pill pill-warn">OUT</span>';
        return '<tr><td>' + fmtTime(r.ts) + '</td><td>' + esc(name) + '</td><td>' + typeLabel + '</td></tr>';
      }).join("") +
      '</tbody>' +
      '</table>';
  }

  // ---------------- Manager Clock-in (this tab) ----------------
  // Each manager uses their own 6-digit personal PIN to clock in/out for
  // the day. After PIN, we capture a selfie (anti-buddy-punch), gate
  // clock-IN to 08:00+, and auto-clock-OUT anyone still clocked in past
  // their scheduled shift end + 1h grace.

  // GPS capture used to live here (haversine + navigator.geolocation
  // wrappers). Removed when manager clock-in/out switched to selfie-only
  // proof — the geolocation prompt added seconds of latency on flaky
  // tablet links and the photo timestamp already covers the audit.

  // Camera modal — returns Promise<dataUrl|null>. Manager taps Capture
  // (freezes a still frame) then either Retake or Confirm. Cancel returns null.
  function capturePhoto(name) {
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.id = "cam-overlay";
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;font-family:inherit";
      overlay.innerHTML =
        '<div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:10px">Selfie required for ' + esc(name || "manager") + '</div>' +
        '<div style="position:relative;background:#000;border-radius:12px;overflow:hidden;max-width:480px;width:100%">' +
        '<video id="cam-video" autoplay playsinline muted style="display:block;width:100%;max-height:60vh;background:#000"></video>' +
        '<canvas id="cam-still" style="display:none;width:100%;max-height:60vh"></canvas>' +
        '</div>' +
        '<div id="cam-controls" style="margin-top:14px;display:flex;gap:10px"></div>';
      document.body.appendChild(overlay);

      var stream = null;
      var videoEl = document.getElementById("cam-video");
      var stillEl = document.getElementById("cam-still");
      var controls = document.getElementById("cam-controls");
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
          '<button id="cam-cancel"  style="padding:10px 18px;border-radius:9px;border:1px solid rgba(255,255,255,0.3);background:transparent;color:#fff;font-family:inherit;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="cam-capture" style="padding:10px 22px;border-radius:9px;border:none;background:#BE185D;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">📸 Capture</button>';
        document.getElementById("cam-cancel").onclick = function () { cleanup(null); };
        document.getElementById("cam-capture").onclick = doCapture;
      }
      function showStill() {
        videoEl.style.display = "none";
        stillEl.style.display = "block";
        controls.innerHTML =
          '<button id="cam-retake"  style="padding:10px 18px;border-radius:9px;border:1px solid rgba(255,255,255,0.3);background:transparent;color:#fff;font-family:inherit;font-size:13px;cursor:pointer">↺ Retake</button>' +
          '<button id="cam-confirm" style="padding:10px 22px;border-radius:9px;border:none;background:#16a34a;color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">✓ Confirm</button>';
        document.getElementById("cam-retake").onclick = showLive;
        document.getElementById("cam-confirm").onclick = function () { cleanup(lastDataUrl); };
      }
      function doCapture() {
        stillEl.width = 400; stillEl.height = 500;
        var ctx = stillEl.getContext("2d");
        var vw = videoEl.videoWidth || 400, vh = videoEl.videoHeight || 500;
        // Cover crop to 4:5
        var srcAspect = vw / vh, dstAspect = 400 / 500;
        var sx, sy, sw, sh;
        if (srcAspect > dstAspect) {
          sh = vh; sw = vh * dstAspect; sx = (vw - sw) / 2; sy = 0;
        } else {
          sw = vw; sh = vw / dstAspect; sx = 0; sy = (vh - sh) / 2;
        }
        ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, 400, 500);
        lastDataUrl = stillEl.toDataURL("image/jpeg", 0.7);
        showStill();
      }

      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 800 }, height: { ideal: 1000 } }, audio: false })
        .then(function (s) { stream = s; videoEl.srcObject = s; showLive(); })
        .catch(function (err) {
          alert("Camera access denied: " + (err.message || err) + "\n\nClock-in needs a selfie. Allow camera in browser settings, then try again.");
          cleanup(null);
        });
    });
  }

  // Fallback auto-out ts when we don't have a manager's scheduled end —
  // e.g. the schedule isn't published yet, or the cell is empty. Used as
  // a safety net only; the normal path resolves to the exact shift end.
  function eveningTs(yyyy_mm_dd) {
    var p = (yyyy_mm_dd || "").split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setHours(cfg.autoClockOutHour || 18, cfg.autoClockOutMinute || 30, 0, 0);
    return d.toISOString();
  }
  // Parse "HH:MM - HH:MM" → { startH, startM, endH, endM } using the end.
  function _parseShiftEnd(rangeStr) {
    if (!rangeStr) return null;
    var m = /(\d{1,2}):(\d{2})\s*$/.exec(rangeStr);
    if (!m) return null;
    return { h: +m[1], m: +m[2] };
  }
  // Build a Date for a (ymd, role, code, branch) tuple at the manager's
  // scheduled shift END time. Returns null if we can't resolve it (no
  // schedule code, unknown role, etc.) — callers fall back to the
  // configured cutoff.
  function _scheduledEndDate(ymd, role, code, branchName) {
    if (!ymd || !code) return null;
    if (typeof shiftTimes !== "function") return null;
    var p = ymd.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var range = shiftTimes(role, code, branchName, d.getDay());
    var hm = _parseShiftEnd(range);
    if (!hm) return null;
    d.setHours(hm.h, hm.m, 0, 0);
    return d;
  }
  function _ymdToday(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function dateKeyOf(iso) {
    var d = new Date(iso);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // Auto-close any "in" entries that don't have a same-day "out"/"out_auto"
  // after them, where the day is in the past OR (the day is today AND
  // current time >= 18:30). Returns a Set of EC codes that got auto-outed
  // YESTERDAY (used for the warning banner today).
  // Auto-out logic:
  //   1. Find each manager's last "in" today / on past days with no out.
  //   2. Look up their SCHEDULED shift end (role + code + branch + dow).
  //   3. Trigger the auto-out only AFTER scheduledEnd + 1 hour grace, but
  //      stamp the recorded ts at scheduledEnd EXACTLY — managers can't
  //      sneak in overtime by simply leaving the kiosk and forgetting
  //      to clock out.
  //   4. When the schedule isn't available (no published cell, unknown
  //      role, etc.) fall back to the legacy 18:30 cutoff.
  // schedLookup: optional fn (ec, ymd) → schedule code, mgrByEc: optional
  // map ec → manager record carrying role + branch.
  async function ensureAutoOuts(recentRows, schedLookup, mgrByEc) {
    var groups = {};                                 // {ec: {ymd: [rows...]}}
    recentRows.forEach(function (r) {
      var ec = r.staff && r.staff.employee_code; if (!ec) return;
      var k = dateKeyOf(r.ts);
      groups[ec] = groups[ec] || {};
      groups[ec][k] = groups[ec][k] || [];
      groups[ec][k].push(r);
    });
    var now = new Date();
    var todayK = _ymdToday(now);
    var legacyCutoffPassed = (now.getHours() > (cfg.autoClockOutHour || 18)) ||
      (now.getHours() === (cfg.autoClockOutHour || 18) && now.getMinutes() >= (cfg.autoClockOutMinute || 30));
    var graceMs = ((cfg.autoClockOutGraceHours != null ? cfg.autoClockOutGraceHours : 1) * 60 * 60 * 1000);
    var yesterdayDate = new Date(now); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    var yesterdayK = _ymdToday(yesterdayDate);
    var autoOutedYesterday = {};
    for (var ec in groups) {
      for (var k in groups[ec]) {
        var dayRows = groups[ec][k].slice().sort(function (a, b) { return a.ts.localeCompare(b.ts); });
        var last = dayRows[dayRows.length - 1];
        if (last.type !== "in") {
          if ((last.type === "out_auto") && k === yesterdayK) autoOutedYesterday[ec] = last;
          continue;
        }
        // last is "in" and not closed — figure out the right end time.
        var mgr = mgrByEc && mgrByEc[String(ec).trim()];
        var schedCode = schedLookup ? schedLookup(ec, k) : null;
        var schedEnd = (mgr && schedCode) ? _scheduledEndDate(k, mgr.role, schedCode, mgr.branch || (last.staff && last.staff.branch)) : null;
        var endIso, fireCutoff;
        if (schedEnd) {
          // Auto-out only past (scheduled end + grace). Record at scheduled end.
          fireCutoff = new Date(schedEnd.getTime() + graceMs);
          endIso = schedEnd.toISOString();
        } else {
          // Fallback: legacy 18:30 hard cutoff.
          fireCutoff = new Date(k.split("-").map(Number)[0], k.split("-").map(Number)[1] - 1, k.split("-").map(Number)[2],
            (cfg.autoClockOutHour || 18), (cfg.autoClockOutMinute || 30), 0, 0);
          endIso = eveningTs(k);
        }
        var isPast = k < todayK;
        var isTodayAndPastCutoff = (k === todayK) && (now >= fireCutoff);
        if (!isPast && !isTodayAndPastCutoff) continue;
        try {
          await window.APP_DATA.addManagerClockinWithMeta(last.staff_id, "out_auto", {
            tsOverride: endIso,
            flags: ["auto_clockout"]
          });
          if (k === yesterdayK) autoOutedYesterday[ec] = { type: "out_auto", ts: endIso };
        } catch (e) { console.warn("Auto-out failed for", ec, k, e); }
      }
    }
    return autoOutedYesterday;
  }

  async function renderMgrClockin() {
    setSublabel("Manager Clock-in");
    if (configMissing()) { setMain(configMissingHtml()); return; }
    setMain(
      '<section class="panel">' +
      '<div class="panel-head">' +
      '<h2>🕐 Manager Clock-in</h2>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="link-btn" id="mc-refresh">Refresh</button>' +
      '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
      '</div>' +
      '</div>' +
      '<div id="mc-warn"></div>' +
      '<div id="mc-hint" style="font-size:13px;color:#9ca3af;margin-bottom:12px">' +
      'Tap Clock In or Clock Out → enter your 6-digit PIN → take a quick selfie. ' +
      'Earliest clock-in is 08:00. Anyone still clocked in past their shift end + 1h grace is auto-clocked-out at their scheduled end time.' +
      '</div>' +
      '<div id="mc-body">Loading…</div>' +
      '</section>'
    );
    document.getElementById("back-home").onclick = renderManagerLanding;
    document.getElementById("mc-refresh").onclick = renderMgrClockin;

    var pins, mgrs, recent, smTrialEcs, trialCand, mgrTaggedStaffIds = {};
    var schedByEcYmd = {};
    // Resolve current + previous cycle ym (25th-of-month convention) up
    // front so we can fire the schedule loads in parallel below.
    var _nowD0 = new Date();
    var todayK = _ymdToday(_nowD0);
    var _todayDow = _nowD0.getDay();
    // Start-month YM for the current + previous cycle (25 → 24 convention).
    // _curCycleYm = "2026-05" means the May 25 → June 24 cycle.
    var _curCycleY = _nowD0.getFullYear(), _curCycleM = _nowD0.getMonth() + 1;
    if (_nowD0.getDate() < 25) { _curCycleM -= 1; if (_curCycleM < 1) { _curCycleM = 12; _curCycleY -= 1; } }
    var _curCycleYm = _curCycleY + "-" + String(_curCycleM).padStart(2, "0");
    var _prevCycleY = _curCycleY, _prevCycleM = _curCycleM - 1;
    if (_prevCycleM < 1) { _prevCycleM = 12; _prevCycleY -= 1; }
    var _prevCycleYm = _prevCycleY + "-" + String(_prevCycleM).padStart(2, "0");
    // getSchedule(ym, "mgr") expects an END-month ym (tech convention) and
    // does endYm − 1 internally to compute the manager start-month key.
    // We hold start-month YMs above (so _ingestSched re-keys cells against
    // the right cycle), so pass END = startMonth + 1 to the loader.
    function _endYmOf(startYm) {
      var p = startYm.split("-"); var y = +p[0], m = +p[1] + 1;
      if (m > 12) { m = 1; y += 1; }
      return y + "-" + String(m).padStart(2, "0");
    }
    var _curEndYm  = _endYmOf(_curCycleYm);
    var _prevEndYm = _endYmOf(_prevCycleYm);
    function _ingestSched(ym, res) {
      var grid = (res && res.grid) || {};
      var ymP = ym.split("-").map(Number);
      var startY = ymP[0], startM = ymP[1];
      Object.keys(grid).forEach(function (ec) {
        var row = grid[ec] || {};
        Object.keys(row).forEach(function (k) {
          var v = row[k]; if (!v) return;
          var ymd;
          if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
            ymd = k;
          } else {
            var dom = parseInt(k, 10);
            if (!isFinite(dom)) return;
            var y = startY, m = startM;
            if (dom < 25) { m += 1; if (m > 12) { m = 1; y += 1; } }
            ymd = y + "-" + String(m).padStart(2, "0") + "-" + String(dom).padStart(2, "0");
          }
          (schedByEcYmd[ec] = schedByEcYmd[ec] || {})[ymd] = v;
        });
      });
    }
    // Load managers FIRST so the clockins query can filter server-side
    // by their staff_ids — clockins is dominated by nail-tech rows and
    // the previous unfiltered query was downloading hundreds of irrelevant
    // rows per render. Everything else fires in parallel after the IDs
    // are known.
    try {
      var _stage1 = await Promise.all([
        window.APP_DATA.loadManagerPins(),
        window.APP_DATA.listAllManagers(),
        window.APP_DATA.activeSmTrialEcs ? window.APP_DATA.activeSmTrialEcs() : Promise.resolve({}),
        window.APP_DATA.listTrialCandidates ? window.APP_DATA.listTrialCandidates() : Promise.resolve([])
      ]);
      pins       = _stage1[0];
      mgrs       = _stage1[1];
      smTrialEcs = _stage1[2];
      trialCand  = _stage1[3];
      var _mgrIds = (mgrs || []).map(function (m) { return m.id; }).filter(Boolean);
      var _stage2 = await Promise.all([
        window.APP_DATA.listRecentManagerClockins(2, _mgrIds),
        window.APP_DATA.getSchedule ? window.APP_DATA.getSchedule(_curEndYm, "mgr").catch(function () { return null; }) : Promise.resolve(null),
        window.APP_DATA.getSchedule ? window.APP_DATA.getSchedule(_prevEndYm, "mgr").catch(function () { return null; }) : Promise.resolve(null),
        window.APP_DATA.listManagerDayStatusesToday ? window.APP_DATA.listManagerDayStatusesToday().catch(function () { return []; }) : Promise.resolve([])
      ]);
      recent = _stage2[0];
      _ingestSched(_curCycleYm, _stage2[1]);
      _ingestSched(_prevCycleYm, _stage2[2]);
      (_stage2[3] || []).forEach(function (r) { if (r && r.staff_id) mgrTaggedStaffIds[r.staff_id] = true; });
    } catch (e) {
      document.getElementById("mc-body").innerHTML =
        '<div class="warn">Could not load: ' + esc(e.message || e) + '</div>';
      return;
    }
    // Trial AMs at this branch — shown on the manager screen during their
    // trial weeks, no PIN. Once they pass the trial they get a real staff
    // record + PIN and move into the regular list above.
    var myTrialAMs = (trialCand || []).filter(function (c) {
      return (c.role || "nt") === "am"
        && c.branch === (cfg.branchName || "")
        && c.status && c.status.indexOf("trial") === 0;
    });
    if (mgrs.length === 0 && myTrialAMs.length === 0) {
      document.getElementById("mc-body").innerHTML = '<div class="empty">No active managers in the staff table yet.</div>';
      return;
    }

    var thisBranch = (cfg.branchName || "");
    mgrs.sort(function (a, b) {
      var aHere = a.branch === thisBranch ? 0 : 1;
      var bHere = b.branch === thisBranch ? 0 : 1;
      if (aHere !== bHere) return aHere - bHere;
      return (a.name || "").localeCompare(b.name || "");
    });

    var mgrByEc = {};
    mgrs.forEach(function (m) { if (m.employee_code) mgrByEc[String(m.employee_code).trim()] = m; });
    var _schedLookup = function (ec, ymd) {
      var row = schedByEcYmd[String(ec).trim()];
      return row ? row[ymd] : null;
    };

    // Run auto-out routine (schedule-aware) and find anyone auto-outed yesterday
    var autoYesterday = await ensureAutoOuts(recent, _schedLookup, mgrByEc);
    if (Object.keys(autoYesterday).length > 0) {
      // Rebuild recent so the per-row "today" status reflects the new auto-outs
      recent = await window.APP_DATA.listRecentManagerClockins(2);
    }

    // Today's schedule lookup for per-row hours + the "haven't clocked in" check.
    var mgrTodaySched = {};
    Object.keys(schedByEcYmd).forEach(function (ec) {
      var v = schedByEcYmd[ec][todayK];
      if (v != null) mgrTodaySched[ec] = v;
    });
    var byEc = {};
    var inTodayByEc = {};   // earliest "in" record today per ec — only one clock-in/day allowed
    // Trim ECs on BOTH sides of the lookup. Some staff records carry
    // trailing whitespace on employee_code (e.g. "B620-M ") and the
    // raw value comes back differently between listAllManagers (often
    // clean) and the staff JOIN on clockins. Without the trim the row
    // lookup misses and a manager who clocked in renders as "HAVEN'T
    // CLOCKED IN" — matches the HR portal's mLocalYmd / trim pattern.
    recent.forEach(function (r) {
      var ec = r.staff && r.staff.employee_code ? String(r.staff.employee_code).trim() : "";
      if (!ec) return;
      if (dateKeyOf(r.ts) !== todayK) return;
      if (!byEc[ec] || r.ts > byEc[ec].ts) byEc[ec] = r;
      if (r.type === "in" && (!inTodayByEc[ec] || r.ts < inTodayByEc[ec].ts)) inTodayByEc[ec] = r;
    });

    // Yesterday-auto-out summary banner
    var warnHtml = "";
    var autoNames = mgrs.filter(function (m) { return autoYesterday[String(m.employee_code || "").trim()]; }).map(function (m) { return m.name; });
    if (autoNames.length > 0) {
      warnHtml =
        '<div class="warn" style="margin-bottom:14px;background:#fee2e2;border:1px solid #fca5a5;color:#7f1d1d;border-radius:11px;padding:12px 14px;font-size:13px;line-height:1.5">' +
        '<strong>⚠ Forgot to clock out yesterday — this is an offence.</strong><br>' +
        'The following managers were auto-clocked-out at their scheduled shift end yesterday and need to remember to clock out manually today: <strong>' + autoNames.map(esc).join(", ") + '</strong>.' +
        '</div>';
    }
    document.getElementById("mc-warn").innerHTML = warnHtml;

    // "Haven't clocked in yet" warning gate. A scheduled-today manager at
    // this branch who hasn't clocked in and hasn't been tagged absent by
    // the ROM, after the configured cutoff time, gets a blinking pill so
    // colleagues at the tablet see it as a reminder. Disappears as soon
    // as they clock in, OR a ROM tags an absence on the HR portal.
    var _warnCutH = (cfg.clockInWarningCutoffHour != null ? cfg.clockInWarningCutoffHour : 9);
    var _warnCutM = (cfg.clockInWarningCutoffMinute != null ? cfg.clockInWarningCutoffMinute : 30);
    var _nowMins  = (new Date()).getHours() * 60 + (new Date()).getMinutes();
    var _pastWarnCutoff = _nowMins >= (_warnCutH * 60 + _warnCutM);
    var _isWorkingCode = function (v) { return v === "W" || v === "WL" || v === "WE" || v === "WB" || v === "WM" || v === "E"; };

    function mgrRowHtml(m) {
      // ec is the trimmed key used for every lookup table built above.
      // The raw m.employee_code might carry trailing whitespace, which
      // would mismatch against the trimmed keys in inTodayByEc / byEc /
      // mgrTodaySched and leave the manager rendering as "not clocked
      // in" even when they did. pins is keyed by raw EC (its data layer
      // doesn't trim), so we fall back to either form for the PIN check.
      var ecRaw = m.employee_code || "";
      var ec = String(ecRaw).trim();
      var has = !!(pins[ec] || pins[ecRaw]);
      var last = byEc[ec];
      var inDone = !!inTodayByEc[ec];   // already clocked in today → no second clock-in
      // An AM on an active SM trial is shown as "SM · on trial", mirroring
      // the HR portal's effective-role badge.
      var onSmTrial = m.role === "AM" && !!(smTrialEcs && smTrialEcs[String(ec).trim()]);
      var roleLabel = onSmTrial ? "SM · on trial" : m.role;
      var rolePill = roleLabel
        ? (onSmTrial
            ? ' <span class="pill" style="background:#FFF7ED;color:#9A3412;border:1px solid #FED7AA">⭐ ' + esc(roleLabel) + '</span>'
            : ' <span class="pill pill-mute">' + esc(roleLabel) + '</span>')
        : "";
      var lastLabel;
      if (!last) lastLabel = '<span class="pill pill-mute">not clocked in</span>';
      else if (last.type === "in") lastLabel = '<span class="pill pill-ok">IN ' + fmtTime(last.ts) + '</span>';
      else if (last.type === "out_auto") lastLabel = '<span class="pill pill-warn">AUTO-OUT ' + fmtTime(last.ts) + '</span>';
      else lastLabel = '<span class="pill pill-warn">OUT ' + fmtTime(last.ts) + '</span>';
      if (inDone && last && last.type !== "in") {
        lastLabel += ' <span class="pill pill-mute">clocked in ' + fmtTime(inTodayByEc[ec].ts) + '</span>';
      }
      var autoBadge = autoYesterday[ec] ? ' <span class="pill" style="background:#fee2e2;color:#7f1d1d">⚠ auto-out yesterday</span>' : "";
      // Blinking nag: scheduled, no clock-in today, not ROM-tagged, past
      // the warning cutoff time. Only nag for THIS branch's managers.
      var _nagBadge = "";
      if (m.branch === thisBranch
          && _pastWarnCutoff
          && !inTodayByEc[ec]
          && _isWorkingCode(mgrTodaySched[ec])
          && !mgrTaggedStaffIds[m.id]) {
        _nagBadge = ' <span class="mgr-clockin-nag" title="No clock-in recorded yet today. No clock-in = unpaid day. Clock in now, or ask the ROM to tag the absence reason.">⚠ HAVEN\'T CLOCKED IN</span>';
      }
      var rowCls = m.branch === thisBranch ? "" : " staff-inactive";
      // Shift hours for today, computed from the schedule code and
      // role. Only shown for managers based at this branch on a day
      // the schedule says they're working — silent otherwise so we
      // don't tell an off-duty manager "your shift is X" by mistake.
      var _schedCodeToday = mgrTodaySched[ec];
      var _isWorkingToday = _schedCodeToday === "W" || _schedCodeToday === "WL" || _schedCodeToday === "WE" || _schedCodeToday === "WM" || _schedCodeToday === "WB" || _schedCodeToday === "E";
      var shiftLine = "";
      if (m.branch === thisBranch && _isWorkingToday) {
        var _effRole = onSmTrial ? "SM" : (m.role || "");
        var _hrs = shiftTimes(_effRole, _schedCodeToday, thisBranch, _todayDow);
        shiftLine = '<div class="staff-shift-hours" style="font-size:11px;color:var(--pink-700);font-weight:700;letter-spacing:0.02em;margin-top:2px">🕐 Today · ' + esc(_hrs) + '</div>';
      }
      return '<div class="staff-row' + rowCls + '" data-id="' + m.id + '" data-ec="' + esc(ec) + '" data-name="' + esc(m.name) + '">' +
        '<div class="staff-row-main">' +
        '<div class="staff-name">' + esc(m.name) +
        rolePill +
        (m.branch !== thisBranch ? ' <span class="pill pill-mute">' + esc(m.branch || "—") + "</span>" : "") +
        (has ? "" : ' <span class="pill pill-warn">NO PIN</span>') + autoBadge + _nagBadge +
        '</div>' +
        shiftLine +
        '<div class="staff-code" style="margin-top:3px">' + lastLabel + '</div>' +
        '</div>' +
        '<div class="staff-row-actions">' +
        '<button class="btn btn-primary" data-act="clockin"  ' + (has && !inDone ? "" : 'disabled') + (inDone ? ' title="Already clocked in today"' : '') + '>Clock In</button>' +
        '<button class="link-btn"       data-act="clockout" ' + (has ? "" : 'disabled') + '>Clock Out</button>' +
        '<button class="link-btn"       data-act="overtime" ' + (has ? "" : 'disabled') + ' title="Submit overtime for ROM approval">⏱️ OT</button>' +
        '</div>' +
        '</div>';
    }

    // Only THIS store's managers are shown by default. Managers based at other
    // stores live behind a "Clock in other manager" button so the list isn't
    // cluttered with every manager in the company.
    var hereMgrs  = mgrs.filter(function (m) { return m.branch === thisBranch; });
    var otherMgrs = mgrs.filter(function (m) { return m.branch !== thisBranch; });

    // Trial AMs use the same daily-status buttons as the trial check-in
    // on the nail-tech side. They have no PIN during the trial weeks; once
    // they pass and get a real employee code they'll appear in the manager
    // list above with PIN + photo.
    var trialStatusButtons = [
      { code: "on",     label: "On Time"     },
      { code: "late",   label: "Late"        },
      { code: "sick_n", label: "Sick + note" },
      { code: "sick",   label: "Sick NO note"},
      { code: "absent", label: "Absent"      },
      { code: "no",     label: "NO SHOW"     },
      { code: "frl",    label: "FRL + proof" }
    ];
    var todayStr = window.APP_DATA.todayStr ? window.APP_DATA.todayStr() : (new Date()).toISOString().slice(0, 10);
    var trialAmHtml = "";
    if (myTrialAMs.length > 0) {
      trialAmHtml =
        '<div style="margin-top:20px">' +
          '<div style="font-size:12px;font-weight:800;color:#9A3412;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">⭐ Trial AMs · no PIN yet</div>' +
          myTrialAMs.map(function (c) {
            var checkinMap = (c.checkins && !Array.isArray(c.checkins)) ? c.checkins : {};
            var workedDays = Object.values(checkinMap).filter(function (st) { return st === "on" || st === "late"; }).length;
            var currentStatus = checkinMap[todayStr];
            var btns = trialStatusButtons.map(function (b) {
              var isActive = currentStatus === b.code;
              return '<button type="button" class="trial-act dly-act-' + b.code +
                     (isActive ? ' dly-act-active' : '') +
                     '" style="padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;border:1px solid #e5e7eb;background:' + (isActive ? '#BE185D' : '#fff') + ';color:' + (isActive ? '#fff' : '#374151') + ';cursor:pointer" ' +
                     'data-id="' + esc(c._id) + '" data-status="' + b.code + '">' + b.label + '</button>';
            }).join("");
            return '<div class="dly-row" style="display:flex;flex-direction:column;gap:8px;padding:10px 14px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;margin-bottom:8px">' +
              '<div style="display:flex;justify-content:space-between;align-items:center">' +
                '<div>' +
                  '<div style="font-weight:700;color:#9A3412;font-size:14px">' + esc(c.name || "(no name)") +
                    ' <span class="pill" style="background:#fff;color:#9A3412;border:1px solid #FED7AA">⭐ trial AM</span>' +
                  '</div>' +
                  '<div style="font-size:11px;color:var(--gray-500);margin-top:2px">' +
                    'Status: ' + esc(c.status) + ' · Worked Days: ' + workedDays + '/5' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' + btns + '</div>' +
            '</div>';
          }).join("") +
        '</div>';
    }

    document.getElementById("mc-body").innerHTML =
      '<div class="staff-list">' +
      (hereMgrs.length
        ? hereMgrs.map(mgrRowHtml).join("")
        : '<div class="empty">No managers are based at ' + esc(thisBranch || "this store") + ' yet.</div>') +
      '</div>' +
      trialAmHtml +
      (otherMgrs.length
        ? '<button id="mc-show-others" type="button" ' +
            'style="margin-top:14px;width:100%;background:#fff;color:var(--pink-700);border:2px solid var(--pink-200);border-radius:10px;padding:11px 14px;font-weight:700;font-size:14px;cursor:pointer">' +
            '➕ Clock in other manager (' + otherMgrs.length + ' from other stores)' +
          '</button>' +
          '<div id="mc-others" style="display:none;margin-top:12px">' +
            '<div style="font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Managers from other stores</div>' +
            '<div class="staff-list">' + otherMgrs.map(mgrRowHtml).join("") + '</div>' +
          '</div>'
        : "");

    // Wire trial-AM status buttons. Same flow as the nail-tech trial
    // section: tap a status → recordTrialCheckin → re-render.
    Array.prototype.forEach.call(document.querySelectorAll("#mc-body .trial-act"), function (btn) {
      btn.onclick = async function () {
        if (btn.disabled) return;
        var candidateId = btn.dataset.id;
        var status = btn.dataset.status;
        var row = btn.closest(".dly-row");
        var acts = row.querySelectorAll(".trial-act");
        Array.prototype.forEach.call(acts, function (el) { el.disabled = true; });
        try {
          await window.APP_DATA.recordTrialCheckin(candidateId, status);
          await renderMgrClockin();
        } catch (e) {
          alert("Could not record check-in: " + ((e && e.message) || e));
          Array.prototype.forEach.call(acts, function (el) { el.disabled = false; });
        }
      };
    });

    var showOthersBtn = document.getElementById("mc-show-others");
    if (showOthersBtn) {
      showOthersBtn.onclick = function () {
        var box = document.getElementById("mc-others");
        if (!box) return;
        var willOpen = box.style.display === "none";
        box.style.display = willOpen ? "" : "none";
        showOthersBtn.innerHTML = willOpen
          ? "▲ Hide other stores' managers"
          : "➕ Clock in other manager (" + otherMgrs.length + " from other stores)";
      };
    }

    var rows = document.querySelectorAll('#mc-body .staff-row');
    Array.prototype.forEach.call(rows, function (row) {
      var inBtn = row.querySelector('[data-act="clockin"]');
      var outBtn = row.querySelector('[data-act="clockout"]');
      var id = row.dataset.id;
      var ec = row.dataset.ec;
      var name = row.dataset.name;

      var doClock = async function (type) {
        // 1. Time gate (clock-IN only)
        if (type === "in") {
          var nowH = new Date().getHours();
          var earliest = (cfg.clockInEarliestHour != null ? cfg.clockInEarliestHour : 8);
          if (nowH < earliest) {
            alert("Earliest clock-in is " + String(earliest).padStart(2, "0") + ":00.\n\nIt's only " + new Date().toLocaleTimeString() + " — wait until " + String(earliest).padStart(2, "0") + ":00 then try again.");
            return;
          }
        }
        // 1b. Early-clock-out picker. Resolve THIS manager's scheduled
        // shift end for today (role + code + branch + dow). If they're
        // clocking out more than `earlyClockOutGraceMinutes` (default 20)
        // before that end time → prompt for a reason. The short hours
        // saved to the early-leave sidecar = scheduledEnd − now.
        // Fallback when we can't resolve the schedule (no published cell,
        // unknown role, etc.) is the legacy fixed-hour cutoff so we
        // never let a too-early clock-out slip through silently.
        var earlyOpts = null;
        if (type === "out") {
          var nowD = new Date();
          var graceMin = (cfg.earlyClockOutGraceMinutes != null ? cfg.earlyClockOutGraceMinutes : 20);
          var schedCodeToday = mgrTodaySched[ec];
          var _mForOut = mgrByEc[String(ec).trim()];
          var schedEndToday = (_mForOut && schedCodeToday) ? _scheduledEndDate(todayK, _mForOut.role, schedCodeToday, _mForOut.branch || thisBranch) : null;
          var promptForReason = false;
          var hoursShort = 0;
          if (schedEndToday) {
            var minsToEnd = Math.round((schedEndToday.getTime() - nowD.getTime()) / 60000);
            if (minsToEnd > graceMin) {
              promptForReason = true;
              hoursShort = Math.min(12, Math.max(0.5, Math.round((minsToEnd / 60) * 2) / 2));
            }
          } else {
            var earlyCutH = (cfg.earlyClockOutCutoffHour != null ? cfg.earlyClockOutCutoffHour : 17);
            if (nowD.getHours() < earlyCutH) {
              promptForReason = true;
              var minsShort = (earlyCutH * 60) - (nowD.getHours() * 60 + nowD.getMinutes());
              hoursShort = Math.min(12, Math.max(0.5, Math.round((minsShort / 60) * 2) / 2));
            }
          }
          if (promptForReason) {
            earlyOpts = await openMgrEarlyClockoutModal({ name: name, defaultHours: hoursShort });
            if (!earlyOpts) return;          // user cancelled
          }
        }
        // 2. PIN
        var entered = prompt("Enter " + name + "'s 6-digit personal PIN:");
        if (entered == null) return;
        entered = entered.trim();
        if (!/^\d{6}$/.test(entered)) { alert("PIN must be exactly 6 digits."); return; }
        if (entered !== pins[ec]) { alert("Wrong PIN."); return; }
        // 3. One clock-in per day — hard-block a second clock-in (no override).
        //    Clock-out can still be re-recorded with a confirm.
        if (type === "in" && inTodayByEc[ec]) {
          alert(name + " already clocked in today at " + fmtTime(inTodayByEc[ec].ts) + ".\n\nOnly one clock-in per day is allowed.");
          return;
        }
        var last = byEc[ec];
        if (type === "out" && last && last.type === "out") {
          if (!confirm(name + " is already clocked out today (" + fmtTime(last.ts) + "). Record another clock-out anyway?")) return;
        }
        // 4. Photo — the selfie alone is enough proof for manager clock-in/out.
        // GPS was previously captured here too but added latency on flaky
        // tablet connections (the geolocation prompt blocks for seconds)
        // and the photo timestamp + clock-in time already cover the audit.
        var meta = { flags: [] };
        var dataUrl = await capturePhoto(name);
        if (!dataUrl) return;        // user cancelled
        meta.photoDataUrl = dataUrl;

        // 6. Save. Clock-in/out goes first; early-leave reason is best-effort
        // and won't roll back the clock-out if writing the sidecar fails (we
        // surface the error but the clock-out already landed).
        try {
          await window.APP_DATA.addManagerClockinWithMeta(id, type, meta);
        } catch (e) {
          alert("Could not record: " + (e.message || e));
          return;
        }
        if (earlyOpts) {
          try {
            // dayKey + ym match the sidecar's convention: cycle uses START-
            // month, dayKey is the day-of-month (1–31).
            var _now2  = new Date();
            var _y = _now2.getFullYear(), _m = _now2.getMonth() + 1, _d = _now2.getDate();
            var _ym2; if (_d > 24) { var nm = _m + 1, ny = _y; if (nm > 12) { nm = 1; ny += 1; } _ym2 = ny + "-" + String(nm).padStart(2, "0"); } else { _ym2 = _y + "-" + String(_m).padStart(2, "0"); }
            await window.APP_DATA.recordEarlyLeave(_ym2, String(_d), ec, earlyOpts.hours, name, {
              reasonCode: earlyOpts.reasonCode,
              reasonNote: earlyOpts.reasonNote,
              approver:   earlyOpts.approver
            });
          } catch (e) {
            alert("Clock-out saved, but the early-leave reason couldn't be recorded: " + (e.message || e) + "\n\nAsk the ROM to record it manually from the HR portal.");
          }
        }
        // Post-clock-out witness prompt: catch colleagues who walked out
        // without clocking out (so no early-leave reason was logged). The
        // clocking-out manager names them; the report goes to boa_mgr_early_reports_v1
        // for ROM review. Skipped on clock-in.
        if (type === "out") {
          try {
            var report = await openMgrEarlyLeaveReportModal({ name: name });
            if (report && report.names) {
              await window.APP_DATA.submitEarlyLeaveReport({
                reportedByEc:   ec,
                reportedByName: name,
                names:          report.names,
                note:           report.note || ""
              });
            }
          } catch (e) { console.warn("early-leave report save failed:", e); }
        }
        renderMgrClockin();
      };
      if (inBtn) inBtn.onclick = function () { doClock("in"); };
      if (outBtn) outBtn.onclick = function () { doClock("out"); };
      var otBtn = row.querySelector('[data-act="overtime"]');
      if (otBtn) otBtn.onclick = async function () {
        // PIN-gate the submission so a colleague can't tap OT for someone
        // else and get them paid extra.
        var entered = prompt("Enter " + name + "'s 6-digit personal PIN to submit overtime:");
        if (entered == null) return;
        entered = (entered || "").trim();
        if (!/^\d{6}$/.test(entered)) { alert("PIN must be exactly 6 digits."); return; }
        if (entered !== pins[ec]) { alert("Wrong PIN."); return; }
        var result = await openMgrOvertimeModal({ name: name });
        if (!result) return;
        try {
          await window.APP_DATA.submitOvertimeRequest({
            ec: ec,
            name: name,
            branch: thisBranch,
            date: result.date,
            hours: result.hours,
            reason: result.reason,
            submittedBy: name
          });
          alert("✓ Overtime submitted for ROM approval.\n\n" + result.hours + "h on " + result.date + " — you'll see it as Approved on the HR portal once a ROM signs off.");
        } catch (e) {
          alert("Could not submit overtime: " + (e.message || e));
        }
      };
    });
  }

  // ---------------- Early-clock-out reason modal (manager) ----------------
  // Resolves to { reasonCode, reasonNote, hours } or null if cancelled.
  // The default hours equals (cutoff − now) so the modal opens with the
  // expected short-hours pre-filled; the manager can edit.
  function openMgrEarlyClockoutModal(opts) {
    return new Promise(function (resolve) {
      var prev = document.getElementById("boa-mgr-early-modal");
      if (prev) prev.remove();
      var modal = document.createElement("div");
      modal.id = "boa-mgr-early-modal";
      modal.className = "boa-modal-backdrop";
      modal.innerHTML =
        '<div class="boa-modal-card">' +
          '<h2 class="boa-modal-title">🏃 Leaving early — ' + esc(opts.name) + '</h2>' +
          '<p class="boa-modal-body">' +
            'You\'re clocking out before the end of your shift. The hours short are ' +
            'deducted from this pay cycle — describe why, and name the ROM or ' +
            'manager who approved going home early.' +
          '</p>' +
          '<label class="lbl" style="margin-top:14px">Explanation</label>' +
          '<textarea id="boa-mgr-early-note" class="input" rows="3" ' +
            'placeholder="e.g. doctor at 14:30, feeling dizzy, kids sick, etc." autocomplete="off"></textarea>' +
          '<label class="lbl" style="margin-top:10px">Approved by</label>' +
          '<input id="boa-mgr-early-approver" type="text" class="input" ' +
            'placeholder="ROM or manager name" autocomplete="off">' +
          '<label class="lbl" style="margin-top:10px">Hours short (30-minute intervals)</label>' +
          '<input id="boa-mgr-early-hours" type="number" class="input" min="0.5" max="12" step="0.5" ' +
            'value="' + esc(String(opts.defaultHours || 0.5)) + '" autocomplete="off">' +
          '<div id="boa-mgr-early-err" class="err-line"></div>' +
          '<div class="btn-row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">' +
            '<button type="button" class="link-btn link-btn-dark" id="boa-mgr-early-cancel">Cancel clock-out</button>' +
            '<button type="button" class="btn btn-primary" id="boa-mgr-early-save">Continue clock-out</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);

      var saveBtn = document.getElementById("boa-mgr-early-save");
      var cancelBtn = document.getElementById("boa-mgr-early-cancel");
      var hoursEl = document.getElementById("boa-mgr-early-hours");
      var noteEl  = document.getElementById("boa-mgr-early-note");
      var approverEl = document.getElementById("boa-mgr-early-approver");
      var errEl   = document.getElementById("boa-mgr-early-err");
      function close(result) { modal.remove(); resolve(result); }
      cancelBtn.onclick = function () { close(null); };
      modal.addEventListener("click", function (e) { if (e.target === modal) close(null); });
      setTimeout(function () { try { noteEl.focus(); } catch (_e) {} }, 50);

      saveBtn.onclick = function () {
        errEl.textContent = "";
        var explanation = (noteEl.value || "").trim();
        if (explanation.length < 3) { errEl.textContent = "Add a short explanation so payroll knows why."; return; }
        var approver = (approverEl.value || "").trim();
        if (approver.length < 2) { errEl.textContent = "Add the name of the ROM / manager who approved this."; return; }
        var h = Number((hoursEl.value || "").trim());
        if (!isFinite(h) || h <= 0) { errEl.textContent = "Hours must be a positive number (e.g. 1.5)."; return; }
        if (h > 12) { errEl.textContent = "12 hours is the max — please double-check."; return; }
        // Persist both fields combined into reasonNote so existing readers
        // (HR portal short-hours summary) pick them up without a schema
        // change. approver is kept on its own field too for any future UI
        // that wants to surface it separately.
        close({
          reasonCode: "early_leave",
          reasonNote: explanation + " · approved by " + approver,
          approver:   approver,
          hours:      h
        });
      };
    });
  }

  // ---------------- Witness "did anyone leave early?" prompt ----------------
  // Asked after a manager successfully clocks out, so a colleague who
  // walked out without clocking out (no reason logged, no short-hours
  // deducted) still gets reported. Resolves to:
  //   { names: "Jane Doe, Sam Smith", note: "left around 14:00" }
  //   null  → user picked "No" or dismissed
  function openMgrEarlyLeaveReportModal(opts) {
    return new Promise(function (resolve) {
      var prev = document.getElementById("boa-mgr-early-report-modal");
      if (prev) prev.remove();
      var modal = document.createElement("div");
      modal.id = "boa-mgr-early-report-modal";
      modal.className = "boa-modal-backdrop";
      modal.innerHTML =
        '<div class="boa-modal-card">' +
          '<h2 class="boa-modal-title">👀 Did anyone leave early today?</h2>' +
          '<p class="boa-modal-body">' +
            'Thanks for clocking out, ' + esc(opts.name) + '. Before you go — ' +
            'did any manager leave their shift early today without clocking out? ' +
            'A quick yes/no helps payroll catch missed deductions.' +
          '</p>' +
          '<div class="btn-row" style="justify-content:center;gap:10px;margin-top:12px">' +
            '<button type="button" class="link-btn link-btn-dark" id="boa-mgr-er-no">No, everyone stayed</button>' +
            '<button type="button" class="btn btn-primary" id="boa-mgr-er-yes">Yes, name them</button>' +
          '</div>' +
          '<div id="boa-mgr-er-detail" style="display:none;margin-top:14px">' +
            '<label class="lbl">Who left early?</label>' +
            '<input id="boa-mgr-er-names" type="text" class="input" ' +
              'placeholder="Comma-separated names" autocomplete="off">' +
            '<label class="lbl" style="margin-top:10px">Note (optional — when they left, why if you know)</label>' +
            '<textarea id="boa-mgr-er-note" class="input" rows="2" ' +
              'placeholder="e.g. around 14:00, said she was sick"></textarea>' +
            '<div id="boa-mgr-er-err" class="err-line"></div>' +
            '<div class="btn-row" style="justify-content:space-between;gap:8px;margin-top:10px">' +
              '<button type="button" class="link-btn link-btn-dark" id="boa-mgr-er-cancel">Skip</button>' +
              '<button type="button" class="btn btn-primary" id="boa-mgr-er-save">Submit report</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);

      var noBtn   = document.getElementById("boa-mgr-er-no");
      var yesBtn  = document.getElementById("boa-mgr-er-yes");
      var detail  = document.getElementById("boa-mgr-er-detail");
      var namesEl = document.getElementById("boa-mgr-er-names");
      var noteEl  = document.getElementById("boa-mgr-er-note");
      var errEl   = document.getElementById("boa-mgr-er-err");
      var saveBtn = document.getElementById("boa-mgr-er-save");
      var cancelBtn = document.getElementById("boa-mgr-er-cancel");
      function close(result) { modal.remove(); resolve(result); }
      noBtn.onclick     = function () { close(null); };
      cancelBtn.onclick = function () { close(null); };
      modal.addEventListener("click", function (e) { if (e.target === modal) close(null); });
      yesBtn.onclick = function () {
        detail.style.display = "block";
        yesBtn.style.display = "none";
        noBtn.style.display  = "none";
        setTimeout(function () { try { namesEl.focus(); } catch (_e) {} }, 50);
      };
      saveBtn.onclick = function () {
        errEl.textContent = "";
        var names = (namesEl.value || "").trim();
        if (names.length < 2) { errEl.textContent = "Add at least one name."; return; }
        close({ names: names, note: (noteEl.value || "").trim() });
      };
    });
  }

  // ---------------- Overtime submission modal (manager) ----------------
  // Submits an OT entry to the boa_overtime_v1 list (status = pending).
  // The HR portal Overtime tab approves or rejects.
  function openMgrOvertimeModal(opts) {
    return new Promise(function (resolve) {
      var prev = document.getElementById("boa-mgr-ot-modal");
      if (prev) prev.remove();
      var modal = document.createElement("div");
      modal.id = "boa-mgr-ot-modal";
      modal.className = "boa-modal-backdrop";
      var todayIso = (new Date()).toISOString().slice(0, 10);
      modal.innerHTML =
        '<div class="boa-modal-card">' +
          '<h2 class="boa-modal-title">⏱️ Submit overtime — ' + esc(opts.name) + '</h2>' +
          '<p class="boa-modal-body">' +
            'Submit overtime hours for ROM approval. Only approved hours are paid. ' +
            'Clocking in early doesn\'t count as overtime — only extra time after your shift.' +
          '</p>' +
          '<label class="lbl" style="margin-top:10px">Date</label>' +
          '<input id="boa-mgr-ot-date" type="date" class="input" value="' + esc(todayIso) + '">' +
          '<label class="lbl" style="margin-top:10px">Hours (30-minute intervals)</label>' +
          '<input id="boa-mgr-ot-hours" type="number" class="input" min="0.5" max="12" step="0.5" placeholder="e.g. 2">' +
          '<label class="lbl" style="margin-top:10px">Reason</label>' +
          '<textarea id="boa-mgr-ot-reason" class="input" rows="2" placeholder="Why was extra time needed?"></textarea>' +
          '<div id="boa-mgr-ot-err" class="err-line"></div>' +
          '<div class="btn-row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">' +
            '<button type="button" class="link-btn link-btn-dark" id="boa-mgr-ot-cancel">Cancel</button>' +
            '<button type="button" class="btn btn-primary" id="boa-mgr-ot-save">Submit for approval</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);

      var saveBtn = document.getElementById("boa-mgr-ot-save");
      var cancelBtn = document.getElementById("boa-mgr-ot-cancel");
      var dateEl = document.getElementById("boa-mgr-ot-date");
      var hrsEl  = document.getElementById("boa-mgr-ot-hours");
      var rsnEl  = document.getElementById("boa-mgr-ot-reason");
      var errEl  = document.getElementById("boa-mgr-ot-err");
      function close(result) { modal.remove(); resolve(result); }
      cancelBtn.onclick = function () { close(null); };
      modal.addEventListener("click", function (e) { if (e.target === modal) close(null); });
      saveBtn.onclick = function () {
        errEl.textContent = "";
        var d = (dateEl.value || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { errEl.textContent = "Pick a valid date."; return; }
        var h = Number((hrsEl.value || "").trim());
        if (!isFinite(h) || h <= 0) { errEl.textContent = "Hours must be a positive number."; return; }
        if (h > 12) { errEl.textContent = "12 hours is the max."; return; }
        var r = (rsnEl.value || "").trim();
        if (!r) { errEl.textContent = "Add a short reason so the approver knows the context."; return; }
        close({ date: d, hours: h, reason: r });
      };
    });
  }

  // ---------------- Cash-up history ----------------
  async function renderCashups() {
    setSublabel("Cash-up History");
    if (configMissing()) { setMain(configMissingHtml()); return; }
    setMain(
      '<section class="panel">' +
      '<div class="panel-head">' +
      '<h2>📊 Recent Cash-ups</h2>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="link-btn" id="cu-refresh">Refresh</button>' +
      '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
      '</div>' +
      '</div>' +
      '<div id="cu-body">Loading…</div>' +
      '</section>'
    );
    document.getElementById("back-home").onclick = renderManagerLanding;
    document.getElementById("cu-refresh").onclick = renderCashups;
    var rows = await window.APP_DATA.listRecentCashups(60);
    if (rows.length === 0) {
      document.getElementById("cu-body").innerHTML = '<div class="empty">No cash-ups submitted yet.</div>';
      return;
    }
    document.getElementById("cu-body").innerHTML =
      '<table class="data-table">' +
      '<thead><tr>' +
      '<th>Date</th><th>Yoco</th><th>Yoco Link</th><th>Cash</th><th>Card Tips</th><th>Vouchers purchased</th><th>Gift card</th><th>Manual Disc.</th><th>Total</th><th>Banking</th><th>Signed by</th>' +
      '</tr></thead>' +
      '<tbody>' +
      rows.map(function (r) {
        var banking = "—";
        if (r.cash_banked === true) {
          var bits = [];
          bits.push('<strong>Yes</strong>');
          if (r.amount_banked) bits.push(fmtMoney(r.amount_banked));
          if (r.banking_ref)   bits.push('ref ' + esc(r.banking_ref));
          if (r.banked_by)     bits.push('by ' + esc(r.banked_by));
          var bankingTxt = bits.join(' · ');
          var slipLink   = r.banking_slip ? ' <a href="' + r.banking_slip + '" target="_blank" rel="noopener">slip</a>' : '';
          banking = bankingTxt + slipLink;
        } else if (r.cash_banked === false) {
          banking = '<span class="pill pill-warn">Not banked</span>';
        } else if (Number(r.cash) > 0) {
          banking = '<span class="pill pill-warn">Missing</span>';
        }
        return '<tr>' +
          '<td>' + fmtDate(r.date) + '</td>' +
          '<td>' + fmtMoney(r.yoco) + '</td>' +
          '<td>' + fmtMoney(r.yoco_link) + '</td>' +
          '<td>' + fmtMoney(r.cash) + '</td>' +
          '<td>' + fmtMoney(r.card_tips) + '</td>' +
          '<td>' + fmtMoney(r.vouchers) + '</td>' +
          '<td>' + fmtMoney(r.gift_card) + '</td>' +
          '<td>' + fmtMoney(r.manual_discounts) + (r.manual_discount_reason ? ' <span class="pill pill-mute" title="' + esc(r.manual_discount_reason) + '">reason</span>' : '') + '</td>' +
          '<td><strong>' + fmtMoney(r.total) + '</strong></td>' +
          '<td>' + banking + '</td>' +
          '<td>' + esc(r.signed_by) + (r.notes ? ' <span class="pill pill-mute" title="' + esc(r.notes) + '">notes</span>' : "") + '</td>' +
          '</tr>';
      }).join("") +
      '</tbody>' +
      '</table>';
  }

  // ---------------- helpers ----------------
  function configMissing() {
    return !window.APP_DATA || !window.APP_DATA.isConfigured();
  }
  function configMissingHtml() {
    return '<div class="warn"><strong>Supabase isn\'t connected yet.</strong><br>' +
      'Open <code>config.js</code> and fill in the URL and anon key, then reload.</div>';
  }
  function fmtMoney(n) {
    var v = Number(n) || 0;
    return "R " + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    catch (_e) { return iso; }
  }
  // Mirror of the HR portal's shiftTimes() (Manager Coverage tab) so the
  // kiosk can show each manager their shift hours for today. Keep these
  // two implementations in sync — the portal one is the source of truth.
  //   role: "SM" | "SSM" | "AM"
  //   code: schedule cell value for today (W / WE / WL / WM / WB / E …)
  //   branchName: store name (matches APP_CONFIG.branchName)
  //   dow: 0=Sun … 6=Sat (Date#getDay)
  function shiftTimes(role, code, branchName, dow) {
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
    // Generic stores. Weekend override: SM flat 08:00-17:00 Sat & Sun.
    // AM Sat 09:00-18:00, Sun 08:30-17:00. Weekdays keep code-specific.
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
  function fmtDate(s) {
    try {
      var d = new Date(s + "T12:00:00");
      return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    } catch (_e) { return s; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
})();
