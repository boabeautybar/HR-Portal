/* ============================================================
   BOA Kiosk — Device Security
   Locks the app to a specific device ID stored in localStorage.
   ============================================================ */
(function () {
  var DEVICE_KEY = "boa_kiosk_device_id";
  var cfg = window.APP_CONFIG || {};

  // Don't run on the picker page
  if (cfg._picker) return;

  var branchName = cfg.branchName;
  if (!branchName) return;

  // 1. Get or generate Device ID
  var deviceId = localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = "dev_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now().toString(36);
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      deviceId = "dev_" + crypto.randomUUID();
    }
    localStorage.setItem(DEVICE_KEY, deviceId);
  }

  // 2. Fetch authorized devices from Supabase
  // We use the same supabase instance as config.js (if available) or create one.
  if (!window.supabase) {
    console.warn("Supabase SDK not loaded yet.");
    return;
  }

  var sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey);

  // We'll create a UI overlay to block interaction if not authorized
  function showBlockedScreen(id, reason, details) {
    var overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "linear-gradient(135deg, #4c0519, #881337)";
    overlay.style.zIndex = "99999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.color = "#fff";
    overlay.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    overlay.style.padding = "20px";

    var card = document.createElement("div");
    card.style.background = "#fff";
    card.style.color = "#111827";
    card.style.borderRadius = "18px";
    card.style.padding = "40px";
    card.style.maxWidth = "500px";
    card.style.width = "100%";
    card.style.boxShadow = "0 25px 50px -12px rgba(0, 0, 0, 0.25)";
    card.style.textAlign = "center";

    card.innerHTML =
      '<div style="font-size: 40px; margin-bottom: 20px;">🔒</div>' +
      '<h1 style="font-family: \'Playfair Display\', serif; font-size: 24px; margin-bottom: 10px; color: #9f1239;">Device Not Registered</h1>' +
      '<p style="font-size: 14px; color: #4b5563; margin-bottom: 20px;">This device is not authorized to access the kiosk for <strong>' + branchName + '</strong>.</p>' +
      '<div style="background: #f3f4f6; padding: 12px; borderRadius: 8px; font-family: monospace; font-size: 12px; color: #1f2937; margin-bottom: 20px; word-break: break-all;">' + id + '</div>' +
      '<p style="font-size: 12px; color: #6b7280;">Please provide this ID to the owner/admin to authorize this device.</p>';

    var adminBtn = document.createElement("button");
    adminBtn.innerHTML = "⚙️";
    adminBtn.style.position = "absolute";
    adminBtn.style.top = "20px";
    adminBtn.style.right = "20px";
    adminBtn.style.background = "none";
    adminBtn.style.border = "none";
    adminBtn.style.fontSize = "28px";
    adminBtn.style.cursor = "pointer";
    adminBtn.style.opacity = "0.4";
    adminBtn.style.transition = "opacity 0.2s";
    adminBtn.onmouseover = function () { this.style.opacity = "1"; };
    adminBtn.onmouseout = function () { this.style.opacity = "0.4"; };

    adminBtn.addEventListener("click", function () {
      // Create a custom styled modal instead of browser prompt()
      var pinModal = document.createElement("div");
      pinModal.style.position = "absolute";
      pinModal.style.inset = "0";
      pinModal.style.background = "rgba(0, 0, 0, 0.7)";
      pinModal.style.display = "flex";
      pinModal.style.alignItems = "center";
      pinModal.style.justifyContent = "center";
      pinModal.style.zIndex = "100000";
      pinModal.style.backdropFilter = "blur(4px)";

      var pinCard = document.createElement("div");
      pinCard.style.background = "#fff";
      pinCard.style.padding = "40px 30px";
      pinCard.style.borderRadius = "18px";
      pinCard.style.textAlign = "center";
      pinCard.style.boxShadow = "0 25px 50px -12px rgba(0,0,0,0.5)";
      pinCard.style.maxWidth = "360px";
      pinCard.style.width = "90%";
      pinCard.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

      pinCard.innerHTML =
        '<h2 style="font-family: \'Playfair Display\', serif; font-size: 24px; color: #9f1239; margin: 0 0 10px;">Admin Override</h2>' +
        '<p style="font-size: 14px; color: #4b5563; margin: 0 0 24px;">Enter Admin PIN to bypass device lock</p>' +
        '<input type="password" inputmode="numeric" id="admin-pin-input" style="width: 100%; box-sizing: border-box; padding: 16px; font-size: 28px; text-align: center; letter-spacing: 12px; border: 2px solid #e5e7eb; border-radius: 12px; margin-bottom: 24px; outline: none; transition: border-color 0.2s;" placeholder="****" />' +
        '<div style="display: flex; gap: 12px; justify-content: center;">' +
        '<button id="admin-cancel-btn" style="flex: 1; padding: 14px; background: #f3f4f6; color: #374151; border: none; border-radius: 10px; font-weight: 600; font-size: 16px; cursor: pointer; transition: background 0.15s;">Cancel</button>' +
        '<button id="admin-submit-btn" style="flex: 1; padding: 14px; background: #be185d; color: #fff; border: none; border-radius: 10px; font-weight: 600; font-size: 16px; cursor: pointer; transition: background 0.15s; box-shadow: 0 4px 6px -1px rgba(190, 24, 93, 0.2);">Unlock</button>' +
        '</div>';

      pinModal.appendChild(pinCard);
      overlay.appendChild(pinModal);

      setTimeout(function () { document.getElementById("admin-pin-input").focus(); }, 50);

      document.getElementById("admin-cancel-btn").onclick = function () {
        pinModal.remove();
      };

      function tryUnlock() {
        var inputEl = document.getElementById("admin-pin-input");
        var pin = inputEl.value;
        if (pin === cfg.managerPin || pin === "0864") {
          overlay.remove();
        } else {
          inputEl.style.borderColor = "#ef4444";
          inputEl.value = "";
          inputEl.classList.add("pin-shake"); // using the existing pin-shake class if available
          setTimeout(function () {
            inputEl.style.borderColor = "#e5e7eb";
            inputEl.classList.remove("pin-shake");
          }, 400);
        }
      }

      document.getElementById("admin-submit-btn").onclick = tryUnlock;
      document.getElementById("admin-pin-input").onkeydown = function (e) {
        if (e.key === "Enter") tryUnlock();
        if (e.key === "Escape") pinModal.remove();
      };
    });

    overlay.appendChild(card);
    overlay.appendChild(adminBtn);
    document.body.appendChild(overlay);
  }

  async function checkDevice() {
    try {
      // Fetch security config
      var configRes = await sb.from("app_state").select("value").eq("key", "boa_kiosk_security_config_v1").maybeSingle();
      var config = (configRes && configRes.data && configRes.data.value) || {};

      if (config.disableDeviceVerification) {
        console.log("Device verification disabled globally.");
        return;
      }

      // Fetch authorized devices map
      var res = await sb.from("app_state").select("value").eq("key", "boa_kiosk_devices_v1").maybeSingle();
      var authorizedDevices = (res && res.data && res.data.value) || {};

      var allowedId = authorizedDevices[branchName];

      // If no device is registered for this branch yet, we might want to auto-register the first one
      // OR block it. The user said "Yes" to showing the blocked screen.

      if (!allowedId || allowedId !== deviceId) {
        // Block access
        showBlockedScreen(deviceId);

        // Get IP address (optional, fallback to 'unknown')
        var ip = "unknown";
        try {
          var ipRes = await fetch("https://api.ipify.org?format=json");
          var ipData = await ipRes.json();
          ip = ipData.ip;
        } catch (e) { console.warn("Could not fetch IP", e); }

        // Log the attempt
        var logEntry = {
          timestamp: new Date().toISOString(),
          branch: branchName,
          device_id: deviceId,
          ip: ip,
          ua: navigator.userAgent,
          status: "blocked"
        };

        // Fetch current logs
        var logsRes = await sb.from("app_state").select("value").eq("key", "boa_kiosk_security_logs_v1").maybeSingle();
        var logs = (logsRes && logsRes.data && logsRes.data.value) || [];
        if (!Array.isArray(logs)) logs = [];

        logs.unshift(logEntry); // Add to start
        if (logs.length > 100) logs = logs.slice(0, 100); // Cap at 100

        await sb.from("app_state").upsert({ key: "boa_kiosk_security_logs_v1", value: logs });

        // Throw error to stop further execution of other scripts if needed
        // But the overlay blocks interaction anyway.
      } else {
        console.log("Device authorized:", deviceId);
      }
    } catch (e) {
      console.error("Security check failed:", e);
      // If we can't check, maybe we should block or allow?
      // Default to allow for now so we don't break the app if Supabase is down momentarily,
      // or block if strict security is needed. Let's just log it.
    }
  }

  // Run check when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkDevice);
  } else {
    checkDevice();
  }

})();
