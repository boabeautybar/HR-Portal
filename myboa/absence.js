/* ============================================================
   My BOA — Call in sick / Mark yourself as absent.
   For letting management know you won't be able to come to work
   today / tomorrow (or a short stretch ahead) — TODAY OR FUTURE
   dates only, never the past. Goes to HR for review in the
   portal's Leave Requests tab (tagged "Absent").
   Reuses the insert-only submit_leave_request RPC. An optional
   proof file uploads to the public "staff-uploads" Storage bucket
   (see sql/staff_uploads.sql) and its link rides along.
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
    var tomorrow = addDays(today, 1);
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<h1>Call in sick / Mark absent</h1>',
      '<p class="sub">Notify your manager and HR if you\'re unable to come to work today or tomorrow. Your submission will be reviewed by HR.</p>',
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
        '<div class="row2">',
          '<label class="field"><span>First day away</span><input type="date" id="start" min="' + today + '" max="' + tomorrow + '" /></label>',
          '<label class="field"><span>Last day away</span><input type="date" id="end" min="' + today + '" max="' + tomorrow + '" /></label>',
        '</div>',
        '<label class="field"><span>Expected back at work <em style="font-weight:400;color:#a07487">(if known)</em></span><input type="date" id="back" min="' + today + '" />',
          '<span class="hint">Today or tomorrow only — defaults to the day after your last day away.</span></label>',
        '<div class="span" id="span" style="display:none"></div>',
        '<label class="field"><span>Reason for being away</span>',
          '<select id="kind">',
            '<option value="Sick">I\'m sick</option>',
            '<option value="Absent">Absent — another reason</option>',
          '</select></label>',
        '<label class="field"><span id="desclbl">What\'s happening? <em style="font-weight:400;color:#a07487">(optional)</em></span>',
          '<textarea id="desc" placeholder="Anything management should know — e.g. symptoms, or the reason you\'re away."></textarea></label>',
        '<label class="field"><span id="filelbl">Attach sick note / proof <em style="font-weight:400;color:#a07487">(optional — photo or PDF)</em></span>',
          '<input type="file" id="file" accept="image/*,application/pdf,.pdf" /></label>',
        '<label class="field"><span>Contact <em style="font-weight:400;color:#a07487">(optional)</em></span>',
          '<input type="text" id="contact" placeholder="Phone or email, so HR can reach you" /></label>',
        '<button type="button" id="submit" class="submit">Send to HR</button>',
        '<p class="err" id="err"></p>',
      '</div>',
      '<p class="foot">My BOA · goes to HR for review</p>'
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
        var back = $("back").value;
        box.textContent = "🚫 " + days + " day" + (days === 1 ? "" : "s") + " away (" + fmt(s) + " → " + fmt(e) + ")"
          + (back && back > e ? " · back " + fmt(back) : "");
      } else { box.style.display = "none"; }
    };
    $("start").onchange = function () { if (!$("end").value) $("end").value = this.value; upd(); };
    $("end").onchange = function () { if (this.value && (!$("back").value || $("back").value <= this.value)) $("back").value = nextDay(this.value); upd(); };
    $("back").onchange = upd;
    $("kind").onchange = function () {
      var other = this.value === "Absent";
      $("desclbl").innerHTML = other
        ? 'Reason you\'re away'
        : 'What\'s happening? <em style="font-weight:400;color:#a07487">(optional)</em>';
      $("desc").placeholder = other
        ? "Tell management why you can't come in — e.g. family emergency, transport…"
        : "Anything management should know — e.g. symptoms, or the reason you're away.";
    };
    $("submit").onclick = submit;
  }

  function submit() {
    if (state.busy) return;
    var $ = function (id) { return document.getElementById(id); };
    setErr("");
    var name = ($("name").value || "").trim();
    var store = $("store").value;
    var ec = ($("ec").value || "").trim();
    var start = $("start").value, end = $("end").value;
    var kind = $("kind").value || "Sick"; // "Sick" or "Absent" (other reason)
    var desc = ($("desc").value || "").trim();
    var today = todayYmd();
    var tomorrow = addDays(today, 1);
    if (!name) { setErr("Please enter your full name."); $("name").focus(); return; }
    if (!store) { setErr("Please choose your branch."); return; }
    if (!ec) { setErr("Please enter your employee code."); $("ec").focus(); return; }
    if (!start || !end) { setErr("Please choose the dates you'll be away."); return; }
    if (start < today || end < today) { setErr("This can only be for today or tomorrow — not the past."); return; }
    if (start > tomorrow || end > tomorrow) { setErr("Calling in / marking absent is only for today or tomorrow."); return; }
    if (end < start) { setErr("The last day can't be before the first day."); return; }
    if (kind === "Absent" && !desc) { setErr("Please tell management the reason you're away."); $("desc").focus(); return; }

    var back = $("back").value;
    if (back && back < today) { setErr("The 'Expected back' date can't be in the past."); return; }
    var file = ($("file").files && $("file").files[0]) || null;

    var finish = function (proofUrl) {
      var lines = [];
      if (desc) lines.push(desc);
      if (back && back > end) lines.push("Expected back at work: " + fmt(back));
      if (proofUrl) lines.push("Proof: " + proofUrl);
      var payload = {
        p_store: store,
        p_ec: ec || null,
        p_name: name,
        p_contact: ($("contact").value || "").trim() || null,
        p_leave_type: kind,
        p_start_date: start,
        p_end_date: end,
        p_reason: lines.join("\n")
      };
      sb.rpc("submit_leave_request", payload).then(function (res) {
        state.busy = false;
        if (res.error) { render(); setErr("Sorry — could not send. Please try again. (" + (res.error.message || "error") + ")"); return; }
        done(res.data);
      }).catch(function () {
        state.busy = false; render(); setErr("Sorry — could not send. Check your signal and try again.");
      });
    };

    state.busy = true; $("submit").disabled = true;
    if (file) {
      $("submit").textContent = "Uploading…";
      uploadFile(sb, file, "absence-proof").then(function (url) {
        $("submit").textContent = "Sending…"; finish(url);
      }).catch(function (e) {
        state.busy = false; $("submit").disabled = false; $("submit").textContent = "Send to HR";
        setErr("Couldn't upload the file (" + ((e && e.message) || "error") + "). You can send without it and get it to HR another way.");
      });
    } else {
      $("submit").textContent = "Sending…"; finish(null);
    }
  }

  function done(ref) {
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<div class="done">',
        '<div class="tick">✅</div>',
        '<h2>Management has been notified</h2>',
        (ref ? '<div class="ref">' + esc(ref) + '</div>' : ''),
        '<p>HR has received this and will review it. Please keep your manager updated if anything changes.</p>',
        '<p style="margin-top:18px"><a href="index.html" style="color:#BE185D;font-weight:700">Back to My BOA</a></p>',
      '</div>',
      '<p class="foot">My BOA</p>'
    ].join("");
  }

  function setErr(m) { var e = document.getElementById("err"); if (e) e.textContent = m || ""; }
  function todayYmd() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(ymd, n) { try { var d = new Date(ymd + "T00:00:00"); d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); } catch (_e) { return ""; } }
  function nextDay(ymd) { return addDays(ymd, 1); }
  function fmt(d) { try { return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { day: "2-digit", month: "short" }); } catch (_e) { return d; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function uploadFile(sb, file, folder) {
    var clean = String(file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
    var path = folder + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "-" + clean;
    return sb.storage.from("staff-uploads").upload(path, file, { cacheControl: "3600", upsert: false })
      .then(function (res) {
        if (res.error) throw res.error;
        return sb.storage.from("staff-uploads").getPublicUrl(path).data.publicUrl;
      });
  }

  sb.from("app_state").select("value").eq("key", "boa_custom_salons").maybeSingle()
    .then(function (res) {
      var v = res && res.data && res.data.value;
      if (Array.isArray(v)) { v.forEach(function (s) { var nm = s && (s.name || s.branch); if (nm && STORES.indexOf(nm) === -1) STORES.push(nm); }); STORES.sort(); }
    }).catch(function () {}).then(render);
})();
