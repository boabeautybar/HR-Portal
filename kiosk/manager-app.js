/* ============================================================
   BOA Check-in App — Manager Dashboard
   ------------------------------------------------------------
   Landing: 4 big tiles
     1. Nail Tech Check-in   (daily attendance grid — shared with staff)
     2. Manager Check-in     (PIN + selfie + GPS clock-in/out)
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
  function _voucherCard(m) {
    return '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:12px;padding:14px 16px;margin-top:10px">' +
      (m.amount ? '<div style="font-size:13px;font-weight:800;color:#14532d">Amount: ' + esc(String(m.amount)) + '</div>' : '') +
      '<div style="font-size:11px;font-weight:700;color:#14532d;text-transform:uppercase;letter-spacing:0.06em;margin-top:' + (m.amount ? '6' : '0') + 'px">Fresha voucher code</div>' +
      '<div style="display:flex;align-items:center;gap:12px;margin-top:4px;flex-wrap:wrap">' +
        '<code style="font-size:22px;font-weight:800;color:#065f46;letter-spacing:0.04em">' + esc(m.fresha) + '</code>' +
        '<button type="button" class="vc-copy" data-code="' + esc(m.fresha) + '" style="background:#fff;border:1px solid #86efac;color:#065f46;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer">Copy</button>' +
      '</div>' +
    '</div>';
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
  // the day. After PIN, we capture a selfie + GPS coords (anti-buddy-punch
  // measures), gate clock-IN to 08:00+, and auto-clock-OUT anyone still
  // clocked in at 18:30.

  // Haversine distance in meters between two {lat,lng} points
  function distMeters(a, b) {
    var R = 6371000;
    var toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Math.round(2 * R * Math.asin(Math.sqrt(s)));
  }

  function getGPS() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) { resolve(null); return; }
      var done = false;
      var timer = setTimeout(function () {
        if (done) return; done = true; resolve({ error: "timeout" });
      }, 12000);
      navigator.geolocation.getCurrentPosition(function (pos) {
        if (done) return; done = true; clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      }, function (err) {
        if (done) return; done = true; clearTimeout(timer);
        resolve({ error: err.message || ("code " + err.code) });
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    });
  }

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

  // Strip 18:30 from now (or 18:30 from a given date) — used for auto-out ts
  function eveningTs(yyyy_mm_dd) {
    var p = (yyyy_mm_dd || "").split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setHours(cfg.autoClockOutHour || 18, cfg.autoClockOutMinute || 30, 0, 0);
    return d.toISOString();
  }
  function dateKeyOf(iso) {
    var d = new Date(iso);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // Auto-close any "in" entries that don't have a same-day "out"/"out_auto"
  // after them, where the day is in the past OR (the day is today AND
  // current time >= 18:30). Returns a Set of EC codes that got auto-outed
  // YESTERDAY (used for the warning banner today).
  async function ensureAutoOuts(recentRows) {
    var groups = {};                                 // {ec: {ymd: [rows...]}}
    recentRows.forEach(function (r) {
      var ec = r.staff && r.staff.employee_code; if (!ec) return;
      var k = dateKeyOf(r.ts);
      groups[ec] = groups[ec] || {};
      groups[ec][k] = groups[ec][k] || [];
      groups[ec][k].push(r);
    });
    var now = new Date();
    var todayK = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    var cutoffPassed = (now.getHours() > (cfg.autoClockOutHour || 18)) ||
      (now.getHours() === (cfg.autoClockOutHour || 18) && now.getMinutes() >= (cfg.autoClockOutMinute || 30));
    var yesterdayDate = new Date(now); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    var yesterdayK = yesterdayDate.getFullYear() + "-" + String(yesterdayDate.getMonth() + 1).padStart(2, "0") + "-" + String(yesterdayDate.getDate()).padStart(2, "0");
    var autoOutedYesterday = {};
    for (var ec in groups) {
      for (var k in groups[ec]) {
        var dayRows = groups[ec][k].slice().sort(function (a, b) { return a.ts.localeCompare(b.ts); });
        var last = dayRows[dayRows.length - 1];
        if (last.type !== "in") {
          if ((last.type === "out_auto") && k === yesterdayK) autoOutedYesterday[ec] = last;
          continue;
        }
        // last is "in" and not closed
        var isPast = k < todayK;
        var isTodayAndCutoff = (k === todayK) && cutoffPassed;
        if (!isPast && !isTodayAndCutoff) continue;
        // Insert out_auto with ts = that day's 18:30
        try {
          await window.APP_DATA.addManagerClockinWithMeta(last.staff_id, "out_auto", {
            tsOverride: eveningTs(k),
            flags: ["auto_clockout"]
          });
          if (k === yesterdayK) autoOutedYesterday[ec] = { type: "out_auto", ts: eveningTs(k) };
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
      'Earliest clock-in is 08:00. Anyone still clocked in at 18:30 is auto-clocked-out.' +
      '</div>' +
      '<div id="mc-body">Loading…</div>' +
      '</section>'
    );
    document.getElementById("back-home").onclick = renderManagerLanding;
    document.getElementById("mc-refresh").onclick = renderMgrClockin;

    var pins, mgrs, recent, smTrialEcs, trialCand;
    try {
      pins = await window.APP_DATA.loadManagerPins();
      mgrs = await window.APP_DATA.listAllManagers();
      recent = await window.APP_DATA.listRecentManagerClockins(7);
      smTrialEcs = window.APP_DATA.activeSmTrialEcs ? await window.APP_DATA.activeSmTrialEcs() : {};
      trialCand = window.APP_DATA.listTrialCandidates ? await window.APP_DATA.listTrialCandidates() : [];
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

    // Run auto-out routine and find anyone auto-outed yesterday
    var autoYesterday = await ensureAutoOuts(recent);
    if (Object.keys(autoYesterday).length > 0) {
      // Rebuild recent so the per-row "today" status reflects the new auto-outs
      recent = await window.APP_DATA.listRecentManagerClockins(7);
    }

    // Pull today's manager schedule + ROM-tagged absences so we can decide
    // who's overdue to clock in. Both are best-effort — if either fetch
    // fails we just don't show the warning rather than blocking the screen.
    var thisBranch = (cfg.branchName || "");
    var mgrTodaySched = {};      // ec → schedule code for today
    var mgrTaggedStaffIds = {};  // staff_id → true (ROM already explained today)
    try {
      var _now = new Date();
      var _ym = _now.getFullYear() + "-" + String(_now.getMonth() + 1).padStart(2, "0");
      if (window.APP_DATA.getSchedule) {
        var schedRes = await window.APP_DATA.getSchedule(_ym, "mgr");
        var schedGrid = (schedRes && schedRes.grid) || {};
        var _dom = _now.getDate();
        var _ymd = todayK;
        Object.keys(schedGrid).forEach(function (ec) {
          var row = schedGrid[ec] || {};
          var v = row[_ymd] != null ? row[_ymd] : row[_dom];
          if (v != null) mgrTodaySched[ec] = v;
        });
      }
      if (window.APP_DATA.listManagerDayStatusesToday) {
        var tagged = await window.APP_DATA.listManagerDayStatusesToday();
        (tagged || []).forEach(function (r) { if (r && r.staff_id) mgrTaggedStaffIds[r.staff_id] = true; });
      }
    } catch (e) { console.warn("warning-banner data load failed:", e); }


    mgrs.sort(function (a, b) {
      var aHere = a.branch === thisBranch ? 0 : 1;
      var bHere = b.branch === thisBranch ? 0 : 1;
      if (aHere !== bHere) return aHere - bHere;
      return (a.name || "").localeCompare(b.name || "");
    });

    // Last clock-in TODAY per ec
    var todayK = (function () {
      var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    })();
    var byEc = {};
    var inTodayByEc = {};   // earliest "in" record today per ec — only one clock-in/day allowed
    recent.forEach(function (r) {
      var ec = r.staff && r.staff.employee_code; if (!ec) return;
      if (dateKeyOf(r.ts) !== todayK) return;
      if (!byEc[ec] || r.ts > byEc[ec].ts) byEc[ec] = r;
      if (r.type === "in" && (!inTodayByEc[ec] || r.ts < inTodayByEc[ec].ts)) inTodayByEc[ec] = r;
    });

    // Yesterday-auto-out summary banner
    var warnHtml = "";
    var autoNames = mgrs.filter(function (m) { return autoYesterday[m.employee_code]; }).map(function (m) { return m.name; });
    if (autoNames.length > 0) {
      warnHtml =
        '<div class="warn" style="margin-bottom:14px;background:#fee2e2;border:1px solid #fca5a5;color:#7f1d1d;border-radius:11px;padding:12px 14px;font-size:13px;line-height:1.5">' +
        '<strong>⚠ Forgot to clock out yesterday — this is an offence.</strong><br>' +
        'The following managers were auto-clocked-out at 18:30 and need to remember to clock out manually today: <strong>' + autoNames.map(esc).join(", ") + '</strong>.' +
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
      var ec = m.employee_code || "";
      var has = !!pins[ec];
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
      return '<div class="staff-row' + rowCls + '" data-id="' + m.id + '" data-ec="' + esc(ec) + '" data-name="' + esc(m.name) + '">' +
        '<div class="staff-row-main">' +
        '<div class="staff-name">' + esc(m.name) +
        rolePill +
        (m.branch !== thisBranch ? ' <span class="pill pill-mute">' + esc(m.branch || "—") + "</span>" : "") +
        (has ? "" : ' <span class="pill pill-warn">NO PIN</span>') + autoBadge + _nagBadge +
        '</div>' +
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
    // list above with PIN + photo + GPS.
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
        // 1b. Early-clock-out picker. Leaving before earlyClockOutCutoffHour
        // needs a reason — sick / appointment / personal / other — saved to
        // the early-leave sidecar so payroll can deduct the short hours.
        // Hours = cutoff time − now (rounded to 0.5h), capped at 12.
        var earlyOpts = null;
        if (type === "out") {
          var earlyCutH = (cfg.earlyClockOutCutoffHour != null ? cfg.earlyClockOutCutoffHour : 17);
          var nowD = new Date();
          if (nowD.getHours() < earlyCutH) {
            var minsShort = (earlyCutH * 60) - (nowD.getHours() * 60 + nowD.getMinutes());
            var rawHours  = Math.max(0.5, Math.round((minsShort / 60) * 2) / 2);
            var hoursShort = Math.min(12, rawHours);
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
        // 4. Get GPS (best-effort — graceful if denied/unavailable)
        var gps = await getGPS();
        var meta = { flags: [] };
        var distanceMeters = null, outOfRange = false;
        if (gps && !gps.error) {
          meta.lat = gps.lat; meta.lng = gps.lng; meta.accuracy = gps.accuracy;
          if (cfg.geo && cfg.geo.lat !== undefined) {
            distanceMeters = distMeters({ lat: gps.lat, lng: gps.lng }, cfg.geo);
            outOfRange = distanceMeters > (cfg.radiusMeters || 1000);
            meta.distanceMeters = distanceMeters;
            meta.outOfRange = outOfRange;
            if (outOfRange && cfg.enforceGeo) {
              alert("Out of range — your tablet reports being " + distanceMeters + "m from " + cfg.branchName + " (max " + cfg.radiusMeters + "m).\n\nClock-in is only allowed at the store.");
              return;
            }
            if (outOfRange) meta.flags.push("out_of_range");
          }
        } else if (gps && gps.error) {
          if (cfg.enforceGeo) {
            alert("Could not get location: " + gps.error + "\n\nLocation is required for clock-in. Enable location in browser settings and try again.");
            return;
          }
          meta.flags.push("no_gps:" + gps.error);
        }
        // 5. Photo
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
              reasonNote: earlyOpts.reasonNote
            });
          } catch (e) {
            alert("Clock-out saved, but the early-leave reason couldn't be recorded: " + (e.message || e) + "\n\nAsk the ROM to record it manually from the HR portal.");
          }
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
      var REASONS = [
        { code: "sick",        label: "🤒 Sick" },
        { code: "appointment", label: "🩺 Doctor / appointment" },
        { code: "personal",    label: "🏠 Personal" },
        { code: "other",       label: "✍ Other" }
      ];
      var modal = document.createElement("div");
      modal.id = "boa-mgr-early-modal";
      modal.className = "boa-modal-backdrop";
      var buttons = REASONS.map(function (r) {
        return '<button type="button" class="link-btn mgr-early-reason" data-code="' + r.code + '" ' +
               'style="padding:10px 12px;border-radius:9px;font-size:13px;font-weight:700;border:1px solid #FBCFE8;background:#fff;color:#831843;text-align:left">' +
               r.label + '</button>';
      }).join("");
      modal.innerHTML =
        '<div class="boa-modal-card">' +
          '<h2 class="boa-modal-title">🏃 Leaving early — ' + esc(opts.name) + '</h2>' +
          '<p class="boa-modal-body">' +
            'Why are you leaving before the end of your shift? Pick a reason. ' +
            'The hours short will be deducted from this pay cycle.' +
          '</p>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">' + buttons + '</div>' +
          '<label class="lbl" style="margin-top:14px">Hours short (30-minute intervals)</label>' +
          '<input id="boa-mgr-early-hours" type="number" class="input" min="0.5" max="12" step="0.5" ' +
            'value="' + esc(String(opts.defaultHours || 0.5)) + '" autocomplete="off">' +
          '<label class="lbl" style="margin-top:10px">Note (optional)</label>' +
          '<textarea id="boa-mgr-early-note" class="input" rows="2" ' +
            'placeholder="e.g. doctor at 14:30, feeling dizzy, etc."></textarea>' +
          '<div id="boa-mgr-early-err" class="err-line"></div>' +
          '<div class="btn-row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">' +
            '<button type="button" class="link-btn link-btn-dark" id="boa-mgr-early-cancel">Cancel clock-out</button>' +
            '<button type="button" class="btn btn-primary" id="boa-mgr-early-save" disabled>Continue clock-out</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);

      var chosen = null;
      var saveBtn = document.getElementById("boa-mgr-early-save");
      var cancelBtn = document.getElementById("boa-mgr-early-cancel");
      var hoursEl = document.getElementById("boa-mgr-early-hours");
      var noteEl  = document.getElementById("boa-mgr-early-note");
      var errEl   = document.getElementById("boa-mgr-early-err");
      function close(result) { modal.remove(); resolve(result); }
      cancelBtn.onclick = function () { close(null); };
      modal.addEventListener("click", function (e) { if (e.target === modal) close(null); });

      var reasonBtns = modal.querySelectorAll(".mgr-early-reason");
      Array.prototype.forEach.call(reasonBtns, function (b) {
        b.onclick = function () {
          chosen = b.dataset.code;
          Array.prototype.forEach.call(reasonBtns, function (x) {
            var isMe = x === b;
            x.style.background = isMe ? "#FCE7F3" : "#fff";
            x.style.border = isMe ? "2px solid #BE185D" : "1px solid #FBCFE8";
          });
          saveBtn.disabled = false;
        };
      });

      saveBtn.onclick = function () {
        errEl.textContent = "";
        if (!chosen) { errEl.textContent = "Pick a reason first."; return; }
        var h = Number((hoursEl.value || "").trim());
        if (!isFinite(h) || h <= 0) { errEl.textContent = "Hours must be a positive number (e.g. 1.5)."; return; }
        if (h > 12) { errEl.textContent = "12 hours is the max — please double-check."; return; }
        close({ reasonCode: chosen, reasonNote: noteEl.value || "", hours: h });
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
