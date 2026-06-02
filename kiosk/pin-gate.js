/* ============================================================
   BOA Check-in App — PIN gate
   Two PINs (set in config.js):
     staffPin   → enters staff dashboard
     managerPin → enters manager dashboard
   Auth state is per-tab (sessionStorage); clears on tab close.

   Rate limiting: failed PIN attempts are tracked in localStorage.
   Every 5 wrong PINs triggers a lockout that escalates each round
   (30s → 60s → 120s → 240s → 480s, capped at 30 minutes). The UI
   disables the inputs and shows a live countdown during a lockout.
   A correct PIN clears the counter. The lockout survives reloads
   and new tabs on the same device. To reset manually, clear the
   "boa_pin_fail_v1" key in localStorage (DevTools → Application).
   ============================================================ */
(function () {
  var STORAGE_KEY          = "boa_checkin_role_v1";
  var FAIL_KEY             = "boa_pin_fail_v1";
  var ATTEMPTS_PER_LOCKOUT = 5;
  var BASE_LOCKOUT_SECONDS = 30;
  var MAX_LOCKOUT_SECONDS  = 30 * 60;
  var cfg = window.APP_CONFIG || {};
  // Branch picker is rendering — don't bootstrap the PIN gate or app.
  if (cfg._picker) return;

  // ── Failure / lockout state (localStorage) ─────────────────
  function readFailState() {
    try {
      var raw = localStorage.getItem(FAIL_KEY);
      if (!raw) return { count: 0, until: 0 };
      var v = JSON.parse(raw);
      return { count: +v.count || 0, until: +v.until || 0 };
    } catch (_e) { return { count: 0, until: 0 }; }
  }
  function writeFailState(state) {
    try { localStorage.setItem(FAIL_KEY, JSON.stringify(state)); } catch (_e) {}
  }
  function clearFailState() {
    try { localStorage.removeItem(FAIL_KEY); } catch (_e) {}
  }
  // Lockout duration grows each batch of 5 fails: 30, 60, 120, 240, 480, capped.
  function lockoutSecondsForCount(count) {
    if (count < ATTEMPTS_PER_LOCKOUT) return 0;
    var step    = Math.floor(count / ATTEMPTS_PER_LOCKOUT) - 1; // 0,1,2,...
    var seconds = BASE_LOCKOUT_SECONDS * Math.pow(2, step);
    return Math.min(seconds, MAX_LOCKOUT_SECONDS);
  }

  // Define logout helper FIRST, before any early returns. Otherwise an
  // already-authed session takes the auto-auth branch below and exits the
  // IIFE before APP_LOGOUT is assigned, leaving the Log Out button broken.
  window.APP_LOGOUT = function () {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (_e) {}
    location.reload();
  };

  var inited = false;

  // Device lock (security.js) gates the boot: resolve(true) = enrolled/allowed,
  // resolve(false) = unenrolled (its enrolment screen owns the page, so the PIN
  // must never show). If security.js isn't present, default to allow.
  (window.kioskDeviceGate || Promise.resolve(true)).then(function (deviceOk) {
    if (deviceOk === false) return; // blocked — do not boot the app
    bootGate();
  });

  function bootGate() {
    // If already authed in this session, hide the overlay and tell the app.
    // The dispatch is deferred to the next tick so the role apps (which load
    // *after* this script) have time to register their listener.
    var prev = sessionStorage.getItem(STORAGE_KEY);
    if (prev === "staff" || prev === "manager") {
      document.body.classList.add("role-" + prev);
      window.APP_ROLE = prev;
      var hideOverlay = function () {
        var ov = document.getElementById("pin-overlay");
        if (ov) ov.style.display = "none";
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", hideOverlay);
      } else { hideOverlay(); }
      setTimeout(function () {
        document.dispatchEvent(new CustomEvent("app:authed", { detail: { role: prev } }));
      }, 0);
      return;
    }

    document.addEventListener("DOMContentLoaded", init);
    if (document.readyState !== "loading") init();
  }

  function init() {
    if (inited) return; inited = true;

    var brand = document.getElementById("pin-brand");
    if (brand) brand.textContent = (cfg.branchDisplayName || cfg.branchName || "BOA Check-in");

    var inputs       = document.querySelectorAll("#pin-overlay .pin-digit");
    var errEl        = document.getElementById("pin-error");
    var lockoutTimer = null;

    function setInputsEnabled(enabled) {
      inputs.forEach(function (i) { i.disabled = !enabled; });
    }
    function clearInputs(focusFirst) {
      inputs.forEach(function (i) { i.value = ""; });
      if (focusFirst && inputs[0] && !inputs[0].disabled) inputs[0].focus();
    }
    function fmtRemaining(sec) {
      if (sec < 60) return sec + "s";
      var m = Math.floor(sec / 60), s = sec % 60;
      return m + "m " + (s < 10 ? "0" + s : s) + "s";
    }
    // Returns true if the gate is currently locked. Also updates the UI:
    // disables inputs + shows a live countdown while locked, re-enables
    // them and clears the message when the lockout expires.
    function applyLockoutUI() {
      var s   = readFailState();
      var now = Date.now();
      if (!s.until || s.until <= now) {
        if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
        setInputsEnabled(true);
        if (errEl) errEl.innerHTML = "&nbsp;";
        return false;
      }
      setInputsEnabled(false);
      clearInputs(false);
      if (lockoutTimer) clearInterval(lockoutTimer);
      var tick = function () {
        var fresh     = readFailState();
        var remaining = Math.max(0, Math.ceil((fresh.until - Date.now()) / 1000));
        if (remaining <= 0) {
          if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
          setInputsEnabled(true);
          if (errEl) errEl.innerHTML = "&nbsp;";
          if (inputs[0]) inputs[0].focus();
          return;
        }
        if (errEl) errEl.textContent = "Too many attempts. Try again in " + fmtRemaining(remaining);
      };
      tick();
      lockoutTimer = setInterval(tick, 1000);
      return true;
    }

    // Show the lockout immediately if the user is returning mid-lockout.
    if (!applyLockoutUI()) {
      setTimeout(function () { if (inputs[0]) inputs[0].focus(); }, 50);
    }

    function tryPin() {
      if (applyLockoutUI()) return; // bail if currently locked

      var pin = "";
      inputs.forEach(function (i) { pin += i.value; });
      if (pin.length !== 4) return;

      var role = null;
      if (pin === (cfg.staffPin   || "")) role = "staff";
      if (pin === (cfg.managerPin || "")) role = "manager";

      if (role) {
        clearFailState();
        sessionStorage.setItem(STORAGE_KEY, role);
        document.body.classList.add("role-" + role);
        var ov = document.getElementById("pin-overlay");
        ov.style.opacity = "0";
        ov.style.transition = "opacity 0.3s";
        setTimeout(function () {
          ov.style.display = "none";
          window.APP_ROLE = role;
          document.dispatchEvent(new CustomEvent("app:authed", { detail: { role: role } }));
        }, 300);
        return;
      }

      // Wrong PIN — shake, increment counter, maybe trigger a lockout.
      var card = document.querySelector(".pin-card");
      if (card) {
        card.classList.add("pin-shake");
        setTimeout(function () { card.classList.remove("pin-shake"); }, 400);
      }
      var s = readFailState();
      s.count = (s.count || 0) + 1;
      if (s.count % ATTEMPTS_PER_LOCKOUT === 0) {
        s.until = Date.now() + lockoutSecondsForCount(s.count) * 1000;
      }
      writeFailState(s);

      if (s.until && s.until > Date.now()) {
        applyLockoutUI();
      } else {
        var remaining = ATTEMPTS_PER_LOCKOUT - (s.count % ATTEMPTS_PER_LOCKOUT);
        if (errEl) {
          errEl.textContent = "Incorrect PIN — " + remaining +
            " attempt" + (remaining === 1 ? "" : "s") + " left";
        }
        clearInputs(true);
      }
    }

    inputs.forEach(function (input, idx) {
      input.addEventListener("input", function (e) {
        if (input.disabled) return; // safety belt during lockout
        var v = e.target.value;
        if (!/^[0-9]$/.test(v)) { e.target.value = ""; return; }
        if (errEl) errEl.innerHTML = "&nbsp;";
        if (idx < inputs.length - 1) inputs[idx + 1].focus();
        else tryPin();
      });
      input.addEventListener("keydown", function (e) {
        if (input.disabled) return;
        if (e.key === "Backspace" && !input.value && idx > 0) {
          inputs[idx - 1].focus();
        } else if (e.key === "Enter") {
          tryPin();
        }
      });
    });
  }

})();
