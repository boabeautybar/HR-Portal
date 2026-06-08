/* ============================================================
   My BOA — Bonus & Commission Calculator (staff, own phone).
   A nail tech picks their level, enters their turnover for the
   pay period, and answers a few incident questions; we instantly
   show the commission + bonuses they'd earn.

   Read-only: pulls the rate tables from app_state["boa_bonus_config_v1"]
   (owner-editable in the HR portal) and computes everything client-side.
   Nothing is written. Falls back to bundled defaults if the row is missing.

   Rules (confirmed with the business):
     • Commission = turnover band lookup. ALWAYS paid; never reduced.
     • Bonuses = Target bonus (turnover band) + Skills bonus (by level,
       unlocked at a turnover threshold).
     • Deductions hit the BONUSES only (worst-wins):
         signed a warning OR a no-show OR late ≥ zeroAt  → bonuses ×0
         else late ≥ halveAt                              → bonuses ×0.5
   ============================================================ */
(function () {
  var cfg = window.BOA_SUPABASE_CONFIG || {};
  var root = document.getElementById("root");
  var sb = (cfg.url && cfg.anonKey && window.supabase)
    ? window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } })
    : null;

  // Bundled defaults — used until the Owner saves a config in the portal.
  var DEFAULT_CONFIG = {
    commissionBands: [
      { min: 15000, amount: 600 }, { min: 20000, amount: 1200 }, { min: 25000, amount: 1800 },
      { min: 30000, amount: 2400 }, { min: 35000, amount: 3500 }, { min: 40000, amount: 4100 },
      { min: 45000, amount: 4700 }, { min: 50000, amount: 5300 }
    ],
    targetBands: [
      { min: 30000, amount: 500 }, { min: 35000, amount: 1000 }, { min: 50000, amount: 3000 }
    ],
    skills: { threshold: 25000, byLevel: { "1": 0, "2": 1000, "3": 2000 } },
    late: { halveAt: 3, zeroAt: 7 }
  };

  var CONF = DEFAULT_CONFIG;
  var state = { level: "1", turnover: "", warning: false, noShow: false, late: 0 };

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
    var commission = bandAmount(CONF.commissionBands, t);
    var target = bandAmount(CONF.targetBands, t);
    var skillsByLevel = (CONF.skills && CONF.skills.byLevel) || {};
    var threshold = (CONF.skills && CONF.skills.threshold) || 0;
    var skills = (t >= threshold) ? (Number(skillsByLevel[state.level]) || 0) : 0;
    var bonusGross = target + skills;

    var halveAt = (CONF.late && CONF.late.halveAt) || 3;
    var zeroAt = (CONF.late && CONF.late.zeroAt) || 7;
    var mult = 1;
    if (state.warning || state.noShow || state.late >= zeroAt) mult = 0;
    else if (state.late >= halveAt) mult = 0.5;
    var bonusNet = Math.round(bonusGross * mult);

    // Plain-language explanation with the from → to amounts baked in.
    var reason = "";
    if (mult !== 1) {
      var fromTo = "from " + rand(bonusGross) + " to " + rand(bonusNet);
      if (state.warning) reason = "Warning signed this pay period — bonus forfeited (" + fromTo + ").";
      else if (state.noShow) reason = "No-show this pay period — bonus forfeited (" + fromTo + ").";
      else if (state.late >= zeroAt) reason = "Late " + state.late + " times (" + zeroAt + " or more) — bonus lost " + fromTo + ".";
      else reason = "Late " + state.late + " times (" + halveAt + " or more) — bonus halved " + fromTo + ".";
    }
    return {
      turnover: t, commission: commission, target: target, skills: skills,
      bonusGross: bonusGross, mult: mult, reason: reason,
      belowSkills: t < threshold, threshold: threshold,
      bonusNet: bonusNet, total: commission + bonusNet
    };
  }

  function rand(n) { return "R" + (Number(n) || 0).toLocaleString("en-ZA"); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ── Render ──────────────────────────────────────────────────
  function lateOptions() {
    var out = "";
    for (var i = 0; i <= 25; i++) out += '<option value="' + i + '"' + (state.late === i ? " selected" : "") + ">" + i + "</option>";
    return out;
  }
  function render() {
    var r = compute();
    var hasTurnover = String(state.turnover).trim() !== "" && r.turnover > 0;

    root.innerHTML =
      '<div class="brand"><img src="boa-logo.png" alt="BOA Beauty Bar" /></div>' +
      '<h1>Bonus &amp; Commission</h1>' +
      '<p class="sub">Pop in your turnover to see what you\'d earn this pay period.</p>' +

      '<div class="card">' +
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

        '<div class="fblock">' +
          '<span class="flbl">Did you have a no-show this pay period?</span>' +
          '<div class="seg yn" id="seg-noshow">' +
            '<button type="button" data-v="0" class="' + (!state.noShow ? "on no" : "") + '">No</button>' +
            '<button type="button" data-v="1" class="' + (state.noShow ? "on" : "") + '">Yes</button>' +
          '</div>' +
        '</div>' +

        '<div class="fblock" style="margin-bottom:0">' +
          '<span class="flbl">How many times were you late this pay period?</span>' +
          '<select id="late">' + lateOptions() + '</select>' +
        '</div>' +
      '</div>' +

      (hasTurnover ? resultCard(r) : '<div class="card" style="text-align:center;color:#9d6a82;font-size:14px">Enter your turnover above to see your estimate.</div>') +

      '<div class="note"><b>Estimate only.</b> Final pay is confirmed by HR. <b>Commission is never affected</b> by warnings, no-shows or lateness — only your bonuses are.</div>' +
      '<p class="foot">My BOA · for BOA team members</p>';

    wire();
  }

  function resultCard(r) {
    var dedAmt = Math.max(0, r.bonusGross - r.bonusNet); // amount removed from the bonus
    var hasDed = r.mult !== 1 && r.bonusGross > 0;
    var dedClass = r.mult === 1 ? "ok" : "";
    var dedIcon = r.mult === 1 ? "✅" : (r.mult === 0 ? "🚫" : "½");
    var dedText = r.mult === 1 ? "No bonus deductions — nice one!" : r.reason;
    return '<div class="card">' +
      '<div class="sech">Your estimate · Level ' + esc(state.level) + '</div>' +
      row("Commission", "always paid", rand(r.commission), false) +
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
    var late = document.getElementById("late");
    if (late) late.onchange = function () { state.late = parseInt(late.value, 10) || 0; render(); };
  }

  // Re-render results without rebuilding the whole form (keeps the turnover
  // field focused while typing).
  function liveUpdate() {
    var r = compute();
    var hasTurnover = String(state.turnover).trim() !== "" && r.turnover > 0;
    var cards = root.querySelectorAll(".card");
    var resultEl = cards[cards.length - 1]; // last card = results / prompt
    if (!resultEl) { render(); return; }
    var html = hasTurnover ? resultCard(r) : '<div class="card" style="text-align:center;color:#9d6a82;font-size:14px">Enter your turnover above to see your estimate.</div>';
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    resultEl.replaceWith(tmp.firstChild);
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
            commissionBands: v.commissionBands || DEFAULT_CONFIG.commissionBands,
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
