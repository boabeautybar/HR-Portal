/* ============================================================
   BOA Kiosk — Device Lock (Tier 3A, server-validated)
   ------------------------------------------------------------
   The kiosk only boots on a device that holds a token matching
   the branch's single active row in `kiosk_devices` (Supabase).
   Enrolment is via a short code minted from the HR portal and
   redeemed here. All checks go through security-definer RPCs, so
   they can't be faked by editing this file (an unenrolled device
   has no valid token to present).

   Flow on load:
     • break-glass (boa_kiosk_security_config_v1.disableDeviceVerification) → allow
     • have a token and verify_kiosk_device → ok  → allow (cache lastOK)
     • verify errors (Supabase down) but verified < 24h ago → allow (outage grace)
     • otherwise → show the enrolment screen; the app never boots

   pin-gate.js awaits window.kioskDeviceGate (resolves true=allow / false=blocked).

   FROZEN once an iPad is enrolled — do not rename TOKEN_KEY, change the
   RPC names, or change the app's origin, or the device must re-enrol.
   ============================================================ */
(function () {
  var cfg = window.APP_CONFIG || {};
  if (cfg._picker) return; // branch picker page — nothing to gate

  var TOKEN_KEY  = "boa_kiosk_device_token_v2";   // FROZEN
  var LASTOK_KEY = "boa_kiosk_device_lastok_v2";
  var BRANCH_KEY = "boa_kiosk_device_branch";     // pinned branch for a branch device
  var ADMIN_KEY  = "boa_kiosk_device_admin";      // "1" for an all-branch admin device
  var GRACE_MS   = 24 * 60 * 60 * 1000;            // 24h outage grace
  var branchName = cfg.branchName;

  // Record this device's class so config.js (next load) can pin a branch device to
  // its branch, and so pin-gate.js can let an admin device skip the PIN.
  function markBranchDevice(branch) {
    try { localStorage.setItem(BRANCH_KEY, String(branch || "")); localStorage.removeItem(ADMIN_KEY); } catch (_e) {}
  }
  function markAdminDevice() {
    try { localStorage.setItem(ADMIN_KEY, "1"); localStorage.removeItem(BRANCH_KEY); } catch (_e) {}
  }
  // Seed from last-known class so the break-glass / outage-grace paths (which allow()
  // without a fresh verify) still let a known admin device skip the PIN.
  try { window.APP_DEVICE_ADMIN = (localStorage.getItem(ADMIN_KEY) === "1"); } catch (_e) {}

  // The gate pin-gate.js waits on: resolve(true)=boot, resolve(false)=blocked.
  var _resolveGate;
  window.kioskDeviceGate = new Promise(function (res) { _resolveGate = res; });

  function setOverlayVisible(v) {
    var ov = document.getElementById("pin-overlay");
    if (ov) ov.style.visibility = v ? "" : "hidden";
  }
  // Hide the default PIN screen until the device is confirmed (avoids a flash).
  if (document.getElementById("pin-overlay")) setOverlayVisible(false);
  else document.addEventListener("DOMContentLoaded", function () { setOverlayVisible(false); });

  function allow() { setOverlayVisible(true); _resolveGate(true); }
  function blockAndEnrol() { _resolveGate(false); renderEnrolment(); }

  // Can't enforce without branch + Supabase SDK/config → degrade open (infra issue,
  // not a bypass we can do anything about here).
  if (!branchName || !window.supabase || !cfg.supabase || !cfg.supabase.url) { allow(); return; }

  var sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey);

  function withinGrace() {
    var t = +localStorage.getItem(LASTOK_KEY) || 0;
    return t && (Date.now() - t < GRACE_MS);
  }

  async function run() {
    // Break-glass: lets Owner disable the lock globally for safe rollout / lockouts.
    try {
      var c = await sb.from("app_state").select("value").eq("key", "boa_kiosk_security_config_v1").maybeSingle();
      if (c && c.data && c.data.value && c.data.value.disableDeviceVerification) { allow(); return; }
    } catch (_e) { /* ignore — fall through to device check */ }

    var token = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch (_e) {}

    if (token) {
      try {
        var res = await sb.rpc("verify_kiosk_device", { p_token: token });
        if (!res.error && res.data && res.data.ok) {
          if (res.data.admin === true) {
            // Admin device — recognised on every branch, no PIN (pin-gate reads this).
            markAdminDevice();
            window.APP_DEVICE_ADMIN = true;
            try { localStorage.setItem(LASTOK_KEY, String(Date.now())); } catch (_e) {}
            allow();
            return;
          }
          // Branch device: token must be the active device FOR THIS branch — a token
          // enrolled for another branch must not unlock this one.
          var okBranch = String(res.data.branch || "").trim() === String(branchName).trim();
          if (okBranch) {
            markBranchDevice(res.data.branch);
            try { localStorage.setItem(LASTOK_KEY, String(Date.now())); } catch (_e) {}
            allow();
            return;
          }
          // valid token but wrong branch → re-enrol for this branch
        } else if (res.error && withinGrace()) {
          allow(); return; // server error → outage grace
        }
      } catch (_e) {
        if (withinGrace()) { allow(); return; }              // network down → grace
      }
    }
    blockAndEnrol();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else { run(); }

  // ---- Enrolment UI ----------------------------------------------------------
  // opts.dismissible → voluntary enrolment from the landing (verification still
  // open): show a × that closes back to the PIN screen. Without it, this is the
  // hard lock screen shown when an un-enrolled device is verified.
  function renderEnrolment(opts) {
    opts = opts || {};
    var dismissible = !!opts.dismissible;
    function build() {
      if (document.getElementById("kiosk-enrol-overlay")) return; // already open
      if (!dismissible) setOverlayVisible(false);
      var overlay = document.createElement("div");
      overlay.id = "kiosk-enrol-overlay";
      overlay.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(135deg,#4c0519,#881337);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      function close() { overlay.remove(); setOverlayVisible(true); }

      overlay.innerHTML =
        '<div style="background:#fff;color:#111827;border-radius:18px;padding:36px;max-width:460px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);text-align:center;position:relative">' +
          (dismissible
            ? '<div id="kiosk-enrol-x" title="Close" style="position:absolute;top:14px;right:18px;font-size:26px;color:#9ca3af;cursor:pointer;user-select:none;line-height:1">×</div>'
            : '<div id="kiosk-enrol-admin" title="Admin" style="position:absolute;top:16px;right:20px;font-size:22px;cursor:pointer;user-select:none">🛡️</div>') +
          '<div style="font-size:38px;margin-bottom:14px">' + (dismissible ? '📱' : '🔒') + '</div>' +
          '<h1 style="font-family:\'Playfair Display\',serif;font-size:22px;margin:0 0 8px;color:#9f1239">Set up this device</h1>' +
          '<p style="font-size:13px;color:#4b5563;margin:0 0 18px;line-height:1.5">Register this iPad as the device for <strong>' + esc(branchName) + '</strong>. Ask the Owner to generate an enrolment code in the HR portal, then enter it below.</p>' +
          '<input id="kiosk-enrol-code" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="6-digit code" ' +
            'style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:22px;letter-spacing:0.3em;text-align:center;border:1px solid #fbcfe8;border-radius:10px;color:#831843;font-family:inherit">' +
          '<div id="kiosk-enrol-err" style="color:#dc2626;font-size:12px;font-weight:600;min-height:16px;margin-top:10px">&nbsp;</div>' +
          '<button id="kiosk-enrol-go" style="margin-top:6px;width:100%;padding:12px;background:#BE185D;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer">Activate this device</button>' +
        '</div>';
      document.body.appendChild(overlay);

      var codeEl = document.getElementById("kiosk-enrol-code");
      var errEl  = document.getElementById("kiosk-enrol-go") && document.getElementById("kiosk-enrol-err");
      var goBtn  = document.getElementById("kiosk-enrol-go");

      function setErr(m) { if (errEl) errEl.textContent = m || " "; }

      async function activate() {
        var code = (codeEl.value || "").replace(/[^0-9]/g, "");
        if (code.length !== 6) { setErr("Enter the 6-digit code."); return; }
        goBtn.disabled = true; goBtn.textContent = "Activating…"; setErr("");
        try {
          var res = await sb.rpc("claim_kiosk_enrollment", { p_code: code });
          if (res.error || !res.data) throw new Error(res.error ? res.error.message : "invalid_or_expired_code");
          persistTokenAndReload(String(res.data));
        } catch (e) {
          goBtn.disabled = false; goBtn.textContent = "Activate this device";
          var msg = (e && e.message) || String(e);
          setErr(/invalid_or_expired/.test(msg) ? "That code is invalid or expired. Generate a new one." : ("Could not activate: " + msg));
        }
      }
      goBtn.onclick = activate;
      codeEl.addEventListener("keydown", function (e) { if (e.key === "Enter") activate(); else if (e.key === "Escape" && dismissible) close(); });
      setTimeout(function () { try { codeEl.focus(); } catch (_e) {} }, 50);

      if (dismissible) { var x = document.getElementById("kiosk-enrol-x"); if (x) x.onclick = close; }
      else bindAdmin(document.getElementById("kiosk-enrol-admin"));
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
    else build();
  }

  // kind: "admin" → all-branch admin device; otherwise pin to the current branch.
  function persistTokenAndReload(token, kind) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(LASTOK_KEY, String(Date.now()));
    } catch (_e) {}
    if (kind === "admin") markAdminDevice();
    else markBranchDevice(branchName);
    location.reload();
  }

  // ---- Admin fallback: self-enrol this device as an all-branch admin device --
  // Accepts the owner code (0864) or the GM code (1478) — both grant identical
  // admin access on the kiosk.
  var ADMIN_CODES = ["0864", "1478"];
  // Human ROLE label per admin code — shown instead of the raw code anywhere a
  // lookup is attributed (e.g. the voucher gate's "Signed in as …"). The code
  // itself is never displayed; only the role.
  var ADMIN_LABELS = { "0864": "Owner", "1478": "Ops" };
  // Expose a checker + label so other kiosk screens (e.g. the voucher-lookup
  // identity gate) use the same owner/Ops codes from one source of truth.
  window.BOA_IS_ADMIN_CODE = function (pin) { return ADMIN_CODES.indexOf(String(pin == null ? "" : pin).trim()) >= 0; };
  window.BOA_ADMIN_LABEL = function (pin) { return ADMIN_LABELS[String(pin == null ? "" : pin).trim()] || null; };
  function bindAdmin(adminBtn) {
    if (!adminBtn) return;
    adminBtn.onclick = function () {
      var ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;z-index:9999999;background:rgba(0,0,0,0.4);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center";
      var card = document.createElement("div");
      card.className = "pin-card";
      card.style.position = "relative";
      card.innerHTML =
        '<div style="position:absolute;top:12px;right:16px;font-size:26px;color:#9ca3af;cursor:pointer" id="kiosk-admin-x">×</div>' +
        '<div class="pin-logo">Admin Auth</div>' +
        '<div class="pin-sub">AUTHORISE DEVICE</div>' +
        '<div class="pin-inputs" id="kiosk-admin-inputs"></div>' +
        '<div class="pin-error" id="kiosk-admin-err">&nbsp;</div>';
      ov.appendChild(card);
      document.body.appendChild(ov);
      document.getElementById("kiosk-admin-x").onclick = function () { ov.remove(); };

      var wrap = document.getElementById("kiosk-admin-inputs");
      var errEl = document.getElementById("kiosk-admin-err");
      var inputs = [];
      for (var i = 0; i < 4; i++) {
        var inp = document.createElement("input");
        inp.type = "password"; inp.inputMode = "numeric"; inp.maxLength = 1;
        inp.className = "pin-digit"; inp.autocomplete = "off";
        wrap.appendChild(inp); inputs.push(inp);
      }
      setTimeout(function () { try { inputs[0].focus(); } catch (_e) {} }, 50);

      async function tryPin() {
        var pin = inputs.map(function (i) { return i.value; }).join("");
        if (pin.length !== 4) return;
        if (ADMIN_CODES.indexOf(pin) === -1) {
          card.classList.add("pin-shake");
          setTimeout(function () { card.classList.remove("pin-shake"); }, 400);
          errEl.textContent = "Incorrect PIN.";
          inputs.forEach(function (i) { i.value = ""; }); inputs[0].focus();
          return;
        }
        try {
          errEl.style.color = "#15803d"; errEl.textContent = "Authorising…";
          var res = await sb.rpc("admin_self_enroll", { p_branch: branchName });
          if (res.error || !res.data) throw new Error(res.error ? res.error.message : "failed");
          errEl.textContent = "Authorised! Reloading…";
          persistTokenAndReload(String(res.data), "admin");
        } catch (e) {
          errEl.style.color = ""; errEl.textContent = "Error: " + ((e && e.message) || e);
          inputs.forEach(function (i) { i.value = ""; }); inputs[0].focus();
        }
      }
      inputs.forEach(function (input, idx) {
        input.addEventListener("input", function (e) {
          var v = e.target.value;
          if (!/^[0-9]$/.test(v)) { e.target.value = ""; return; }
          errEl.innerHTML = "&nbsp;";
          if (idx < inputs.length - 1) inputs[idx + 1].focus(); else tryPin();
        });
        input.addEventListener("keydown", function (e) {
          if (e.key === "Backspace" && !input.value && idx > 0) inputs[idx - 1].focus();
          else if (e.key === "Enter") tryPin();
          else if (e.key === "Escape") ov.remove();
        });
      });
    };
  }

  // Also let the normal landing 🛡️ (in index.html) trigger admin self-enrol.
  (function bindLanding() {
    var el = document.getElementById("kiosk-admin-unlock");
    if (el) bindAdmin(el);
    else document.addEventListener("DOMContentLoaded", function () { bindAdmin(document.getElementById("kiosk-admin-unlock")); });
  })();

  // "Enroll this device" link on the PIN landing — lets an un-enrolled iPad be
  // registered with a portal code WHILE verification is still disabled (so the
  // rollout never interrupts a branch). Only shown when this device has no
  // token; once enrolled it stays hidden. Code-protected, so safe to expose.
  (function bindEnrolLink() {
    function attach() {
      var el = document.getElementById("kiosk-enrol-device");
      if (!el) return;
      var hasToken = false;
      try { hasToken = !!localStorage.getItem(TOKEN_KEY); } catch (_e) {}
      if (!hasToken) el.style.display = "";          // reveal only on un-enrolled devices
      el.onclick = function () { renderEnrolment({ dismissible: true }); };
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
    else attach();
  })();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
})();
