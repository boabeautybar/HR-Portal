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

    overlay.appendChild(card);
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
