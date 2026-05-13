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

  document.addEventListener("app:authed", function (e) {
    if (e.detail.role !== "manager") return;
    boot();
  });

  function getGreeting() {
    var h = new Date().getHours();
    if (h >= 5  && h < 12) return "Good morning";
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
      if (a === "logout")   { window.APP_LOGOUT(); return; }
      // While the store-open gate is showing, only LOG OUT is allowed —
      // every other nav action is blocked so the manager can't navigate
      // away from the gate without first marking the store as open.
      if (document.body.classList.contains("store-gate-active")) return;
      if (a === "home")     { renderManagerLanding(); return; }
      if (a === "news"      && window.BOA_FLOWS) { window.BOA_FLOWS.renderNews();     return; }
      if (a === "schedule"  && window.BOA_FLOWS) { window.BOA_FLOWS.renderSchedule(); return; }
      if (a === "staff")    { renderStaff();    return; }
      if (a === "today")    { renderCheckins(); return; }
      if (a === "cashlist") { renderCashups();  return; }
    });

    if (window.BOA_FLOWS) {
      window.BOA_FLOWS.refreshNewsBadge();
      setInterval(window.BOA_FLOWS.refreshNewsBadge, 60 * 1000);
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
  var OPEN_GATE_HOUR   = 6;
  var OPEN_GATE_MINUTE = 30;

  function setHeaderGated(gated) {
    if (gated) document.body.classList.add("store-gate-active");
    else       document.body.classList.remove("store-gate-active");
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
    var gate    = OPEN_GATE_HOUR * 60 + OPEN_GATE_MINUTE;
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
    var btnEl  = document.getElementById("sg-btn");
    var statEl = document.getElementById("sg-status");
    var tickHandle = null;
    var submitting = false;

    function updateButtonState() {
      if (submitting) return;
      var name        = (nameEl.value || "").trim();
      var nameOk      = name.length >= 2;
      var minsToWait  = minutesUntilOpenAllowed(new Date());
      var timeOk      = minsToWait === 0;
      var enabled     = nameOk && timeOk;
      btnEl.disabled  = !enabled;
      btnEl.style.opacity = enabled ? "1" : "0.55";
      btnEl.style.cursor  = enabled ? "pointer" : "not-allowed";
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
    setTimeout(function () { try { nameEl.focus(); } catch (_e) {} }, 50);

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

  // ---------------- Tile landing ----------------
  function renderManagerLanding() {
    setSublabel("HOME");
    var nextMonth = window.APP_DATA ? window.APP_DATA.nextMonthLabel().split(" ")[0] : "Off";
    setMain(
      '<div class="hero hero-big">' +
        '<div class="hero-brand">' + esc(cfg.branchDisplayName || cfg.branchName || "BOA Check-in") + ' · Manager</div>' +
        '<div class="hero-title">What would you like to do?</div>' +
      '</div>' +
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
      '</div>'
    );
    document.getElementById("tile-nailtech").onclick = function () {
      if (window.BOA_FLOWS) window.BOA_FLOWS.renderCheckin();
    };
    document.getElementById("tile-mgrclock").onclick = function () { renderMgrClockin(); };
    document.getElementById("tile-cashup").onclick   = function () {
      if (window.BOA_FLOWS) window.BOA_FLOWS.renderCashup();
    };
    document.getElementById("tile-offreq").onclick   = function () {
      if (window.BOA_FLOWS) window.BOA_FLOWS.renderOffRequests();
    };
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
    var staff   = loaded[0];
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
    var leftStaff   = [];
    staff.forEach(function (s) {
      var ec = s && s.employee_code && String(s.employee_code).trim();
      var off = ec ? offByEc[ec] : null;
      var eff = (off && off.leftDate) || s.left_date || null;
      if (!eff) { activeStaff.push(s); return; }
      if (eff < monthStart) return;          // historical, drop
      if (eff > todayIso) { activeStaff.push(s); return; } // future leaver
      s._leftDate  = eff;
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

    var html = "";
    if (activeStaff.length > 0) {
      html += '<div class="staff-section-head">Current staff · ' + activeStaff.length + '</div>';
      html += activeStaff.map(function (s) { return renderRow(s, false); }).join("");
    }
    if (leftStaff.length > 0) {
      html += '<div class="staff-section-head staff-section-head-left">👋 Left this month · ' + leftStaff.length + '</div>';
      html += leftStaff.map(function (s) { return renderRow(s, true); }).join("");
    }
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
    var s = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
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
        try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_e) {}
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
        document.getElementById("cam-retake").onclick  = showLive;
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
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
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
    var todayK = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0");
    var cutoffPassed = (now.getHours() > (cfg.autoClockOutHour || 18)) ||
                       (now.getHours() === (cfg.autoClockOutHour || 18) && now.getMinutes() >= (cfg.autoClockOutMinute || 30));
    var yesterdayDate = new Date(now); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    var yesterdayK = yesterdayDate.getFullYear() + "-" + String(yesterdayDate.getMonth()+1).padStart(2,"0") + "-" + String(yesterdayDate.getDate()).padStart(2,"0");
    var autoOutedYesterday = {};
    for (var ec in groups) {
      for (var k in groups[ec]) {
        var dayRows = groups[ec][k].slice().sort(function (a,b) { return a.ts.localeCompare(b.ts); });
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

    var pins, mgrs, recent;
    try {
      pins   = await window.APP_DATA.loadManagerPins();
      mgrs   = await window.APP_DATA.listAllManagers();
      recent = await window.APP_DATA.listRecentManagerClockins(7);
    } catch (e) {
      document.getElementById("mc-body").innerHTML =
        '<div class="warn">Could not load: ' + esc(e.message || e) + '</div>';
      return;
    }
    if (mgrs.length === 0) {
      document.getElementById("mc-body").innerHTML = '<div class="empty">No active managers in the staff table yet.</div>';
      return;
    }

    // Run auto-out routine and find anyone auto-outed yesterday
    var autoYesterday = await ensureAutoOuts(recent);
    if (Object.keys(autoYesterday).length > 0) {
      // Rebuild recent so the per-row "today" status reflects the new auto-outs
      recent = await window.APP_DATA.listRecentManagerClockins(7);
    }

    var thisBranch = (cfg.branchName || "");
    mgrs.sort(function (a, b) {
      var aHere = a.branch === thisBranch ? 0 : 1;
      var bHere = b.branch === thisBranch ? 0 : 1;
      if (aHere !== bHere) return aHere - bHere;
      return (a.name || "").localeCompare(b.name || "");
    });

    // Last clock-in TODAY per ec
    var todayK = (function () {
      var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    })();
    var byEc = {};
    recent.forEach(function (r) {
      var ec = r.staff && r.staff.employee_code; if (!ec) return;
      if (dateKeyOf(r.ts) !== todayK) return;
      if (!byEc[ec] || r.ts > byEc[ec].ts) byEc[ec] = r;
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

    document.getElementById("mc-body").innerHTML =
      '<div class="staff-list">' +
        mgrs.map(function (m) {
          var ec   = m.employee_code || "";
          var has  = !!pins[ec];
          var last = byEc[ec];
          var lastLabel;
          if (!last) lastLabel = '<span class="pill pill-mute">not clocked in</span>';
          else if (last.type === "in") lastLabel = '<span class="pill pill-ok">IN ' + fmtTime(last.ts) + '</span>';
          else if (last.type === "out_auto") lastLabel = '<span class="pill pill-warn">AUTO-OUT ' + fmtTime(last.ts) + '</span>';
          else lastLabel = '<span class="pill pill-warn">OUT ' + fmtTime(last.ts) + '</span>';
          var autoBadge = autoYesterday[ec] ? ' <span class="pill" style="background:#fee2e2;color:#7f1d1d">⚠ auto-out yesterday</span>' : "";
          var rowCls = m.branch === thisBranch ? "" : " staff-inactive";
          return '<div class="staff-row' + rowCls + '" data-id="' + m.id + '" data-ec="' + esc(ec) + '" data-name="' + esc(m.name) + '">' +
                   '<div class="staff-row-main">' +
                     '<div class="staff-name">' + esc(m.name) +
                       (m.role ? ' <span class="pill pill-mute">' + esc(m.role) + "</span>" : "") +
                       (m.branch !== thisBranch ? ' <span class="pill pill-mute">' + esc(m.branch || "—") + "</span>" : "") +
                       (has ? "" : ' <span class="pill pill-warn">NO PIN</span>') + autoBadge +
                     '</div>' +
                     '<div class="staff-code" style="margin-top:3px">' + lastLabel + '</div>' +
                   '</div>' +
                   '<div class="staff-row-actions">' +
                     '<button class="btn btn-primary" data-act="clockin"  ' + (has ? "" : 'disabled') + '>Clock In</button>' +
                     '<button class="link-btn"       data-act="clockout" ' + (has ? "" : 'disabled') + '>Clock Out</button>' +
                   '</div>' +
                 '</div>';
        }).join("") +
      '</div>';

    var rows = document.querySelectorAll('#mc-body .staff-row');
    Array.prototype.forEach.call(rows, function (row) {
      var inBtn  = row.querySelector('[data-act="clockin"]');
      var outBtn = row.querySelector('[data-act="clockout"]');
      var id     = row.dataset.id;
      var ec     = row.dataset.ec;
      var name   = row.dataset.name;

      var doClock = async function (type) {
        // 1. Time gate (clock-IN only)
        if (type === "in") {
          var nowH = new Date().getHours();
          var earliest = (cfg.clockInEarliestHour != null ? cfg.clockInEarliestHour : 8);
          if (nowH < earliest) {
            alert("Earliest clock-in is " + String(earliest).padStart(2,"0") + ":00.\n\nIt's only " + new Date().toLocaleTimeString() + " — wait until " + String(earliest).padStart(2,"0") + ":00 then try again.");
            return;
          }
        }
        // 2. PIN
        var entered = prompt("Enter " + name + "'s 6-digit personal PIN:");
        if (entered == null) return;
        entered = entered.trim();
        if (!/^\d{6}$/.test(entered)) { alert("PIN must be exactly 6 digits."); return; }
        if (entered !== pins[ec])     { alert("Wrong PIN."); return; }
        // 3. Block double clock of same type today
        var last = byEc[ec];
        if (last && last.type === type) {
          var lbl = type === "in" ? "in" : "out";
          if (!confirm(name + " is already clocked " + lbl + " today (" + fmtTime(last.ts) + "). Record another clock-" + lbl + " anyway?")) return;
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

        // 6. Save
        try {
          await window.APP_DATA.addManagerClockinWithMeta(id, type, meta);
          renderMgrClockin();
        } catch (e) {
          alert("Could not record: " + (e.message || e));
        }
      };
      if (inBtn)  inBtn.onclick  = function () { doClock("in"); };
      if (outBtn) outBtn.onclick = function () { doClock("out"); };
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
          '<th>Date</th><th>Yoco</th><th>Cash</th><th>Vouchers</th><th>Discounts</th><th>Total</th><th>Signed by</th>' +
        '</tr></thead>' +
        '<tbody>' +
          rows.map(function (r) {
            return '<tr>' +
              '<td>' + fmtDate(r.date) + '</td>' +
              '<td>' + fmtMoney(r.yoco) + '</td>' +
              '<td>' + fmtMoney(r.cash) + '</td>' +
              '<td>' + fmtMoney(r.vouchers) + '</td>' +
              '<td>' + fmtMoney(r.discounts) + '</td>' +
              '<td><strong>' + fmtMoney(r.total) + '</strong></td>' +
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
