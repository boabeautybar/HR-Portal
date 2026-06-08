/* ============================================================
   My BOA — Bonus & Commission Calculator (staff, own phone).
   A nail tech picks their level, enters their turnover for the
   pay period, and answers a few incident questions; we instantly
   show the commission + bonuses they'd earn.

   Read-only: pulls the rate tables from app_state["boa_bonus_config_v1"]
   (owner-editable in the HR portal) and computes everything client-side.
   Nothing is written. Falls back to bundled defaults if the row is missing.

   Rules (confirmed with the business):
     • Basic salary — flat for everyone, always paid.
     • Commission = turnover band lookup (+ a fixed amount per step above the
       top band). ALWAYS paid; never reduced.
     • Bonuses = Target bonus (turnover band) + Skills bonus (by level,
       unlocked at a turnover threshold).
     • A warning OR a no-show forfeits the BONUSES (commission untouched).
       Lateness isn't an input here — the late≥N → forfeit rule is in the
       disclaimer only.
   ============================================================ */
(function () {
  var cfg = window.BOA_SUPABASE_CONFIG || {};
  var root = document.getElementById("root");
  var sb = (cfg.url && cfg.anonKey && window.supabase)
    ? window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } })
    : null;

  // Bundled defaults — used until the Owner saves a config in the portal.
  var DEFAULT_CONFIG = {
    basic: 5500,                 // flat monthly basic salary for everyone
    commissionBands: [
      { min: 15000, amount: 600 }, { min: 20000, amount: 1200 }, { min: 25000, amount: 1800 },
      { min: 30000, amount: 2400 }, { min: 35000, amount: 3500 }, { min: 40000, amount: 4100 },
      { min: 45000, amount: 4700 }, { min: 50000, amount: 5300 }
    ],
    // Above aboveTurnover, add addAmount for every full perStep of turnover.
    commissionExtend: { aboveTurnover: 50000, perStep: 5000, addAmount: 1000 },
    targetBands: [
      { min: 30000, amount: 500 }, { min: 35000, amount: 1000 }, { min: 50000, amount: 3000 }
    ],
    skills: { threshold: 25000, byLevel: { "1": 0, "2": 1000, "3": 2000 } },
    late: { halveAt: 3, zeroAt: 7 }
  };

  var CONF = DEFAULT_CONFIG;
  var state = { level: "1", turnover: "", warning: false, noShow: false };

  // ── Calc helpers ────────────────────────────────────────────
  function bandAmount(bands, turnover) {
    // The band with the greatest min that is still ≤ turnover (lower-bound
    // inclusive); below the lowest band → 0. Robust to unsorted input.
    var best = null;
    (bands || []).forEach(function (b) { if (turnover >= b.min && (!best || b.min > best.min)) best = b; });
    return best ? best.amount : 0;
  }
  function compute() {
    var t = Math.max(0, Math.round(Number(state.turnover) || 0));
    var basic = Number(CONF.basic) || 0;
    var commission = bandAmount(CONF.commissionBands, t);
    // Above the cap, add a fixed amount for every full step of extra turnover.
    var ex = CONF.commissionExtend, commissionExtended = false;
    if (ex && ex.perStep > 0 && t > ex.aboveTurnover) {
      var extra = Math.floor((t - ex.aboveTurnover) / ex.perStep) * (Number(ex.addAmount) || 0);
      if (extra > 0) { commission += extra; commissionExtended = true; }
    }
    var target = bandAmount(CONF.targetBands, t);
    var skillsByLevel = (CONF.skills && CONF.skills.byLevel) || {};
    var threshold = (CONF.skills && CONF.skills.threshold) || 0;
    var skills = (t >= threshold) ? (Number(skillsByLevel[state.level]) || 0) : 0;
    var bonusGross = target + skills;

    // A warning OR a no-show forfeits the whole bonus; otherwise it's paid in full.
    var mult = (state.warning || state.noShow) ? 0 : 1;
    var bonusNet = Math.round(bonusGross * mult);

    var reason = "";
    if (mult !== 1) {
      var fromTo = "from " + rand(bonusGross) + " to " + rand(bonusNet);
      if (state.warning) reason = "Warning signed this pay period — bonus forfeited (" + fromTo + ").";
      else reason = "No-show this pay period — bonus forfeited (" + fromTo + ").";
    }
    return {
      turnover: t, basic: basic, commission: commission, commissionExtended: commissionExtended,
      target: target, skills: skills,
      bonusGross: bonusGross, mult: mult, reason: reason,
      belowSkills: t < threshold, threshold: threshold,
      bonusNet: bonusNet, total: basic + commission + bonusNet
    };
  }

  function rand(n) { return "R" + (Number(n) || 0).toLocaleString("en-ZA"); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ── Render ──────────────────────────────────────────────────
  // Reactive vibe line under the big number: 🤑 making bank, 👀 side-eye when an
  // incident forfeits the bonus.
  function moodSub(r) {
    if (r.mult === 0 && r.bonusGross > 0) return "👀 Bonus forfeited — basic + commission only";
    if (r.bonusGross > 0) return "🤑 Making bank · this pay period";
    return "Basic + commission · this pay period";
  }
  function displayCard(r) {
    return '<div class="calc-display">' +
      '<div class="cd-label">Estimated payout</div>' +
      '<div class="cd-amt" id="bonus-display-amount">' + rand(r.total) + '</div>' +
      '<div class="cd-sub" id="bonus-display-sub">' + moodSub(r) + '</div>' +
    '</div>';
  }
  function inputsCard() {
    return '<div class="card">' +
      '<div class="fblock">' +
        '<span class="flbl">Your level</span>' +
        '<div class="seg" id="seg-level">' +
          ['1', '2', '3'].map(function (l) { return '<button type="button" data-level="' + l + '" class="' + (state.level === l ? "on" : "") + '">Level ' + l + '</button>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="fblock">' +
        '<span class="flbl">Turnover this pay period</span>' +
        '<div class="turn"><span class="cur">R</span>' +
          '<input id="turnover" inputmode="numeric" autocomplete="off" placeholder="e.g. 30000" value="' + esc(state.turnover) + '" /></div>' +
        '<div class="hint">Your total turnover for the 25th → 24th pay cycle.</div>' +
      '</div>' +
      '<div class="fblock">' +
        '<span class="flbl">Did you sign a warning this pay period?</span>' +
        '<div class="seg yn" id="seg-warning">' +
          '<button type="button" data-v="0" class="' + (!state.warning ? "on no" : "") + '">No</button>' +
          '<button type="button" data-v="1" class="' + (state.warning ? "on" : "") + '">Yes</button>' +
        '</div>' +
      '</div>' +
      '<div class="fblock" style="margin-bottom:0">' +
        '<span class="flbl">Did you have a no-show this pay period?</span>' +
        '<div class="seg yn" id="seg-noshow">' +
          '<button type="button" data-v="0" class="' + (!state.noShow ? "on no" : "") + '">No</button>' +
          '<button type="button" data-v="1" class="' + (state.noShow ? "on" : "") + '">Yes</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  function disclaimerCard() {
    var zeroAt = (CONF.late && CONF.late.zeroAt) || 7;
    return '<div class="disclaimer">' +
      '<div class="dc-h">⚠️ Please read — this is just an estimate</div>' +
      '<div class="dc-b">This is <b>not</b> your final take-home pay. Your real pay also depends on ' +
      '<b>tips</b>, <b>PAYE</b> &amp; <b>UIF</b> deductions, <b>missed days</b>, <b>sick days</b>, ' +
      '<b>extra days worked</b> and <b>public-holiday pay</b>. And if you\'re <b>late ' + zeroAt + '+ times</b> ' +
      'this pay period, your <b>bonus is forfeited</b>. Commission is always paid — only your bonus is ' +
      'affected by a warning or no-show. Your final pay is confirmed by HR.</div>' +
    '</div>';
  }
  function render() {
    var r = compute();
    root.innerHTML =
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>' +
      '<h1>Bonus &amp; Commission</h1>' +
      '<p class="sub">Pop in your turnover to see what you\'d earn this pay period.</p>' +

      '<div class="calc-grid">' +
        '<div class="calc-col">' + inputsCard() + '</div>' +
        '<div class="calc-col">' + displayCard(r) + receiptCard(r) + '</div>' +
      '</div>' +

      disclaimerCard() +
      '<p class="foot">My BOA · for BOA team members</p>';

    wire();
  }

  function receiptCard(r) {
    var dedAmt = Math.max(0, r.bonusGross - r.bonusNet); // amount removed from the bonus
    var hasDed = r.mult !== 1 && r.bonusGross > 0;
    var dedClass = r.mult === 1 ? "ok" : "";
    var dedIcon = r.mult === 1 ? "🤑" : "👀";
    var dedText = r.mult === 1 ? "No deductions — making bank!" : r.reason;
    return '<div class="card" id="bonus-receipt">' +
      '<div class="sech">Your estimate · Level ' + esc(state.level) + '</div>' +
      row("Basic salary", "everyone", rand(r.basic), false) +
      row("Commission", r.commissionExtended ? "incl. R50k+ bonus" : "always paid", rand(r.commission), false) +
      row("Target bonus", null, rand(r.target), false) +
      row("Skills bonus", r.belowSkills ? ("unlocks at " + rand(r.threshold) + " turnover") : ("Level " + state.level), rand(r.skills), r.belowSkills && r.skills === 0) +
      (r.bonusGross > 0 ? row("Bonus subtotal", null, rand(r.bonusGross), false) : "") +
      (hasDed ? row("Bonus deductions", null, "− " + rand(dedAmt), false, "neg") : "") +
      '<div class="res total"><span class="lbl">Estimated payout</span><span class="amt">' + rand(r.total) + '</span></div>' +
      '<div class="ded below ' + dedClass + '"><span style="font-size:16px">' + dedIcon + '</span><span>' + esc(dedText) + '</span></div>' +
    '</div>';
  }
  function row(lbl, sub, amt, muted, amtClass) {
    return '<div class="res' + (muted ? " muted" : "") + '"><span class="lbl">' + esc(lbl) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><span class="amt' + (amtClass ? " " + amtClass : "") + '">' + amt + '</span></div>';
  }

  function wire() {
    var segLevel = document.getElementById("seg-level");
    if (segLevel) segLevel.querySelectorAll("button").forEach(function (b) {
      b.onclick = function () { state.level = b.getAttribute("data-level"); render(); };
    });
    var turn = document.getElementById("turnover");
    if (turn) turn.oninput = function () {
      state.turnover = turn.value.replace(/[^0-9]/g, "");
      // live-update only the results portion without losing input focus
      liveUpdate();
    };
    var segW = document.getElementById("seg-warning");
    if (segW) segW.querySelectorAll("button").forEach(function (b) {
      b.onclick = function () { state.warning = b.getAttribute("data-v") === "1"; render(); };
    });
    var segN = document.getElementById("seg-noshow");
    if (segN) segN.querySelectorAll("button").forEach(function (b) {
      b.onclick = function () { state.noShow = b.getAttribute("data-v") === "1"; render(); };
    });
  }

  // Refresh the live display + receipt without rebuilding the inputs (keeps the
  // turnover field focused while typing).
  function liveUpdate() {
    var r = compute();
    var amtEl = document.getElementById("bonus-display-amount");
    if (amtEl) amtEl.textContent = rand(r.total);
    var subEl = document.getElementById("bonus-display-sub");
    if (subEl) subEl.textContent = moodSub(r);
    var rc = document.getElementById("bonus-receipt");
    if (!rc) { render(); return; }
    var tmp = document.createElement("div");
    tmp.innerHTML = receiptCard(r);
    rc.replaceWith(tmp.firstChild);
  }

  // ── Boot: load config, then render ──────────────────────────
  function start() {
    render();
    if (!sb) return; // offline / SDK missing → defaults still work
    sb.from("app_state").select("value").eq("key", "boa_bonus_config_v1").maybeSingle()
      .then(function (res) {
        var v = res && res.data && res.data.value;
        if (v && typeof v === "object" && Array.isArray(v.commissionBands)) {
          CONF = {
            basic: (v.basic != null ? v.basic : DEFAULT_CONFIG.basic),
            commissionBands: v.commissionBands || DEFAULT_CONFIG.commissionBands,
            commissionExtend: v.commissionExtend || DEFAULT_CONFIG.commissionExtend,
            targetBands: v.targetBands || DEFAULT_CONFIG.targetBands,
            skills: v.skills || DEFAULT_CONFIG.skills,
            late: v.late || DEFAULT_CONFIG.late
          };
          render();
        }
      })
      .catch(function () { /* keep defaults */ });
  }
  start();
})();
