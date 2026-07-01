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

  // Who is doing a voucher lookup — verified by personal PIN at the gate in
  // renderVoucherLookup, so every lookup is attributable. Held for the current
  // visit to the Voucher Code screen and cleared on "← Back".
  var _voucherWho = null;       // { ec, name } once verified


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

    // Admin devices (security.js) can roam every branch — give them a one-tap
    // "Switch branch" that returns to the store picker. Branch devices are pinned
    // to their store and never see it.
    var isAdminDevice = !!window.APP_DEVICE_ADMIN;
    var switchBranchBtn = isAdminDevice
      ? '<button class="gp-btn" data-action="switchbranch" type="button"><span>🔀</span> Switch branch</button>'
      : '';

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
      '<div class="gp-header-inner">' +
      '<div class="gp-left">' +
      '<div class="boa-logo"><img class="boa-logo-img" src="boa-logo.png" alt="BOA Beauty Bar"></div>' +
      '<div class="gp-greeting">' +
      '<div class="gp-greeting-line">' + esc(getGreeting()) + ' · ' + esc(cfg.branchDisplayName || cfg.branchName || "BOA Check-in") + '</div>' +
      '<div class="gp-sublabel" id="gp-sublabel">MANAGER</div>' +
      '</div>' +
      '</div>' +
      '<div class="gp-actions">' +
      '<button class="gp-btn" id="pwa-install-btn" style="display:none; margin-right:12px; font-weight:700;" type="button"><span>⬇️</span> Install to Device</button>' +
      '<button class="gp-btn"  data-action="home"     type="button"><span>🏠</span> Home</button>' +
      switchBranchBtn +
      '<button class="gp-btn"  data-action="news"     type="button"><span>📰</span> News<span class="gp-badge" id="gp-news-count" style="display:none">0</span></button>' +
      '<button class="gp-btn"  data-action="schedule" type="button"><span>📅</span> Schedule</button>' +
      '<button class="gp-btn"  data-action="staff"    type="button"><span>👥</span> Staff</button>' +
      '<button class="gp-btn"  data-action="today"    type="button"><span>🕒</span> Today</button>' +
      '<button class="gp-btn"  data-action="cashlist" type="button"><span>📊</span> Cash History</button>' +
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

    // Quick Home button (always beside the menu on narrow screens).
    var gpHome = document.getElementById("gp-home-quick");
    if (gpHome) gpHome.addEventListener("click", function () {
      closeMenu();
      if (document.body.classList.contains("store-gate-active")) return;
      renderManagerLanding();
    });

    // Hamburger: collapse/expand the action pills on narrow screens.
    var gpToggle = document.getElementById("gp-menu-toggle");
    if (gpToggle) gpToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      if (gpActions) gpActions.classList.toggle("open");
    });
    // Tap outside the open menu closes it.
    document.addEventListener("click", function (e) {
      if (!gpActions || !gpActions.classList.contains("open")) return;
      if (gpActions.contains(e.target) || (gpToggle && gpToggle.contains(e.target))) return;
      closeMenu();
    });

    gpActions.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]"); if (!btn) return;
      var a = btn.dataset.action;
      closeMenu(); // collapse the mobile menu after any choice
      if (a === "logout") { window.APP_LOGOUT(); return; }
      // Switch branch (admin devices only): back to the store picker. Allowed
      // even during the store-open gate so an admin is never trapped on a store.
      if (a === "switchbranch") { window.location.href = window.location.pathname; return; }
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
      // Keep the "previous day's cash-up still owed" reminder live too.
      if (window.BOA_FLOWS.refreshCashupNag) setInterval(window.BOA_FLOWS.refreshCashupNag, 60 * 1000);
      // Keep the urgent "evaluation due" banner live on the landing.
      if (window.BOA_FLOWS.refreshEvalNag) setInterval(function () { if (document.getElementById("eval-due-slot")) window.BOA_FLOWS.refreshEvalNag(); }, 60 * 1000);
    }

    // ── Store-open gate ─────────────────────────────────────────
    // Before anything else, check whether someone has marked the store as
    // open today. If not, show the gate and block all nav buttons (except
    // LOG OUT). Once opened we fall through to the normal landing.
    // Admin devices roam every branch and never open/check in — skip the gate
    // and go straight to the branch home.
    if (window.APP_DEVICE_ADMIN) { renderManagerLanding(); return; }
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

      // Don't nag anyone who's on approved leave today — annual OR emergency.
      // A leave day is "no action required", not a missed clock-in. (The
      // schedule grid often still shows a working code because leave lives in
      // the Leave Calendar, so we must check leave records, not the grid.)
      var onLeave = await _onLeaveEcsToday(false);

      var missing = hereMgrs.filter(function (m) {
        var ec = String(m.employee_code || "").trim();
        if (!isWorking(schedByEc[ec])) return false;     // not scheduled today
        if (onLeave[ec]) return false;                   // on approved leave (annual or emergency)
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

  // Employee codes (ec → "el"/"al") on approved leave that covers today, read
  // from the Leave Calendar (boa_leave_v1). emergency:true → "el" (unpaid),
  // otherwise "al". Best-effort; returns {} on any failure.
  async function _onLeaveEcsToday(emergencyOnly) {
    if (!window.APP_DATA || !window.APP_DATA.listLeaveRecords) return {};
    try {
      var todayK = _ymdToday(new Date());
      var recs = await window.APP_DATA.listLeaveRecords();
      var map = {};
      (recs || []).forEach(function (r) {
        if (!r || !r.ec || !r.startDate || !r.endDate) return;
        if (emergencyOnly && r.emergency !== true) return;
        if (r.startDate <= todayK && todayK <= r.endDate) {
          var ec = String(r.ec).trim();
          // An emergency record wins over a plain one for the same ec/day.
          if (map[ec] !== "el") map[ec] = (r.emergency === true ? "el" : "al");
        }
      });
      return map;
    } catch (e) { console.warn("_onLeaveEcsToday failed:", e); return {}; }
  }

  // Calm "on emergency leave today · no action required" home-screen panel.
  // Lists this store's staff who are on EMERGENCY (unpaid) leave covering
  // today, so the manager knows not to chase them for a check-in / clock-in.
  async function loadOnLeaveTodayIntoPanel() {
    var slot = document.getElementById("mgr-on-leave-slot");
    if (!slot) return;
    if (!window.APP_DATA || !window.APP_DATA.listLeaveRecords || !window.APP_DATA.listStaff) { slot.style.display = "none"; return; }
    try {
      var leaveMap = await _onLeaveEcsToday(true);   // emergency only
      var ecs = Object.keys(leaveMap);
      if (ecs.length === 0) { slot.style.display = "none"; return; }
      // Resolve names against this branch's staff (drops anyone not here).
      var staff = await window.APP_DATA.listStaff();
      var nameByEc = {};
      (staff || []).forEach(function (s) { if (s && s.employee_code) nameByEc[String(s.employee_code).trim()] = s.name; });
      var names = [];
      ecs.forEach(function (ec) { if (nameByEc[ec]) names.push(esc(nameByEc[ec])); });
      if (names.length === 0) { slot.style.display = "none"; return; }
      slot.innerHTML =
        '<div class="mgr-home-info">' +
          '<div class="mgr-home-nag-icon">🏖️</div>' +
          '<div class="mgr-home-nag-body">' +
            '<div class="mgr-home-nag-title">On emergency leave today &middot; no action required</div>' +
            '<div class="mgr-home-nag-sub">' + names.join(", ") + ' &mdash; approved <strong>emergency leave (unpaid)</strong>. No need to chase them for a check-in or clock-in today.</div>' +
          '</div>' +
        '</div>';
      slot.style.display = "block";
    } catch (e) {
      console.warn("on-leave panel load failed:", e);
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
      // URGENT pink-neon banner when a trial tech is due her Week 1 / Final
      // evaluation — populated async by BOA_FLOWS.refreshEvalNag so managers
      // see it the moment they open the tablet, not only inside check-in.
      '<div id="eval-due-slot"></div>' +
      // Big blinking warning when today's nail-tech check-in hasn't been
      // submitted yet (and it's past 10:30) — populated async below.
      '<div id="checkin-nag-slot"></div>' +
      // Previous-day cash-up reminder — populated async by refreshCashupNag.
      '<div id="cashup-nag-slot"></div>' +
      // Reminders panel — populated async right after this innerHTML write.
      // Hidden by default; only flips visible when there's at least one
      // reminder firing today for this branch.
      '<div id="kiosk-reminders" style="display:none"></div>' +
      // "Haven't clocked in" nag — same logic as the per-row pill on the
      // Manager Clock-in screen, surfaced here on the home screen so it
      // catches a manager who walks in, opens the tablet, and stops at
      // the landing. Populated async by loadMgrClockinNagIntoPanel.
      '<div id="mgr-clockin-nag-slot" style="display:none"></div>' +
      // Extra-Day offer alert — shows when Ops has published open extra shifts.
      '<div id="ed-alert-slot" style="display:none"></div>' +
      // (Removed the "on emergency leave today" home panel — a tech on leave
      // already shows greyed out under Nail Tech Check-in, so no need to repeat
      // it big on the landing.)
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
      '<button class="tile tile-big" id="tile-guide" type="button">' +
      '<div class="tile-icon">📖</div>' +
      '<div class="tile-label">How Check-ins Work</div>' +
      '<div class="tile-hint">RULES · READ ME FIRST</div>' +
      '</button>' +
      '</div>'
    );
    loadKioskRemindersIntoPanel();
    loadMgrClockinNagIntoPanel();
    loadEdAlertIntoSlot();
    if (window.BOA_FLOWS) { window.BOA_FLOWS.refreshEvalNag(); window.BOA_FLOWS.refreshCheckinNag(); window.BOA_FLOWS.refreshCashupNag(); }
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
    document.getElementById("tile-guide").onclick = function () { renderCheckinGuide(); };
  }

  // ---------------- Extra Days (ED) ----------------
  // Off-duty managers see published ED offers, claim one with their personal PIN,
  // and can cancel a pending claim (PIN-gated, since the kiosk is shared).
  // Approval happens back in the portal. Data: boa_mgr_ed_offers_v1 /
  // boa_mgr_ed_requests_v1.
  function _edTodayYmd() {
    var n = new Date();
    return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
  }
  function _edFmtDate(ymd) {
    try { return new Date(ymd + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" }); }
    catch (_e) { return ymd; }
  }
  async function loadEdAlertIntoSlot() {
    var slot = document.getElementById("ed-alert-slot");
    if (!slot || !window.APP_DATA || !window.APP_DATA.loadEdOffers) return;
    try {
      var offers = await window.APP_DATA.loadEdOffers();
      var today = _edTodayYmd();
      var open = (offers || []).filter(function (o) { return o && o.status === "open" && o.date >= today; });
      if (!open.length) { slot.style.display = "none"; slot.innerHTML = ""; return; }
      slot.style.display = "block";
      slot.innerHTML =
        '<button type="button" id="ed-alert-btn" style="width:100%;text-align:left;border:none;cursor:pointer;background:linear-gradient(135deg,#BE185D,#E84B9B);color:#fff;border-radius:16px;padding:14px 18px;margin-bottom:14px;box-shadow:0 6px 18px rgba(190,24,93,0.28);display:flex;align-items:center;gap:14px">' +
          '<div style="font-size:26px">⭐</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:15px;font-weight:800">' + open.length + ' extra shift' + (open.length === 1 ? '' : 's') + ' available</div>' +
            '<div style="font-size:12px;opacity:0.9">Tap to view and claim an extra day.</div>' +
          '</div>' +
          '<div style="font-size:20px">›</div>' +
        '</button>';
      var btn = document.getElementById("ed-alert-btn");
      if (btn) btn.onclick = renderEdManager;
    } catch (e) { console.warn("loadEdAlertIntoSlot:", e); slot.style.display = "none"; }
  }

  async function renderEdManager() {
    setSublabel("Extra Days");
    if (configMissing()) { setMain(configMissingHtml()); return; }
    setMain(
      '<section class="panel">' +
        '<div class="panel-head"><h2>✨ Extra Days</h2><button class="link-btn link-btn-dark" id="back-home">← Back</button></div>' +
        '<div id="ed-body"><div style="padding:8px 0;color:#6b7280">Loading…</div></div>' +
      '</section>'
    );
    document.getElementById("back-home").onclick = renderManagerLanding;
    var body = document.getElementById("ed-body");
    var offers = [], requests = [];
    try {
      var loaded = await Promise.all([window.APP_DATA.loadEdOffers(), window.APP_DATA.loadEdRequests()]);
      offers = loaded[0] || []; requests = loaded[1] || [];
    } catch (e) {
      body.innerHTML = '<div class="warn">Could not load: ' + esc((e && e.message) || e) + '</div>'; return;
    }
    var today = _edTodayYmd();
    var open = offers.filter(function (o) { return o && o.status === "open" && o.date >= today; })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var pending = requests.filter(function (r) { return r && r.status === "pending"; });
    var offerById = {}; offers.forEach(function (o) { if (o) offerById[o.id] = o; });

    var html = '<div style="font-size:13px;color:#6b7280;margin-bottom:12px;line-height:1.5">Claim an extra day on one of your <strong>off days</strong>. Ops approves the best request — first to claim isn\'t guaranteed.</div>';
    if (!open.length) {
      html += '<div class="empty">No open extra days right now.</div>';
    } else {
      html += open.map(function (o) {
        var n = pending.filter(function (r) { return r.offerId === o.id; }).length;
        return '<div style="border:1px solid #FBCFE8;border-radius:14px;padding:14px 16px;margin-bottom:10px;background:#fff">' +
          '<div style="font-size:15px;font-weight:800;color:#831843">' + esc(o.branch) + ' · ' + esc(_edFmtDate(o.date)) + '</div>' +
          '<div style="font-size:13px;color:#6b7280;margin:2px 0 10px">' + esc(o.startTime || '') + '–' + esc(o.endTime || '') + (o.note ? ' · ' + esc(o.note) : '') + (n ? ' · <strong>' + n + '</strong> claimed' : '') + '</div>' +
          '<button class="btn btn-primary ed-claim" data-offer="' + esc(o.id) + '" type="button">Claim this day</button>' +
          '</div>';
      }).join('');
    }
    if (pending.length) {
      html += '<div style="font-size:11px;font-weight:800;color:#9D2B62;letter-spacing:0.06em;text-transform:uppercase;margin:18px 0 8px">Pending claims</div>';
      html += pending.map(function (r) {
        var o = offerById[r.offerId] || {};
        return '<div style="border:1px solid #FBE3EE;border-radius:12px;padding:10px 14px;margin-bottom:8px;background:#FFF7FB;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
          '<div style="min-width:0"><span style="font-weight:700;color:#831843">' + esc(r.name || r.ec) + '</span>' +
          '<span style="font-size:12px;color:#9D7387"> · ' + esc(o.branch || '') + ' ' + esc(o.date ? _edFmtDate(o.date) : '') + '</span></div>' +
          '<button class="link-btn link-btn-dark ed-cancel" data-req="' + esc(r.id) + '" data-ec="' + esc(r.ec) + '" data-name="' + esc(r.name || '') + '" type="button" style="color:#B91C1C">Cancel</button>' +
          '</div>';
      }).join('');
    }
    body.innerHTML = html;

    Array.prototype.forEach.call(body.querySelectorAll('.ed-claim'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-offer');
        var o = open.find(function (x) { return x.id === id; });
        if (o) renderEdClaim(o);
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll('.ed-cancel'), function (b) {
      b.onclick = function () { _edCancel(b.getAttribute('data-req'), b.getAttribute('data-ec'), b.getAttribute('data-name')); };
    });
  }

  async function _edCancel(reqId, ec, name) {
    var pin = prompt("Enter " + (name || "your") + "'s 6-digit PIN to cancel this request:");
    if (pin == null) return;
    pin = pin.trim();
    try {
      var pins = await window.APP_DATA.loadManagerPins();
      var want = pins[ec] || pins[String(ec).trim()];
      if (!want || pin !== String(want)) { alert("Wrong PIN."); return; }
      var ok = await window.APP_DATA.cancelEdRequest(reqId, ec);
      alert(ok ? "Request cancelled." : "Could not cancel (already decided?).");
      renderEdManager();
    } catch (e) { alert("Could not cancel: " + ((e && e.message) || e)); }
  }

  function renderEdClaim(offer) {
    setSublabel("Claim Extra Day");
    var elig = (offer.eligible || []);
    setMain(
      '<section class="panel">' +
        '<div class="panel-head"><h2>✨ Claim Extra Day</h2><button class="link-btn link-btn-dark" id="back-ed">← Back</button></div>' +
        '<div style="font-size:14px;font-weight:800;color:#831843">' + esc(offer.branch) + ' · ' + esc(_edFmtDate(offer.date)) + '</div>' +
        '<div style="font-size:13px;color:#6b7280;margin:2px 0 16px">' + esc(offer.startTime || '') + '–' + esc(offer.endTime || '') + (offer.note ? ' · ' + esc(offer.note) : '') + '</div>' +
        (elig.length
          ? '<form id="ed-claim-form" autocomplete="off">' +
              '<label class="lbl" for="ed-who">Your name (off that day)</label>' +
              '<select id="ed-who" class="input">' + elig.map(function (m) { return '<option value="' + esc(m.ec) + '" data-name="' + esc(m.name) + '" data-home="' + esc(m.homeBranch || '') + '">' + esc(m.name) + (m.homeBranch ? '  ·  ' + esc(m.homeBranch) : '') + '</option>'; }).join('') + '</select>' +
              '<label class="lbl" for="ed-pin" style="margin-top:12px">Your personal PIN</label>' +
              '<input id="ed-pin" class="input" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="6-digit PIN">' +
              '<div id="ed-claim-err" class="warn" style="display:none;margin-top:10px"></div>' +
              '<div class="btn-row" style="margin-top:14px"><button class="btn btn-primary" id="ed-claim-go" type="submit">Submit request</button></div>' +
            '</form>'
          : '<div class="warn">No eligible managers for this day — everyone is already scheduled. Nothing to claim.</div>') +
      '</section>'
    );
    document.getElementById("back-ed").onclick = renderEdManager;
    if (!elig.length) return;
    var form = document.getElementById("ed-claim-form");
    var whoEl = document.getElementById("ed-who");
    var pinEl = document.getElementById("ed-pin");
    var errEl = document.getElementById("ed-claim-err");
    var showErr = function (m) { errEl.textContent = m; errEl.style.display = "block"; };
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var ec = whoEl.value;
      var opt = whoEl.options[whoEl.selectedIndex];
      var name = (opt && opt.getAttribute("data-name")) || "";
      var home = (opt && opt.getAttribute("data-home")) || "";
      var entered = (pinEl.value || "").trim();
      if (!/^\d{6}$/.test(entered)) { showErr("Enter your 6-digit PIN."); return; }
      try {
        var pins = await window.APP_DATA.loadManagerPins();
        var want = pins[ec] || pins[String(ec).trim()];
        if (!want) { showErr("No PIN set for you — ask HR."); return; }
        if (entered !== String(want)) { showErr("Wrong PIN. Try again."); return; }
        await window.APP_DATA.requestEd({ offerId: offer.id, ec: ec, name: name, homeBranch: home });
        alert("Request submitted! Ops will review it.");
        renderEdManager();
      } catch (e2) { showErr("Could not submit: " + ((e2 && e2.message) || e2)); }
    });
    setTimeout(function () { try { pinEl.focus(); } catch (_e) {} }, 50);
  }

  // ---------------- How Check-ins Work (manager guide) ----------------
  // A plain-language rulebook for store managers covering the Nail Tech
  // Check-in and the Manager Check-in. Written deliberately simple and
  // visual — short sentences, exact button names, one rule per box — so
  // there is zero room for interpretation. Pure static content.
  function renderCheckinGuide() {
    setSublabel("HOW CHECK-INS WORK");

    // Small builders so every section reads the same.
    function box(border, bg, titleColor, title, bodyHtml) {
      return '<div style="border:2px solid ' + border + ';background:' + bg + ';border-radius:14px;padding:16px 18px;margin-top:14px">' +
        '<div style="font-size:15px;font-weight:800;color:' + titleColor + ';letter-spacing:0.02em">' + title + '</div>' +
        '<div style="font-size:14px;color:#1f2937;line-height:1.65;margin-top:8px">' + bodyHtml + '</div>' +
        '</div>';
    }
    function step(n, html) {
      return '<div style="display:flex;gap:12px;align-items:flex-start;margin-top:12px">' +
        '<div style="flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:#BE185D;color:#fff;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center">' + n + '</div>' +
        '<div style="font-size:14px;color:#1f2937;line-height:1.6;padding-top:4px">' + html + '</div>' +
        '</div>';
    }
    function row(situation, action) {
      return '<tr>' +
        '<td style="padding:9px 10px;border-bottom:1px solid #FCE7F3;font-size:13px;color:#1f2937;line-height:1.5">' + situation + '</td>' +
        '<td style="padding:9px 10px;border-bottom:1px solid #FCE7F3;font-size:13px;font-weight:800;color:#831843;line-height:1.5;white-space:nowrap">' + action + '</td>' +
        '</tr>';
    }

    var goldenRule =
      box("#fca5a5", "#fef2f2", "#991b1b", "🛑 THE GOLDEN RULE",
        '<strong>Only mark a tech On Time or Late if she is INSIDE the store right now.</strong><br><br>' +
        'Ask yourself one question: <strong>“Can I see her in the store?”</strong><br>' +
        '✔️ YES → she is <strong>On Time</strong> (or <strong>Late</strong> if she arrived late).<br>' +
        '❌ NO → she is <strong>Absent</strong>. Full stop.<br><br>' +
        '“She is almost there”, “she is parking”, “she is 5 minutes away”, “she just messaged me” — ' +
        'she is <strong>NOT in the store</strong>, so she is <strong>Absent</strong>. <strong>NEVER mark her Late.</strong><br><br>' +
        'If she is still on her way: mark her <strong>Absent</strong> now. When she actually arrives, ' +
        'phone your <strong>regional manager</strong> and ask them to <strong>reopen the check-in</strong> — then you can mark her Late.');

    var steps =
      '<div style="margin-top:18px">' +
      '<div style="font-size:16px;font-weight:800;color:#831843">✍️ Submitting the Nail Tech Check-in — step by step</div>' +
      step(1, 'On the home screen, tap <strong>✍️ Nail Tech Check-in</strong>.') +
      step(2, 'Walk through the store and <strong>look</strong>. For each tech, tap the button that is true <strong>right now</strong>:<br>' +
        '<strong>On Time</strong> — she is in the store and started on time.<br>' +
        '<strong>Late</strong> — she is in the store but arrived late.<br>' +
        '<strong>Sick + note</strong> / <strong>Sick NO note</strong> / <strong>FRL + proof</strong> / <strong>Absent</strong> / <strong>NO SHOW</strong> — she is not working today.') +
      step(3, '<strong>Not in the store = Absent.</strong> No exceptions. It does not matter what she said on the phone.') +
      step(4, '<strong>Do not rush to submit.</strong> The moment you tap a status, the exact time of your tap is saved — even before you submit. ' +
        'Head office can see you tapped “On Time” at 09:00 even if you only submit at 10:15. Take your time and get it right.') +
      step(5, 'When every tech has a status, tap <strong>Confirm and submit attendance</strong>.<br>' +
        '⏰ Submit by <strong>10:30</strong> at the latest. Stores with a late shift working: by <strong>11:30</strong>.') +
      '</div>';

    var afterSubmit =
      box("#fdba74", "#fff7ed", "#9a3412", "🏃 A tech leaves work early",
        'Open <strong>Nail Tech Check-in</strong> and tap the <strong style="color:#9a3412">ORANGE “Mark left early”</strong> button on her row, then enter how early she left.<br>' +
        '✅ You can do this <strong>after</strong> you have already submitted the check-in.<br>' +
        '⚠️ But it must be done <strong>on the same day she leaves</strong> (before 20:00). You <strong>cannot</strong> mark someone “left early” a day later — the button is gone the next day.') +
      box("#fde047", "#fefce8", "#854d0e", "📎 A sick note arrives later",
        'She was marked <strong>Sick NO note</strong>, and a few days later she brings a doctor’s note?<br>' +
        'Open <strong>Nail Tech Check-in</strong>, go to <strong>the day she was sick</strong>, and tap the <strong style="color:#854d0e">YELLOW “Add sick note”</strong> button to upload the note.<br>' +
        '✅ That day then becomes <strong>Sick + note</strong> (a paid sick day).') +
      box("#93c5fd", "#eff6ff", "#1e40af", "🔓 She arrives after you marked her Absent (or after you submitted)",
        'You cannot change it yourself. Phone your <strong>regional manager</strong> and ask them to <strong>reopen the check-in</strong> for today.<br>' +
        'The statuses you already tapped are kept — you only update the tech who arrived, and submit again.');

    var mgrCheckin =
      box("#f9a8d4", "#fdf2f8", "#831843", "🕐 Manager Check-in — this one is for YOU",
        'The Nail Tech Check-in does <strong>not</strong> clock you in.<br>' +
        'Tap <strong>🕐 Manager Check-in</strong> and clock <strong>in</strong> (PIN + selfie) when you arrive, and clock <strong>out</strong> when you leave. ' +
        'Your own attendance and pay come from these clock-ins — every day, no exceptions.');

    var responsibility =
      box("#831843", "#fdf2f8", "#831843", "✍️ When you submit, you sign for it",
        'By tapping <strong>Confirm and submit attendance</strong> you take <strong>full personal responsibility</strong> that every tech marked ' +
        '<strong>On Time</strong> or <strong>Late</strong> is actually standing in the store.<br><br>' +
        'Head office compares your check-ins against the schedule, the tap times and the Fresha appointments. ' +
        'Marking someone present who is not there is a <strong>serious offence</strong>.');

    var cheatSheet =
      '<div style="margin-top:18px">' +
      '<div style="font-size:16px;font-weight:800;color:#831843">📋 Quick reference — what do I press?</div>' +
      '<div style="overflow-x:auto;margin-top:10px;border:1px solid #FCE7F3;border-radius:12px">' +
      '<table style="width:100%;border-collapse:collapse;background:#fff">' +
      '<thead><tr>' +
      '<th style="text-align:left;padding:9px 10px;font-size:11px;letter-spacing:0.08em;color:#9d174d;background:#fdf2f8;text-transform:uppercase">Situation</th>' +
      '<th style="text-align:left;padding:9px 10px;font-size:11px;letter-spacing:0.08em;color:#9d174d;background:#fdf2f8;text-transform:uppercase">What you press</th>' +
      '</tr></thead><tbody>' +
      row('In the store, started on time', 'On Time') +
      row('In the store, but arrived late', 'Late') +
      row('NOT in the store — even if she says she is on her way', 'Absent') +
      row('Off sick, doctor’s note received', 'Sick + note') +
      row('Off sick, no doctor’s note', 'Sick NO note') +
      row('Family emergency, proof received', 'FRL + proof') +
      row('No call, no message, simply never came', 'NO SHOW') +
      row('Left work before the end of her shift', '🏃 Mark left early (orange)') +
      row('Sick note arrives days later', '📎 Add sick note (yellow), on her sick day') +
      row('Arrived after Absent / after submitting', 'Phone your regional → reopen check-in') +
      '</tbody></table></div></div>';

    setMain(
      '<section class="panel">' +
      '<div class="panel-head">' +
      '<h2>📖 How Check-ins Work</h2>' +
      '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
      '</div>' +
      '<div style="font-size:13px;color:#6b7280;line-height:1.5">The rules every manager must follow for the daily Nail Tech Check-in and your own Manager Check-in. Read it once a week until you know it by heart.</div>' +
      '<button type="button" id="start-tour" class="btn btn-primary" style="margin-top:14px;width:100%;font-size:15px;padding:14px">🎓 Take the 2-minute practice tour</button>' +
      goldenRule +
      steps +
      '<div style="font-size:16px;font-weight:800;color:#831843;margin-top:22px">🔧 After submitting — fixing things the right way</div>' +
      afterSubmit +
      '<div style="font-size:16px;font-weight:800;color:#831843;margin-top:22px">🕐 Your own check-in</div>' +
      mgrCheckin +
      '<div style="font-size:16px;font-weight:800;color:#831843;margin-top:22px">⚖️ Your responsibility</div>' +
      responsibility +
      cheatSheet +
      '</section>'
    );
    document.getElementById("back-home").onclick = renderManagerLanding;
    document.getElementById("start-tour").onclick = renderCheckinTour;
  }

  // ---------------- Check-in practice tour (interactive wizard) ----------------
  // A slide-by-slide walkthrough of the Nail Tech Check-in with PRACTICE
  // questions on realistic mock rows (the same .dly-act buttons as the real
  // screen). Nothing tapped in the tour is saved anywhere. Practice slides
  // lock the Next button until the manager taps the RIGHT answer, so the
  // golden rule (not in store = Absent, never Late) is actually rehearsed,
  // not just read.
  function renderCheckinTour() {
    setSublabel("PRACTICE TOUR");

    var STATUS_BTNS = [
      ["on", "On Time"], ["late", "Late"], ["sick_n", "Sick + note"],
      ["sick", "Sick NO note"], ["absent", "Absent"], ["no", "NO SHOW"], ["frl", "FRL + proof"]
    ];
    function statusRow(activeCode, locked) {
      return STATUS_BTNS.map(function (b) {
        return '<button type="button" class="dly-act dly-act-' + b[0] +
          (activeCode === b[0] ? ' dly-act-active' : '') + '"' +
          (locked ? ' disabled style="opacity:0.45;cursor:not-allowed"' : '') +
          ' data-pick="' + b[0] + '">' + b[1] + '</button>';
      }).join("");
    }
    function earlyBtn() {
      return '<button type="button" class="dly-act" data-pick="early" ' +
        'style="background:#FFEDD5;color:#9A3412;border:1px solid #FB923C;font-weight:700">🏃 Mark left early</button>';
    }
    function sickNoteBtn() {
      return '<button type="button" class="dly-act" data-pick="note" ' +
        'style="background:#fef3c7;color:#78350f;border:1px solid #fbbf24">📎 Add sick note → Sick + note</button>';
    }
    function mockRow(name, code, note, actionsHtml) {
      return '<div style="background:#fff;border:1px solid #FBCFE8;border-radius:12px;padding:12px 14px;margin-top:12px;text-align:left">' +
        '<div style="font-weight:700;color:#831843;font-size:14px">' + name + '</div>' +
        '<div style="font-size:11px;color:#9ca3af">' + code + '</div>' +
        (note ? '<div style="font-size:12px;color:#6b7280;margin-top:5px;line-height:1.5">' + note + '</div>' : '') +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">' + actionsHtml + '</div>' +
        '</div>';
    }
    function infoCard(html) {
      return '<div style="font-size:14px;color:#1f2937;line-height:1.7;text-align:left;margin-top:12px">' + html + '</div>';
    }

    // Each step: { title, html, quiz }. quiz = { correct, right, wrong:{pick:msg}, fallback }.
    // Steps with a quiz keep Next locked until the correct button is tapped.
    var steps = [
      {
        title: "🎓 Welcome to the check-in practice tour",
        html: infoCard(
          'This tour shows you, step by step, how to do the daily <strong>Nail Tech Check-in</strong> — with practice questions on real-looking buttons.<br><br>' +
          '✅ Nothing you tap in this tour is saved.<br>' +
          '✅ It takes about 2 minutes.<br>' +
          '✅ On the practice slides, the <strong>Next</strong> button only unlocks when you tap the right answer.')
      },
      {
        title: "This is a tech's row on the check-in screen",
        html: infoCard(
          'Every tech working today gets a row like this. You tap <strong>one status</strong> per tech — exactly what is true <strong>right now</strong>:') +
          mockRow("Zanele M.", "B123 · NT", "", statusRow(null, false)) +
          infoCard('<strong>On Time</strong> / <strong>Late</strong> = she is IN the store.<br>' +
            'All the other buttons = she is NOT working in the store today.<br>' +
            '<em>(These example buttons do nothing — practice starts on the next slide.)</em>')
      },
      {
        title: "Practice 1 — the easy one",
        html: infoCard('It is 09:05. <strong>Zanele is inside the store, sitting at her manicure table and working on a client.</strong> She arrived at 08:55, before her shift started.<br><strong>Tap the right button on her row:</strong>') +
          mockRow("Zanele M.", "B123 · NT", "", statusRow(null, false)),
        quiz: {
          correct: "on",
          right: "✅ Correct. She is in the store and she was on time → On Time.",
          wrong: {
            late: "❌ No — she arrived at 08:55, before her shift. That is not Late.",
            absent: "❌ No — she is standing right there in the store. Absent is only for techs who are NOT in the store."
          },
          fallback: "❌ Not this one. She is in the store and arrived on time. Try again."
        }
      },
      {
        title: "Practice 2 — THE GOLDEN RULE",
        html: infoCard('It is 10:20. Thandi is <strong>not in the store</strong>. She phoned: <em>“I\'m almost there! 5 minutes away, promise!”</em><br><strong>Tap the right button on her row:</strong>') +
          mockRow("Thandi K.", "B456 · NT", "📱 “Almost there, 5 minutes away!”", statusRow(null, false)),
        quiz: {
          correct: "absent",
          right: "✅ Correct. Not in the store = Absent. It does not matter what she said on the phone.",
          wrong: {
            late: "🛑 NO! This is the mistake we must stop. “Almost there” is NOT in the store. NEVER mark someone Late who you cannot see in the store. She is Absent.",
            on: "🛑 NO! You cannot see her in the store. She is Absent — never On Time."
          },
          fallback: "❌ Not this one. She is not in the store right now. So what is she? Try again."
        }
      },
      {
        title: "But what if Thandi really arrives later?",
        html: infoCard(
          'You marked her <strong>Absent</strong> — that was correct.<br><br>' +
          'If she then truly walks in:<br>' +
          '1️⃣ Phone your <strong>regional manager</strong>.<br>' +
          '2️⃣ Ask them to <strong>🔓 reopen the check-in</strong> for today.<br>' +
          '3️⃣ Now you can change her to <strong>Late</strong> and submit again.<br><br>' +
          '<strong>You never mark her Late “in advance” because she promised to come.</strong> First she arrives, then her status changes.')
      },
      {
        title: "Take your time — we see every tap",
        html: infoCard(
          'The moment you tap a status, the <strong>exact time of your tap is saved</strong> — even before you press submit.<br><br>' +
          'So if you tap “On Time” at 09:00 and only submit at 10:15, head office still sees the 09:00 tap. <strong>No need to rush. Get it right.</strong><br><br>' +
          '⏰ Submit by <strong>10:30</strong> at the latest.<br>' +
          '⏰ Stores with a <strong>late shift</strong> working: by <strong>11:30</strong>.<br><br>' +
          'When every tech has a status, you press:') +
          '<div style="margin-top:10px"><button type="button" class="btn btn-primary" style="pointer-events:none">Confirm and submit attendance</button></div>' +
          infoCard('<em>By pressing it you confirm every tech marked On Time or Late is really in the store — more on that at the end.</em>')
      },
      {
        title: "Practice 3 — a tech leaves early",
        html: infoCard('You submitted at 10:20. ✔️ At 15:00 <strong>Amahle goes home early</strong> (her shift ends at 17:00).<br>' +
          'Her statuses are now locked (greyed out) — but one button still works. <strong>Tap it:</strong>') +
          mockRow("Amahle P.", "B789 · NT", "Submitted ✓ — statuses locked", statusRow("on", true) +
            '</div><div class="dly-early-row" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' + earlyBtn()),
        quiz: {
          correct: "early",
          right: "✅ Correct. The ORANGE “Mark left early” button works even after you submitted — but only on the SAME DAY she leaves (before 20:00). You cannot mark someone left early a day later.",
          fallback: "Those are locked after submitting — look for the button that is still orange and active."
        }
      },
      {
        title: "Practice 4 — the sick note arrives later",
        html: infoCard('On Monday, Naledi was sick with <strong>no doctor\'s note</strong> → you marked “Sick NO note”. ✔️<br>' +
          'On Wednesday she brings a <strong>doctor\'s note</strong> for Monday.<br>' +
          'Open <strong>Nail Tech Check-in</strong>, go back to <strong>Monday</strong>, and… <strong>tap the right button:</strong>') +
          mockRow("Naledi S.", "B321 · NT", "Monday · marked Sick NO note", statusRow("sick", true) +
            '</div><div class="dly-convert-row" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' + sickNoteBtn() + earlyBtn()),
        quiz: {
          correct: "note",
          right: "✅ Correct. The YELLOW “Add sick note” button uploads her note and Monday becomes Sick + note (a paid sick day).",
          wrong: {
            early: "❌ No — she didn't leave early. She brought a doctor's note for her sick day. Look for the yellow button."
          },
          fallback: "❌ Not this one. She brought a doctor's note — look for the yellow button."
        }
      },
      {
        title: "🕐 Don't forget YOUR OWN check-in",
        html: infoCard(
          'The Nail Tech Check-in does <strong>not</strong> clock you in.<br><br>' +
          'Every day, on the home screen, tap <strong>🕐 Manager Check-in</strong>:<br>' +
          '✔️ Clock <strong>in</strong> with your PIN + selfie when you arrive.<br>' +
          '✔️ Clock <strong>out</strong> when you leave.<br><br>' +
          'Your own attendance and pay come from these clock-ins.')
      },
      {
        title: "⚖️ You sign for it",
        html: infoCard(
          'When you press <strong>Confirm and submit attendance</strong>, you take <strong>full personal responsibility</strong> that every tech marked <strong>On Time</strong> or <strong>Late</strong> is actually in the store.<br><br>' +
          'Head office compares your check-ins with the schedule, your tap times and the Fresha appointments. Marking someone present who is not there is a <strong>serious offence</strong>.<br><br>' +
          '🎓 <strong>That\'s it — you\'re ready.</strong> You can retake this tour any time from the 📖 How Check-ins Work tile.')
      }
    ];

    var idx = 0;
    var solved = {};   // step index -> true once its practice question was answered correctly

    // Finishing the tour records the manager's name to boa_tour_done_v1 so
    // head office can see who has completed it (HR portal → Nail Tech
    // Check-ins). Recording is best-effort — skipping the name still exits.
    function finishTour() {
      var name = window.prompt(
        "🎓 Tour complete!\n\nType YOUR name so head office can see you've done it:", "");
      var clean = (name || "").trim();
      if (clean.length >= 2 && window.APP_DATA && window.APP_DATA.saveTourCompletion) {
        window.APP_DATA.saveTourCompletion(clean).then(function () {
          alert("✓ Recorded — thank you, " + clean + "!");
          renderCheckinGuide();
        }).catch(function () {
          alert("Could not save right now — please tell your regional manager you finished the tour.");
          renderCheckinGuide();
        });
      } else {
        renderCheckinGuide();
      }
    }

    function show() {
      var st = steps[idx];
      var isQuiz = !!st.quiz && !solved[idx];
      var dots = steps.map(function (_s, i) {
        return '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 3px;background:' + (i === idx ? '#BE185D' : '#FBCFE8') + '"></span>';
      }).join("");
      setMain(
        '<section class="panel" style="max-width:680px;margin:0 auto">' +
        '<div class="panel-head">' +
        '<h2 style="font-size:18px">' + st.title + '</h2>' +
        '<button class="link-btn link-btn-dark" id="tour-exit">✕ Exit tour</button>' +
        '</div>' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#9d174d;text-transform:uppercase">Step ' + (idx + 1) + ' of ' + steps.length + (st.quiz ? ' · PRACTICE' : '') + '</div>' +
        st.html +
        '<div id="tour-feedback" style="display:none;margin-top:12px;border-radius:10px;padding:12px 14px;font-size:14px;font-weight:700;line-height:1.5"></div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:20px">' +
        '<button type="button" class="btn" id="tour-back"' + (idx === 0 ? ' disabled style="opacity:0.4"' : '') + '>← Back</button>' +
        '<div>' + dots + '</div>' +
        '<button type="button" class="btn btn-primary" id="tour-next"' + (isQuiz ? ' disabled style="opacity:0.4"' : '') + '>' +
        (idx === steps.length - 1 ? 'Finish ✓' : (isQuiz ? 'Tap the right answer…' : 'Next →')) + '</button>' +
        '</div>' +
        '</section>'
      );
      document.getElementById("tour-exit").onclick = renderCheckinGuide;
      document.getElementById("tour-back").onclick = function () { if (idx > 0) { idx--; show(); } };
      var nextBtn = document.getElementById("tour-next");
      nextBtn.onclick = function () {
        if (nextBtn.disabled) return;
        if (idx === steps.length - 1) { finishTour(); return; }
        idx++; show();
      };
      var fb = document.getElementById("tour-feedback");
      function feedback(ok, msg) {
        fb.style.display = "block";
        fb.style.background = ok ? "#dcfce7" : "#fee2e2";
        fb.style.border = "1px solid " + (ok ? "#86efac" : "#fca5a5");
        fb.style.color = ok ? "#166534" : "#991b1b";
        fb.textContent = msg;
      }
      if (st.quiz) {
        var main = document.getElementById("staff-main") || document;
        Array.prototype.forEach.call(main.querySelectorAll("[data-pick]"), function (btn) {
          btn.onclick = function () {
            var pick = btn.getAttribute("data-pick");
            if (pick === st.quiz.correct) {
              // Highlight the chosen button like the real screen does.
              btn.classList.add("dly-act-active");
              feedback(true, st.quiz.right);
              solved[idx] = true;
              nextBtn.disabled = false;
              nextBtn.style.opacity = "1";
              nextBtn.textContent = (idx === steps.length - 1 ? 'Finish ✓' : 'Next →');
            } else {
              feedback(false, (st.quiz.wrong && st.quiz.wrong[pick]) || st.quiz.fallback || "❌ Not this one — try again.");
            }
          };
        });
      }
    }
    show();
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
    // Identity gate — every voucher lookup must be attributable to a person, so
    // before the lookup form we require the manager to pick their name + enter
    // their personal PIN (the same PINs as manager clock-in). The verified
    // identity is held in _voucherWho for this visit and logged with each lookup.
    if (!_voucherWho) { return renderVoucherIdentityGate(); }
    renderVoucherForm();
  }

  async function renderVoucherIdentityGate() {
    setMain(
      '<section class="panel">' +
        '<div class="panel-head">' +
          '<h2>🎟️ Voucher Code Lookup</h2>' +
          '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
        '</div>' +
        '<div id="vc-gate-body"><div style="padding:8px 0;color:#6b7280">Loading…</div></div>' +
      '</section>'
    );
    document.getElementById("back-home").onclick = function () { _voucherWho = null; renderManagerLanding(); };

    var mgrs = [], pins = {}, clockedInEcs = {};
    try {
      var loaded = await Promise.all([
        window.APP_DATA.listAllManagers(),
        window.APP_DATA.loadManagerPins(),
        window.APP_DATA.listTodayManagerClockins ? window.APP_DATA.listTodayManagerClockins() : Promise.resolve([])
      ]);
      mgrs = loaded[0] || [];
      pins = loaded[1] || {};
      // Managers who have a clock-IN record today — voucher lookups are gated on
      // being on shift (admin codes bypass this below).
      (loaded[2] || []).forEach(function (r) {
        if (r && r.type === "in" && r.staff && r.staff.employee_code) clockedInEcs[String(r.staff.employee_code).trim()] = true;
      });
    } catch (e) {
      document.getElementById("vc-gate-body").innerHTML =
        '<div class="warn">Could not load managers: ' + esc((e && e.message) || e) + '</div>' +
        '<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" id="vc-gate-retry" type="button">Try again</button></div>';
      var rb = document.getElementById("vc-gate-retry");
      if (rb) rb.onclick = renderVoucherIdentityGate;
      return;
    }

    var thisBranch = (cfg.branchName || "");
    // Manager rows are keyed by employee_code (NOT `ec`) — mirror the clock-in
    // screen, which also tries the raw value because some codes carry trailing
    // whitespace. Keep only rows that actually have a code.
    mgrs = (mgrs || []).filter(function (m) { return m && m.employee_code; });
    mgrs.sort(function (a, b) {
      var ah = a.branch === thisBranch ? 0 : 1, bh = b.branch === thisBranch ? 0 : 1;
      if (ah !== bh) return ah - bh;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    var hasMgrs = mgrs.length > 0;
    var opts = mgrs.map(function (m) {
      var ec = String(m.employee_code).trim();
      var label = esc(m.name || ("EC " + ec)) + (m.branch && m.branch !== thisBranch ? "  ·  " + esc(m.branch) : "");
      return '<option value="' + esc(ec) + '" data-ecraw="' + esc(String(m.employee_code)) + '" data-name="' + esc(String(m.name || "")) + '">' + label + '</option>';
    }).join("");

    // Always render the PIN field so an owner/GM admin code can be entered even
    // when no managers are listed for this store (e.g. on an admin device).
    document.getElementById("vc-gate-body").innerHTML =
      '<div style="font-size:13px;color:#6b7280;margin-bottom:14px;line-height:1.5">' +
        (hasMgrs
          ? 'Voucher lookups are logged. Select <strong>your name</strong> and enter your <strong>personal 6-digit PIN</strong> — you must be <strong>clocked in</strong> today. '
          : 'No managers are listed for this store. ') +
        'Owner/GM may enter their <strong>admin code</strong> instead — it works on any kiosk and is logged against that code.' +
      '</div>' +
      '<form id="vc-gate-form" autocomplete="off">' +
        (hasMgrs
          ? '<label class="lbl" for="vc-who">Your name</label>' +
            '<select id="vc-who" class="input">' + opts + '</select>' +
            '<label class="lbl" for="vc-pin" style="margin-top:12px">Your personal PIN</label>'
          : '<label class="lbl" for="vc-pin">Admin code</label>') +
        '<input id="vc-pin" class="input" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="' + (hasMgrs ? '6-digit PIN' : 'Admin code') + '">' +
        '<div id="vc-gate-err" class="warn" style="display:none;margin-top:10px"></div>' +
        '<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" id="vc-gate-go" type="submit">Continue</button></div>' +
      '</form>';

    var gateForm = document.getElementById("vc-gate-form");
    var whoEl = document.getElementById("vc-who");   // null when no managers listed
    var pinEl = document.getElementById("vc-pin");
    var errEl = document.getElementById("vc-gate-err");
    var showErr = function (msg) { errEl.textContent = msg; errEl.style.display = "block"; };

    gateForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var entered = (pinEl.value || "").trim();
      // Admin override — the owner/GM codes (security.js) work on any kiosk and
      // are logged against the code itself, so an admin lookup stays traceable.
      // Checked first, so it works regardless of whether managers are listed.
      if (window.BOA_IS_ADMIN_CODE && window.BOA_IS_ADMIN_CODE(entered)) {
        // Attribute to the ROLE, never the raw code (0864 → Owner, 1478 → Ops).
        // ec keeps the code for forensic traceability; only the role is shown.
        var adminLabel = (window.BOA_ADMIN_LABEL && window.BOA_ADMIN_LABEL(entered)) || (entered === "1478" ? "Ops" : "Owner");
        _voucherWho = { ec: "admin:" + entered, name: adminLabel };
        renderVoucherForm();
        return;
      }
      if (!whoEl) { showErr("No managers are set up here — enter an owner/GM admin code to continue."); return; }
      var ec = whoEl.value;
      var opt = whoEl.options[whoEl.selectedIndex];
      var name = (opt && opt.getAttribute("data-name")) || "";
      var ecRaw = (opt && opt.getAttribute("data-ecraw")) || ec;
      if (!/^\d{6}$/.test(entered)) { showErr("Enter your 6-digit personal PIN (or an admin code)."); return; }
      var want = pins[ec] || pins[ecRaw];
      if (!want) { showErr("No personal PIN is set for " + (name || "this manager") + ". Ask HR to add one."); return; }
      if (entered !== String(want)) { showErr("Wrong PIN. Try again."); return; }
      if (!clockedInEcs[ec] && !clockedInEcs[String(ecRaw).trim()]) {
        showErr((name || "You") + " must clock in on the kiosk today before looking up vouchers.");
        return;
      }
      _voucherWho = { ec: String(ec), name: name };
      renderVoucherForm();
    });

    setTimeout(function () { try { pinEl.focus(); } catch (_) {} }, 50);
  }

  function renderVoucherForm() {
    setMain(
      '<section class="panel">' +
        '<div class="panel-head">' +
          '<h2>🎟️ Voucher Code Lookup</h2>' +
          '<button class="link-btn link-btn-dark" id="back-home">← Back</button>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 12px;margin-bottom:14px">' +
          '<span style="font-size:12px;color:#166534">Signed in as <strong>' + esc((_voucherWho && _voucherWho.name) || "—") + '</strong></span>' +
          '<button type="button" id="vc-switch" class="link-btn link-btn-dark" style="font-size:12px">Switch</button>' +
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
    document.getElementById("back-home").onclick = function () { _voucherWho = null; renderManagerLanding(); };
    document.getElementById("vc-switch").onclick = function () { _voucherWho = null; renderVoucherIdentityGate(); };

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

    // Amber banner shown when the characters before the last 4 are all one
    // repeated character — the 000…/111…/AAAA… shortcut. We still show the code
    // (per policy) but the manager sees the warning and the lookup is flagged.
    var PAD_WARN = '<div class="warn" style="background:#fffbeb;border-color:#fcd34d;color:#92400e">' +
      '⚠️ <strong>This looks like a shortcut entry.</strong> The characters before the last 4 are all the same — please type the client\'s <strong>full</strong> code. This lookup has been logged.' +
    '</div>';

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var code = (input.value || "").trim();
      var amount = (amountEl.value || "").trim();
      if (!code) { resEl.innerHTML = '<div class="warn">Type the full voucher code first.</div>'; return; }
      if (!amount) { resEl.innerHTML = '<div class="warn">Enter the voucher amount too.</div>'; return; }
      findBtn.disabled = true; findBtn.textContent = "Searching…";
      try {
        var r = await window.APP_DATA.lookupFreshaVoucher(code, amount);
        var pad = (r.suspiciousPad && !r.tooShort) ? PAD_WARN : "";
        if (r.tooShort) {
          resEl.innerHTML = '<div class="warn">Enter the client\'s <strong>full</strong> voucher code (at least ' + r.minLen + ' characters).</div>';
        } else if (!r.found) {
          resEl.innerHTML = pad + '<div class="warn">No matching Fresha voucher found. Double-check the full code <strong>and the amount</strong> were entered correctly.</div>';
        } else if (r.matches.length === 1) {
          resEl.innerHTML = pad + _voucherCard(r.matches[0]);
          wireCopies();
        } else {
          resEl.innerHTML = pad +
            '<div class="warn" style="background:#fef3c7;border-color:#fde68a;color:#92400e">' +
              '<strong>' + r.matches.length + ' vouchers end in those digits.</strong> Pick the one whose <strong>amount</strong> matches the client\'s voucher.' +
            '</div>' +
            r.matches.map(_voucherCard).join("");
          wireCopies();
        }
        // Best-effort audit log of this lookup (skip the "too short" non-attempt).
        if (!r.tooShort && window.APP_DATA.logVoucherLookup) {
          var single = (r.matches && r.matches.length === 1) ? r.matches[0] : null;
          window.APP_DATA.logVoucherLookup({
            managerEc:     _voucherWho && _voucherWho.ec,
            managerName:   _voucherWho && _voucherWho.name,
            typedCode:     code,
            last4:         r.last4,
            amount:        amount,
            found:         !!r.found,
            freshaCode:    single ? single.fresha : null,
            matchCount:    r.matches ? r.matches.length : 0,
            balanceAt:     single ? single.balance : null,
            suspiciousPad: !!r.suspiciousPad
          });
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

  // Manager selfie — returns Promise<dataUrl|null>. Uses the shared camera helper
  // (live preview where supported on the device, system camera otherwise), then
  // crops the result to 4:5 (400×500).
  function capturePhoto(name) {
    return window.BOA_CAMERA.capture({
      facingMode: "user",
      title: "Selfie required for " + (name || "manager"),
      crop: { mode: "cover", w: 400, h: 500, quality: 0.7 }
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
  // scheduled shift END time. A customRange ("HH:MM - HH:MM" from Manager
  // Coverage's per-day custom hours) wins over the computed default.
  // Returns null if we can't resolve it (no schedule code, unknown role,
  // etc.) — callers fall back to the configured cutoff.
  function _scheduledEndDate(ymd, role, code, branchName, customRange) {
    if (!ymd) return null;
    var p = ymd.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var range = customRange || null;
    if (!range) {
      if (!code) return null;
      if (typeof shiftTimes !== "function") return null;
      range = shiftTimes(role, code, branchName, d.getDay());
    }
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
  // map ec → manager record carrying role + branch, customTimes: optional
  // per-day custom hours map from Manager Coverage (boa_mgr_times_v1) —
  // a custom range for the day overrides the computed shift end.
  async function ensureAutoOuts(recentRows, schedLookup, mgrByEc, customTimes) {
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
        var custRange = customTimes ? ((customTimes[ec] || customTimes[String(ec).trim()] || {})[k] || null) : null;
        var schedEnd = (mgr && (schedCode || custRange)) ? _scheduledEndDate(k, mgr._effRole || mgr.role, schedCode, mgr.branch || (last.staff && last.staff.branch), custRange) : null;
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

    var pins, mgrs, recent, smTrialEcs, trialCand, mgrTaggedStaffIds = {}, mgrOnLeaveToday = {};
    // Per-day custom shift hours set on the HR portal's Manager Coverage tab
    // (boa_mgr_times_v1): { ec: { "YYYY-MM-DD": "HH:MM - HH:MM" } }. These are
    // the EXACT times coverage shows and they override the computed defaults.
    var mgrCustomTimes = {};
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
      // Consumer surfaces render the PUBLISHED schedule verbatim. The draft
      // (boa_mgrsched_*) holds a stale raw rotation WITHOUT the manual shift pins,
      // so a pinned manager (or any re-drafted cell) shows the wrong hours here —
      // e.g. Table Bay Neliwe read as WL 11:00–20:00 when the published snapshot
      // (and Manager Coverage) say WM 09:00–18:00. Prefer the approved snapshot
      // [0]; fall back to the draft only for a cycle that was never published.
      var _loadMgrSched = async function (endYm) {
        if (window.APP_DATA.getApprovedSchedule) {
          try {
            var ap = await window.APP_DATA.getApprovedSchedule(endYm, "mgr");
            if (ap && ap.grid && Object.keys(ap.grid).length) return ap;
          } catch (_e) { /* fall through to draft */ }
        }
        if (!window.APP_DATA.getSchedule) return null;
        try { return await window.APP_DATA.getSchedule(endYm, "mgr"); } catch (_e2) { return null; }
      };
      var _stage2 = await Promise.all([
        window.APP_DATA.listRecentManagerClockins(2, _mgrIds),
        _loadMgrSched(_curEndYm),
        _loadMgrSched(_prevEndYm),
        window.APP_DATA.listManagerDayStatusesToday ? window.APP_DATA.listManagerDayStatusesToday().catch(function () { return []; }) : Promise.resolve([]),
        _onLeaveEcsToday(false).catch(function () { return {}; }),   // ec → al/el on approved leave today
        window.APP_DATA.getMgrTimes ? window.APP_DATA.getMgrTimes().catch(function () { return {}; }) : Promise.resolve({})
      ]);
      recent = _stage2[0];
      _ingestSched(_curCycleYm, _stage2[1]);
      _ingestSched(_prevCycleYm, _stage2[2]);
      (_stage2[3] || []).forEach(function (r) { if (r && r.staff_id) mgrTaggedStaffIds[r.staff_id] = true; });
      mgrOnLeaveToday = _stage2[4] || {};
      mgrCustomTimes = _stage2[5] || {};
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
    mgrs.forEach(function (m) {
      if (!m.employee_code) return;
      var _ecK = String(m.employee_code).trim();
      // AMs on an active SM trial work SM shifts (08:00–17:00 close), not the
      // later AM close. Resolve their scheduled shift end — and therefore any
      // early-clock-out short hours and auto-out time — as an SM, not an AM.
      m._effRole = (m.role === "AM" && smTrialEcs && smTrialEcs[_ecK]) ? "SM" : m.role;
      mgrByEc[_ecK] = m;
    });
    var _schedLookup = function (ec, ymd) {
      var row = schedByEcYmd[String(ec).trim()];
      return row ? row[ymd] : null;
    };

    // Run auto-out routine (schedule-aware) and find anyone auto-outed yesterday
    var autoYesterday = await ensureAutoOuts(recent, _schedLookup, mgrByEc, mgrCustomTimes);
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
      // On approved leave today (annual or emergency) → no clock-in expected,
      // so show a calm pill and never nag. The schedule grid often still
      // carries a working code (W) because leave is recorded in the Leave
      // Calendar rather than re-written onto the grid.
      var _onLeaveCode = mgrOnLeaveToday[ec];
      var _leaveBadge = _onLeaveCode
        ? ' <span class="pill" style="background:#dbeafe;color:#1e3a8a">🌴 on leave today' + (_onLeaveCode === "el" ? " (emergency)" : "") + '</span>'
        : "";
      // Blinking nag: scheduled, no clock-in today, not ROM-tagged, not on
      // leave, past the warning cutoff time. Only nag for THIS branch's managers.
      var _nagBadge = "";
      if (m.branch === thisBranch
          && _pastWarnCutoff
          && !inTodayByEc[ec]
          && _isWorkingCode(mgrTodaySched[ec])
          && !_onLeaveCode
          && !mgrTaggedStaffIds[m.id]) {
        _nagBadge = ' <span class="mgr-clockin-nag" title="No clock-in recorded yet today. No clock-in = unpaid day. Clock in now, or ask the ROM to tag the absence reason.">⚠ HAVEN\'T CLOCKED IN</span>';
      }
      var rowCls = m.branch === thisBranch ? "" : " staff-inactive";
      // Shift hours for today. Per-day CUSTOM hours set on the HR portal's
      // Manager Coverage tab are the exact scheduled times and always win;
      // otherwise compute from the schedule code + role like coverage does.
      // Only shown for managers based at this branch on a day the schedule
      // (or a custom-hours entry) says they're working — silent otherwise so
      // we don't tell an off-duty manager "your shift is X" by mistake.
      var _schedCodeToday = mgrTodaySched[ec];
      var _isWorkingToday = _schedCodeToday === "W" || _schedCodeToday === "WL" || _schedCodeToday === "WE" || _schedCodeToday === "WM" || _schedCodeToday === "WB" || _schedCodeToday === "E";
      var _custRow = mgrCustomTimes[ecRaw] || mgrCustomTimes[ec];
      var _custHrs = _custRow ? _custRow[todayK] : null;
      var shiftLine = "";
      if (m.branch === thisBranch && (_custHrs || _isWorkingToday) && !_onLeaveCode) {
        var _hrs, _custMark = "";
        if (_custHrs) {
          _hrs = _custHrs;
          _custMark = ' <span title="Custom hours for today, set on Manager Coverage" style="color:#9A3412">★ custom</span>';
        } else {
          var _effRole = onSmTrial ? "SM" : (m.role || "");
          _hrs = shiftTimes(_effRole, _schedCodeToday, thisBranch, _todayDow);
        }
        shiftLine = '<div class="staff-shift-hours" style="font-size:11px;color:var(--pink-700);font-weight:700;letter-spacing:0.02em;margin-top:2px">🕐 Today · ' + esc(_hrs) + _custMark + '</div>';
      }
      return '<div class="staff-row' + rowCls + '" data-id="' + m.id + '" data-ec="' + esc(ec) + '" data-name="' + esc(m.name) + '">' +
        '<div class="staff-row-main">' +
        '<div class="staff-name">' + esc(m.name) +
        rolePill +
        (m.branch !== thisBranch ? ' <span class="pill pill-mute">' + esc(m.branch || "—") + "</span>" : "") +
        (has ? "" : ' <span class="pill pill-warn">NO PIN</span>') + autoBadge + _leaveBadge + _nagBadge +
        '</div>' +
        shiftLine +
        '<div class="staff-code" style="margin-top:3px">' + lastLabel + '</div>' +
        '</div>' +
        '<div class="staff-row-actions">' +
        '<button class="btn btn-primary" data-act="clockin"  ' + (has && !inDone ? "" : 'disabled') + (inDone ? ' title="Already clocked in today"' : '') + '>Clock In</button>' +
        '<button class="btn btn-out"     data-act="clockout" ' + (has ? "" : 'disabled') + '>Clock Out</button>' +
        '</div>' +
        '</div>';
    }

    // Only THIS store's managers are shown by default. Managers based at other
    // stores live behind a "Clock in other manager" button so the list isn't
    // cluttered with every manager in the company.
    var hereMgrs  = mgrs.filter(function (m) { return m.branch === thisBranch; });
    var otherMgrs = mgrs.filter(function (m) { return m.branch !== thisBranch; });

    // Trial AMs use the same three daily-status buttons as the nail-tech
    // trial check-in and the portal day editor: Worked / Late count as paid
    // trial days, Absent does not. They have no PIN during the trial weeks;
    // once they pass and get a real employee code they'll appear in the
    // manager list above with PIN + photo.
    var trialStatusButtons = [
      { code: "on",     label: "Worked" },
      { code: "late",   label: "Late"   },
      { code: "absent", label: "Absent" }
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
          // 1a. Store-open gate. The kiosk boot screen shows the gate when
          // the store hasn't been opened today, but it only fires on the
          // initial boot — a tablet left running from yesterday lets
          // managers tap "Manager Clock-in" and clock in BEFORE anyone
          // marks the store as open. Re-check here so opening the store
          // is genuinely the first action of the day.
          try {
            var opened = await window.APP_DATA.getStoreOpenedToday();
            if (!opened || !opened.openedAt) {
              alert("Open the store first.\n\nNobody has marked " + (cfg.branchName || "this store") + " as open yet today. Tap ← Back and open the store before clocking in.");
              return;
            }
          } catch (e) {
            // Don't block on transient network errors — log and proceed.
            console.warn("store-open check failed; allowing clock-in:", e);
          }
        }
        // 1b. (Removed) Early-clock-out self-prompt. We no longer ask a manager
        // "how many hours early" on clock-out — that guessed a scheduled end and
        // could record a deduction even when they left on time. Instead the HR
        // portal's attendance sheet DERIVES the deduction automatically from the
        // actual clock-out time recorded below vs the manager's scheduled end
        // for that day (custom hours aware). The colleague "did anyone leave
        // early?" witness prompt still runs after a successful clock-out.
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
        // (Manager early-leave is no longer self-recorded here — the HR portal
        // derives it from this clock-out time. See note at "1b" above.)
        // Post-clock-out witness prompt: catch MANAGERS who walked out
        // without clocking out (so no early-leave reason was logged). The
        // clocking-out manager ticks them from a manager-only checklist —
        // nail techs are deliberately not selectable here (those go through
        // Nail Tech Check-ins → Mark left early). The report goes to
        // boa_mgr_early_reports_v1 for ROM review. Skipped on clock-in.
        if (type === "out") {
          try {
            var report = await openMgrEarlyLeaveReportModal({ name: name, selfEc: ec, managers: hereMgrs });
            if (report && report.names) {
              await window.APP_DATA.submitEarlyLeaveReport({
                reportedByEc:   ec,
                reportedByName: name,
                names:          report.names,
                note:           report.note || ""
              });
            }
          } catch (e) { console.warn("early-leave report save failed:", e); }

          // Non-blocking cash-up reminder on clock-out. We can't force it
          // (early shifts clock out before close), so just nudge: if today's
          // cash-up isn't in yet, remind them on the way out. They tap OK and
          // carry on — clock-out has already been recorded above.
          try {
            if (window.APP_DATA.todaysCashup) {
              var cuToday = await window.APP_DATA.todaysCashup();
              var owed = window.APP_DATA.outstandingCashupDates ? await window.APP_DATA.outstandingCashupDates(7) : [];
              if (!cuToday || (owed && owed.length)) {
                var msg = "✅ Clocked out.\n\n";
                if (!cuToday) msg += "Reminder: today's CASH-UP hasn't been submitted yet. Please make sure it's done before the store closes.\n";
                if (owed && owed.length) msg += "\nAlso still owed: " + owed.length + " previous day" + (owed.length === 1 ? "" : "s") + " — see the reminder on the home screen.\n";
                alert(msg);
              }
            }
          } catch (e) { console.warn("cash-up clock-out reminder failed (non-fatal):", e); }
        }
        renderMgrClockin();
      };
      if (inBtn) inBtn.onclick = function () { doClock("in"); };
      if (outBtn) outBtn.onclick = function () { doClock("out"); };
      // Overtime is recorded from the HR portal only — managers no longer
      // submit OT requests from the kiosk (too many spurious requests).
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

      // Candidates are MANAGERS at this store only, minus the person clocking
      // out. Reporting is a tick-box pick from this list — there is no free
      // text — so a nail tech can never be entered here by mistake. Nail-tech
      // early-leaves have their own flow (Nail Tech Check-ins → Mark left
      // early), called out prominently below.
      var selfEc = String(opts.selfEc || "").trim();
      var seen = {};
      var candidates = (opts.managers || []).filter(function (m) {
        if (!m || !m.name) return false;
        var ec = String(m.employee_code || "").trim();
        if (ec && ec === selfEc) return false;       // not yourself
        if (ec && seen[ec]) return false;            // de-dupe
        if (ec) seen[ec] = true;
        return true;
      });

      var nailTechCallout =
        '<div style="margin-top:12px;padding:11px 13px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;font-size:13px;line-height:1.45;color:#9A3412">' +
          '💅 <strong>A nail tech left early?</strong> Don\'t report them here. ' +
          'Go back and open <strong>Nail Tech Check-ins</strong>, then tap ' +
          '<strong>🏃 Mark left early</strong> on her row. This list is for <strong>managers only</strong>.' +
        '</div>';

      var modal = document.createElement("div");
      modal.id = "boa-mgr-early-report-modal";
      modal.className = "boa-modal-backdrop";
      modal.innerHTML =
        '<div class="boa-modal-card">' +
          '<h2 class="boa-modal-title">👀 Did another manager leave early today?</h2>' +
          '<p class="boa-modal-body">' +
            'Thanks for clocking out, ' + esc(opts.name) + '. Before you go — ' +
            'did any <strong>manager</strong> leave their shift early today without ' +
            'clocking out? A quick yes/no helps payroll catch missed deductions.' +
          '</p>' +
          nailTechCallout +
          (candidates.length
            ? '<div class="btn-row" style="justify-content:center;gap:10px;margin-top:14px">' +
                '<button type="button" class="link-btn link-btn-dark" id="boa-mgr-er-no">No, every manager stayed</button>' +
                '<button type="button" class="btn btn-primary" id="boa-mgr-er-yes">Yes, a manager did</button>' +
              '</div>' +
              '<div id="boa-mgr-er-detail" style="display:none;margin-top:14px">' +
                '<label class="lbl">Which manager(s) left early?</label>' +
                '<div id="boa-mgr-er-list" style="margin-top:6px">' +
                  candidates.map(function (m) {
                    return '<label style="display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;cursor:pointer">' +
                      '<input type="checkbox" class="boa-mgr-er-cb" value="' + esc(m.name) + '" style="width:18px;height:18px;flex:none">' +
                      '<span style="font-weight:600;color:#374151">' + esc(m.name) +
                        (m.role ? ' <span style="font-weight:400;color:#9ca3af">· ' + esc(m.role) + '</span>' : '') +
                      '</span>' +
                    '</label>';
                  }).join("") +
                '</div>' +
                '<label class="lbl" style="margin-top:10px">Note (optional — when they left, why if you know)</label>' +
                '<textarea id="boa-mgr-er-note" class="input" rows="2" ' +
                  'placeholder="e.g. around 14:00, said she was sick"></textarea>' +
                '<div id="boa-mgr-er-err" class="err-line"></div>' +
                '<div class="btn-row" style="justify-content:space-between;gap:8px;margin-top:10px">' +
                  '<button type="button" class="link-btn link-btn-dark" id="boa-mgr-er-cancel">Skip</button>' +
                  '<button type="button" class="btn btn-primary" id="boa-mgr-er-save">Submit report</button>' +
                '</div>' +
              '</div>'
            : '<p class="boa-modal-body" style="margin-top:12px;color:#9ca3af">' +
                'No other managers are based at this store, so there\'s nobody to report here.' +
              '</p>' +
              '<div class="btn-row" style="justify-content:center;margin-top:12px">' +
                '<button type="button" class="btn btn-primary" id="boa-mgr-er-done">Done</button>' +
              '</div>') +
        '</div>';
      document.body.appendChild(modal);

      function close(result) { modal.remove(); resolve(result); }
      modal.addEventListener("click", function (e) { if (e.target === modal) close(null); });

      var doneBtn = document.getElementById("boa-mgr-er-done");
      if (doneBtn) { doneBtn.onclick = function () { close(null); }; return; }

      var noBtn     = document.getElementById("boa-mgr-er-no");
      var yesBtn    = document.getElementById("boa-mgr-er-yes");
      var detail    = document.getElementById("boa-mgr-er-detail");
      var noteEl    = document.getElementById("boa-mgr-er-note");
      var errEl     = document.getElementById("boa-mgr-er-err");
      var saveBtn   = document.getElementById("boa-mgr-er-save");
      var cancelBtn = document.getElementById("boa-mgr-er-cancel");
      noBtn.onclick     = function () { close(null); };
      cancelBtn.onclick = function () { close(null); };
      yesBtn.onclick = function () {
        detail.style.display = "block";
        yesBtn.style.display = "none";
        noBtn.style.display  = "none";
      };
      saveBtn.onclick = function () {
        errEl.textContent = "";
        var picked = [].slice.call(modal.querySelectorAll(".boa-mgr-er-cb:checked"))
          .map(function (cb) { return cb.value; });
        if (!picked.length) { errEl.textContent = "Tick at least one manager."; return; }
        close({ names: picked.join(", "), note: (noteEl.value || "").trim() });
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
    var isAM = r === "AM";
    var b = branchName || "";

    if (b === "Sandown" || b === "Table Bay") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) {
        if (code === "WE") return "08:00 - 17:00";
        if (code === "WL") return "09:00 - 18:00";
        return "09:00 - 18:00";
      }
      if (dow === 6 && b === "Sandown") {
        if (code === "WE") return "08:00 - 17:00";
        if (code === "WL") return "10:00 - 19:00";
        return "10:00 - 19:00";
      }
      if (code === "WE") return "08:00 - 17:00";
      if (code === "WM") return "09:00 - 18:00";
      if (code === "WL") return "11:00 - 20:00";
      return "11:00 - 20:00";
    }
    if (b === "Riverlands") {
      if (isSM) return "08:00 - 17:00";               // SM/SSM always 08:00-17:00, every day
      if (dow === 6) return "09:00 - 18:00";          // Sat single AM
      if (dow === 0) return "08:30 - 17:00";          // Sun single AM (08:30 open)
      if (code === "WE") return "09:00 - 18:00";      // AM opener
      if (code === "WB") return "08:00 - 17:00";      // 4+ bonus opener
      if (code === "WL") return "10:00 - 19:00";
      return "10:00 - 19:00";
    }
    if (b === "Ballito" || b === "Mall of the South") {
      if (isSM) return "08:00 - 17:00";
      if (dow === 0) return isAM ? "08:30 - 17:00" : "08:00 - 17:00";
      if (code === "WE") return "08:00 - 17:00";
      if (code === "WM") return "09:00 - 18:00";
      if (code === "WL") return "10:00 - 19:00";
      return "10:00 - 19:00";
    }
    if (b === "Fourways") {
      if (isSM) return "08:00 - 17:00";   // SM/SSM always open, never close
      if (dow === 0) {
        if (code === "WE") return "08:00 - 17:00";
        if (code === "WL") return "10:00 - 19:00";
        return "10:00 - 19:00";
      }
      if (code === "WE") return "08:00 - 17:00";   // AM opener when no SM is in
      if (code === "WM") return "10:00 - 19:00";
      if (code === "WL") return "11:00 - 20:00";
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
    return "09:00 - 18:30";
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
