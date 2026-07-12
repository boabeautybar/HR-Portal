/* ============================================================
   My BOA — Annual leave request form (staff & managers, own phone).
   Standalone page reached from the My BOA hub.

   Flow:
     1. Identify — enter name, employee code and branch. We verify the
        code exists and the branch matches (lookup_my_leave RPC).
     2. We show the reply to their recent leave request(s) — approved /
        declined (with the manager's reason) / still pending — then the
        leave form opens, pre-filled with their details.
     3. Submit creates a new annual-leave request (submit_leave_request)
        which HR reviews in the portal's Leave Requests tab.

   Insert-only + own-record read: a person can only ever see their own
   requests (they must know their own code + branch). Calling in sick /
   marking absent has its own page (absence.html / absence.js).
   ============================================================ */
(function () {
  var cfg = window.BOA_SUPABASE_CONFIG || {};
  var root = document.getElementById("root");
  if (!cfg.url || !cfg.anonKey || !window.supabase) {
    root.innerHTML = '<p class="sub" style="color:#b91c1c">Sorry — the form could not load. Please tell HR.</p>';
    return;
  }
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });

  // Store list — single source in stores.js (window.BOA_STORES), loaded via
  // <script src="stores.js"> before this file (see it for companion lists).
  // .slice() copies it so the per-page DB-augment below can't mutate the
  // shared registry.
  var STORES = (window.BOA_STORES || []).slice();
  if (!STORES.length) console.error("[My BOA] stores.js missing or empty — store picker will be blank (stale page? reload)");
  var MAX_DAYS = 21; // annual leave requests longer than this must go via HR.

  // Employee-code format: a letter + number, no spaces/dashes; managers end in M
  // (e.g. B379 for a nail tech, B379M for a manager). We strip anything that
  // isn't a letter or digit and upper-case, then check the shape.
  var EC_HINT = "Your employee code should look like B379 (nail techs) or B379M (managers) — a letter, then your number. Head Office and some manager codes end in a dashed suffix (like B412-CC or B941-M): type it exactly as it appears.";
  // Keep dashes: Head Office (and legacy manager) codes are STORED with a dashed
  // suffix (B412-CC, B941-M) and the server lookup compares the code verbatim
  // (upper/trim only) — stripping the dash made those codes unfindable. Spaces
  // and other punctuation are still dropped.
  function cleanEc(raw) { return String(raw == null ? "" : raw).replace(/[^A-Za-z0-9-]/g, "").toUpperCase(); }
  var EC_RE = /^[A-Z]\d+(-?(M|W|F|T|CC|C))?$/;

  var state = { busy: false, name: "", store: "", ec: "", recent: [] };

  // ── Step 1: identify yourself ─────────────────────────────────
  function renderIdentify(msg) {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("myboa_sched_v1") || "{}"); } catch (_e) {}
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<h1>Request annual leave</h1>',
      '<p class="sub">First, let\'s find you. Enter your details to see the reply to your last request and send a new one.</p>',
      msg ? '<p class="err" style="text-align:center">' + esc(msg) + '</p>' : '',
      '<div class="card">',
        '<label class="field"><span>Your name</span>',
          '<input type="text" id="name" placeholder="First and last name" value="' + esc(state.name || "") + '" /></label>',
        '<label class="field"><span>Employee code</span>',
          '<input type="text" id="ec" autocapitalize="characters" autocomplete="off" placeholder="e.g. B379 — managers B379M" value="' + esc(state.ec || saved.ec || "") + '" />',
          '<span class="hint">A letter then your number, no spaces or dashes. Managers end with M.</span></label>',
        '<label class="field"><span>Your branch</span>',
          '<select id="store"><option value="">— choose —</option>',
            STORES.map(function (s) { return '<option' + ((state.store || saved.store) === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join(""),
          '</select></label>',
        '<button type="button" id="go" class="submit">Continue</button>',
        '<p class="err" id="err"></p>',
      '</div>',
      '<p class="foot">My BOA · leave requests go to HR</p>'
    ].join("");
    document.getElementById("go").onclick = identify;
  }

  function identify() {
    if (state.busy) return;
    var name = (val("name") || "").trim();
    var ec = cleanEc(val("ec"));
    var store = val("store");
    setErr("");
    if (!name) { setErr("Please enter your name."); focus("name"); return; }
    if (name.split(/\s+/).filter(Boolean).length < 2) { setErr("Please enter both your first name and surname."); focus("name"); return; }
    if (!ec) { setErr("Please enter your employee code."); focus("ec"); return; }
    if (!EC_RE.test(ec)) { setErr("Please check your employee code. " + EC_HINT); focus("ec"); return; }
    if (!store) { setErr("Please choose your branch."); return; }

    setBusy(true, "go", "Checking…");
    sb.rpc("lookup_my_leave", { p_ec: ec, p_branch: store }).then(function (res) {
      setBusy(false, "go", "Continue");
      if (res.error) { setErr("Sorry — could not check your details. Please try again."); return; }
      var d = res.data || {};
      if (!d.matched) {
        if (d.reason === "branch_mismatch") {
          renderIdentify("Employee code " + ec + " isn't registered at " + store + (d.branch ? " (we have it at " + d.branch + ")" : "") + ". Please choose your correct branch.");
        } else {
          renderIdentify("We couldn't find employee code " + ec + ". " + EC_HINT + " Still stuck? Ask your manager for your exact code.");
        }
        return;
      }
      state.name = name;
      state.store = store;
      state.ec = ec;
      state.recent = Array.isArray(d.requests) ? d.requests : [];
      try { localStorage.setItem("myboa_sched_v1", JSON.stringify({ store: store, ec: ec })); } catch (_e) {}
      renderForm();
    }).catch(function () {
      setBusy(false, "go", "Continue");
      setErr("Sorry — could not check your details. Check your signal and try again.");
    });
  }

  // Status box for the most recent request (and a short list of older ones).
  function statusBannerHtml() {
    var reqs = state.recent || [];
    if (!reqs.length) {
      return '<div class="note" style="background:#fdf2f8;border:1px solid #f9a8d4;border-radius:12px;padding:11px 13px;margin-bottom:16px;font-size:13.5px;color:#831843">No leave requests on record yet — send your first one below.</div>';
    }
    var r = reqs[0];
    var st = String(r.status || "pending").toLowerCase();
    var range = fmt(r.start_date) + " → " + fmt(r.end_date);
    var box, head, body = "";
    if (st === "approved") {
      box = "background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d";
      head = "✅ Your last leave request was approved";
    } else if (st === "declined") {
      box = "background:#fef2f2;border:1px solid #fecaca;color:#b91c1c";
      head = "✕ Your last leave request was declined";
      if (r.decision_note) body = '<div style="color:#7f1d1d;font-size:13.5px;margin-top:6px"><b>Reason:</b> ' + esc(r.decision_note) + '</div>';
    } else {
      box = "background:#fffbeb;border:1px solid #fde68a;color:#92400e";
      head = "⏳ Your last leave request is still being reviewed";
    }
    var meta = '<div style="font-size:12.5px;opacity:.85;margin-top:3px">' + esc(range)
      + (r.leave_type ? " · " + esc(r.leave_type) : "")
      + (r.ref_code ? " · " + esc(r.ref_code) : "") + '</div>';
    var older = "";
    if (reqs.length > 1) {
      older = '<div style="margin-top:8px;font-size:12px;color:#9d6a82">Earlier: '
        + reqs.slice(1, 4).map(function (q) {
            var qs = String(q.status || "pending").toLowerCase();
            var tag = qs === "approved" ? "✅" : qs === "declined" ? "✕" : "⏳";
            return tag + " " + fmt(q.start_date) + "–" + fmt(q.end_date);
          }).join(" · ")
        + '</div>';
    }
    return '<div style="border-radius:12px;padding:12px 14px;margin-bottom:16px;' + box + '">'
      + '<div style="font-weight:700;font-size:14px">' + head + '</div>' + meta + body + older + '</div>';
  }

  // ── Step 2: the leave form (identity already confirmed) ───────
  function renderForm() {
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<h1>Request annual leave</h1>',
      '<p class="sub">Off sick or can\'t come in? Use "Call in sick / Mark absent" on My BOA instead.</p>',
      statusBannerHtml(),
      '<div class="card">',
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;font-size:13px;color:#831843">',
          '<span><b>' + esc(state.name) + '</b> · ' + esc(state.ec) + ' · ' + esc(state.store) + '</span>',
          '<a href="#" id="change" style="color:#BE185D;font-weight:700;text-decoration:none;white-space:nowrap">Not you? Change</a>',
        '</div>',
        '<div class="row2">',
          '<label class="field"><span>From</span><input type="date" id="start" /></label>',
          '<label class="field"><span>To</span><input type="date" id="end" /></label>',
        '</div>',
        '<label class="field"><span>Back at work</span><input type="date" id="back" />',
          '<span class="hint">First day back — defaults to the day after your last day of leave.</span></label>',
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
    $("change").onclick = function (e) { e.preventDefault(); renderIdentify(); };
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
        var back = $("back").value;
        box.textContent = (over ? "⚠️ " : "🌴 ") + days + " day" + (days === 1 ? "" : "s") + " (" + fmt(s) + " → " + fmt(e) + ")"
          + (back && back > e ? " · back " + fmt(back) : "")
          + (over ? " — over the " + MAX_DAYS + "-day limit" : "");
      } else { box.style.display = "none"; }
    };
    $("start").onchange = function () { if (!$("end").value) $("end").value = this.value; upd(); };
    $("end").onchange = function () { if (this.value && (!$("back").value || $("back").value <= this.value)) $("back").value = nextDay(this.value); upd(); };
    $("back").onchange = upd;
    $("submit").onclick = submit;
  }

  function submit() {
    if (state.busy) return;
    var $ = function (id) { return document.getElementById(id); };
    setErr("");
    var start = $("start").value, end = $("end").value;
    if (!start || !end) { setErr("Please choose both dates."); return; }
    if (end < start) { setErr("The 'To' date can't be before the 'From' date."); return; }
    var days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
    if (days > MAX_DAYS) { setErr("Annual leave requests are limited to " + MAX_DAYS + " days. Please speak to HR for anything longer."); return; }
    var back = $("back").value;
    if (!back) { setErr("Please choose the date you'll be back at work."); return; }
    if (back <= end) { setErr("The 'Back at work' date must be after your last day of leave."); return; }

    // One request at a time per date range: if an earlier request covering any
    // of these days is still being reviewed, don't let a second one through —
    // duplicates double up HR's queue and the replies confuse everyone. The
    // server enforces this too (duplicate_pending_request); this check just
    // gives a friendlier message without a round trip. Declined/approved
    // requests don't block — those already have an answer.
    var clash = (state.recent || []).filter(function (q) {
      var qs = String(q.status || "pending").toLowerCase();
      return qs !== "approved" && qs !== "declined"
        && q.start_date && q.end_date
        && q.start_date <= end && q.end_date >= start;
    })[0];
    if (clash) {
      setErr("You already have a leave request for " + fmt(clash.start_date) + " → " + fmt(clash.end_date)
        + (clash.ref_code ? " (" + clash.ref_code + ")" : "")
        + " that is still being reviewed. Please wait for HR's reply before requesting these dates again.");
      return;
    }

    var notes = ($("reason").value || "").trim();
    var reason = "Back at work: " + fmt(back) + (notes ? "\n" + notes : "");

    var payload = {
      p_store: state.store,
      p_ec: state.ec || null,
      p_name: state.name,
      p_contact: ($("contact").value || "").trim() || null,
      p_leave_type: "Annual",
      p_start_date: start,
      p_end_date: end,
      p_reason: reason
    };

    state.busy = true; $("submit").disabled = true; $("submit").textContent = "Sending…";
    sb.rpc("submit_leave_request", payload).then(function (res) {
      state.busy = false;
      if (res.error) {
        var msg = res.error.message || "";
        renderForm();
        if (/duplicate_pending_request/i.test(msg)) {
          setErr("You already have a leave request for these dates that is still being reviewed. Please wait for HR's reply before requesting them again.");
        } else {
          setErr("Sorry — could not send. Please try again. (" + (msg || "error") + ")");
        }
        return;
      }
      done(res.data);
    }).catch(function () {
      state.busy = false; renderForm(); setErr("Sorry — could not send. Check your signal and try again.");
    });
  }

  function done(ref) {
    root.innerHTML = [
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>',
      '<div class="done">',
        '<div class="tick">✅</div>',
        '<h2>Your leave request has been sent</h2>',
        (ref ? '<div class="ref">' + esc(ref) + '</div>' : ''),
        '<p>HR has received it and will review it. Come back here any time to see whether it was approved or declined.</p>',
        '<p style="margin-top:18px"><a href="index.html" style="color:#BE185D;font-weight:700">Back to My BOA</a></p>',
      '</div>',
      '<p class="foot">My BOA</p>'
    ].join("");
  }

  // ── helpers ───────────────────────────────────────────────────
  function val(id) { var e = document.getElementById(id); return e ? e.value : ""; }
  function focus(id) { var e = document.getElementById(id); if (e) e.focus(); }
  function setErr(m) { var e = document.getElementById("err"); if (e) e.textContent = m || ""; }
  function setBusy(on, btnId, label) {
    state.busy = on;
    var b = document.getElementById(btnId);
    if (b) { b.disabled = on; if (label) b.textContent = label; }
  }
  function nextDay(ymd) { try { var d = new Date(ymd + "T00:00:00"); d.setDate(d.getDate() + 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); } catch (_e) { return ""; } }
  function fmt(d) { try { return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { day: "2-digit", month: "short" }); } catch (_e) { return d; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Pull any custom stores added in the portal, then show the identify step.
  sb.from("app_state").select("value").eq("key", "boa_custom_salons").maybeSingle()
    .then(function (res) {
      var v = res && res.data && res.data.value;
      if (Array.isArray(v)) { v.forEach(function (s) { var nm = s && (s.name || s.branch); if (nm && STORES.indexOf(nm) === -1) STORES.push(nm); }); STORES.sort(); }
    }).catch(function () {}).then(function () { renderIdentify(); });
})();
