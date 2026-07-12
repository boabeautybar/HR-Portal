/* ============================================================
   BOA — Staff incident report form (staff's OWN phone).
   Standalone page: loads only Supabase, NOT the HR app. Reached
   by scanning the printed QR code in the store. It can only call
   submit_incident_report (insert-only RPC) — it can never read
   any report back. Anonymous by default; name/contact optional.
   ============================================================ */
(function () {
  var cfg = window.BOA_SUPABASE_CONFIG || {};
  var root = document.getElementById("root");
  if (!cfg.url || !cfg.anonKey || !window.supabase) {
    root.innerHTML = '<p class="sub" style="color:#b91c1c">Sorry — the form could not load. Please tell HR.</p>';
    return;
  }
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });

  // Built-in store names (matches the kiosk's default branch list). We also
  // try to merge any stores added later (boa_custom_salons, public-safe).
  // Store list — single source in stores.js (window.BOA_STORES), loaded via
  // <script src="stores.js"> before this file (see it for companion lists).
  // .slice() copies it so the per-page DB-augment below can't mutate the
  // shared registry.
  var STORES = (window.BOA_STORES || []).slice();
  if (!STORES.length) console.error("[My BOA] stores.js missing or empty — store picker will be blank (stale page? reload)");

  var CATEGORIES = [
    { v: "Safety", l: "Safety / accident / injury" },
    { v: "Harassment", l: "Harassment or bullying" },
    { v: "Management", l: "A manager / management conduct" },
    { v: "StaffConduct", l: "A staff member's conduct" },
    { v: "Customer", l: "A customer / client incident" },
    { v: "Theft", l: "Theft, money or till" },
    { v: "Stock", l: "Stock, equipment or damage" },
    { v: "Hygiene", l: "Hygiene / cleanliness" },
    { v: "Other", l: "Something else" }
  ];

  var TIMEFRAMES = [
    "Early morning (before 9am)",
    "Morning (9am – 12pm)",
    "Around midday (12pm – 2pm)",
    "Afternoon (2pm – 5pm)",
    "Evening (after 5pm)",
    "After hours / store closed",
    "Not sure"
  ];

  var state = { urgent: false, photo: null, showName: false, busy: false };

  // ── Render the form ──────────────────────────────────────────
  function render() {
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<h1>Report an incident</h1>',
      '<p class="sub">Tell us about something that happened in your store.</p>',

      '<div class="reassure">',
        '<div style="font-weight:800;color:#831843;font-size:15px;margin-bottom:6px">🔒 You can send this anonymously</div>',
        'You do <strong>not</strong> have to give your name — leave the name section blank and we will ',
        'never know who you are. <strong>Only HR can see this report.</strong> Your store manager and ',
        'any other managers <strong>cannot</strong> see it (so it is safe to use even if your report is ',
        'about a manager). Tell us what happened in your own words.',
      '</div>',

      '<button type="button" id="urgentBtn" class="urgent-btn' + (state.urgent ? ' on' : '') + '">',
        (state.urgent ? '🚨 URGENT — selected' : '🚨 Urgent Incident'),
        '<small>' + (state.urgent
          ? 'Tap to turn off. HR is alerted immediately.'
          : 'Tap if you feel unsafe or it needs attention now') + '</small>',
      '</button>',
      '<p class="urgent-note">' + (state.urgent
        ? 'HR will be alerted immediately. Only HR can see this.'
        : '') + '</p>',

      '<div class="card">',
        // Store
        '<label class="field"><span>Which store?</span>',
          '<select id="store"><option value="">— choose your store —</option>',
            STORES.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join(""),
            '<option value="__other">Other / not listed</option>',
          '</select>',
        '</label>',
        '<label class="field" id="storeOtherWrap" style="display:none"><span>Store name</span>',
          '<input type="text" id="storeOther" placeholder="Type the store name" /></label>',

        // Category
        '<label class="field"><span>What kind of issue is it?</span>',
          '<select id="category"><option value="">— choose one —</option>',
            CATEGORIES.map(function (c) { return '<option value="' + c.v + '">' + esc(c.l) + '</option>'; }).join(""),
          '</select>',
        '</label>',

        // Date of incident (required)
        '<label class="field"><span>Date of the incident</span>',
          '<input type="date" id="when" class="date-input" min="2023-01-01" max="' + todayISO() + '" />',
          '<div class="quickdates">',
            '<button type="button" class="quickdate" data-days="0">Today</button>',
            '<button type="button" class="quickdate" data-days="1">Yesterday</button>',
            '<button type="button" class="quickdate" data-days="2">2 days ago</button>',
          '</div>',
          '<span class="hint">Tap the field to open the calendar, or use a quick option. Pick the closest day if unsure.</span>',
        '</label>',

        // Time frame (optional)
        '<label class="field"><span>Roughly what time? <em style="font-weight:400;color:#a07487">(if you know)</em></span>',
          '<select id="timeframe">',
            '<option value="">— choose a time —</option>',
            TIMEFRAMES.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join(""),
          '</select>',
        '</label>',

        // People involved (required)
        '<label class="field"><span>People involved</span>',
          '<textarea id="people" style="min-height:80px" placeholder="Who was involved? Names or roles (e.g. \'the manager\', \'a client\')."></textarea>',
        '</label>',

        // Description (required)
        '<label class="field"><span>What happened?</span>',
          '<textarea id="desc" placeholder="Describe what happened in your own words — as much detail as you can."></textarea>',
        '</label>',

        // Witnesses (optional)
        '<label class="field"><span>Witnesses <em style="font-weight:400;color:#a07487">(optional)</em></span>',
          '<textarea id="witnesses" style="min-height:70px" placeholder="Anyone who saw it happen, if you know."></textarea>',
        '</label>',

        // Photo / document
        '<label class="field"><span>Photo or document <em style="font-weight:400;color:#a07487">(optional)</em></span>',
          '<div class="photo-row">',
            '<label class="photo-btn">📷 Add photo<input type="file" id="photo" accept="image/*" capture="environment" /></label>',
            '<img id="photoPrev" style="display:none" />',
            '<button type="button" id="photoClear" class="photo-clear" style="display:none">Remove</button>',
          '</div>',
          '<span class="hint">e.g. a hazard, mess, or a photo of a document. We shrink it on your phone before sending.</span>',
        '</label>',

        // Optional identity
        '<label class="toggle"><input type="checkbox" id="nameToggle" ' + (state.showName ? 'checked' : '') + ' /> Add my name & number so HR can follow up (optional — leave off to stay anonymous)</label>',
        '<div class="optional-box" id="nameBox" style="display:' + (state.showName ? 'block' : 'none') + '">',
          '<label class="field" style="margin-top:14px"><span>Your name</span><input type="text" id="rname" placeholder="First and last name" /></label>',
          '<label class="field"><span>Phone or email</span><input type="tel" id="rcontact" placeholder="So we can reach you privately" /></label>',
        '</div>',
      '</div>',

      '<button type="button" id="submit" class="submit"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Sending…' : 'Send report') + '</button>',
      '<p class="err" id="err"></p>',
      '<p class="foot">BOA HR · Confidential reporting</p>'
    ].join("");

    wire();
  }

  function wire() {
    var $ = function (id) { return document.getElementById(id); };

    // Toggle urgent in place (don't re-render — that would wipe typed fields).
    $("urgentBtn").onclick = function () {
      state.urgent = !state.urgent;
      var btn = $("urgentBtn");
      btn.className = "urgent-btn" + (state.urgent ? " on" : "");
      btn.innerHTML = (state.urgent ? "🚨 URGENT — selected" : "🚨 Urgent Incident") +
        '<small>' + (state.urgent ? "Tap to turn off. HR is alerted immediately." : "Tap if you feel unsafe or it needs attention now") + '</small>';
      var note = document.querySelector(".urgent-note");
      if (note) note.textContent = state.urgent ? "HR will be alerted immediately. Only HR can see this." : "";
    };

    $("store").onchange = function () {
      $("storeOtherWrap").style.display = this.value === "__other" ? "block" : "none";
    };

    // Quick date buttons set the date field relative to today.
    Array.prototype.forEach.call(document.querySelectorAll(".quickdate"), function (b) {
      b.onclick = function () {
        var d = new Date(); d.setDate(d.getDate() - parseInt(b.getAttribute("data-days"), 10));
        var p = function (n) { return String(n).padStart(2, "0"); };
        $("when").value = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
        Array.prototype.forEach.call(document.querySelectorAll(".quickdate"), function (x) { x.classList.remove("on"); });
        b.classList.add("on");
      };
    });

    $("nameToggle").onchange = function () {
      state.showName = this.checked;
      $("nameBox").style.display = this.checked ? "block" : "none";
    };

    $("photo").onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      downscale(f, function (dataUrl) {
        state.photo = dataUrl;
        var prev = $("photoPrev");
        prev.src = dataUrl; prev.style.display = "inline-block";
        $("photoClear").style.display = "inline-block";
      }, function () {
        setErr("Could not read that photo — try another, or skip it.");
      });
    };
    $("photoClear").onclick = function () {
      state.photo = null;
      $("photoPrev").style.display = "none";
      $("photoClear").style.display = "none";
      $("photo").value = "";
    };

    $("submit").onclick = submit;
  }

  function setErr(msg) { var e = document.getElementById("err"); if (e) e.textContent = msg || ""; }

  // ── Submit ───────────────────────────────────────────────────
  function submit() {
    if (state.busy) return;
    var $ = function (id) { return document.getElementById(id); };
    setErr("");

    var storeSel = $("store").value;
    var store = storeSel === "__other" ? ($("storeOther").value || "").trim() : storeSel;
    var category = $("category").value;
    var when = ($("when").value || "").trim();
    var people = ($("people").value || "").trim();
    var desc = ($("desc").value || "").trim();
    var witnesses = ($("witnesses").value || "").trim();

    if (!store) { setErr("Please choose your store."); return; }
    if (!category) { setErr("Please choose what kind of issue it is."); return; }
    if (!when) { setErr("Please pick the date of the incident."); $("when").focus(); return; }
    if (!people) { setErr("Please say who was involved."); $("people").focus(); return; }
    if (!desc) { setErr("Please tell us what happened."); $("desc").focus(); return; }

    var payload = {
      p_store: store,
      p_category: category,
      p_incident_date: when,
      p_time_frame: ($("timeframe").value || "").trim() || null,
      p_people_involved: people,
      p_description: desc,
      p_witnesses: witnesses || null,
      p_urgent: !!state.urgent,
      p_about_management: category === "Management",
      p_reporter_name: state.showName ? (($("rname").value || "").trim() || null) : null,
      p_reporter_contact: state.showName ? (($("rcontact").value || "").trim() || null) : null,
      p_photo_b64: state.photo || null
    };

    state.busy = true; render();
    sb.rpc("submit_incident_report", payload).then(function (res) {
      state.busy = false;
      if (res.error) {
        render();
        setErr("Sorry — could not send. Please try again, or tell HR. (" + (res.error.message || "error") + ")");
        return;
      }
      showDone(res.data);
    }).catch(function (e) {
      state.busy = false; render();
      setErr("Sorry — could not send. Please check your signal and try again.");
    });
  }

  function showDone(ref) {
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<div class="done">',
        '<div class="tick">✅</div>',
        '<h2>Thank you — your report has been sent</h2>',
        (ref ? '<div class="ref">' + esc(ref) + '</div>' : ''),
        '<p><strong>Only HR can see this.</strong> No managers — including your store manager — can see it.</p>',
        (ref ? '<p>If you ever want to refer to this report, you can quote the reference above. You don\'t need to keep it.</p>' : ''),
        (state.urgent ? '<p style="color:#b91c1c;font-weight:600">Because you marked it urgent, HR has been alerted immediately.</p>' : ''),
        '<p style="margin-top:18px"><a href="report.html" style="color:#BE185D;font-weight:700">Submit another report</a></p>',
      '</div>',
      '<p class="foot">BOA HR · Confidential reporting</p>'
    ].join("");
  }

  // ── Helpers ──────────────────────────────────────────────────
  function todayISO() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Downscale an image file to <=1280px on the long edge, JPEG ~0.72, returns
  // a data URL. Keeps the base64 payload small (typically 100–350KB) so it
  // fits comfortably through the submit RPC.
  function downscale(file, ok, fail) {
    try {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var max = 1280;
          var w = img.width, h = img.height;
          if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
          else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
          var cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          ok(cv.toDataURL("image/jpeg", 0.72));
        } catch (e) { fail && fail(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); fail && fail(); };
      img.src = url;
    } catch (e) { fail && fail(e); }
  }

  // Best-effort: merge any stores added after launch (public-safe app_state row).
  sb.from("app_state").select("value").eq("key", "boa_custom_salons").maybeSingle()
    .then(function (res) {
      var v = res && res.data && res.data.value;
      if (Array.isArray(v)) {
        v.forEach(function (s) {
          var nm = s && (s.name || s.branch);
          if (nm && STORES.indexOf(nm) === -1) STORES.push(nm);
        });
        STORES.sort();
      }
    })
    .catch(function () {})
    .then(render);
})();
