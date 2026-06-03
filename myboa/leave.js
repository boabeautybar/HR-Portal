/* ============================================================
   My BOA — Annual leave request form (staff & managers, own phone).
   Standalone page reached from the My BOA hub. Submits an annual
   (holiday) leave request that HR reviews in the portal's Leave
   Requests tab. Sick leave has its own page (sick.html / sick.js).
   Insert-only via submit_leave_request RPC — cannot read others.
   ============================================================ */
(function () {
  var cfg = window.BOA_SUPABASE_CONFIG || {};
  var root = document.getElementById("root");
  if (!cfg.url || !cfg.anonKey || !window.supabase) {
    root.innerHTML = '<p class="sub" style="color:#b91c1c">Sorry — the form could not load. Please tell HR.</p>';
    return;
  }
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });

  var STORES = [
    "Sea Point", "Bree", "Kloof", "Claremont", "Rondebosch", "Durbanville",
    "Table Bay", "Somerset West", "Riverlands", "Kuils River", "Westlake",
    "Green Point", "Plumstead", "Sandown", "Cape Gate", "Winelands", "Betty",
    "Fourways", "Eastgate", "Mall of the South", "Mushroom Farm", "Verdi", "Ballito"
  ];
  var MAX_DAYS = 21; // annual leave requests longer than this must go via HR.

  var state = { busy: false };

  function render() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("myboa_sched_v1") || "{}"); } catch (_e) {}
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<h1>Request annual leave</h1>',
      '<p class="sub">Send an annual (holiday) leave request to HR. You\'ll get a reference number. <br/>For sick leave, use the Sick leave option on My BOA.</p>',
      '<div class="card">',
        '<label class="field"><span>Your name</span>',
          '<input type="text" id="name" placeholder="First and last name" /></label>',
        '<div class="row2">',
          '<label class="field"><span>Your store</span>',
            '<select id="store"><option value="">— choose —</option>',
              STORES.map(function (s) { return '<option' + (saved.store === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join(""),
            '</select></label>',
          '<label class="field"><span>Employee code <em style="font-weight:400;color:#a07487">(if you know)</em></span>',
            '<input type="text" id="ec" autocapitalize="characters" autocomplete="off" placeholder="e.g. B379" value="' + esc(saved.ec || "") + '" /></label>',
        '</div>',
        '<div class="row2">',
          '<label class="field"><span>From</span><input type="date" id="start" /></label>',
          '<label class="field"><span>To</span><input type="date" id="end" /></label>',
        '</div>',
        '<div class="span" id="span" style="display:none"></div>',
        '<label class="field"><span>Reason / notes <em style="font-weight:400;color:#a07487">(optional)</em></span>',
          '<textarea id="reason" placeholder="Anything HR should know."></textarea></label>',
        '<label class="field"><span>Contact <em style="font-weight:400;color:#a07487">(optional)</em></span>',
          '<input type="text" id="contact" placeholder="Phone or email, so HR can reach you" /></label>',
        '<button type="button" id="submit" class="submit">Send request</button>',
        '<p class="err" id="err"></p>',
      '</div>',
      '<p class="foot">My BOA · leave requests go to HR</p>'
    ].join("");
    wire();
  }

  function wire() {
    var $ = function (id) { return document.getElementById(id); };
    var upd = function () {
      var s = $("start").value, e = $("end").value;
      var box = $("span");
      if (s && e && e >= s) {
        var days = Math.round((new Date(e) - new Date(s)) / 86400000) + 1;
        box.style.display = "block";
        var over = days > MAX_DAYS;
        box.style.color = over ? "#b91c1c" : "";
        box.style.borderColor = over ? "#fca5a5" : "";
        box.style.background = over ? "#fef2f2" : "";
        box.textContent = (over ? "⚠️ " : "🌴 ") + days + " day" + (days === 1 ? "" : "s") + " (" + fmt(s) + " → " + fmt(e) + ")"
          + (over ? " — over the " + MAX_DAYS + "-day limit" : "");
      } else { box.style.display = "none"; }
    };
    $("start").onchange = function () { if (!$("end").value) $("end").value = this.value; upd(); };
    $("end").onchange = upd;
    $("submit").onclick = submit;
  }

  function submit() {
    if (state.busy) return;
    var $ = function (id) { return document.getElementById(id); };
    setErr("");
    var name = ($("name").value || "").trim();
    var store = $("store").value;
    var start = $("start").value, end = $("end").value;
    if (!name) { setErr("Please enter your name."); $("name").focus(); return; }
    if (!store) { setErr("Please choose your store."); return; }
    if (!start || !end) { setErr("Please choose both dates."); return; }
    if (end < start) { setErr("The 'To' date can't be before the 'From' date."); return; }
    var days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
    if (days > MAX_DAYS) { setErr("Annual leave requests are limited to " + MAX_DAYS + " days. Please speak to HR for anything longer."); return; }

    var payload = {
      p_store: store,
      p_ec: ($("ec").value || "").trim() || null,
      p_name: name,
      p_contact: ($("contact").value || "").trim() || null,
      p_leave_type: "Annual",
      p_start_date: start,
      p_end_date: end,
      p_reason: ($("reason").value || "").trim() || null
    };

    state.busy = true; $("submit").disabled = true; $("submit").textContent = "Sending…";
    sb.rpc("submit_leave_request", payload).then(function (res) {
      state.busy = false;
      if (res.error) { render(); setErr("Sorry — could not send. Please try again. (" + (res.error.message || "error") + ")"); return; }
      done(res.data);
    }).catch(function () {
      state.busy = false; render(); setErr("Sorry — could not send. Check your signal and try again.");
    });
  }

  function done(ref) {
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<div class="done">',
        '<div class="tick">✅</div>',
        '<h2>Your leave request has been sent</h2>',
        (ref ? '<div class="ref">' + esc(ref) + '</div>' : ''),
        '<p>HR has received it and will review it. They may contact you about the outcome.</p>',
        '<p style="margin-top:18px"><a href="index.html" style="color:#BE185D;font-weight:700">Back to My BOA</a></p>',
      '</div>',
      '<p class="foot">My BOA</p>'
    ].join("");
  }

  function setErr(m) { var e = document.getElementById("err"); if (e) e.textContent = m || ""; }
  function fmt(d) { try { return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { day: "2-digit", month: "short" }); } catch (_e) { return d; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  sb.from("app_state").select("value").eq("key", "boa_custom_salons").maybeSingle()
    .then(function (res) {
      var v = res && res.data && res.data.value;
      if (Array.isArray(v)) { v.forEach(function (s) { var nm = s && (s.name || s.branch); if (nm && STORES.indexOf(nm) === -1) STORES.push(nm); }); STORES.sort(); }
    }).catch(function () {}).then(render);
})();
