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
    card.style.position = "relative";

    card.innerHTML = 
      '<div style="font-size: 40px; margin-bottom: 20px;">🔒</div>' +
      '<h1 style="font-family: \'Playfair Display\', serif; font-size: 24px; margin-bottom: 10px; color: #9f1239;">Device Not Registered</h1>' +
      '<p style="font-size: 14px; color: #4b5563; margin-bottom: 20px;">This device is not authorized to access the kiosk for <strong>' + branchName + '</strong>.</p>' +
      '<div style="background: #f3f4f6; padding: 12px; borderRadius: 8px; font-family: monospace; font-size: 12px; color: #1f2937; margin-bottom: 20px; word-break: break-all;">' + id + '</div>' +
      '<p style="font-size: 12px; color: #6b7280;">Please provide this ID to the owner/admin to authorize this device.</p>';

    overlay.appendChild(card);
    
    var adminBtn = document.createElement("div");
    adminBtn.id = "kiosk-admin-unlock-blocked";
    adminBtn.style.position = "absolute";
    adminBtn.style.top = "20px";
    adminBtn.style.right = "24px";
    adminBtn.style.fontSize = "24px";
    adminBtn.style.cursor = "pointer";
    adminBtn.style.userSelect = "none";
    adminBtn.title = "Admin Login";
    adminBtn.innerText = "🛡️";
    overlay.appendChild(adminBtn);

    document.body.appendChild(overlay);
    bindAdminBtnElement(adminBtn);
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

      // Fetch authorized admin devices
      var adminRes = await sb.from("app_state").select("value").eq("key", "boa_kiosk_admin_devices_v1").maybeSingle();
      var adminDevices = (adminRes && adminRes.data && adminRes.data.value) || [];

      // If no device is registered for this branch yet, we might want to auto-register the first one
      // OR block it. The user said "Yes" to showing the blocked screen.
      
      var isAdmin = adminDevices.includes(deviceId);

      if ((!allowedId || allowedId !== deviceId) && !isAdmin) {
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

  bindLandingAdminBtn();

  function bindLandingAdminBtn() {
    bindAdminBtnElement(document.getElementById("kiosk-admin-unlock"));
  }

  function bindAdminBtnElement(adminBtn) {
    if (adminBtn) {
      adminBtn.onclick = function () {
        var overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.zIndex = "9999999";
        overlay.style.background = "rgba(0,0,0,0.4)";
        overlay.style.backdropFilter = "blur(6px)";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";

        var card = document.createElement("div");
        card.className = "pin-card";
        card.style.position = "relative";
        
        var closeBtn = document.createElement("div");
        closeBtn.innerHTML = "×";
        closeBtn.style.position = "absolute";
        closeBtn.style.top = "12px";
        closeBtn.style.right = "16px";
        closeBtn.style.fontSize = "26px";
        closeBtn.style.color = "#9ca3af";
        closeBtn.style.cursor = "pointer";
        closeBtn.onclick = function() { overlay.remove(); };
        card.appendChild(closeBtn);

        var title = document.createElement("div");
        title.className = "pin-logo";
        title.innerText = "Admin Auth";
        card.appendChild(title);

        var sub = document.createElement("div");
        sub.className = "pin-sub";
        sub.innerText = "AUTHORIZE DEVICE";
        card.appendChild(sub);

        var inputsWrap = document.createElement("div");
        inputsWrap.className = "pin-inputs";
        
        var inputs = [];
        for(let i=0; i<4; i++){
            let inp = document.createElement("input");
            inp.type = "password";
            inp.inputMode = "numeric";
            inp.maxLength = 1;
            inp.className = "pin-digit";
            inp.autocomplete = "off";
            inputsWrap.appendChild(inp);
            inputs.push(inp);
        }
        card.appendChild(inputsWrap);

        var errEl = document.createElement("div");
        errEl.className = "pin-error";
        errEl.innerHTML = "&nbsp;";
        card.appendChild(errEl);

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        setTimeout(() => inputs[0].focus(), 50);

        async function tryPin() {
          var pin = inputs.map(i => i.value).join("");
          if (pin.length !== 4) return;

          if (pin === "0864") {
             try {
               errEl.style.color = "#15803d";
               errEl.innerText = "Authorizing...";
               var adminRes = await sb.from("app_state").select("value").eq("key", "boa_kiosk_admin_devices_v1").maybeSingle();
               var adminDevices = (adminRes && adminRes.data && adminRes.data.value) || [];
               if (!adminDevices.includes(deviceId)) {
                 adminDevices.push(deviceId);
                 await sb.from("app_state").upsert({ key: "boa_kiosk_admin_devices_v1", value: adminDevices });
               }
               errEl.innerText = "Authorized! Reloading...";
               setTimeout(() => location.reload(), 1000);
             } catch(e) {
               errEl.style.color = "";
               errEl.innerText = "Error: " + e.message;
               inputs.forEach(i => i.value="");
               inputs[0].focus();
             }
          } else {
             card.classList.add("pin-shake");
             setTimeout(() => card.classList.remove("pin-shake"), 400);
             errEl.innerText = "Incorrect PIN.";
             inputs.forEach(i => i.value="");
             inputs[0].focus();
          }
        }

        inputs.forEach(function (input, idx) {
          input.addEventListener("input", function (e) {
            var v = e.target.value;
            if (!/^[0-9]$/.test(v)) { e.target.value = ""; return; }
            errEl.innerHTML = "&nbsp;";
            if (idx < inputs.length - 1) inputs[idx + 1].focus();
            else tryPin();
          });
          input.addEventListener("keydown", function (e) {
            if (e.key === "Backspace" && !input.value && idx > 0) {
              inputs[idx - 1].focus();
            } else if (e.key === "Enter") {
              tryPin();
            } else if (e.key === "Escape") {
              overlay.remove();
            }
          });
        });
      };
    }
  }

})();
