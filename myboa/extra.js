/* ============================================================
   My BOA — Offer an extra day (staff & managers, own phone).
   Staff put themselves forward to work an extra day; the regional
   manager reviews (approve / decline) in the HR portal's
   "Extra-Day Requests" tab. Today or future only. Insert-only via
   submit_extra_day_request RPC — cannot read others' requests.
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

  var state = { busy: false };

  function render() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("myboa_sched_v1") || "{}"); } catch (_e) {}
    var today = todayYmd();
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<h1>Offer an extra day</h1>',
      '<p class="sub">Put yourself forward to work an extra day. Your regional manager will review and approve it.</p>',
      '<div class="note">Extra days only count once your <b>regional manager approves</b> them — please don\'t plan around an extra day until it\'s confirmed.</div>',
      '<div class="card">',
        '<label class="field"><span>Full name</span>',
          '<input type="text" id="name" placeholder="First and last name" /></label>',
        '<div class="row2">',
          '<label class="field"><span>Branch</span>',
            '<select id="store"><option value="">— choose —</option>',
              STORES.map(function (s) { return '<option' + (saved.store === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join(""),
            '</select></label>',
          '<label class="field"><span>Employee code</span>',
            '<input type="text" id="ec" autocapitalize="characters" autocomplete="off" placeholder="e.g. B379" value="' + esc(saved.ec || "") + '" /></label>',
        '</div>',
        '<label class="field"><span>Day you\'re offering to work</span><input type="date" id="day" min="' + today + '" /></label>',
        '<label class="field"><span>Purpose</span>',
          '<select id="purpose">',
            '<option value="extra">Extra availability — I\'d like to work an extra day</option>',
            '<option value="catch_up">Catch-up — to make up a day I missed</option>',
          '</select></label>',
        '<label class="field"><span>Note <em style="font-weight:400;color:#a07487">(optional)</em></span>',
          '<textarea id="note" placeholder="Anything your manager should know — e.g. available from 10am."></textarea></label>',
        '<button type="button" id="submit" class="submit">Send to regional manager</button>',
        '<p class="err" id="err"></p>',
      '</div>',
      '<p class="foot">My BOA · reviewed by your regional manager</p>'
    ].join("");
    wire();
  }

  function wire() {
    var $ = function (id) { return document.getElementById(id); };
    $("submit").onclick = submit;
  }

  function submit() {
    if (state.busy) return;
    var $ = function (id) { return document.getElementById(id); };
    setErr("");
    var name = ($("name").value || "").trim();
    var store = $("store").value;
    var ec = ($("ec").value || "").trim();
    var day = $("day").value;
    var today = todayYmd();
    if (!name) { setErr("Please enter your full name."); $("name").focus(); return; }
    if (!store) { setErr("Please choose your branch."); return; }
    if (!ec) { setErr("Please enter your employee code."); $("ec").focus(); return; }
    if (!day) { setErr("Please choose the day you're offering to work."); return; }
    if (day < today) { setErr("Please choose today or a future day."); return; }

    var payload = {
      p_store: store,
      p_ec: ec || null,
      p_name: name,
      p_purpose: $("purpose").value || "extra",
      p_work_date: day,
      p_note: ($("note").value || "").trim() || null
    };

    state.busy = true; $("submit").disabled = true; $("submit").textContent = "Sending…";
    sb.rpc("submit_extra_day_request", payload).then(function (res) {
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
        '<h2>Sent to your regional manager</h2>',
        (ref ? '<div class="ref">' + esc(ref) + '</div>' : ''),
        '<p>Your offer to work an extra day has been received. It only counts once your regional manager approves it — they\'ll be in touch.</p>',
        '<p style="margin-top:18px"><a href="index.html" style="color:#BE185D;font-weight:700">Back to My BOA</a></p>',
      '</div>',
      '<p class="foot">My BOA</p>'
    ].join("");
  }

  function setErr(m) { var e = document.getElementById("err"); if (e) e.textContent = m || ""; }
  function todayYmd() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
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
