const { useState, useMemo, useEffect } = React;

// ─── STAFF PIN LOGIN ────────────────────────────────────────────────────────────
// 4-digit PINs. Lookup is by exact PIN string. Each user is recorded against
// activity log entries so we can see who did each edit / transfer / save.
const STAFF_USERS = {
  "1993": { name: "Master",   role: "Master Admin"  },
  "2023": { name: "Kelly",    role: "Ops Manager",  hideCategories: ["Payroll"] },
  "6678": { name: "Joy",      role: "HR Generalist" },
  "7890": { name: "Siphe",    role: "Recruiter"     },
  "5990": { name: "Ops Admin",role: "Ops Admin"     },
  // Rochelle: Ops Admin focused on payroll + ops scheduling. Sees Payroll
  // (Attendance) and the Scheduling / Leave Planner / Mgr Clock-ins tabs in
  // Operations; everything else is hidden.
  "3030": { name: "Rochelle", role: "Ops Admin",
            hideCategories: ["People", "Insights"],
            hideTabs: ["locations", "mgrPlanner"] },
  "1111": { name: "Demo",     role: "Training Demo", demo: true }
};
const PIN_SESSION_KEY = "boa_hr_current_user_v1";

// Demo-mode shim: when a `demo:true` user is signed in we replace every
// persistence method on window.BOA_DB with a no-op so changes never reach the
// server. Local React state still updates, so the user can practice editing
// staff / attendance / schedules — but a page reload wipes their changes.
function installDemoMode() {
  const apply = () => {
    if (!window.BOA_DB) { setTimeout(apply, 100); return; }
    if (window.__BOA_DEMO_INSTALLED) return;
    window.__BOA_DEMO_INSTALLED = true;
    let demoSeed = 900000;
    const passthrough = async (arg) => {
      if (arg && typeof arg === "object" && !Array.isArray(arg) && arg._id === undefined) {
        return { ...arg, _id: ++demoSeed };
      }
      return arg;
    };
    const noop = async () => {};
    ["saveStaff","saveMat","saveManager"].forEach(n => { window.BOA_DB[n] = passthrough; });
    ["saveSchedule","saveAttendance","saveOnboarding","saveOffboarding",
     "saveLeaveRecords","saveMgrRequests","saveManagerPins",
     "deleteMat","deleteManager","deleteSchedule","appendActivity"
    ].forEach(n => { window.BOA_DB[n] = noop; });
  };
  apply();
}

// ─── HELPERS ────────────────────────────────────────────────────────────────────
const TODAY = new Date("2026-04-27");
function daysDiff(d) { return d ? Math.ceil((new Date(d) - TODAY) / 86400000) : null; }
function fmt(d) { return d ? new Date(d).toLocaleDateString("en-ZA", { day:"2-digit", month:"short", year:"numeric" }) : "—"; }

// Sort by B-number: extract numeric part after "B", sort ascending; T-codes go after
function ecSort(a, b) {
  const parse = ec => {
    const m = String(ec).match(/^([A-Za-z]+)(\d+)/);
    if (!m) return [ec, 9999];
    return [m[1].toUpperCase(), parseInt(m[2], 10)];
  };
  const [al, an] = parse(a.ec);
  const [bl, bn] = parse(b.ec);
  if (al !== bl) return al < bl ? -1 : 1;
  return an - bn;
}

// ─── SOUTH AFRICAN PUBLIC HOLIDAYS ──────────────────────────────────────────────
// Per the Public Holidays Act, 1994. If a holiday falls on a Sunday, the
// following Monday is also a public holiday ("observed").
function _easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*l) / 451);
  const month = Math.floor((h + l - 7*m + 114) / 31);
  const day = ((h + l - 7*m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
function _dkey(y, m, d) {
  return y + "-" + String(m).padStart(2,"0") + "-" + String(d).padStart(2,"0");
}
const _saHolidayCache = {};
function saHolidays(year) {
  if (_saHolidayCache[year]) return _saHolidayCache[year];
  const out = {};
  const add = (m, d, name) => {
    const dt = new Date(year, m-1, d);
    out[_dkey(year, m, d)] = name;
    if (dt.getDay() === 0) {
      const dt2 = new Date(year, m-1, d+1);
      out[_dkey(dt2.getFullYear(), dt2.getMonth()+1, dt2.getDate())] = name + " (observed)";
    }
  };
  add(1,  1,  "New Year's Day");
  add(3,  21, "Human Rights Day");
  const easter = _easterSunday(year);
  const gf = new Date(easter); gf.setDate(easter.getDate() - 2);
  const fd = new Date(easter); fd.setDate(easter.getDate() + 1);
  out[_dkey(gf.getFullYear(), gf.getMonth()+1, gf.getDate())] = "Good Friday";
  out[_dkey(fd.getFullYear(), fd.getMonth()+1, fd.getDate())] = "Family Day";
  add(4,  27, "Freedom Day");
  add(5,  1,  "Workers' Day");
  add(6,  16, "Youth Day");
  add(8,  9,  "Women's Day");
  add(9,  24, "Heritage Day");
  add(12, 16, "Day of Reconciliation");
  add(12, 25, "Christmas Day");
  add(12, 26, "Day of Goodwill");
  _saHolidayCache[year] = out;
  return out;
}

// ─── MANAGER SCHEDULE GENERATOR (mgrSched) ────────────────────────────────────────
// Ported 1:1 from the old HR portal HTML (function originally on line 842).
// Generates a per-manager × per-day grid for one branch over a single 25th→24th
// payroll cycle.
//   - SM gets 2 weekend pairs (Sat+Sun) off per cycle. AM gets 1.
//   - Each full ISO week targets 2 off-days per manager.
//   - Day-of-week preference for off-day picking: Mon=6, Tue=5, Wed=4, Sun=3,
//     Thu=1, Fri=0, Sat=0 — managers prefer mid-week and never voluntarily
//     take Fri/Sat off (busy days).
//   - Min 2 managers working per day (hard constraint).
//   - Max 6 consecutive working days (5-pass fix at the end).
// Off-boarding ghosts: post-leftDate cells become "X". Onboarding ghosts:
// pre-startDate cells become "X". Both are computed from the staff record's
// leftDate / startDate fields.
//
// Cell vocabulary: W=working, O=off (auto), L=on leave, R=requested off,
// E=extra off (manual), X=ghost.
//
// Returns { managers, dates, grid, conflicts, dayTotals, branch, cycleStart,
//   cycleEnd, weekOrder, weeksMap }.
function mgrSched(branchName, cycleStartYmd, allManagers, leaveRecs, requests, priorContext) {
  const p2 = z => String(z).padStart(2, "0");
  const fmt = z => z.getFullYear() + "-" + p2(z.getMonth()+1) + "-" + p2(z.getDate());
  const d0 = new Date(cycleStartYmd + "T00:00:00");
  const dEnd = new Date(d0.getFullYear(), d0.getMonth()+1, 24);
  const dates = [];
  for (let c = new Date(d0); c <= dEnd; c.setDate(c.getDate()+1)) {
    dates.push({ d: fmt(new Date(c)), dow: c.getDay() });
  }
  const cycleEnd = dates[dates.length-1].d;

  // Filter managers for this branch + cycle (skip future-onboarding, skip
  // anyone who left before the cycle started).
  const f = allManagers.filter(h => {
    if (h.branch !== branchName) return false;
    if (h._onboarding && h._startDate && h._startDate > cycleEnd) return false;
    if (h.leftDate && h.leftDate < cycleStartYmd) return false;
    return true;
  });
  if (f.length === 0) {
    return { managers: [], dates, grid: {}, conflicts: [{ type:"no_managers", msg:"No managers at " + branchName, severity:"high" }],
      dayTotals: {}, branch: branchName, cycleStart: cycleStartYmd, cycleEnd, weekOrder: [], weeksMap: {} };
  }
  const m = f.length;

  // ISO week mapping
  const wkOf = ymd => {
    const x = new Date(ymd + "T00:00:00");
    const dn = (x.getDay()+6) % 7;
    x.setDate(x.getDate() - dn + 3);
    const ff = new Date(x.getFullYear(), 0, 4);
    const fdn = (ff.getDay()+6) % 7;
    ff.setDate(ff.getDate() - fdn + 3);
    const wk = 1 + Math.round((x - ff) / (7*86400000));
    return x.getFullYear() + "-W" + p2(wk);
  };
  const wkMap = {}, wkOrder = [];
  for (const x of dates) {
    const w = wkOf(x.d);
    if (!wkMap[w]) { wkMap[w] = []; wkOrder.push(w); }
    wkMap[w].push(x);
  }
  const wkOfDay = {};
  for (const w of wkOrder) for (const x of wkMap[w]) wkOfDay[x.d] = w;

  // Initialise per-manager grid + per-day counters
  const grid = {}, W = {};
  for (const x of dates) W[x.d] = { dow: x.dow, working: 0, off: 0, leave: 0 };
  for (const h of f) { grid[h.ec] = {}; for (const x of dates) grid[h.ec][x.d] = null; }
  // Seed leaves
  for (const lv of leaveRecs || []) {
    if (!grid[lv.ec]) continue;
    for (const x of dates) if (x.d >= lv.startDate && x.d <= lv.endDate) {
      grid[lv.ec][x.d] = "L"; W[x.d].leave++;
    }
  }
  // Seed requested off-days
  for (const r of requests || []) {
    if (grid[r.ec] && grid[r.ec][r.date] == null) {
      grid[r.ec][r.date] = "R"; W[r.date].off++;
    }
  }

  // ── Weekend pairing pass ──────────────────────────────────────────
  const offWk = {};
  for (const h of f) { offWk[h.ec] = {}; for (const w of wkOrder) offWk[h.ec][w] = 0; }
  for (const h of f) for (const x of dates) {
    const v = grid[h.ec][x.d];
    if (v === "L" || v === "R" || v === "O") offWk[h.ec][wkOfDay[x.d]]++;
  }

  // ── Cross-month carry-over (leading partial week) ────────────────
  // Hard rule: no manager may exceed 2 off-days in any Mon–Sun labour
  // week, even when that week straddles two scheduling cycles. If this
  // cycle starts mid-week, the leading week overlaps with the prior
  // cycle's tail. priorContext.priorOffs[ec] holds the count of O/R/L
  // each manager already had on those overlap days. We seed offWk for
  // the leading week with that count so every downstream check
  // (weekend-pair gate, backtracking solver via wkMap[w].length, cross-
  // week swap accounting) naturally honours the cap.
  const leadingWk    = wkOrder[0];
  const trailingWk   = wkOrder[wkOrder.length - 1];
  const isLeadingPartial  = !!(leadingWk  && wkMap[leadingWk]  && wkMap[leadingWk].length  < 7);
  const isTrailingPartial = !!(trailingWk && wkMap[trailingWk] && wkMap[trailingWk].length < 7 && trailingWk !== leadingWk);
  const priorOffs    = (priorContext && priorContext.priorOffs)    || {};
  const priorMissing = !!(priorContext && priorContext.priorMissing);
  const nextOffs     = (priorContext && priorContext.nextOffs)     || {};
  const nextMissing  = !!(priorContext && priorContext.nextMissing);
  if (isLeadingPartial) {
    for (const h of f) {
      const carry = +priorOffs[h.ec] || 0;
      if (carry > 0) offWk[h.ec][leadingWk] += carry;
    }
  }
  // Trailing partial week — same shared-week problem at the END of the cycle.
  // The trailing partial week of THIS cycle = the leading partial week of the
  // NEXT cycle. If the next cycle exists, count the offs each manager already
  // has on the overlap days (Sat/Sun after our cycleEnd, etc.) and seed
  // offWk[trailingWk] so we don't add a 3rd off into that combined week.
  if (isTrailingPartial) {
    for (const h of f) {
      const carry = +nextOffs[h.ec] || 0;
      if (carry > 0) offWk[h.ec][trailingWk] += carry;
    }
  }
  const wePairs = (h) => {
    let ct = 0;
    for (let i = 0; i < dates.length-1; i++) {
      if (dates[i].dow === 6 && dates[i+1].dow === 0) {
        const a = grid[h.ec][dates[i].d], b = grid[h.ec][dates[i+1].d];
        if ((a === "O" || a === "L" || a === "R") && (b === "O" || b === "L" || b === "R")) ct++;
      }
    }
    return ct;
  };
  const setOff = (ec, day) => {
    if (grid[ec][day] != null) return false;
    grid[ec][day] = "O"; W[day].off++; offWk[ec][wkOfDay[day]]++;
    return true;
  };
  // Locked days = weekend-pair offs that the 7-day-streak fix is NOT allowed
  // to swap away. Without this, the fix happily breaks Sat-Sun pairs to fix
  // long streaks, leaving the manager with 0 weekend pairs (the conflict
  // user reported for Robin P).
  const pairLocked = {};
  for (const h of f) pairLocked[h.ec] = new Set();
  const allWePairs = [];
  for (let i = 0; i < dates.length-1; i++) {
    if (dates[i].dow === 6 && dates[i+1].dow === 0) allWePairs.push([dates[i], dates[i+1]]);
  }
  const ordered = [...f].sort((a,b) => (a.role==="SM"?0:1)-(b.role==="SM"?0:1));
  for (const h of ordered) {
    const need = h.role === "SM" ? 2 : 1;
    let have = wePairs(h);
    if (have >= need) continue;
    let candidates = allWePairs.filter(([fr,sa]) =>
      grid[h.ec][fr.d] == null && grid[h.ec][sa.d] == null
      && offWk[h.ec][wkOfDay[fr.d]]+2 <= 2
      && offWk[h.ec][wkOfDay[sa.d]]+(wkOfDay[fr.d]===wkOfDay[sa.d] ? 0 : 2) <= 2
    );
    while (have < need && candidates.length) {
      candidates.sort((a,b) => {
        const wa = m - W[a[0].d].off - W[a[0].d].leave - 1;
        const wa2 = m - W[a[1].d].off - W[a[1].d].leave - 1;
        const wb = m - W[b[0].d].off - W[b[0].d].leave - 1;
        const wb2 = m - W[b[1].d].off - W[b[1].d].leave - 1;
        const adjPen = (pair) => {
          const i0 = dates.indexOf(pair[0]), i1 = dates.indexOf(pair[1]);
          let pen = 0;
          if (i0 > 0) { const prev = grid[h.ec][dates[i0-1].d]; if (prev === "O" || prev === "L" || prev === "R") pen -= 300; }
          if (i1 < dates.length-1) { const nxt = grid[h.ec][dates[i1+1].d]; if (nxt === "O" || nxt === "L" || nxt === "R") pen -= 300; }
          return pen;
        };
        const sa = (wa < 2 ? -1000 : 0) + (wa2 < 2 ? -1000 : 0) - (W[a[0].d].off + W[a[1].d].off) + adjPen(a);
        const sb = (wb < 2 ? -1000 : 0) + (wb2 < 2 ? -1000 : 0) - (W[b[0].d].off + W[b[1].d].off) + adjPen(b);
        return sb - sa;
      });
      const pair = candidates.shift(), fr = pair[0], saturday = pair[1];
      setOff(h.ec, fr.d); setOff(h.ec, saturday.d); have++;
      pairLocked[h.ec].add(fr.d); pairLocked[h.ec].add(saturday.d);
      candidates = candidates.filter(([fr2,sa2]) =>
        grid[h.ec][fr2.d] == null && grid[h.ec][sa2.d] == null
        && offWk[h.ec][wkOfDay[fr2.d]]+2 <= 2
        && offWk[h.ec][wkOfDay[sa2.d]]+(wkOfDay[fr2.d]===wkOfDay[sa2.d] ? 0 : 2) <= 2
      );
    }
  }

  // ── Per-week off-day allocation — BACKTRACKING SOLVER ─────────────
  // Hard rules enforced AT PLACEMENT TIME (not as a post-pass clean-up):
  //   1. 2 off-days per full ISO week
  //   2. Min 2 managers working per day (coverage)
  //   3. Max 6 consecutive working days per manager (the killer rule)
  // For each manager, backtrack through their non-pair weeks placing
  // 2 weekday offs at a time. Skip any candidate that would push this
  // manager's longest W-run ≥ 7. If no candidate satisfies, backtrack
  // to the previous week and try a different placement. Falls back to
  // greedy Mon-Tue if backtracking fails entirely (very rare).
  const dowOrd = { 0:3, 1:6, 2:5, 3:4, 4:1, 5:0, 6:0 };
  // Helper: max W-gap on either side of the candidate, between candidate
  // and the nearest existing off-day in this manager's grid. Matches OLD's
  // _maxRun(_dy) — local-gap, NOT global-run.
  const maxRunIfOff = (ec, candDay) => {
    const myOffs = [];
    for (let i = 0; i < dates.length; i++) {
      const v = grid[ec][dates[i].d];
      if (v === "O" || v === "L" || v === "R") myOffs.push(i);
    }
    const ix = dates.findIndex(x => x.d === candDay);
    let prev = -2, next = -2;
    for (const o of myOffs) {
      if (o < ix && o > prev) prev = o;
      if (o > ix && (next === -2 || o < next)) next = o;
    }
    const bf = prev >= 0 ? ix - prev - 1 : 0;
    const af = next >= 0 ? next - ix - 1 : 0;
    return Math.max(bf, af);
  };
  // Helper: length of off-streak created by placing candidate as O
  const offStreakIfOff = (ec, candDay) => {
    const idx = dates.findIndex(x => x.d === candDay);
    if (idx < 0) return 1;
    let n = 1;
    for (let j = idx-1; j >= 0; j--) {
      const v = grid[ec][dates[j].d];
      if (v === "O" || v === "L" || v === "R") n++; else break;
    }
    for (let j = idx+1; j < dates.length; j++) {
      const v = grid[ec][dates[j].d];
      if (v === "O" || v === "L" || v === "R") n++; else break;
    }
    return n;
  };
  // Helper: spacing in days from candidate to the nearest existing off
  // (or large value if no offs yet)
  const spacingTo = (ec, candDay) => {
    const idx = dates.findIndex(x => x.d === candDay);
    let best = 999;
    for (let j = 0; j < dates.length; j++) {
      if (j === idx) continue;
      const v = grid[ec][dates[j].d];
      if (v === "O" || v === "L" || v === "R") {
        const dist = Math.abs(j - idx);
        if (dist < best) best = dist;
      }
    }
    return best;
  };

  // For each manager, run backtracking solver across all full weeks
  // that need 2 offs (skipping weeks where the weekend pair already
  // contributes 2). Backtracking guarantees max-run ≤ 6 if a solution
  // exists; falls back to greedy if no solution exists.
  for (const h of f) {
    // Build the list of full weeks needing offs (with their target need)
    const weeksToFill = [];
    for (const w of wkOrder) {
      const days = wkMap[w];
      if (days.length < 7) continue;
      const need = 2 - offWk[h.ec][w];
      if (need > 0) weeksToFill.push({ w, days, need });
    }
    if (weeksToFill.length === 0) continue;

    // Compute longest W/null-run for THIS manager only (treats null as W
    // since unfilled weeks would otherwise be working).
    const maxRunForManager = () => {
      let run = 0, mx = 0;
      for (const x of dates) {
        const v = grid[h.ec][x.d];
        if (v === "O" || v === "L" || v === "R") run = 0;
        else { run++; if (run > mx) mx = run; }
      }
      return mx;
    };
    // Best-case max-run: treat NULL as off (we haven't decided yet — they
    // CAN become offs in a later level). Used as the prune check so we
    // don't kill branches that are still solvable.
    const minMaxRunIfNullsBecomeOffs = () => {
      let run = 0, mx = 0;
      for (const x of dates) {
        const v = grid[h.ec][x.d];
        if (v === "O" || v === "L" || v === "R" || v == null) run = 0;
        else { run++; if (run > mx) mx = run; }
      }
      return mx;
    };

    // Backtracking search
    const tryWeek = (i) => {
      if (i >= weeksToFill.length) {
        return maxRunForManager() <= 6;
      }
      const { days, need } = weeksToFill[i];
      // Generate candidate combinations
      const candidates = [];
      if (need === 2) {
        for (let a = 0; a < days.length; a++) {
          if (grid[h.ec][days[a].d] != null) continue;
          if ((m - W[days[a].d].off - W[days[a].d].leave - 1) < 2) continue;
          for (let b = a + 1; b < days.length; b++) {
            if (grid[h.ec][days[b].d] != null) continue;
            if ((m - W[days[b].d].off - W[days[b].d].leave - 1) < 2) continue;
            candidates.push([days[a], days[b]]);
          }
        }
      } else {
        for (const d of days) {
          if (grid[h.ec][d.d] != null) continue;
          if ((m - W[d.d].off - W[d.d].leave - 1) < 2) continue;
          candidates.push([d]);
        }
      }
      // Score: prefer mid-week (dow weight) + adjacency bonus + late-in-cycle
      // bonus when a weekend pair sits in the next week.
      const scoreCombo = (combo) => {
        let s = 0;
        for (const d of combo) s += (dowOrd[d.dow] || 0) * 10;
        if (combo.length === 2) {
          const idxA = dates.indexOf(combo[0]);
          const idxB = dates.indexOf(combo[1]);
          if (Math.abs(idxA - idxB) === 1) s += 30;     // adjacency bonus
        }
        // Smooth W-coverage: penalise days that already have many offs
        for (const d of combo) s -= W[d.d].off * 5;
        return s;
      };
      candidates.sort((a, b) => scoreCombo(b) - scoreCombo(a));
      // Try each candidate in scored order
      for (const combo of candidates) {
        // Apply
        for (const d of combo) {
          grid[h.ec][d.d] = "O";
          W[d.d].off++;
          offWk[h.ec][wkOfDay[d.d]]++;
        }
        // Prune: max-run check after this placement
        if (maxRunForManager() <= 6) {
          if (tryWeek(i + 1)) return true;
        }
        // Undo
        for (const d of combo) {
          grid[h.ec][d.d] = null;
          W[d.d].off--;
          offWk[h.ec][wkOfDay[d.d]]--;
        }
      }
      return false;
    };

    if (!tryWeek(0)) {
      // Backtracking failed — fall back to greedy Mon-Tue placement
      // for any week still missing offs (will report conflict later).
      for (const wt of weeksToFill) {
        let need = 2 - offWk[h.ec][wt.w];
        for (const d of wt.days) {
          if (need <= 0) break;
          if (grid[h.ec][d.d] != null) continue;
          if ((m - W[d.d].off - W[d.d].leave - 1) < 2) continue;
          grid[h.ec][d.d] = "O";
          W[d.d].off++;
          offWk[h.ec][wkOfDay[d.d]]++;
          need--;
        }
      }
    }
  }

  // ── Default fill: any remaining null → W ─────────────────────────
  for (const h of f) for (const x of dates) {
    if (grid[h.ec][x.d] == null) { grid[h.ec][x.d] = "W"; W[x.d].working++; }
  }

  // ── 7-consecutive-day fix (1:1 port from old HTML, 5 passes) ──────
  // For each manager: find longest W-run; build _swappable list of off
  // days OUTSIDE the run within the run's ISO weeks (skipping pair-
  // locked weekend offs); for each src in turn, pick the in-run target
  // that yields the smallest new max-run; apply if it improves; first
  // src that yields an improvement wins (no exhaustive search).
  // Coverage check: only the target-day → O transition (target's
  // working count must stay ≥ 2). Run counter only counts "W" (NOT "E").
  for (let pass = 0; pass < 5; pass++) {
    let anyFix = false;
    for (const h of f) {
      let run = 0, rs = -1, maxRun = 0, maxRs = -1, maxRe = -1;
      for (let i = 0; i < dates.length; i++) {
        const v = grid[h.ec][dates[i].d];
        if (v === "W") {
          if (run === 0) rs = i;
          run++;
          if (run > maxRun) { maxRun = run; maxRs = rs; maxRe = i; }
        } else run = 0;
      }
      if (maxRun < 7) continue;
      const runWks = new Set();
      for (let i = maxRs; i <= maxRe; i++) runWks.add(wkOfDay[dates[i].d]);
      const swappable = [];
      for (let i = 0; i < dates.length; i++) {
        if (grid[h.ec][dates[i].d] !== "O") continue;
        if (!runWks.has(wkOfDay[dates[i].d])) continue;
        if (i >= maxRs && i <= maxRe) continue;            // outside the run
        if (pairLocked[h.ec].has(dates[i].d)) continue;
        swappable.push(i);
      }
      let fixed = false;
      for (const src of swappable) {
        if (fixed) break;
        const srcWk = wkOfDay[dates[src].d];
        let bestIx = -1, bestNew = maxRun;
        for (let ix = maxRs; ix <= maxRe; ix++) {
          // OLD restricts targets to the SAME ISO WEEK as the source-O.
          if (wkOfDay[dates[ix].d] !== srcWk) continue;
          const wb = m - W[dates[ix].d].off - W[dates[ix].d].leave;
          if (wb - 1 < 2) continue;                         // target's coverage
          // Try the swap, measure new max run, revert
          const oldSrc = grid[h.ec][dates[src].d];
          const oldTgt = grid[h.ec][dates[ix].d];
          grid[h.ec][dates[src].d] = "W";
          grid[h.ec][dates[ix].d]  = "O";
          let nr = 0, nm = 0;
          for (let j = 0; j < dates.length; j++) {
            if (grid[h.ec][dates[j].d] === "W") { nr++; if (nr > nm) nm = nr; } else nr = 0;
          }
          grid[h.ec][dates[src].d] = oldSrc;
          grid[h.ec][dates[ix].d]  = oldTgt;
          if (nm < bestNew) { bestNew = nm; bestIx = ix; }
        }
        if (bestIx >= 0) {
          // Apply
          grid[h.ec][dates[src].d] = "W";
          W[dates[src].d].off--; W[dates[src].d].working++; offWk[h.ec][wkOfDay[dates[src].d]]--;
          grid[h.ec][dates[bestIx].d] = "O";
          W[dates[bestIx].d].working--; W[dates[bestIx].d].off++; offWk[h.ec][wkOfDay[dates[bestIx].d]]++;
          fixed = true; anyFix = true;
        }
      }
    }
    if (!anyFix) break;
  }

  // ── Partial-week off allocation (pre-fill so HARD max-6 stays compatible
  //    with HARD 2-offs-per-FULL-week) ───────────────────────────────────
  // Full weeks already have their 2 offs from the backtracking solver. The
  // leading and trailing partial weeks were never touched. With 4-manager
  // teams and a mid-week cycle start, that leaves runs that span partial+
  // full+full at 7-10 days. Place offs in the partial weeks now — limited
  // by the cross-month carry — so the HARD max-6 step that follows can rely
  // on swap-only moves and never has to push a full week to 3 offs.
  const isFullWeek    = (wk) => wkMap[wk] && wkMap[wk].length === 7;
  const isPartialWeek = (wk) => wkMap[wk] && wkMap[wk].length < 7;
  const partialCarry  = (ec, wk) => {
    if (wk === leadingWk  && isLeadingPartial)  return +priorOffs[ec] || 0;
    if (wk === trailingWk && isTrailingPartial) return +nextOffs[ec]  || 0;
    return 0;
  };
  const longestWRun = (ec) => {
    let run = 0, mx = 0;
    for (const x of dates) {
      const v = grid[ec][x.d];
      if (v === "W" || v === "E") { run++; if (run > mx) mx = run; }
      else if (v === null || v === undefined) { run++; if (run > mx) mx = run; }
      else run = 0;
    }
    return mx;
  };
  for (const h of f) {
    for (const wk of [leadingWk, trailingWk]) {
      if (!isPartialWeek(wk)) continue;
      // offWk already includes the cross-month carry (we seeded it earlier so
      // the weekend-pair gate respects it). So the cap is simply 2 - offWk[wk].
      let capacity = 2 - offWk[h.ec][wk];
      if (capacity <= 0) continue;
      // Aim for proportional offs: roughly weekLen * 2 / 7, but never above capacity
      const weekLen = wkMap[wk].length;
      let want = Math.min(capacity, Math.max(0, Math.round(weekLen * 2 / 7)));
      if (want <= 0 && longestWRun(h.ec) >= 7) want = Math.min(1, capacity);
      // For very short partials with carry already at the cap, still try to
      // place 1 off if the manager would otherwise span the rollover with no
      // off-day on either side. This keeps the rollover week visibly humane
      // even when the carry from the adjacent cycle is positioned far from
      // this end of the week.
      if (want <= 0 && capacity >= 1) {
        // Check if this manager has ANY off in the partial week's days within
        // the current cycle. If not, force-place 1 off here for "seamless flow".
        let hasOff = false;
        for (const dy of wkMap[wk]) {
          const v = grid[h.ec][dy.d];
          if (v === "O" || v === "L" || v === "R") { hasOff = true; break; }
        }
        if (!hasOff) want = 1;
      }
      while (want-- > 0) {
        // Pick the W day in the partial that, when made O, minimises this
        // manager's max-run (and preserves coverage).
        let best = null, bestMax = Infinity;
        for (const dy of wkMap[wk]) {
          const cur = grid[h.ec][dy.d];
          if (cur !== "W") continue;
          if (pairLocked[h.ec].has(dy.d)) continue;
          if ((m - W[dy.d].off - W[dy.d].leave - 1) < 2) continue;
          grid[h.ec][dy.d] = "O";
          const mx = longestWRun(h.ec);
          grid[h.ec][dy.d] = "W";
          if (mx < bestMax) { bestMax = mx; best = dy; }
        }
        if (!best) break;
        grid[h.ec][best.d] = "O";
        W[best.d].working--;
        W[best.d].off++;
        offWk[h.ec][wk]++;
      }
    }
  }

  // ── HARD max-6 enforcement (labour law) — preserves 2-offs-per-FULL-week
  // Both rules are hard. Strategies allowed:
  //   STEP 1  Same-week swap inside a full week — counts unchanged.
  //   STEP 2  Cross-week swap where the SOURCE is a partial week (no 2-target)
  //           AND the TARGET week stays within its cap (full ≤ 2, partial
  //           ≤ 2 - carry).
  //   STEP 3  Insert in a partial week with remaining capacity (≤ 2-carry).
  //   The cross-week-swap-into-full-week-already-at-2 path is BANNED — that
  //   would push the full week to 3 offs.
  for (const h of f) {
    for (let pass = 0; pass < 30; pass++) {
      let run = 0, rs = -1, maxRun = 0, maxRs = -1, maxRe = -1;
      for (let i = 0; i < dates.length; i++) {
        const v = grid[h.ec][dates[i].d];
        if (v === "W" || v === "E") {
          if (run === 0) rs = i;
          run++;
          if (run > maxRun) { maxRun = run; maxRs = rs; maxRe = i; }
        } else run = 0;
      }
      if (maxRun <= 6) break;

      // STEPS 1+2 — best swap that respects 2-per-full-week
      let bestSwap = null, bestSwapMax = maxRun;
      for (let src = 0; src < dates.length; src++) {
        const sv = grid[h.ec][dates[src].d];
        if (sv !== "O" && sv !== "E") continue;
        if (pairLocked[h.ec].has(dates[src].d)) continue;
        const srcWk = wkOfDay[dates[src].d];
        for (let ix = maxRs; ix <= maxRe; ix++) {
          const tgtWk = wkOfDay[dates[ix].d];
          const sameWk = srcWk === tgtWk;
          if (!sameWk) {
            // Cross-week swap allowed only when source is partial AND
            // target's cap won't be breached.
            if (!isPartialWeek(srcWk)) continue;
            if (isFullWeek(tgtWk)) {
              // target full week — must already be < 2 offs
              if (offWk[h.ec][tgtWk] >= 2) continue;
            } else if (isPartialWeek(tgtWk)) {
              const carryT = partialCarry(h.ec, tgtWk);
              if (offWk[h.ec][tgtWk] + carryT >= 2) continue;
            }
          }
          const wb = m - W[dates[ix].d].off - W[dates[ix].d].leave;
          if (wb - 1 < 2) continue;
          const oS = grid[h.ec][dates[src].d];
          const oT = grid[h.ec][dates[ix].d];
          grid[h.ec][dates[src].d] = "W";
          grid[h.ec][dates[ix].d]  = "O";
          let nr = 0, nm = 0;
          for (let j = 0; j < dates.length; j++) {
            const v2 = grid[h.ec][dates[j].d];
            if (v2 === "W" || v2 === "E") { nr++; if (nr > nm) nm = nr; } else nr = 0;
          }
          grid[h.ec][dates[src].d] = oS;
          grid[h.ec][dates[ix].d]  = oT;
          if (nm < bestSwapMax) { bestSwapMax = nm; bestSwap = { src, ix }; }
        }
      }
      if (bestSwap) {
        const { src, ix } = bestSwap;
        grid[h.ec][dates[src].d] = "W";
        W[dates[src].d].off--; W[dates[src].d].working++; offWk[h.ec][wkOfDay[dates[src].d]]--;
        grid[h.ec][dates[ix].d]  = "O";
        W[dates[ix].d].working--; W[dates[ix].d].off++; offWk[h.ec][wkOfDay[dates[ix].d]]++;
        continue;
      }

      // STEP 3 — insert in a PARTIAL week with capacity (preserves 2/full-week)
      const insertOrder = [];
      for (let i = maxRs + 6; i <= maxRe; i++) insertOrder.push(i);
      for (let i = maxRs + 5; i >= maxRs; i--) insertOrder.push(i);
      let inserted = false;
      for (const ix of insertOrder) {
        const tgtWk = wkOfDay[dates[ix].d];
        if (!isPartialWeek(tgtWk)) continue;
        const carryT = partialCarry(h.ec, tgtWk);
        if (offWk[h.ec][tgtWk] + carryT >= 2) continue;
        const wb = m - W[dates[ix].d].off - W[dates[ix].d].leave;
        if (wb - 1 < 2) continue;
        grid[h.ec][dates[ix].d] = "O";
        W[dates[ix].d].working--; W[dates[ix].d].off++; offWk[h.ec][wkOfDay[dates[ix].d]]++;
        inserted = true;
        break;
      }
      if (!inserted) break; // unsolvable with hard 2/week + max-6 — surface as conflict
    }
  }

  // ── Day totals + conflicts ────────────────────────────────────────
  const dayTotals = {};
  for (const x of dates) {
    let w = 0, o = 0, l = 0, r = 0;
    for (const h of f) {
      const v = grid[h.ec][x.d];
      if (v === "W")      w++;
      else if (v === "O") o++;
      else if (v === "L") l++;
      else if (v === "R") { r++; o++; }
    }
    dayTotals[x.d] = { working: w, off: o, leave: l, requested: r };
  }
  const conflicts = [];
  for (const x of dates) {
    const w = dayTotals[x.d].working;
    if (w < 2) conflicts.push({ type:"solo_or_empty", msg: x.d + ": only " + w + " manager(s) working", severity:"high", date: x.d });
  }
  // Map of managers who submitted off-day requests this cycle. A request
  // can overrule the guaranteed weekend pair (the request takes priority,
  // and we don't surface a "short weekend" conflict for that manager).
  const hasReq = new Set();
  for (const r of (requests || [])) if (r && r.ec) hasReq.add(r.ec);
  for (const h of f) {
    const need = h.role === "SM" ? 2 : 1;
    const have = wePairs(h);
    if (have < need && !hasReq.has(h.ec)) conflicts.push({ type:"short_weekend", msg: h.name + " has " + have + " weekend(s) off (target " + need + ")", severity:"medium", ec: h.ec });
    for (const w of wkOrder) {
      if (wkMap[w].length < 7) continue;
      if (offWk[h.ec][w] < 2) conflicts.push({ type:"short_off_week", msg: h.name + " has " + offWk[h.ec][w] + " off in " + w + " (target 2)", severity:"medium", ec: h.ec, week: w });
    }
    // Cross-month rollover: leading partial-week effective off-count
    // (in-cycle + prior tail) must still respect the 2-cap.
    if (isLeadingPartial && offWk[h.ec][leadingWk] > 2) {
      const inCycle = offWk[h.ec][leadingWk] - (+priorOffs[h.ec] || 0);
      conflicts.push({ type:"rollover_overlimit", msg: h.name + " has " + offWk[h.ec][leadingWk] + " off-days in the rollover week (" + inCycle + " this cycle + " + (+priorOffs[h.ec] || 0) + " prior) — over the 2-cap", severity:"high", ec: h.ec, week: leadingWk });
    }
    // Trailing partial — same check on the cycle's tail week.
    if (isTrailingPartial && offWk[h.ec][trailingWk] > 2) {
      const inCycle = offWk[h.ec][trailingWk] - (+nextOffs[h.ec] || 0);
      conflicts.push({ type:"rollover_overlimit", msg: h.name + " has " + offWk[h.ec][trailingWk] + " off-days in the closing rollover week (" + inCycle + " this cycle + " + (+nextOffs[h.ec] || 0) + " next) — over the 2-cap", severity:"high", ec: h.ec, week: trailingWk });
    }
    let run = 0, seen7 = false;
    for (const x of dates) {
      if (grid[h.ec][x.d] === "W") {
        run++;
        if (run >= 7 && !seen7) { conflicts.push({ type:"consecutive", msg: h.name + " " + run + "+ consecutive working days", severity:"high", ec: h.ec }); seen7 = true; }
      } else { run = 0; seen7 = false; }
    }
  }
  // If this cycle starts mid-week but the prior cycle hasn't been
  // generated yet, the cross-month overlap can't be enforced. Surface
  // it as a single info-level conflict so the user knows.
  if (isLeadingPartial && priorMissing) {
    conflicts.push({ type:"prior_missing", msg: "Prior month's manager schedule not generated yet — the leading rollover week's 2-off cap can't be enforced across the boundary. Generate the prior cycle first for full coverage.", severity:"medium" });
  }
  if (isTrailingPartial && nextMissing) {
    conflicts.push({ type:"next_missing", msg: "Next month's manager schedule not generated yet — the closing rollover week's 2-off cap is provisional. When you generate the next cycle, that boundary will be re-checked.", severity:"medium" });
  }
  // Ghost overlay (offboard / onboarding)
  for (const h of f) {
    if (h.leftDate) {
      h._offGhost = true;
      h._offLeftDate = h.leftDate;
      h._offReason = h.offRec ? h.offRec.reason : "";
      if (grid[h.ec]) for (const x of dates) if (x.d > h.leftDate) grid[h.ec][x.d] = "X";
    }
    if (h._onboarding && h._startDate) {
      h._obStarting = true;
      h._obStartDate = h._startDate;
      if (grid[h.ec]) for (const x of dates) if (x.d < h._startDate) grid[h.ec][x.d] = "X";
    }
  }
  return { managers: f, dates, grid, conflicts, dayTotals, branch: branchName, cycleStart: cycleStartYmd, cycleEnd, weekOrder: wkOrder, weeksMap: wkMap };
}


// ─── CONFIG ──────────────────────────────────────────────────────────────────────
const SALONS = [
  { name:"Sea Point",       mani:16, pedi:6,  capacity:24 },
  { name:"Bree",            mani:9,  pedi:5,  capacity:15 },
  { name:"Kloof",           mani:11, pedi:4,  capacity:17 },
  { name:"Claremont",       mani:12, pedi:7,  capacity:21 },
  { name:"Rondebosch",      mani:12, pedi:4,  capacity:18 },
  { name:"Durbanville",     mani:11, pedi:8,  capacity:21 },
  { name:"Table Bay",       mani:14, pedi:4,  capacity:20 },
  { name:"Somerset West",   mani:14, pedi:4,  capacity:20 },
  { name:"Riverlands",  mani:11, pedi:6,  capacity:19 },
  { name:"Kuils River", mani:13, pedi:8,  capacity:23 },
  { name:"Westlake",        mani:9,  pedi:7,  capacity:18 },
  { name:"Green Point",     mani:8,  pedi:7,  capacity:17 },
  { name:"Plumstead",       mani:9,  pedi:7,  capacity:18 },
  { name:"Sandown",         mani:9,  pedi:7,  capacity:18 },
  { name:"Cape Gate",       mani:9,  pedi:7,  capacity:18 },
  { name:"Winelands",       mani:9,  pedi:7,  capacity:18 },
  { name:"Betty",           mani:9,  pedi:7,  capacity:18, targetCapacity:10, lowDemand:true },
];

const COMPLIANCE = {
  sa_citizen:   { label:"SA Citizen",            icon:"🇿🇦", color:"#14532d", bg:"#dcfce7", border:"#86efac" },
  work_permit:  { label:"Valid Work Permit",      icon:"✅",  color:"#8E5570", bg:"#dbeafe", border:"#93c5fd" },
  asylum:       { label:"Asylum on File",         icon:"📋",  color:"#4c1d95", bg:"#ede9fe", border:"#a78bfa" },
  verified_dha: { label:"Verified by DHA",        icon:"🔵",  color:"#0c4a6e", bg:"#e0f2fe", border:"#7dd3fc" },
  z_na:         { label:"Z/NA – No Valid Permit", icon:"🚨",  color:"#831843", bg:"#fee2e2", border:"#fca5a5" },
};

// matStatus values:
//   "on_mat"    = currently ON maternity leave → EXCLUDED from store count, greyed out
//   "pregnant"  = still working, just pregnant → COUNTED IN store, shown with 🤰 badge
//   "returned"  = back at work → fully active
//   "sick_leave"= on sick leave
const MAT_STATUS = {
  on_mat:    { label:"On Maternity Leave", icon:"🤱", color:"#8E5570", bg:"#fce7f3", border:"#fbcfe8" },
  pregnant:  { label:"Pregnant – At Work", icon:"🤰", color:"#8E5570", bg:"#fef3c7", border:"#fde68a" },
  returned:  { label:"Back at Work",       icon:"✅",  color:"#8E5570", bg:"#d1fae5", border:"#6ee7b7" },
  sick_leave:{ label:"Sick Leave",         icon:"🏥",  color:"#8E5570", bg:"#dbeafe", border:"#93c5fd" },
};


// ─── MANAGERS DATA ────────────────────────────────────────────────────────────────
// Managers do NOT count toward salon headcount or occupancy
const MANAGERS_INIT = [
  // Sea Point
  {ec:"B643M",name:"Aqilah Oosthuizen",branch:"Sea Point",role:"AM",notes:"Pregnant, end of June"},
  {ec:"B246M",name:"Zikhona Qelewa",branch:"Sea Point",role:"SM",notes:""},
  {ec:"M003",name:"Robin P",branch:"Sea Point",role:"AM",notes:"Transfer from Riverlands"},
  {ec:"M004",name:"Vela",branch:"Sea Point",role:"AM",notes:"Started 01/05/2026"},
  // Westlake
  {ec:"M005",name:"Annisa",branch:"Westlake",role:"SM",notes:""},
  {ec:"M006",name:"Stacey",branch:"Westlake",role:"AM",notes:""},
  {ec:"M007",name:"Sesethu",branch:"Westlake",role:"AM",notes:""},
  // Riverlands
  {ec:"M008",name:"Tarryn A",branch:"Riverlands",role:"AM",notes:"Transfer from Sea Point"},
  {ec:"M009",name:"Miche",branch:"Riverlands",role:"AM",notes:""},
  {ec:"M010",name:"Nicole",branch:"Riverlands",role:"AM",notes:"Started 04/03/2026"},
  {ec:"M011",name:"Araside",branch:"Riverlands",role:"AM",notes:"Started 07/04/2026 - training at Table Bay"},
  // Durbanville
  {ec:"B330M",name:"Jaqueline",branch:"Durbanville",role:"SM",notes:""},
  {ec:"M013",name:"Shumeeze",branch:"Durbanville",role:"AM",notes:"Started 13/04/2026"},
  {ec:"M014",name:"Tabita",branch:"Durbanville",role:"AM",notes:"Moving to Somerset West when replacement found"},
  // Claremont
  {ec:"B307M",name:"Rene",branch:"Claremont",role:"SM",notes:""},
  {ec:"M016",name:"Yasmina",branch:"Claremont",role:"AM",notes:""},
  {ec:"M017",name:"Nonthombi",branch:"Claremont",role:"AM",notes:"Started 4 March"},
  {ec:"M018",name:"Charnelle",branch:"Claremont",role:"AM",notes:"Returned from maternity 20th April"},
  // Green Point
  {ec:"M019",name:"Bongani",branch:"Green Point",role:"SM",notes:"Acting SM - 3 months trial"},
  {ec:"M020",name:"Naquawbisa",branch:"Green Point",role:"AM",notes:""},
  {ec:"M021",name:"Nomcebo",branch:"Green Point",role:"AM",notes:"Started 07/04/2026"},
  // Somerset West
  {ec:"M022",name:"Jade",branch:"Somerset West",role:"AM",notes:"Potential resignation"},
  {ec:"M023",name:"Summer",branch:"Somerset West",role:"AM",notes:""},
  // Rondebosch
  {ec:"M024",name:"Micheala",branch:"Rondebosch",role:"AM",notes:"Started 23/03/2025"},
  {ec:"M025",name:"Linda",branch:"Rondebosch",role:"SM",notes:"Promoted to SM 31st March"},
  {ec:"M026",name:"Siaan",branch:"Rondebosch",role:"AM",notes:"Returned from maternity 23/03/26"},
  // Kuils River
  {ec:"B272M",name:"Thandi",branch:"Kuils River",role:"AM",notes:""},
  {ec:"M028",name:"Zandile",branch:"Kuils River",role:"AM",notes:""},
  {ec:"B198M",name:"Jamiee",branch:"Kuils River",role:"SM",notes:""},
  // Kloof
  {ec:"M030",name:"Shenaz",branch:"Kloof",role:"SM",notes:""},
  {ec:"M031",name:"Mischka",branch:"Kloof",role:"AM",notes:"Transfer from Sandown"},
  {ec:"M032",name:"Thandi",branch:"Kloof",role:"AM",notes:""},
  {ec:"M033",name:"Aphiwe",branch:"Kloof",role:"AM",notes:"Started 28/04/2026"},
  // Sandown
  {ec:"M047",name:"Fahima",branch:"Sandown",role:"SM",notes:""},
  {ec:"M048",name:"Lungile",branch:"Sandown",role:"AM",notes:""},
  {ec:"M049",name:"Micheala",branch:"Sandown",role:"AM",notes:""},
  {ec:"M050",name:"Brenda",branch:"Sandown",role:"AM",notes:""},
  {ec:"M034",name:"Tarrin",branch:"Winelands",role:"SM",notes:"From Durbanville"},
  {ec:"M035",name:"Seiphati",branch:"Winelands",role:"AM",notes:"Started 21/04/2026"},
  {ec:"M036",name:"Kayla",branch:"Winelands",role:"AM",notes:""},
  {ec:"M037",name:"Junia",branch:"Winelands",role:"AM",notes:"Transfer from Cape Gate"},
  // Winelands
  {ec:"M038",name:"Isabella",branch:"Regional",role:"AM",notes:"Started 05/05/2026"},
  {ec:"M039",name:"Chante",branch:"Regional",role:"AM",notes:"Started 05/05/2026"},
  {ec:"M040",name:"Nazeera",branch:"Regional",role:"AM",notes:"Started 05/05/2026"},
  {ec:"M041",name:"Isa",branch:"Regional",role:"AM",notes:"Started 20/04/2026"},
  // Table Bay
  {ec:"B185M",name:"Carol",branch:"Table Bay",role:"SM",notes:"Senior Store Manager"},
  {ec:"B224M",name:"Phelo",branch:"Table Bay",role:"AM",notes:"Maternity end of December"},
  {ec:"M044",name:"Nellie",branch:"Table Bay",role:"AM",notes:"Transfer from Sandown"},
  {ec:"M045",name:"Julia",branch:"Table Bay",role:"AM",notes:""},
  {ec:"M046",name:"Thina",branch:"Table Bay",role:"AM",notes:"Transferring from Kuils River"},
  // Plumstead
  {ec:"M051",name:"Fatima",branch:"Plumstead",role:"AM",notes:"May - Pregnant"},
  {ec:"M052",name:"Charlene",branch:"Plumstead",role:"AM",notes:"Started 4 March"},
  {ec:"M053",name:"Crysteblle",branch:"Plumstead",role:"AM",notes:"Started 13/04/2026"},
  {ec:"M054",name:"Gakeema",branch:"Plumstead",role:"AM",notes:"Started 07/04/2025"},
  // Cape Gate
  {ec:"M055",name:"Michelle",branch:"Cape Gate",role:"SM",notes:"Started 28/04/2026"},
  {ec:"M056",name:"Danel",branch:"Cape Gate",role:"AM",notes:""},
  {ec:"M057",name:"Sinovuyo",branch:"Cape Gate",role:"AM",notes:"Started 28/04/2026"},
  // Betty
  {ec:"M058",name:"Savanah",branch:"Betty",role:"AM",notes:""},
  {ec:"M059",name:"Tanita",branch:"Betty",role:"AM",notes:"Started 23/03/2026"},
  // Bree
  {ec:"B147M",name:"Fazlyn",branch:"Bree",role:"SM",notes:""},
  {ec:"M061",name:"Chante",branch:"Bree",role:"AM",notes:"Transfer from Kloof"},
  {ec:"M062",name:"Suaad",branch:"Bree",role:"AM",notes:""},
];

// ─── MATERNITY RECORDS (from Google Sheets) ──────────────────────────────────────
// ONLY on_mat status → excluded from store count
// pregnant = still in store, counted normally
const MAT_INIT = [
  { ec:"B207", name:"Thandokazi Kondowe",   branch:"Rondebosch",       matStatus:"on_mat",    matStart:null,         matEnd:null,         returnDate:null,       notes:"On maternity leave. AL 07–26 Apr 2026. Check with Farieda for exact dates." },
  { ec:"B268", name:"Zoey Adonis",          branch:"Sea Point",        matStatus:"returned",  matStart:"2025-11-21", matEnd:"2026-03-23", returnDate:"2026-03-25",notes:"Back @ work. No RTW note on file" },
  { ec:"B295", name:"Lorraine Sangweni",    branch:"Kuils River",  matStatus:"on_mat",    matStart:null,         matEnd:null,         returnDate:null,       notes:"On maternity leave – no dates confirmed" },
  { ec:"B296", name:"Provina Runhondo",     branch:"Kuils River",  matStatus:"pregnant",  matStart:null,         matEnd:null,         returnDate:null,       notes:"Pregnant – next appointment Wed 29 Apr" },
  { ec:"B360", name:"Privilege Shoko",      branch:"Somerset West",   matStatus:"pregnant",  matStart:null,         matEnd:null,         returnDate:null,       notes:"Pregnant – due ~17 May 2026 per ultrasound" },
  { ec:"B365", name:"Ropafadzo William",    branch:"Sandown",          matStatus:"pregnant",  matStart:null,         matEnd:null,         returnDate:null,       notes:"Pregnant – due ~17 May 2026. Doc appt 23 Apr" },
  { ec:"B379", name:"Deneys Courtney Gaza", branch:"Fourways",         matStatus:"on_mat",    matStart:"2026-02-20", matEnd:"2026-06-22", returnDate:"2026-06-23",notes:"AL 06–19 Feb before maternity" },
  { ec:"B403", name:"Shiela Rwizi",         branch:"Plumstead",      matStatus:"pregnant",  matStart:null,         matEnd:null,         returnDate:null,       notes:"Pregnant – no leave date set yet" },
  { ec:"B409", name:"Tatenda Sawunyama",    branch:"Verdi",            matStatus:"on_mat",    matStart:"2026-02-19", matEnd:"2026-06-19", returnDate:"2026-06-22",notes:"AL 29 Jan–18 Feb before maternity" },
  { ec:"B418", name:"Millicent",            branch:"Plumstead",        matStatus:"on_mat",    matStart:null,         matEnd:null,         returnDate:null,       notes:"On maternity leave" },
  { ec:"B419", name:"Tsi Tsi Tsunda",       branch:"Westlake",         matStatus:"returned",  matStart:"2025-12-24", matEnd:null,         returnDate:null,       notes:"Back @ work. No return docs. Everything given to Tara-Lee" },
  { ec:"B442", name:"Albertina Kandeke",    branch:"Sea Point",        matStatus:"on_mat",    matStart:"2026-03-24", matEnd:"2026-07-24", returnDate:"2026-07-25",notes:"AL 11–23 Mar 2026 before maternity" },
  { ec:"B484", name:"Rumbidzai Dambaza",    branch:"Durbanville",      matStatus:"on_mat",    matStart:"2026-03-26", matEnd:"2026-07-27", returnDate:"2026-07-28",notes:"AL 02–25 Mar 2026 before maternity" },
  { ec:"B485", name:"Shaine Mtazu",         branch:"Mushroom",         matStatus:"on_mat",    matStart:"2026-02-12", matEnd:"2026-06-12", returnDate:"2026-06-15",notes:"" },
  { ec:"B497", name:"Ayabulela Kutwana",    branch:"Kuils River",  matStatus:"pregnant",  matStart:null,         matEnd:null,         returnDate:null,       notes:"Pregnant – next appointment Fri 24 Apr" },
  { ec:"B535", name:"Kimberleigh Tshepo",   branch:"Sea Point",        matStatus:"sick_leave",matStart:null,         matEnd:null,         returnDate:null,       notes:"Miscarriage – on sick leave 2 months" },
  { ec:"B585", name:"Praise Mupakati",      branch:"Sea Point",        matStatus:"on_mat",    matStart:"2026-02-25", matEnd:"2026-06-25", returnDate:"2026-06-26",notes:"AL 10–24 Feb 2026 before maternity" },
  { ec:"B631", name:"Nazin Banda",          branch:"Plumstead",      matStatus:"pregnant",  matStart:null,         matEnd:null,         returnDate:null,       notes:"Pregnant – no leave date set yet" },
  { ec:"B687", name:"Londiwe Somi",         branch:"Ballito",          matStatus:"pregnant",  matStart:"2026-05-15", matEnd:"2026-09-15", returnDate:"2026-09-16",notes:"Maternity expected from 15 May 2026" },
  { ec:"B705", name:"Shiela Gondo",         branch:"Kuils River",  matStatus:"pregnant",  matStart:null,         matEnd:null,         returnDate:null,       notes:"9 weeks as of 21 Apr 2026" },
  { ec:"B710", name:"Ayanda Bali",          branch:"MOS",              matStatus:"pregnant",  matStart:null,         matEnd:null,         returnDate:null,       notes:"Currently 3 months pregnant" },
  { ec:"B711", name:"Beverly Shange",       branch:"Ballito",          matStatus:"on_mat",    matStart:"2026-03-17", matEnd:"2026-07-17", returnDate:"2026-07-20",notes:"" },
  { ec:"B723", name:"Pamela Jantjies",      branch:"Kuils River",  matStatus:"on_mat",    matStart:"2026-02-07", matEnd:"2026-06-07", returnDate:"2026-06-08",notes:"" },
  { ec:"B752", name:"Lusanda Esther Mutombo",branch:"Plumstead",       matStatus:"on_mat",    matStart:"2026-02-06", matEnd:"2026-06-08", returnDate:"2026-06-09",notes:"" },
  { ec:"B777", name:"Efume Vicky Katey",    branch:"Mall of the South",matStatus:"on_mat",    matStart:"2026-03-24", matEnd:"2026-07-24", returnDate:null,       notes:"No return date confirmed yet" },
  { ec:"B807", name:"Mihlali Ndamandama",   branch:"Rondebosch",       matStatus:"on_mat",    matStart:"2026-04-22", matEnd:"2026-08-23", returnDate:"2026-08-24",notes:"Maternity from 22 Apr 2026. AL 18–21 Apr before maternity." },
];

// ─── STAFF DATA (sorted by B-number in source so render is consistent) ──────────
const STAFF_INIT = [
  // SEA POINT
  {ec:"B028",name:"Fatima January",branch:"Kloof",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B024",name:"Colleen Shumba",branch:"Bree",contract:"NO CONTRACT",permit:"z_na",level:"Three"},
  {ec:"B029",name:"Brilliant Muirimi",branch:"Bree",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B032",name:"Atupele Mpatula",branch:"Claremont",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B042",name:"Reginah Nyagomo",branch:"Bree",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B043",name:"Thembi Juba",branch:"Bree",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B045",name:"Pauline Kumadzi",branch:"Somerset West",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B046",name:"Lavu (Loveness) Chitsulo",branch:"Kloof",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B051",name:"Khanyisa Swartbooi",branch:"Kloof",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B055",name:"Stacy Ngabi",branch:"Riverlands",contract:"NO CONTRACT",permit:"z_na",level:"Three"},
  {ec:"B057",name:"Miriam Mamie",branch:"Kloof",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B058",name:"Esther Makani",branch:"Sea Point",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B059",name:"Letwin Dumira",branch:"Green Point",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B064",name:"Alice Tafa",branch:"Somerset West",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B066",name:"Andisiwe Dyani",branch:"Bree",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B069",name:"Current Mavhaire",branch:"Sea Point",contract:"Permanent",permit:"z_na",level:"Two"},
  {ec:"B072",name:"Bijou Salama-Musa",branch:"Durbanville",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B073",name:"Martha Makiyi",branch:"Bree",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B077",name:"Lindiwe",branch:"Sea Point",contract:"Permanent",permit:"z_na",level:"Three"},
  {ec:"B087",name:"Flora Nzamba",branch:"Sea Point",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B101",name:"Polite Ndlovu",branch:"Bree",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B105",name:"Philiswa Mbambisa",branch:"Bree",contract:"Permanent",permit:"sa_citizen",level:"Two"},
  {ec:"B109",name:"Matrice Makoenose",branch:"Green Point",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B115",name:"Helen (Nyaradzo) Duri",branch:"Green Point",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B116",name:"Panayoti Zinduwa",branch:"Sandown",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B120",name:"Aviwe Tom",branch:"Rondebosch",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B123",name:"Samantha Chimera",branch:"Kloof",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B126",name:"Gladys Chingadza",branch:"Sandown",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B127",name:"Connie Mdongwe",branch:"Claremont",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B129",name:"Ruwiza Mutsvene",branch:"Green Point",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B137",name:"Isabelle Namahirwe",branch:"Sandown",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B157",name:"Peace Munetsi",branch:"Westlake",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B159",name:"Liya Maweli",branch:"Claremont",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B160",name:"Thandiwe Ncube",branch:"Claremont",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B174",name:"Beauty Mutereko",branch:"Sea Point",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B175",name:"Tabeth Marodza",branch:"Riverlands",contract:"NO CONTRACT",permit:"z_na",level:"Three"},
  {ec:"B179",name:"Fidelia Dlamini",branch:"Bree",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B192",name:"Tetenda Jena",branch:"Sandown",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B196",name:"Hlubi Skolpati",branch:"Betty",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B200",name:"Kazi Mboso",branch:"Rondebosch",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B207",name:"Thandokazi Kondowe",branch:"Rondebosch",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B212",name:"Chrissy Namakonje",branch:"Sandown",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B214",name:"Plexedes Shoniwa",branch:"Table Bay",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B216",name:"Charity Kushamba",branch:"Bree",contract:"Permanent",permit:"z_na",level:"Two"},
  {ec:"B229",name:"Pauline Lutonadio",branch:"Sea Point",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B231",name:"Omega Kafumbe",branch:"Sandown",contract:"Permanent",permit:"asylum",level:""},
  {ec:"B233",name:"Letticia Mutize",branch:"Table Bay",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B240",name:"Sharai Manyuka",branch:"Bree",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B244",name:"Ngoni Mpofu",branch:"Rondebosch",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B251",name:"Francisca Dzingai",branch:"Kloof",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B252",name:"Emma Mudhokwa",branch:"Kloof",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B264",name:"Shiela Chimanga",branch:"Kloof",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B265",name:"Brenda Masvosva",branch:"Kloof",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B266",name:"Thina Mene",branch:"Claremont",contract:"Permanent",permit:"sa_citizen",level:"Two"},
  {ec:"B268",name:"Zoey Adonis",branch:"Sea Point",contract:"Permanent",permit:"sa_citizen",level:"Two"},
  {ec:"B269",name:"Chelsea Gatsi",branch:"Rondebosch",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B280",name:"Brenda Mavhiza",branch:"Claremont",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B281",name:"Mbalentle Apleni",branch:"Claremont",contract:"Permanent",permit:"sa_citizen",level:"Two"},
  {ec:"B282",name:"Nwabisa Mvumvu",branch:"Claremont",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B285",name:"Veliswa Yalezo",branch:"Table Bay",contract:"NO CONTRACT",permit:"sa_citizen",level:"One"},
  {ec:"B288",name:"Vimbai Tiripano",branch:"Sea Point",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B292",name:"Makanaka Rusike",branch:"Green Point",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B295",name:"Lorraine Sangweni",branch:"Kuils River",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B296",name:"Provina Runhondo",branch:"Kuils River",contract:"Permanent",permit:"z_na",level:"Two"},
  {ec:"B297",name:"Patience Kandiero",branch:"Somerset West",contract:"Permanent",permit:"z_na",level:"Two"},
  {ec:"B311",name:"Faith Mukonda",branch:"Green Point",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B312",name:"Anesu Chirume",branch:"Rondebosch",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B313",name:"Emihle Kati",branch:"Rondebosch",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B320",name:"Linnet Machiwenyika",branch:"Somerset West",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B325",name:"Tadiwa Mazhande",branch:"Rondebosch",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B327",name:"Millicent Moyo",branch:"Somerset West",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B332",name:"Sharon Rumbidzai",branch:"Claremont",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B337",name:"Chipo Ndongwe",branch:"Kuils River",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B338",name:"Talent Mariranyika",branch:"Durbanville",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B347",name:"Darlington Nyenga",branch:"Riverlands",contract:"Permanent",permit:"z_na",level:"Two"},
  {ec:"B356",name:"Yolanda Dingwayo",branch:"Kuils River",contract:"Permanent",permit:"sa_citizen",level:"Two"},
  {ec:"B360",name:"Privilege Shoko",branch:"Riverlands",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B365",name:"Ropafadzo William",branch:"Sandown",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B370",name:"Ennita Mugdih",branch:"Somerset West",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B371",name:"Isabel Mandizyidza",branch:"Somerset West",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B382",name:"Sisanda Maji",branch:"Cape Gate",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B384",name:"Susan Mutema",branch:"Durbanville",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B388",name:"Dorothy Mugwariri",branch:"Cape Gate",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B389",name:"Maryline Mugova",branch:"Kloof",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B390",name:"Rosemary Mandawala",branch:"Kuils River",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B402",name:"Sibusiswe Lulaka",branch:"Table Bay",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B403",name:"Sheila Rwisi",branch:"Plumstead",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B406",name:"Patuma Halidi",branch:"Rondebosch",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B407",name:"Mercy Mudungu",branch:"Kloof",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B408",name:"Chiedza Matsheza",branch:"Durbanville",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B410",name:"Tecla Dhanana",branch:"Durbanville",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B411",name:"Busiswa Sobani",branch:"Sea Point",contract:"Permanent",permit:"asylum",level:""},
  {ec:"B412",name:"Zinzi Sam",branch:"Rondebosch",contract:"NO CONTRACT",permit:"sa_citizen",level:"One"},
  {ec:"B413",name:"Jordon Lewis",branch:"Rondebosch",contract:"NO CONTRACT",permit:"sa_citizen",level:"Two"},
  {ec:"B415",name:"Nicole Gambiza",branch:"Durbanville",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B416",name:"Linda Sande",branch:"Durbanville",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B417",name:"Charmaine Muchenje",branch:"Westlake",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B418",name:"Millicent",branch:"Plumstead",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B419",name:"Tsi Tsi Tsunda",branch:"Westlake",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B428",name:"Talent Makudo",branch:"Westlake",contract:"NO CONTRACT",permit:"asylum",level:"Two"},
  {ec:"B429",name:"Tariro Denere",branch:"Sea Point",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B430",name:"Gisele Tshimbuyi",branch:"Durbanville",contract:"NO CONTRACT",permit:"asylum",level:"Two"},
  {ec:"B437",name:"Dunyiswa Ngcoza",branch:"Betty",contract:"NO CONTRACT",permit:"sa_citizen",level:""},
  {ec:"B438",name:"Ruth Muzhangiri",branch:"Sea Point",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B439",name:"Primerose Masuku",branch:"Durbanville",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B442",name:"Albertina Kandeke",branch:"Sea Point",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B444",name:"Nontutuzelu Shasha",branch:"Claremont",contract:"Permanent",permit:"sa_citizen",level:"Two"},
  {ec:"B452",name:"Loveness Shoko",branch:"Kuils River",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B459",name:"Venessa Dlamini",branch:"Sandown",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B460",name:"Ozlyn King",branch:"Table Bay",contract:"NO CONTRACT",permit:"sa_citizen",level:"One"},
  {ec:"B462",name:"Patience Tafadzwa",branch:"Riverlands",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B463",name:"Trisha Sisipenzi",branch:"Kuils River",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B464",name:"Ruth Masamba",branch:"Westlake",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B468",name:"Wendy Muwungani",branch:"Riverlands",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B469",name:"Ruth Kaseke",branch:"Green Point",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B470",name:"Ashley Ngubani",branch:"Table Bay",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B479",name:"Nancy Chiwandere",branch:"Kloof",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B484",name:"Rumbidzai Dambaza",branch:"Durbanville",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B488",name:"Masaline Kadawu",branch:"Green Point",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B490",name:"Blessing Gaha",branch:"Green Point",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B497",name:"Ayabulela Kutwana (BP)",branch:"Kuils River",contract:"NO CONTRACT",permit:"sa_citizen",level:"One"},
  {ec:"B498",name:"Lee Jean (BP)",branch:"Durbanville",contract:"NO CONTRACT",permit:"sa_citizen",level:"One"},
  {ec:"B499",name:"Caitlin Theunissen (BP)",branch:"Durbanville",contract:"NO CONTRACT",permit:"sa_citizen",level:"One"},
  {ec:"B500",name:"Vimbai Chachoka",branch:"Table Bay",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B502",name:"Aliyah Safiedien (BP)",branch:"Claremont",contract:"NO CONTRACT",permit:"sa_citizen",level:"One"},
  {ec:"B503",name:"Blessing Negomo",branch:"Table Bay",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B504",name:"Cherylen Mutandinda",branch:"Westlake",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B505",name:"Paidamoyo Pauro",branch:"Riverlands",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B506",name:"Memory Chipiwa",branch:"Sandown",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B507",name:"Plaxedes Chitawa",branch:"Durbanville",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B519",name:"Angeline Mhundwa",branch:"Cape Gate",contract:"NO CONTRACT",permit:"asylum",level:"Two"},
  {ec:"B522",name:"Melisa Mavhunje",branch:"Rondebosch",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B523",name:"Ingwani Vimbai",branch:"Table Bay",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B524",name:"Tariro Muchabayetu",branch:"Table Bay",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B525",name:"Natasha Ngwenya",branch:"Table Bay",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B526",name:"Fortunate Chiyangwa",branch:"Riverlands",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B527",name:"Shantel Mungwa",branch:"Kuils River",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B528",name:"Shamiso Chinoda",branch:"Riverlands",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B529",name:"Charity Muchavarangwa",branch:"Sea Point",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B531",name:"Delma Mungwariri",branch:"Cape Gate",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B533",name:"Lydia Mutyambizi",branch:"Westlake",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B534",name:"Nopelo",branch:"Sea Point",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B535",name:"Kimberley Santana",branch:"Sea Point",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B543",name:"Tendai Mavera",branch:"Westlake",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B545",name:"Tino Mugadza",branch:"Plumstead",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B547",name:"Nqobizitha Ncube",branch:"Plumstead",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B548",name:"Naysha Nyakadzino",branch:"Plumstead",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B549",name:"Patience Simenti",branch:"Plumstead",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B550",name:"Precious Barumbi",branch:"Plumstead",contract:"Permanent",permit:"z_na",level:"Two"},
  {ec:"B551",name:"Dorcas Chakwenya",branch:"Sandown",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B555",name:"Tanaka Chiboziwa",branch:"Bree",contract:"Permanent",permit:"asylum",level:"Three"},
  {ec:"B557",name:"Alice Moyo",branch:"Durbanville",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B559",name:"Zandiswa Mqikela",branch:"Claremont",contract:"NO CONTRACT",permit:"sa_citizen",level:"One"},
  {ec:"B580",name:"Snodia Svilziro",branch:"Green Point",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B582",name:"Vanesah Muhwandagara",branch:"Riverlands",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B585",name:"Praise Mupakati",branch:"Sea Point",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B586",name:"Sarah Bwakura",branch:"Claremont",contract:"Permanent",permit:"asylum",level:"Two"},
  {ec:"B588",name:"Primrose Choto",branch:"Claremont",contract:"Permanent",permit:"z_na",level:"Two"},
  {ec:"B601",name:"Princess Mapeza",branch:"Green Point",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B602",name:"Armelle Nkuela",branch:"Riverlands",contract:"NO CONTRACT",permit:"asylum",level:"Two"},
  {ec:"B631",name:"Nazin Banda",branch:"Plumstead",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B632",name:"Ketai Matope",branch:"Plumstead",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B633",name:"Kelly Phiri",branch:"Claremont",contract:"Permanent",permit:"asylum",level:"Two"},
  {ec:"B634",name:"Eva Katongo",branch:"Claremont",contract:"Permanent",permit:"asylum",level:"Two"},
  {ec:"B636",name:"Mildred Nyamukapa",branch:"Kuils River",contract:"Permanent",permit:"asylum",level:"Two"},
  {ec:"B637",name:"Primrose Mutambisi",branch:"Somerset West",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B638",name:"Lisah Madyiwa",branch:"Kuils River",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B639",name:"Tsi Tsi Mutero",branch:"Winelands",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B640",name:"Ruth Mota",branch:"Sandown",contract:"NO CONTRACT",permit:"z_na",level:"Two"},
  {ec:"B642",name:"Ameerah Cloete (BP)",branch:"Riverlands",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B646",name:"Caroline Chandirega",branch:"Rondebosch",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B661",name:"Sethu Mzomba",branch:"Rondebosch",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B647",name:"Nompikelelo Kaunda",branch:"Riverlands",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B655",name:"Sibongile (BP)",branch:"Green Point",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B662",name:"Nyameka Kula",branch:"Kloof",contract:"Permanent",permit:"sa_citizen",level:""},
  {ec:"B663",name:"Lisa Mazomba",branch:"Kloof",contract:"Permanent",permit:"sa_citizen",level:""},
  {ec:"B664",name:"Andisiwe Mgqatsha",branch:"Green Point",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B665",name:"Zulpha Smith",branch:"Green Point",contract:"Permanent",permit:"sa_citizen",level:""},
  {ec:"B670",name:"Elisafelo Magadzire",branch:"Kuils River",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B671",name:"Patricia Mutekesi",branch:"Somerset West",contract:"Permanent",permit:"asylum",level:""},
  {ec:"B672",name:"Yvonne Chanachimwe",branch:"Sea Point",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B673",name:"Pindiswa Mvinjelwa",branch:"Somerset West",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B674",name:"Panashe Mandizvidza",branch:"Kuils River",contract:"NO CONTRACT",permit:"asylum",level:""},
  {ec:"B675",name:"Buhle Vika",branch:"Somerset West",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B676",name:"Brita Nyamudo",branch:"Plumstead",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B677",name:"Faith Mudonhi",branch:"Kloof",contract:"Permanent",permit:"asylum",level:""},
  {ec:"B678",name:"Tavonga Mahaso",branch:"Kuils River",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B680",name:"Anesu Lisnet Kanduro",branch:"Plumstead",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B681",name:"Sinelizwe Rhozana",branch:"Riverlands",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B682",name:"Felicity Nosiphino Dita",branch:"Table Bay",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B683",name:"Lisa Meki",branch:"Somerset West",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B690",name:"Marvellous Mariko",branch:"Sandown",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B691",name:"Ntombizanele Thawuse",branch:"Claremont",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B692",name:"Zinam Gongxeka",branch:"Rondebosch",contract:"Permanent",permit:"sa_citizen",level:"Two"},
  {ec:"B693",name:"Sinazo Koni",branch:"Sea Point",contract:"Permanent",permit:"sa_citizen",level:""},
  {ec:"B695",name:"Renee Maswerera",branch:"Somerset West",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B696",name:"Monalisa Madzokere",branch:"Green Point",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B697",name:"Gugulethu Siwela",branch:"Table Bay",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B698",name:"Angela Malunga",branch:"Sandown",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B699",name:"Presley Teguru",branch:"Bree",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B700",name:"Courtney Tango",branch:"Westlake",contract:"NO CONTRACT",permit:"sa_citizen",level:""},
  {ec:"B701",name:"Tafadzwa Kuyeri",branch:"Westlake",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B702",name:"Esona Matiti",branch:"Plumstead",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B703",name:"Joey Nyakarize",branch:"Green Point",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B704",name:"Concilia Bure",branch:"Table Bay",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B705",name:"Shiela Gondo",branch:"Kuils River",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B714",name:"Deon Muzerengi",branch:"Durbanville",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B716",name:"Linda Beremauro",branch:"Durbanville",contract:"NO CONTRACT",permit:"asylum",level:"Two"},
  {ec:"B717",name:"Lisa Muzando",branch:"Kuils River",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B718",name:"Lucia Kore",branch:"Table Bay",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B719",name:"Monica Musviba",branch:"Table Bay",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B721",name:"Ntombozuko Guwata",branch:"Rondebosch",contract:"Permanent",permit:"sa_citizen",level:""},
  {ec:"B778",name:"Azama Damas",branch:"Rondebosch",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B722",name:"Oretha Kafumbe",branch:"Sandown",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B723",name:"Pamela Jantjies",branch:"Kuils River",contract:"Permanent",permit:"sa_citizen",level:""},
  {ec:"B729",name:"Zezethu",branch:"Bree",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B734",name:"Cynthia Smith",branch:"Westlake",contract:"NO CONTRACT",permit:"asylum",level:""},
  {ec:"B735",name:"Sharon Muungwa",branch:"Green Point",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B737",name:"Salomy Mlanga",branch:"Table Bay",contract:"Permanent",permit:"z_na",level:"One"},
  {ec:"B738",name:"Christabel Garande",branch:"Winelands",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B741",name:"Liona Ngido",branch:"Somerset West",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B747",name:"Ireen Dabengwa",branch:"Table Bay",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B749",name:"Chido Bingwa",branch:"Sea Point",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B750",name:"Amanda Tafirenyika",branch:"Sea Point",contract:"NO CONTRACT",permit:"asylum",level:""},
  {ec:"B751",name:"Monica Moyo",branch:"Sandown",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B752",name:"Lusanda Esther Mutombo",branch:"Plumstead",contract:"Permanent",permit:"asylum",level:""},
  {ec:"B759",name:"Mandisi Siziba",branch:"Somerset West",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B770",name:"Nolundi Metsiza",branch:"Sea Point",contract:"Permanent",permit:"sa_citizen",level:""},
  {ec:"B772",name:"PhaPhama Valashiya",branch:"Riverlands",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B773",name:"Samkelo Nkomo",branch:"Westlake",contract:"NO CONTRACT",permit:"z_na",level:"One"},
  {ec:"B774",name:"Sandra Murwira",branch:"Sandown",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B775",name:"Sesethu Ndaliso",branch:"Riverlands",contract:"NO CONTRACT",permit:"sa_citizen",level:"One"},
  {ec:"B788",name:"Shalom Gwiti",branch:"Kuils River",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B789",name:"Tanatswanash Mpangi",branch:"Westlake",contract:"Permanent",permit:"asylum",level:""},
  {ec:"B736",name:"Loice Moyo",branch:"Cape Gate",contract:"Permanent",permit:"asylum",level:""},
  {ec:"B799",name:"Learnmore",branch:"Cape Gate",contract:"Fixed Term",permit:"asylum",level:""},
  {ec:"B800",name:"Michelle Makwarimba",branch:"Cape Gate",contract:"NO CONTRACT",permit:"asylum",level:""},
  {ec:"B801",name:"Doris Katelara",branch:"Sea Point",contract:"NO CONTRACT",permit:"asylum",level:""},
  {ec:"B802",name:"Tshego Ketshegofaditso",branch:"Claremont",contract:"NO CONTRACT",permit:"z_na",level:""},
  {ec:"B805",name:"Wendy Njaju",branch:"Kloof",contract:"Permanent",permit:"sa_citizen",level:""},
  {ec:"B807",name:"Mihlali Ndamandama",branch:"Rondebosch",contract:"Permanent",permit:"sa_citizen",level:""},
  {ec:"B833",name:"Monica Mudzingwa",branch:"Sandown",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B834",name:"Sinazo Mpofana",branch:"Betty",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B835",name:"Agness Fusire",branch:"Riverlands",contract:"Fixed Term",permit:"asylum",level:""},
  {ec:"B836",name:"Nancy Chivambe",branch:"Betty",contract:"Fixed Term",permit:"asylum",level:"One"},
  {ec:"B837",name:"Tatenda Chivavayah",branch:"Kuils River",contract:"Fixed Term",permit:"asylum",level:"One"},
  {ec:"B838",name:"Delight Gonese",branch:"Betty",contract:"Fixed Term",permit:"asylum",level:"Two"},
  {ec:"B839",name:"Natasha Damba",branch:"Plumstead",contract:"NO CONTRACT",permit:"asylum",level:""},
  {ec:"B846",name:"Yolanda Sibanda",branch:"Betty",contract:"Fixed Term",permit:"asylum",level:""},
  {ec:"B847",name:"Munashe Mukombe",branch:"Durbanville",contract:"NO CONTRACT",permit:"asylum",level:"One"},
  {ec:"B848",name:"Rejoice Machoba",branch:"Betty",contract:"Fixed Term",permit:"asylum",level:"One"},
  {ec:"B849",name:"Kiara Mandimutsira",branch:"Sandown",contract:"Permanent",permit:"asylum",level:"One"},
  {ec:"B850",name:"Usisipho Majamani",branch:"Sea Point",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B851",name:"Stephanie Jason",branch:"Cape Gate",contract:"Permanent",permit:"sa_citizen",level:"One"},
  {ec:"B855",name:"Ayanda Lubisi",branch:"Durbanville",contract:"Permanent",permit:"sa_citizen",level:""},
  {ec:"B856",name:"Tariro Makore",branch:"Cape Gate",contract:"NO CONTRACT",permit:"asylum",level:""},
  {ec:"B857",name:"Valentine Murambiza",branch:"Somerset West",contract:"Permanent",permit:"z_na",level:""},
  {ec:"B858",name:"Gorgenia Mugomesa",branch:"Plumstead",contract:"Permanent",permit:"asylum",level:""},
  {ec:"B859",name:"Kimberly Makuyana",branch:"Plumstead",contract:"Permanent",permit:"verified_dha",level:""},
  {ec:"B860",name:"Blessing Nyamadzawa",branch:"Plumstead",contract:"Permanent",permit:"verified_dha",level:"One"},
  {ec:"B861",name:"Florence Svinurayi",branch:"Somerset West",contract:"Permanent",permit:"asylum",level:""},
  {ec:"B876",name:"Dorcas Likibi",branch:"Cape Gate",contract:"NO CONTRACT",permit:"asylum",level:""},
  // Trials / inductions
  {ec:"T001",name:"Asanda",branch:"Sea Point",contract:"2 Weeks",permit:"sa_citizen",level:"One"},
  {ec:"T002",name:"Asemahle Xobololo",branch:"Sea Point",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T003",name:"Logan Kelly",branch:"Sea Point",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T004",name:"Okuhle Gumede",branch:"Bree",contract:"2 Weeks",permit:"sa_citizen",level:"One"},
  {ec:"T005",name:"Zanele Nohesi",branch:"Kloof",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T006",name:"Amanda",branch:"Claremont",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T007",name:"Viyolwethu",branch:"Claremont",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T008",name:"Nicole Adams",branch:"Claremont",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T009",name:"Zukiswa Citi",branch:"Durbanville",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T010",name:"Andisiwe Ngqayimbana",branch:"Somerset West",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T011",name:"Xolelwa Cibi",branch:"Somerset West",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T012",name:"Zandile Mangele",branch:"Somerset West",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T013",name:"Anganathi Dayimani",branch:"Riverlands",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T014",name:"Queen Mkonto",branch:"Riverlands",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T015",name:"Andisiwe Moni",branch:"Kuils River",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T016",name:"Unathi Jordaan",branch:"Kuils River",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T017",name:"Collina Landule",branch:"Kuils River",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T018",name:"Viwe",branch:"Table Bay",contract:"2 Weeks",permit:"sa_citizen",level:"One"},
  {ec:"T019",name:"Othandwayo",branch:"Table Bay",contract:"2 Weeks",permit:"sa_citizen",level:""},
  {ec:"T023",name:"Emmerentia McKnight",branch:"Westlake",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T024",name:"Philela Makubalo",branch:"Westlake",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T025",name:"Thandiwe Tshayisa",branch:"Westlake",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T027",name:"Zikhona Sebolai",branch:"Somerset West",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T028",name:"Nadine Van Wyk",branch:"Cape Gate",contract:"2 Weeks",permit:"sa_citizen",level:"One"},
  {ec:"T029",name:"Dumisa Ngwase",branch:"Cape Gate",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T030",name:"Olona Jekwa",branch:"Cape Gate",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T031",name:"Khasha Malgas",branch:"Winelands",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T032",name:"Dorrine Galant",branch:"Winelands",contract:"Induction",permit:"sa_citizen",level:""},
  {ec:"T033",name:"Consetar Moyo",branch:"Winelands",contract:"Induction",permit:"verified_dha",level:""},
  {ec:"T036",name:"Lindelwa",branch:"Betty",contract:"2 Weeks",permit:"sa_citizen",level:""},
];

// ─── TINY COMPONENTS ─────────────────────────────────────────────────────────────
function Chip({ bg, color, border, children }) {
  return <span style={{ background:bg, color, border:`1px solid ${border}`, borderRadius:20, padding:"3px 10px", fontSize:11, fontWeight:700, whiteSpace:"nowrap", display:"inline-flex", alignItems:"center", gap:4 }}>{children}</span>;
}
const CompBadge = ({ permit }) => { const c = COMPLIANCE[permit]||COMPLIANCE.z_na; return <Chip bg={c.bg} color={c.color} border={c.border}>{c.icon} {c.label}</Chip>; };
const LevelBadge = ({ level }) => {
  if (!level) return <span style={{ color:"#d1d5db", fontSize:11 }}>—</span>;
  const m = { One:["#e0e7ff","#3730a3"], Two:["#ede9fe","#5b21b6"], Three:["#cffafe","#155e75"] };
  const [bg, c] = m[level]||["#f3f4f6","#374151"];
  return <span style={{ background:bg, color:c, borderRadius:6, padding:"3px 9px", fontSize:11, fontWeight:700 }}>{level}</span>;
};
function Meter({ current, capacity, goal, lowDemand }) {
  const target = goal || capacity;
  const pct = Math.min(current/target*100,100);
  const col = current===0?"#dc2626":current<target*0.6?"#f97316":current<target?"#eab308":"#16a34a";
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, fontWeight:700, marginBottom:3, color:current>=target?"#15803d":"#9a3412" }}>
        <span>{current} / {target} active{lowDemand?" (target)":""}</span>
        <span>{current>=target?"✓ Sufficient":`${target-current} needed`}</span>
      </div>
      <div style={{ height:7, borderRadius:99, background:"#e5e7eb", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:col, borderRadius:99, transition:"width .4s" }} />
      </div>
    </div>
  );
}

// ─── MATERNITY MODAL ─────────────────────────────────────────────────────────────
function MatModal({ rec, onClose, onSave, onDelete }) {
  const [f, setF] = useState({ ...rec });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const inp = { width:"100%", padding:"8px 11px", borderRadius:8, border:"1px solid #FBCFE8", background:"#FCE7F3", fontFamily:"inherit", fontSize:13, boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:10, fontWeight:700, color:"#BE185D", letterSpacing:"0.08em", marginBottom:4, textTransform:"uppercase" };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:"#FFFFFF", borderRadius:22, width:"min(520px,96vw)", maxHeight:"90vh", overflowY:"auto", padding:"30px 28px", boxShadow:"0 30px 90px rgba(0,0,0,.22)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h2 style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:24, color:"#111827", margin:0 }}>{!rec._id?"Add Record":"Edit Maternity Record"}</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:24, cursor:"pointer", color:"#9ca3af" }}>×</button>
        </div>

        {/* Status explanation */}
        <div style={{ background:"#FCE7F3", border:"1px solid #fde68a", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:12, color:"#831843", lineHeight:1.5 }}>
          <strong>🤰 Pregnant</strong> = still working in the store, counts toward staffing.<br/>
          <strong>🤱 On Maternity Leave</strong> = not in the store, <em>excluded</em> from the store's active count.
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:13 }}>
          <div><label style={lbl}>EC Code</label><input style={inp} value={f.ec} onChange={e=>set("ec",e.target.value)} placeholder="e.g. B585" /></div>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Full Name</label><input style={inp} value={f.name} onChange={e=>set("name",e.target.value)} /></div>
          <div>
            <label style={lbl}>Branch</label>
            <select style={inp} value={f.branch} onChange={e=>set("branch",e.target.value)}>
              {SALONS.map(s=><option key={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Status</label>
            <select style={inp} value={f.matStatus} onChange={e=>set("matStatus",e.target.value)}>
              <option value="on_mat">🤱 On Maternity Leave (excluded from count)</option>
              <option value="pregnant">🤰 Pregnant – Still at Work (counted in)</option>
              <option value="returned">✅ Returned to Work</option>
              <option value="sick_leave">🏥 Sick Leave</option>
            </select>
          </div>
          <div><label style={lbl}>Maternity Start Date</label><input type="date" style={inp} value={f.matStart||""} onChange={e=>set("matStart",e.target.value||null)} /></div>
          <div><label style={lbl}>Maternity End Date</label><input type="date" style={inp} value={f.matEnd||""} onChange={e=>set("matEnd",e.target.value||null)} /></div>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Expected Return to Work</label><input type="date" style={inp} value={f.returnDate||""} onChange={e=>set("returnDate",e.target.value||null)} /></div>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Notes</label><textarea style={{ ...inp, minHeight:70, resize:"vertical" }} value={f.notes||""} onChange={e=>set("notes",e.target.value)} /></div>
        </div>
        <div style={{ display:"flex", gap:10, marginTop:22, justifyContent:"space-between", alignItems:"center" }}>
          {rec._id && <button onClick={()=>{ if(confirm("Delete this record?")) onDelete(rec._id); }} style={{ padding:"9px 16px", borderRadius:9, border:"none", background:"#FBCFE8", color:"#BE185D", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>Delete</button>}
          <div style={{ display:"flex", gap:10, marginLeft:"auto" }}>
            <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:9, border:"1px solid #FBCFE8", background:"#FFFFFF", cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>Cancel</button>
            <button onClick={()=>onSave(f)} style={{ padding:"9px 22px", borderRadius:9, border:"none", background:"#BE185D", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── STAFF MODAL ──────────────────────────────────────────────────────────────────
function StaffModal({ s, onClose, onSave, onTransfer, allStaff }) {
  // Split existing "name" into firstName / surname for the form. New records
  // start blank. Combined back into `name` on save.
  const splitName = (full) => {
    const t = (full || "").trim();
    if (!t) return { firstName:"", surname:"" };
    const i = t.indexOf(" ");
    if (i < 0) return { firstName:t, surname:"" };
    return { firstName:t.slice(0,i), surname:t.slice(i+1).trim() };
  };
  const initial = splitName(s.name);
  const [f, setF] = useState({ ...s, firstName:initial.firstName, surname:initial.surname, position:s.position || s.level || "" });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const inp = { width:"100%", padding:"8px 11px", borderRadius:8, border:"1px solid #FBCFE8", background:"#FCE7F3", fontFamily:"inherit", fontSize:13, color:"#111827", boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:10, fontWeight:700, color:"#BE185D", letterSpacing:"0.08em", marginBottom:4, textTransform:"uppercase" };

  // Check for duplicate EC in a different record
  const dupInOtherBranch = allStaff.find(x =>
    x.ec.trim().toUpperCase() === f.ec.trim().toUpperCase() && x._id !== f._id
  );

  // Required-field validation
  const missing = [];
  if (!(f.firstName || "").trim()) missing.push("First name");
  if (!(f.surname   || "").trim()) missing.push("Surname");
  if (!(f.startDate || "").trim()) missing.push("Start date");
  if (!(f.position  || "").trim()) missing.push("Position");
  const blockSave = !!dupInOtherBranch || missing.length > 0;

  const submit = () => {
    if (blockSave) return;
    const fullName = (f.firstName.trim() + " " + f.surname.trim()).trim();
    const out = { ...f, name: fullName, level: f.position };
    delete out.firstName;
    delete out.surname;
    onSave(out);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:"#FFFFFF", borderRadius:22, width:"min(520px,96vw)", maxHeight:"90vh", overflowY:"auto", padding:"30px 28px", boxShadow:"0 30px 90px rgba(0,0,0,.22)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <h2 style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:24, color:"#111827", margin:0 }}>{!s._id?"Add Staff":"Edit Staff"}</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:24, cursor:"pointer", color:"#9ca3af" }}>×</button>
        </div>

        {dupInOtherBranch && (
          <div style={{ background:"#FBCFE8", border:"1px solid #fca5a5", borderRadius:10, padding:"11px 14px", marginBottom:14, fontSize:12, color:"#831843" }}>
            🚫 <strong>Duplicate EC</strong> — <strong>{dupInOtherBranch.name}</strong> already has EC <strong>{f.ec}</strong> at <strong>{dupInOtherBranch.branch}</strong>. Use a different EC code.
          </div>
        )}
        {missing.length > 0 && (
          <div style={{ background:"#fef3c7", border:"1px solid #fbbf24", borderRadius:10, padding:"11px 14px", marginBottom:14, fontSize:12, color:"#78350f" }}>
            ⚠ <strong>Required:</strong> {missing.join(", ")}
          </div>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:13 }}>
          <div><label style={lbl}>EC Code</label>
            <input style={{ ...inp, border:`1px solid ${dupInOtherBranch?"#fca5a5":"#d1d5db"}`, background:dupInOtherBranch?"#FAEEF1":"#f9fafb" }}
              value={f.ec} onChange={e=>set("ec",e.target.value)} /></div>
          <div><label style={lbl}>First Name *</label>
            <input style={inp} value={f.firstName} onChange={e=>set("firstName",e.target.value)} placeholder="e.g. Thandi" /></div>
          <div><label style={lbl}>Surname *</label>
            <input style={inp} value={f.surname} onChange={e=>set("surname",e.target.value)} placeholder="e.g. Mokoena" /></div>
          <div><label style={lbl}>Branch</label>
            <select style={inp} value={f.branch} onChange={e=>set("branch",e.target.value)}>
              {SALONS.map(s=><option key={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Position *</label>
            <select style={inp} value={f.position||""} onChange={e=>set("position",e.target.value)}>
              <option value="">—</option>
              <option>One</option>
              <option>Two</option>
              <option>Three</option>
              <option>Trainee</option>
            </select>
          </div>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Start Date * {f.startDate && (() => {
            const d = new Date(f.startDate + "T00:00:00");
            const days = Math.floor((Date.now() - d) / 86400000);
            const yrs = (days / 365).toFixed(1);
            return <span style={{ fontWeight:600, color:"#9ca3af", letterSpacing:0, textTransform:"none", marginLeft:8 }}>· {days < 365 ? days + " days" : yrs + " yrs"} tenure</span>;
          })()}</label>
            <input type="date" style={inp} value={f.startDate||""} onChange={e=>set("startDate",e.target.value||null)} />
          </div>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Contract</label>
            <select style={inp} value={f.contract} onChange={e=>set("contract",e.target.value)}>
              <option>Permanent</option><option>Fixed Term</option><option>3 Month</option><option>NO CONTRACT</option><option>2 Weeks</option><option>Induction</option>
            </select>
          </div>
          <div style={{ gridColumn:"1/-1", background:"#FCE7F3", borderRadius:12, padding:"14px 16px", border:"1px solid #FBCFE8" }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#BE185D", marginBottom:10, textTransform:"uppercase", letterSpacing:"0.08em" }}>Compliance / Work Status</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7 }}>
              {Object.entries(COMPLIANCE).map(([k,c]) => (
                <label key={k} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 11px", borderRadius:9, border:`2px solid ${f.permit===k?c.border:"#e5e7eb"}`, background:f.permit===k?c.bg:"#fff", cursor:"pointer" }}>
                  <input type="radio" checked={f.permit===k} onChange={()=>set("permit",k)} style={{ display:"none" }} />
                  <span style={{ fontSize:16 }}>{c.icon}</span>
                  <span style={{ fontSize:11, fontWeight:700, color:f.permit===k?c.color:"#831843" }}>{c.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:10, marginTop:22, justifyContent:"space-between", alignItems:"center" }}>
          {s._id !== undefined && (
            <button onClick={()=>{ onClose(); onTransfer(s); }}
              style={{ padding:"9px 16px", borderRadius:9, border:"none", background:"#BE185D", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>
              🔄 Transfer Branch
            </button>
          )}
          <div style={{ display:"flex", gap:10, marginLeft:"auto" }}>
            <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:9, border:"1px solid #FBCFE8", background:"#FFFFFF", cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>Cancel</button>
            <button onClick={submit} disabled={blockSave}
              style={{ padding:"9px 22px", borderRadius:9, border:"none", background:blockSave?"#d1d5db":"#b45309", color:"#fff", cursor:blockSave?"not-allowed":"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TRANSFER MODAL ───────────────────────────────────────────────────────────────
function TransferModal({ s, onClose, onConfirm, onCancelTransfer }) {
  // If this person already has a pending transfer, pre-fill the form
  const isEditing = !!s.transferring && !s.isShadow;
  const [toBranch,     setToBranch]     = useState(s.transferTo || SALONS.find(sl=>sl.name!==s.branch)?.name || "");
  const [transferDate, setTransferDate] = useState(s.transferDate || "");
  const [note,         setNote]         = useState(s.transferNote || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inp = { width:"100%", padding:"8px 11px", borderRadius:8, border:"1px solid #FBCFE8", background:"#FCE7F3", fontFamily:"inherit", fontSize:13, boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:10, fontWeight:700, color:"#BE185D", letterSpacing:"0.08em", marginBottom:4, textTransform:"uppercase" };
  const isPending = transferDate && new Date(transferDate) > new Date("2026-04-27");

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:"#FFFFFF", borderRadius:22, width:"min(500px,96vw)", padding:"30px 28px", boxShadow:"0 30px 90px rgba(0,0,0,.25)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <h2 style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:24, color:"#111827", margin:0 }}>
            {isEditing ? "✏️ Edit Transfer" : "🔄 Branch Transfer"}
          </h2>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:24, cursor:"pointer", color:"#9ca3af" }}>×</button>
        </div>

        {/* Existing transfer banner */}
        {isEditing && (
          <div style={{ background:"#FBCFE8", border:"1px solid #7dd3fc", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:12, color:"#0c4a6e" }}>
            ✏️ <strong>Editing existing transfer</strong> — currently scheduled to move to <strong>{s.transferTo}</strong> on <strong>{s.transferDate ? new Date(s.transferDate).toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"}) : "—"}</strong>.<br/>
            Update the fields below and save, or delete the transfer entirely.
          </div>
        )}

        {/* Staff summary */}
        <div style={{ background:"#F5E1E7", border:"1px solid #7dd3fc", borderRadius:10, padding:"12px 14px", marginBottom:18 }}>
          <div style={{ fontWeight:700, fontSize:13, color:"#0c4a6e" }}>{s.name} <span style={{ fontFamily:"monospace", fontSize:11, color:"#BE185D" }}>({s.ec})</span></div>
          <div style={{ fontSize:11, color:"#BE185D", marginTop:3 }}>Currently at: <strong>{s.branch}</strong></div>
        </div>

        <div style={{ display:"grid", gap:13 }}>
          <div>
            <label style={lbl}>Transfer To Branch</label>
            <select style={inp} value={toBranch} onChange={e=>setToBranch(e.target.value)}>
              {SALONS.filter(sl=>sl.name!==s.branch).map(sl=><option key={sl.name}>{sl.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Transfer Date</label>
            <input type="date" style={inp} value={transferDate} onChange={e=>setTransferDate(e.target.value)} />
            {transferDate && (
              <div style={{ fontSize:11, marginTop:5, fontWeight:700, color:isPending?"#0369a1":"#065f46" }}>
                {isPending
                  ? `⏳ Pending — staff member shows on BOTH branches until ${new Date(transferDate).toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"})}`
                  : `✅ Effective immediately — moves to ${toBranch} now`}
              </div>
            )}
          </div>
          <div>
            <label style={lbl}>Notes (optional)</label>
            <input style={inp} value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. covering for maternity leave" />
          </div>
        </div>

        {/* Preview */}
        {toBranch && transferDate && (
          <div style={{ background:isPending?"#fef3c7":"#d1fae5", border:`1px solid ${isPending?"#fde68a":"#6ee7b7"}`, borderRadius:10, padding:"11px 14px", marginTop:14, fontSize:12, color:isPending?"#78350f":"#065f46" }}>
            {isPending ? (
              <>
                <strong>📋 What will happen:</strong><br/>
                • <strong>{s.name}</strong> stays visible on <strong>{s.branch}</strong> with a 🔄 "Transferring out" badge<br/>
                • Also appears on <strong>{toBranch}</strong> with a 🔄 "Arriving" badge<br/>
                • Neither branch counts them toward active headcount during transition
              </>
            ) : (
              <>
                <strong>✅ What will happen:</strong><br/>
                • <strong>{s.name}</strong> moves immediately from <strong>{s.branch}</strong> to <strong>{toBranch}</strong><br/>
                • They count toward {toBranch}&apos;s active headcount from today
              </>
            )}
          </div>
        )}

        {/* Inline delete confirmation — no window.confirm needed */}
        {isEditing && confirmDelete && (
          <div style={{ background:"#FBCFE8", border:"1px solid #fca5a5", borderRadius:10, padding:"12px 14px", marginTop:14, fontSize:12, color:"#831843" }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>⚠️ Are you sure you want to delete this transfer?</div>
            <div style={{ marginBottom:10 }}>This will remove all transfer badges and keep <strong>{s.name}</strong> at <strong>{s.branch}</strong>.</div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>onCancelTransfer(s)}
                style={{ padding:"7px 16px", borderRadius:8, border:"none", background:"#991b1b", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>
                Yes, Delete Transfer
              </button>
              <button onClick={()=>setConfirmDelete(false)}
                style={{ padding:"7px 14px", borderRadius:8, border:"1px solid #FBCFE8", background:"#FFFFFF", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>
                No, Keep It
              </button>
            </div>
          </div>
        )}

        <div style={{ display:"flex", gap:10, marginTop:22, justifyContent:"space-between", alignItems:"center" }}>
          {/* Delete transfer button — only shown when editing */}
          {isEditing && !confirmDelete && (
            <button onClick={()=>setConfirmDelete(true)}
              style={{ padding:"9px 16px", borderRadius:9, border:"none", background:"#FBCFE8", color:"#831843", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>
              🗑 Delete Transfer
            </button>
          )}
          <div style={{ display:"flex", gap:10, marginLeft:"auto" }}>
            <button onClick={onClose} style={{ padding:"9px 20px", borderRadius:9, border:"1px solid #FBCFE8", background:"#FFFFFF", cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>Cancel</button>
            <button onClick={()=>toBranch&&transferDate&&onConfirm({ staff:s, toBranch, transferDate, note, isPending })}
              disabled={!toBranch||!transferDate}
              style={{ padding:"9px 22px", borderRadius:9, border:"none", background:!toBranch||!transferDate?"#d1d5db":"#0c4a6e", color:"#fff", cursor:!toBranch||!transferDate?"not-allowed":"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>
              {isEditing ? "💾 Save Changes" : isPending ? "Schedule Transfer" : "Confirm Transfer Now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MANAGER MODAL ────────────────────────────────────────────────────────────────
function ManagerModal({ m, pin, onClose, onSave, onDelete }) {
  const [f, setF] = useState(m);
  const [pinInput, setPinInput] = useState(pin || "");
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const inp = { width:"100%", padding:"8px 11px", borderRadius:8, border:"1px solid #FBCFE8", background:"#FCE7F3", fontFamily:"inherit", fontSize:13, color:"#111827", boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:10, fontWeight:700, color:"#BE185D", letterSpacing:"0.08em", marginBottom:4, textTransform:"uppercase" };
  const isNew = f._id === undefined;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:"#FFFFFF", borderRadius:22, width:"min(460px,96vw)", maxHeight:"90vh", overflowY:"auto", padding:"28px 26px", boxShadow:"0 30px 90px rgba(0,0,0,.25)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h2 style={{ fontFamily:"'Playfair Display',serif", fontSize:22, color:"#8E5570", margin:0 }}>
            {isNew?"Add Manager":"Edit Manager"}
          </h2>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:24, cursor:"pointer", color:"#9ca3af" }}>×</button>
        </div>
        <div style={{ display:"grid", gap:13 }}>
          <div><label style={lbl}>EC Code</label>
            <input style={inp} value={f.ec} onChange={e=>set("ec",e.target.value)} placeholder="e.g. B185M" /></div>
          <div><label style={lbl}>Full Name</label>
            <input style={inp} value={f.name} onChange={e=>set("name",e.target.value)} /></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div><label style={lbl}>Branch</label>
              <select style={inp} value={f.branch} onChange={e=>set("branch",e.target.value)}>
                {SALONS.map(s=><option key={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Role</label>
              <select style={inp} value={f.role} onChange={e=>set("role",e.target.value)}>
                <option value="SM">👑 Store Manager (SM)</option>
                <option value="AM">⭐ Assistant Manager (AM)</option>
              </select>
            </div>
          </div>
          <div><label style={lbl}>Notes</label>
            <input style={inp} value={f.notes||""} onChange={e=>set("notes",e.target.value)} placeholder="e.g. Transfer from Sandown, Pregnant..." /></div>
          <div>
            <label style={lbl}>Personal Clock-in PIN <span style={{ fontWeight:500, color:"#9CA3AF", letterSpacing:0, textTransform:"none", marginLeft:4 }}>(6 digits — used in the check-in app)</span></label>
            <input
              style={{ ...inp, fontFamily:"monospace", letterSpacing:"0.2em", fontSize:14 }}
              value={pinInput}
              maxLength={6}
              inputMode="numeric"
              placeholder="6-digit PIN"
              onChange={e=>setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            {pinInput && pinInput.length !== 6 && (
              <div style={{ fontSize:11, color:"#dc2626", marginTop:4 }}>PIN must be exactly 6 digits (or empty to clear).</div>
            )}
          </div>
          <div><label style={lbl}>Start Date {f.startDate && (() => {
            const d = new Date(f.startDate + "T00:00:00");
            const days = Math.floor((Date.now() - d) / 86400000);
            const yrs = (days / 365).toFixed(1);
            return <span style={{ fontWeight:600, color:"#9ca3af", letterSpacing:0, textTransform:"none", marginLeft:8 }}>· {days < 365 ? days + " days" : yrs + " yrs"} tenure</span>;
          })()}</label>
            <input type="date" style={inp} value={f.startDate||""} onChange={e=>set("startDate",e.target.value||null)} />
          </div>
          <div><label style={lbl}>Contract</label>
            <select style={inp} value={f.contract} onChange={e=>set("contract",e.target.value)}>
              <option>Permanent</option><option>Fixed Term</option><option>3 Month</option>
            </select>
          </div>
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ ...lbl, marginBottom:8 }}>Maternity Status</label>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10 }}>
              {[
                { val:"active",    icon:"✅", label:"Active",           desc:"Working normally",              border:"#86efac", bg:"#f0fdf4", col:"#15803d" },
                { val:"pregnant",  icon:"🤰", label:"Pregnant",         desc:"Still at work, leave upcoming", border:"#fde68a", bg:"#fffbeb", col:"#92400e" },
                { val:"on_mat",    icon:"🤱", label:"On Maternity",     desc:"Currently on leave",            border:"#fbcfe8", bg:"#fdf4ff", col:"#7A4258" },
              ].map(opt=>{
                const selected = (f.matStatus||"active")===opt.val;
                return (
                  <label key={opt.val} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"10px 8px", borderRadius:10, border:`2px solid ${selected?opt.border:"#e5e7eb"}`, background:selected?opt.bg:"#f9fafb", cursor:"pointer", textAlign:"center" }}>
                    <input type="radio" checked={selected} onChange={()=>{ set("matStatus",opt.val); if(opt.val==="active"){ set("onMat",false); set("pregnant",false); } else if(opt.val==="pregnant"){ set("onMat",false); set("pregnant",true); } else { set("onMat",true); set("pregnant",false); } }}
                      style={{ display:"none" }} />
                    <span style={{ fontSize:20 }}>{opt.icon}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:selected?opt.col:"#374151" }}>{opt.label}</span>
                    <span style={{ fontSize:9, color:selected?opt.col:"#9ca3af" }}>{opt.desc}</span>
                  </label>
                );
              })}
            </div>

            {/* Pregnant — show expected leave start date */}
            {(f.matStatus||"active")==="pregnant" && (
              <div style={{ background:"#FFFFFF", border:"1px solid #fde68a", borderRadius:9, padding:"12px 14px", marginTop:4 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8E5570", marginBottom:8 }}>🤰 Upcoming Maternity Details</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div><label style={lbl}>Expected Leave Start Date</label>
                    <input type="date" style={inp} value={f.matStart||""} onChange={e=>set("matStart",e.target.value)} /></div>
                  <div><label style={lbl}>Expected Return Date</label>
                    <input type="date" style={inp} value={f.matReturn||""} onChange={e=>set("matReturn",e.target.value)} /></div>
                  <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Notes</label>
                    <input style={inp} value={f.matNotes||""} onChange={e=>set("matNotes",e.target.value)} placeholder="e.g. due mid-July, cover needed from June" /></div>
                </div>
              </div>
            )}

            {/* On maternity — show return date */}
            {(f.matStatus||"active")==="on_mat" && (
              <div style={{ background:"#F5E1E7", border:"1px solid #FBCFE8", borderRadius:9, padding:"12px 14px", marginTop:4 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#8E5570", marginBottom:8 }}>🤱 Maternity Leave Details — greyed out in cards, not counted in coverage</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div><label style={lbl}>Leave Start Date</label>
                    <input type="date" style={inp} value={f.matStart||""} onChange={e=>set("matStart",e.target.value)} /></div>
                  <div><label style={lbl}>Return Date</label>
                    <input type="date" style={inp} value={f.matReturn||""} onChange={e=>set("matReturn",e.target.value)} /></div>
                  <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Notes</label>
                    <input style={inp} value={f.matNotes||""} onChange={e=>set("matNotes",e.target.value)} placeholder="e.g. expected return June 2026" /></div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ display:"flex", gap:10, marginTop:22, justifyContent:"space-between", alignItems:"center" }}>
          {!isNew && (
            <button onClick={()=>onDelete(f._id)}
              style={{ padding:"9px 14px", borderRadius:9, border:"none", background:"#FBCFE8", color:"#831843", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>
              🗑 Remove
            </button>
          )}
          <div style={{ display:"flex", gap:10, marginLeft:"auto" }}>
            <button onClick={onClose} style={{ padding:"9px 18px", borderRadius:9, border:"1px solid #FBCFE8", background:"#FFFFFF", cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>Cancel</button>
            <button onClick={()=>{
              if (!f.name) return;
              if (pinInput && pinInput.length !== 6) { alert("Personal PIN must be exactly 6 digits, or left empty."); return; }
              // Pass the PIN value (could be the same as before, a new one, or empty to clear)
              onSave(f, pinInput);
            }}
              disabled={!f.name}
              style={{ padding:"9px 22px", borderRadius:9, border:"none", background:!f.name?"#d1d5db":"#1e293b", color:"#fff", cursor:!f.name?"not-allowed":"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>
              {isNew?"Add Manager":"Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SCHEDULE EDITOR (Phase 2a — manual editing, save to Supabase) ──────────────
function Schedule({ allStaff }) {
  const [branch, setBranch] = useState(SALONS[0].name);
  const [ym, setYm] = useState(window.BOA_DB ? window.BOA_DB.currentSchedYm() : "2026-05");
  const [grid, setGrid] = useState({});
  const [savedAt, setSavedAt] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  // Drag-and-drop state — { ec, day, value, weekIdx } when a cell is being dragged
  const [dragSource, setDragSource] = useState(null);
  // Version history modal state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVersions, setHistoryVersions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const v = await window.BOA_DB.loadScheduleHistory(branch, ym, false);
      setHistoryVersions(Array.isArray(v) ? v : []);
    } catch (e) {
      console.error("loadScheduleHistory:", e);
      setHistoryVersions([]);
    } finally { setHistoryLoading(false); }
  }
  async function restoreVersion(idx) {
    const v = historyVersions[idx];
    if (!v) return;
    const ts = v.savedAt ? new Date(v.savedAt).toLocaleString() : "this snapshot";
    if (!confirm(
      "Restore the version saved on " + ts + "?\n\n" +
      "Your current schedule will be backed up to history first, then this older version will replace it on screen. " +
      "You'll still need to click Save to commit the restored version."
    )) return;
    setGrid(v.grid || {});
    setDirty(true);
    setHistoryOpen(false);
  }

  useEffect(() => {
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    setLoading(true);
    window.BOA_DB.loadSchedule(branch, ym, false).then((d) => {
      setGrid((d && d.grid) || {});
      setSavedAt((d && d.savedAt) || null);
      setDirty(false);
      setLoading(false);
    });
  }, [branch, ym]);

  const days = window.BOA_DB ? window.BOA_DB.periodDays(ym) : [];
  const periodLbl = window.BOA_DB ? window.BOA_DB.periodLabel(ym) : "";

  // All scheduled staff at this branch — actively-working first (sorted by EC),
  // then on-maternity-leave at the bottom (also sorted by EC). On-mat staff
  // remain visible so the manager can see who's away, but they're greyed out
  // and excluded from the auto-fill algorithm.
  const techs = useMemo(() => allStaff
    .filter(s => s.branch === branch && !s.leftDate && !s.isShadow)
    .sort((a, b) => {
      const am = a.onMat ? 1 : 0;
      const bm = b.onMat ? 1 : 0;
      if (am !== bm) return am - bm;                       // active before on-mat
      return (a.ec || "").localeCompare(b.ec || "");
    }), [allStaff, branch]);

  const cycle = ["W","WL","O","R","L","E","X",""];
  const cellStyle = (z) => {
    if (z === "W")  return { background:"#dcfce7", color:"#14532d" };
    if (z === "WL") return { background:"#86efac", color:"#14532d" };
    if (z === "O")  return { background:"#fee2e2", color:"#991b1b" };
    if (z === "R")  return { background:"#fca5a5", color:"#7f1d1d" };
    if (z === "L")  return { background:"#cbd5e1", color:"#475569" };
    if (z === "E")  return { background:"#6ee7b7", color:"#064e3b" };
    if (z === "X")  return { background:"#f3f4f6", color:"#9ca3af", fontStyle:"italic", fontWeight:500 };
    return { background:"#fff", color:"#9ca3af" };
  };

  function setCell(ec, day, val) {
    setGrid(g => {
      const next = { ...g };
      const ecRow = { ...(next[ec] || {}) };
      if (val) ecRow[day] = val; else delete ecRow[day];
      if (Object.keys(ecRow).length === 0) delete next[ec]; else next[ec] = ecRow;
      return next;
    });
    setDirty(true);
  }
  function cycleCell(ec, day) {
    const cur = (grid[ec] || {})[day] || "";
    const idx = cycle.indexOf(cur);
    const nxt = cycle[(idx + 1) % cycle.length];
    setCell(ec, day, nxt);
  }
  function clearAll() {
    if (!confirm("Clear all entries for this period? Cannot be undone after Save.")) return;
    setGrid({}); setDirty(true);
  }

  // ── Auto-fill: greedy scheduler implementing the full BOA rule set ────
  // Rules encoded (in order of application):
  //  1. Sunday rotation HARD — every staff off every second Sunday (A/B 50/50)
  //  2. Min-staffing per day  — Fri/Sat ≈85%, Wed/Thu/Sun ≈60%, Mon/Tue ≈45%, +5% in busy period
  //  3. Sunday min ≈40% of headcount (rotation respected even if dips coverage)
  //  4. Station capacity HARD — techs/day ≤ (mani + pedi) physical stations (extras get pushed off)
  //  5. 2 off-days/week (HARD), exactly 1 off-day in the staff's designated 6-day busy week
  //  6. Off-day preference: Mon/Tue → Wed/Thu → Sun, avoid Fri/Sat where coverage permits
  //  7. Weekday flexibility: short of off-days? Fill from Mon-Thu, NEVER Sunday
  //  8. Day-off requests HARD — applied as R, override everything else
  async function autoFill() {
    if (Object.keys(grid).length > 0 && !confirm("Replace existing schedule with auto-generated one? Day-off requests will be honoured. Existing manual entries will be lost.")) return;

    // Fetch day-off requests for this branch/period
    let dayRequests = [];
    try {
      const r = await window.BOA_DB.sb.from("app_state").select("value").eq("key", "boa_offreq_" + branch + "_" + ym).maybeSingle();
      dayRequests = (r.data && r.data.value) || [];
    } catch (e) { console.warn("Could not load day requests:", e); }

    const salon = salonForBranch;
    // HARD station cap = mani + pedi stations physically available at the salon.
    // We never schedule more techs working than there are stations to seat them.
    const capacity = (salon.mani || 0) + (salon.pedi || 0);

    // Group weeks (Mon-Sun)
    const weeks = [];
    let cur = [];
    days.forEach(d => {
      cur.push(d);
      if (d.dow === 0) { weeks.push(cur); cur = []; }
    });
    if (cur.length) weeks.push(cur);

    // Active techs only (exclude staff currently on maternity leave) — they
    // don't count toward coverage targets and shouldn't get scheduled days.
    // We'll mark their grid rows as Leave separately at the end.
    const sortedTechs = [...techs]
      .filter(t => !t.onMat)
      .sort((a,b) => (a.ec || "").localeCompare(b.ec || ""));
    const onMatTechs = techs.filter(t => t.onMat);
    const totalStaff = sortedTechs.length;
    const sundayGroup = {};
    sortedTechs.forEach((s, i) => { sundayGroup[s.ec] = (i % 2 === 0) ? "A" : "B"; });

    // Identify busy-period weeks (full weeks that contain prev-month-25→6 of current)
    const ymP = ym.split("-").map(Number);
    const curMonth = ymP[1], prevMonth = (curMonth === 1) ? 12 : curMonth - 1;
    const isBusyDay = (d) => {
      const m = d.monthIdx + 1;
      if (m === prevMonth && d.d >= 25) return true;
      if (m === curMonth && d.d <= 6)   return true;
      return false;
    };
    // Designation candidates — preference order:
    //   1. Full weeks that overlap the busy period (25th–6th, peak revenue)
    //   2. Otherwise the earliest full weeks (later weeks = less revenue, avoid)
    const fullWeekMeta = weeks
      .map((w, i) => ({ i, full: w.length === 7, hasBusy: w.some(isBusyDay) }))
      .filter(x => x.full);
    const busyWeekIndices = fullWeekMeta.filter(x => x.hasBusy).map(x => x.i);
    const fallbackWeekIndices = fullWeekMeta.filter(x => !x.hasBusy).sort((a,b)=>a.i-b.i).map(x => x.i);
    const designatedCandidates = busyWeekIndices.length > 0 ? busyWeekIndices : fallbackWeekIndices;

    // 6-day week designation — EXACT match to the original `c1`.
    // KEY: pool is ALL FULL WEEKS (sorted by busy-day count DESC), NOT only
    // busy weeks. Some techs naturally fall through to non-busy weeks when
    // the busy ones hit the 35% per-week cap. This is what allows "some
    // people to work their 6-day week later in the month, not just during
    // busy period." Branches that opt out entirely: Table Bay, Sandown.
    const NO_SIX_DAY_BRANCHES = new Set(["Table Bay", "Sandown"]);
    const designatedBusyWeek = {};
    if (!NO_SIX_DAY_BRANCHES.has(branch)) {
      const allFullWeeks = weeks.map((w, i) => ({ w, i })).filter(x => x.w.length >= 7).map(x => x.i);
      const busyDayCount = (wIdx) => weeks[wIdx].filter(d => isBusyDay(d)).length;
      const wkCount = {};
      const perWeekCap = Math.max(2, Math.ceil(sortedTechs.length * 0.35));
      sortedTechs.forEach((s) => {
        if (allFullWeeks.length === 0) { designatedBusyWeek[s.ec] = -1; return; }
        const grp = sundayGroup[s.ec];
        // Eligible: weeks where this tech WORKS the Sunday (rotation A/B per wIdx parity)
        const eligible = allFullWeeks.filter(wIdx => ((wIdx % 2 === 0) ? "A" : "B") !== grp);
        if (eligible.length === 0) return;                      // skip; no designation
        // Sort by busy-day-count DESC — busy weeks tried first
        const sorted = [...eligible].sort((a, b) => busyDayCount(b) - busyDayCount(a));
        let picked = null;
        for (const wIdx of sorted) {
          if (!wkCount[wIdx]) wkCount[wIdx] = 0;
          if (wkCount[wIdx] < perWeekCap) { picked = wIdx; break; }
        }
        if (picked == null) {
          // All capped — pick least-loaded
          let least = sorted[0];
          for (const wIdx of sorted) {
            if ((wkCount[wIdx] || 0) < (wkCount[least] || 0)) least = wIdx;
          }
          picked = least;
        }
        wkCount[picked] = (wkCount[picked] || 0) + 1;
        designatedBusyWeek[s.ec] = picked;
      });
    }

    // Coverage targets per day-of-week — ascending gradient from Mon (least
    // staff) to Sat (full occupancy):
    //   Mon — fewest. Quietest day, biggest off-day sink.
    //   Tue — slightly more.
    //   Wed — slightly more.
    //   Thu — more.
    //   Fri/Sat — IDEAL FULL OCCUPANCY (100% of active staff, capped at station count).
    //   Sun — rotation rule (~half team, capped to staff/2).
    // Coverage gradient ported from the original bundle's `c1` function.
    // Steeper Mon→Thu progression than my v2 had, gives a cleaner Mon<Tue<Wed<Thu separation.
    const dayTargetPct = (dow, busyPeriod) => {
      let base;
      if (dow === 5 || dow === 6)      base = 1.00; // Fri/Sat — full
      else if (dow === 4)              base = 0.70; // Thu
      else if (dow === 3)              base = 0.60; // Wed
      else if (dow === 2)              base = 0.50; // Tue
      else if (dow === 1)              base = 0.40; // Mon — fewest
      else if (dow === 0)              base = 0.40; // Sun rotation
      else                             base = 0.60;
      if (busyPeriod) base += 0.05;
      return Math.min(base, 1.0);
    };
    // Original uses Math.round (not ceil) — matches the working bundle.
    const minWorkingFor = (d) => totalStaff <= 2 ? 1
      : Math.min(capacity, Math.max(1, Math.round(dayTargetPct(d.dow, isBusyDay(d)) * totalStaff)));

    const newGrid = {};
    sortedTechs.forEach(s => { newGrid[s.ec] = {}; });

    // ── Cross-month carry-over for the leading partial week ─────────────
    // A schedule period (25th–24th) can begin mid-week. The Mon-Sun labour
    // week containing the period's first days extends back into the prior
    // month's schedule. To keep the labour-week off quota capped at 2, we
    // load the prior month's schedule and count any off-days each tech
    // already has on the days of that shared labour week. The leading
    // partial's quota is then reduced by that count.
    // ── Cross-month STRICT 2-off-per-week constraint ────────────────────
    // Hard rule: no tech may ever have more than 2 off-days within any
    // single Mon-Sun labour week, even if those days span two scheduling
    // periods. The leading partial week of this period overlaps with the
    // tail of the previous month's schedule. We load the prior schedule
    // and count how many off-days each tech already has in those overlap
    // days; that count is added to the in-period off-count for this
    // tech's wIdx=0 week, so the existing 2-cap check naturally enforces
    // the cross-month boundary.
    let priorOffsLeading = {};                 // ec → number of offs already in prior month's days (Mon-Sat span before period start)
    const leadingWeekRef = weeks[0];
    const isLeadingPartial = leadingWeekRef && leadingWeekRef.length < 7;
    let priorMonthMissing = false;             // true when leading partial exists but prior schedule has no data
    if (isLeadingPartial) {
      try {
        const priorYm = window.BOA_DB.shiftYm(ym, -1);
        const priorSched = await window.BOA_DB.loadSchedule(branch, priorYm, false);
        const priorGrid = (priorSched && priorSched.grid) || {};
        const priorIsEmpty = !priorSched || !priorSched.grid || Object.keys(priorSched.grid).length === 0;
        priorMonthMissing = priorIsEmpty;
        const firstDay = leadingWeekRef[0];
        const firstDow = firstDay.dow;
        const firstDate = new Date(firstDay.year, firstDay.monthIdx, firstDay.d);
        const daysBack = (firstDow === 0) ? 6 : firstDow - 1;
        const priorDays = [];
        for (let k = daysBack; k > 0; k--) {
          const dt = new Date(firstDate); dt.setDate(firstDate.getDate() - k);
          priorDays.push(dt.getDate());
        }
        sortedTechs.forEach(s => {
          const row = priorGrid[s.ec] || {};
          let n = 0;
          priorDays.forEach(dnum => {
            const v = row[dnum];
            if (v === "O" || v === "R" || v === "L") n++;
          });
          priorOffsLeading[s.ec] = n;
        });
      } catch (e) {
        console.warn("Could not load prior schedule for carry-over:", e);
        priorMonthMissing = true;
        sortedTechs.forEach(s => { priorOffsLeading[s.ec] = 0; });
      }
    }
    // Option A — if the prior month hasn't been generated yet, the
    // cross-month 2-off-per-week constraint can't be enforced for the
    // leading partial week. Surface this and let the user decide.
    if (isLeadingPartial && priorMonthMissing) {
      const priorYm = window.BOA_DB.shiftYm(ym, -1);
      const [py, pm] = priorYm.split("-").map(Number);
      const priorLabel = new Date(py, pm - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
      const ok = confirm(
        "The schedule for " + priorLabel + " hasn't been generated yet.\n\n" +
        "This month starts mid-week, so the first labour week (Mon-Sun) overlaps with " + priorLabel + ". " +
        "Without that month's schedule, the strict 2-off-per-week rule can't be enforced across the boundary — " +
        "a tech might end up with more than 2 off-days in that combined week once " + priorLabel + " is generated later.\n\n" +
        "Recommended: cancel, generate " + priorLabel + " first, then return here.\n\n" +
        "Click OK to continue anyway, or Cancel to stop."
      );
      if (!ok) return;
    }
    // Helper: how many off-days each tech "carries in" from the prior
    // month for a given week index. Only the leading partial week (wIdx=0
    // when the period starts mid-week) has any carry; all other weeks
    // return 0 so the existing in-period count stands alone.
    const _carryFor = (ec, wIdx) => (isLeadingPartial && wIdx === 0) ? (priorOffsLeading[ec] || 0) : 0;

    // PHASE E — max-6-consecutive enforcement, ported from the original `c1`.
    // For each tech, find their longest streak ≥ 7 and try to break it by
    // swapping an existing off-day (in any week the streak spans) onto a
    // day inside the streak. The original was much more lenient than my v2:
    //   • allows Mon/Fri/Sat as swap candidates (just not Sun)
    //   • accepts a swap if the new max-streak is SHORTER than the old one
    //     (doesn't require complete elimination)
    //   • picks the swap that minimises the resulting max-streak
    //   • up to 10 attempts per tech
    // This is what made the original schedule labour-law compliant in
    // practice — my over-strict v2 left too many violations unresolved.
    function enforceMaxSixConsecutive(g, allDays, weekChunks, ecList) {
      let totalSwaps = 0, unresolved = 0;
      const dayToWk = new Map();
      weekChunks.forEach((w, i) => w.forEach(d => dayToWk.set(d.d, i)));

      const findLongestRun = (ec) => {
        let cu = 0, rs = -1, maxRun = 0, maxRs = -1, maxRe = -1;
        for (let i = 0; i < allDays.length; i++) {
          const v = g[ec] && g[ec][allDays[i].d];
          if (v === "W" || v === "WL" || v === "E") {
            if (cu === 0) rs = i;
            cu++;
            if (cu > maxRun) { maxRun = cu; maxRs = rs; maxRe = i; }
          } else { cu = 0; rs = -1; }
        }
        return { maxRun, maxRs, maxRe };
      };
      const wkOffsCount = (ec, wIdx) => {
        const wk = weekChunks[wIdx];
        if (!wk) return 0;
        return wk.reduce((n, d) => {
          const v = g[ec] && g[ec][d.d];
          return n + ((v === "O" || v === "R" || v === "L") ? 1 : 0);
        }, 0);
      };
      const dayWorking = (d) => ecList.reduce((n, e2) => {
        const v = g[e2] && g[e2][d.d];
        return n + ((v === "W" || v === "WL" || v === "E") ? 1 : 0);
      }, 0);

      ecList.forEach(ec => {
        for (let attempt = 0; attempt < 40; attempt++) {
          const { maxRun, maxRs, maxRe } = findLongestRun(ec);
          if (maxRun < 7) break;

          // Weeks the run spans
          const runWks = new Set();
          for (let i = maxRs; i <= maxRe; i++) runWks.add(dayToWk.get(allDays[i].d));

          // Off-day candidates for the swap source: tech's existing Os (not Sun)
          // in any week the run spans, OUTSIDE the run itself.
          const swapSources = [];
          for (let i = 0; i < allDays.length; i++) {
            const d = allDays[i];
            if (d.dow === 0) continue;
            if (g[ec][d.d] !== "O") continue;
            if (!runWks.has(dayToWk.get(d.d))) continue;
            if (i >= maxRs && i <= maxRe) continue;
            swapSources.push(i);
          }

          // STEP 1: try swap (preserves tech's off-count) — pick the swap
          // that minimises the new max-streak. Only cap check; no minW check
          // (other passes handle under-coverage). Allows Mon/Fri/Sat as swap.
          let bestSwap = null;
          let bestNewMax = maxRun;
          for (const src of swapSources) {
            const srcWk = dayToWk.get(allDays[src].d);
            const srcWorking = dayWorking(allDays[src]);
            if (srcWorking + 1 > capacity) continue;          // cap: src would over-cap on flip
            for (let ix = maxRs; ix <= maxRe; ix++) {
              const tgt = allDays[ix];
              if (tgt.dow === 0) continue;
              if (dayToWk.get(tgt.d) !== srcWk) continue;     // same week as src
              g[ec][allDays[src].d] = "W";
              g[ec][tgt.d] = "O";
              const { maxRun: newMax } = findLongestRun(ec);
              g[ec][allDays[src].d] = "O";
              g[ec][tgt.d] = "W";
              if (newMax < bestNewMax) {
                bestNewMax = newMax;
                bestSwap = { src, tgt };
              }
            }
          }

          if (bestSwap) {
            g[ec][allDays[bestSwap.src].d] = "W";
            g[ec][bestSwap.tgt.d] = "O";
            totalSwaps++;
            if (bestNewMax < 7) break;
            continue;
          }

          // STEP 2 — fallback: PLACE A NEW OFF in the streak on a day where
          // the tech still has off-quota left in that week (me < we). This
          // matches the original bundle's escape valve. Adds an off-day,
          // doesn't remove one — but only within the tech's per-week target.
          let placed = null;
          let placedScore = -Infinity;
          for (let ix = maxRs; ix <= maxRe; ix++) {
            const tgt = allDays[ix];
            if (tgt.dow === 0) continue;
            if (g[ec][tgt.d] !== "W" && g[ec][tgt.d] !== "WL") continue;
            const wIdx = dayToWk.get(tgt.d);
            if (wIdx == null) continue;
            const wk = weekChunks[wIdx];
            const wkLen = wk.length;
            // Per-week target. For partials we allow up to 2 (matches the
            // earlier wkMaxOffs logic in Phase C).
            let target;
            if (wkLen < 7) target = 2;
            else target = (designatedBusyWeek[ec] === wIdx) ? 1 : 2;
            if (wkOffsCount(ec, wIdx) >= target) continue;     // tech already at target for this week
            // Prefer Mon/Tue (high score), avoid Thu/Fri/Sat
            const sc = (tgt.dow === 1 ? 60 : tgt.dow === 2 ? 40 :
                        tgt.dow === 3 ? 20 : tgt.dow === 4 ? -40 :
                        (tgt.dow === 5 || tgt.dow === 6) ? -45 : 15);
            if (sc > placedScore) { placedScore = sc; placed = tgt; }
          }
          if (placed) {
            g[ec][placed.d] = "O";
            totalSwaps++;
            const { maxRun: m2 } = findLongestRun(ec);
            if (m2 < 7) break;
            continue;
          }

          unresolved++;
          break;
        }
      });
      return { totalSwaps, unresolved };
    }

    // Build a quick lookup: requestedDays[ec] = Set(day-numbers) of requested off-days
    const requestedDays = {};
    dayRequests.forEach(req => {
      if (!req.ec) return;
      requestedDays[req.ec] = requestedDays[req.ec] || new Set();
      (req.days || []).forEach(d => requestedDays[req.ec].add(d));
    });

    // Track conflicts where the algorithm couldn't fully honour requests
    let unhonouredRequests = 0;

    // PASS A — Sun rotation across ALL weeks first (matches original PHASE 1
    // which uses `K.forEach(...)` outside the per-week PHASE 4 loop). This
    // ensures PHASE 4's adjacency check can see Sundays of OTHER weeks too.
    // Cross-month strict 2-cap: if a tech already carries ≥2 offs from the
    // previous month's tail of this same Mon-Sun week, skip their Sun=O —
    // setting it would push them to 3 offs in a single labour week.
    weeks.forEach((week, wIdx) => {
      const sundayDay = week.find(d => d.dow === 0);
      const sundayOffGroup = (wIdx % 2 === 0) ? "A" : "B";
      if (sundayDay) {
        sortedTechs.forEach(s => {
          if (sundayGroup[s.ec] === sundayOffGroup) {
            if (_carryFor(s.ec, wIdx) >= 2) return;     // 2-cap already hit by prior month
            newGrid[s.ec][sundayDay.d] = "O";
          }
        });
      }
    });

    // Apply day-off requests across ALL period (no quota check, matches original).
    sortedTechs.forEach(s => {
      const reqs = Array.from(requestedDays[s.ec] || []).sort((a,b)=>a-b);
      for (const d of reqs) {
        if (!newGrid[s.ec][d]) newGrid[s.ec][d] = "R";
        else if (newGrid[s.ec][d] === "O") newGrid[s.ec][d] = "R";
      }
    });

    // Pre-compute global per-day W counters and helpers used by PHASE 4.
    const _W4 = {};
    days.forEach(d => {
      const minW = minWorkingFor(d);
      const off = sortedTechs.filter(s => {
        const v = newGrid[s.ec][d.d]; return v === "O" || v === "R" || v === "L";
      }).length;
      _W4[d.d] = { minNeeded: minW, maxOff: Math.max(0, totalStaff - minW), currentOff: off, dow: d.dow };
    });
    const _isPreHol4 = (d) => {
      const dt = new Date(d.year, d.monthIdx, d.d + 1);
      const ymd = dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0");
      return holidayLookup && !!holidayLookup[ymd];
    };
    const _slackOk4 = (dnum) => _W4[dnum].currentOff < _W4[dnum].maxOff;
    const _tt4 = (s, d) => {
      if (newGrid[s.ec][d.d] || !_slackOk4(d.d)) return -9999;
      let score = 0;
      if (d.dow === 1) score += 60;
      else if (d.dow === 2) score += 40;
      else if (d.dow === 3) score += 20;
      else if (d.dow === 4) score -= 40;
      else if (d.dow === 0) score += 15;
      else if (d.dow === 5 || d.dow === 6) score -= 45;
      if (_isPreHol4(d)) score -= 8;
      const myOffs = days.filter(z => newGrid[s.ec][z.d] && newGrid[s.ec][z.d] !== "W" && z.d !== d.d).map(z => z.d);
      if (myOffs.length > 0) {
        const minD = Math.min(...myOffs.map(od => Math.abs(od - d.d)));
        if (minD <= 1) score -= 50;
        else if (minD === 2) score -= 20;
        else if (minD === 3 || minD === 4) score += 25;
      }
      score += (_W4[d.d].maxOff - _W4[d.d].currentOff) * 5;
      return score;
    };
    const _placeOff4 = (ec, dnum) => {
      if (!newGrid[ec][dnum]) {
        newGrid[ec][dnum] = "O";
        if (_W4[dnum]) _W4[dnum].currentOff++;
      }
    };
    // Cross-month carry-aware: when wIdx is the leading partial week, add
    // priorOffsLeading[ec] so this tech's effective per-week off count
    // reflects offs already used in the prior month's tail of the same
    // Mon-Sun labour week. The hard 2-cap then applies cross-month.
    const _wkOffs4 = (ec, week, wIdx) => {
      const inWk = week.reduce((n, d) => {
        const v = newGrid[ec][d.d]; return n + ((v && v !== "W") ? 1 : 0);
      }, 0);
      return inWk + (typeof wIdx === "number" ? _carryFor(ec, wIdx) : 0);
    };
    const _wkTarget4 = (ec, wIdx) => (designatedBusyWeek[ec] === wIdx) ? 1 : 2;
    const _isAllLeave4 = (ec, week) => week.every(d => newGrid[ec][d.d] === "L");

    // PASS B — PHASE 4: per-week off-day fill using `_tt4` scoring.
    // Now Sundays for ALL weeks are already set, so adjacency calculations
    // include cross-week Sundays — matches the original.
    weeks.forEach((week, wIdx) => {
      for (let pass = 0; pass < 200; pass++) {
        const undertarget = sortedTechs
          .filter(s => !_isAllLeave4(s.ec, week) && _wkOffs4(s.ec, week, wIdx) < _wkTarget4(s.ec, wIdx))
          .map(s => ({ s, off: _wkOffs4(s.ec, week, wIdx) }))
          .sort((a, b) => a.off - b.off);
        if (undertarget.length === 0) break;
        let placed = false;
        for (const { s } of undertarget) {
          const opts = week.filter(d => !newGrid[s.ec][d.d] && _slackOk4(d.d) && d.dow !== 0);
          if (opts.length === 0) continue;
          opts.sort((a, b) => _tt4(s, b) - _tt4(s, a));
          _placeOff4(s.ec, opts[0].d);
          placed = true;
          break;
        }
        if (!placed) break;
      }
    });

    // PHASE 5 — fill any remaining cells as W (across ALL weeks at once,
    // matching the original `for(let h of f)for(let M of p)d[h.ec][M.d]||(d[h.ec][M.d]="W")`).
    sortedTechs.forEach(s => days.forEach(d => { if (!newGrid[s.ec][d.d]) newGrid[s.ec][d.d] = "W"; }));

    // Build the global W (per-day off counters) AFTER PHASE 5 so PHASE 6's
    // streak detection and cap calculations see the full populated grid.
    const _W6 = {};
    days.forEach(d => {
      const off = sortedTechs.filter(s => { const v = newGrid[s.ec][d.d]; return v === "O" || v === "R" || v === "L"; }).length;
      _W6[d.d] = { currentOff: off, dow: d.dow };
    });
    const _dayToWk6 = new Map();
    weekChunks.forEach((wk, i) => wk.forEach(d => _dayToWk6.set(d.d, i)));

    // PHASE 6 — per-day STATION CAP enforcement with streak protection.
    // Iterates ALL non-Sunday days. For each over-cap day, finds a tech
    // working that day with a same-week O on a higher-priority day (with
    // headroom), swaps. Reverts if swap creates a 7-day streak.
    days.forEach(d => {
      if (d.dow === 0) return;
      let needed = (totalStaff - _W6[d.d].currentOff) - capacity;
      if (needed <= 0) return;
      const dWk = _dayToWk6.get(d.d);
      let safetyC = 0;
      while (needed > 0 && safetyC++ < 50) {
        const workers = sortedTechs.filter(s => newGrid[s.ec][d.d] === "W");
        let any = false;
        for (const cand of workers) {
          const swapDays = days.filter(B => {
            if (B.d === d.d || newGrid[cand.ec][B.d] !== "O" || B.dow === 0) return false;
            if (_dayToWk6.get(B.d) !== dWk) return false;            // SAME WEEK as d
            return (totalStaff - _W6[B.d].currentOff) < capacity;     // B has headroom
          });
          if (swapDays.length === 0) continue;
          swapDays.sort((a, b) => {
            const pri = x => x.dow === 1 ? 3 : x.dow === 2 ? 2 : x.dow === 3 ? 1 : 0;
            if (pri(a) !== pri(b)) return pri(b) - pri(a);
            const aHead = capacity - (totalStaff - _W6[a.d].currentOff);
            const bHead = capacity - (totalStaff - _W6[b.d].currentOff);
            return bHead - aHead;
          });
          const sw = swapDays[0];
          newGrid[cand.ec][d.d] = "O"; _W6[d.d].currentOff++;
          newGrid[cand.ec][sw.d] = "W"; _W6[sw.d].currentOff--;
          // Streak check across the FULL period (this is now correct because
          // PHASE 5 has filled all empty cells as W).
          let run = 0, viol = false;
          for (const dd of days) {
            const v = newGrid[cand.ec][dd.d];
            if (v === "W" || v === "WL" || v === "E") {
              run++;
              if (run >= 7) { viol = true; break; }
            } else run = 0;
          }
          if (viol) {
            newGrid[cand.ec][d.d] = "W"; _W6[d.d].currentOff--;
            newGrid[cand.ec][sw.d] = "O"; _W6[sw.d].currentOff++;
            continue;
          }
          needed--; any = true;
          break;
        }
        if (!any) break;
      }
    });

    // ─── Cross-week streak/coverage passes (ported from original `c1`) ───
    const W = {};
    const _isPreHolFn = (d) => {
      const dt = new Date(d.year, d.monthIdx, d.d + 1);
      const ymd = dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0");
      return holidayLookup && !!holidayLookup[ymd];
    };
    days.forEach(d => {
      const minW = minWorkingFor(d, sortedTechs.length);
      const off = sortedTechs.filter(s => { const v = newGrid[s.ec][d.d]; return v === "O" || v === "R" || v === "L"; }).length;
      W[d.d] = { dd: d, minNeeded: minW, maxOff: Math.max(0, sortedTechs.length - minW), currentOff: off, dow: d.dow, isPreHol: _isPreHolFn(d) };
    });
    const ecList = sortedTechs.map(s => s.ec);
    const dayToWk = new Map();
    weekChunks.forEach((wk, idx) => wk.forEach(d => dayToWk.set(d.d, idx)));
    // Cross-month carry-aware: leading partial week gets prior-month tail
    // offs added so the strict 2-cap is enforced across the boundary by
    // every later phase (7, 8, 9, 10, 11, 13) that consults this counter.
    const techWkOffs = (ec, wkIdx) => {
      const wk = weekChunks[wkIdx]; if (!wk) return 0;
      const inWk = wk.reduce((n, d) => {
        const v = newGrid[ec][d.d]; return n + ((v && v !== "W" && v !== "WL" && v !== "E") ? 1 : 0);
      }, 0);
      return inWk + _carryFor(ec, wkIdx);
    };
    // Matches original An(h, M): 1 if designated for week wkIdx, else 2.
    const techTarget = (ec, wkIdx) => (designatedBusyWeek[ec] === wkIdx) ? 1 : 2;
    const findFirst7 = (ec) => {
      let cnt = 0, start = null, end = null;
      for (const d of days) {
        const v = newGrid[ec][d.d];
        if (v === "W" || v === "WL" || v === "E") {
          if (cnt === 0) start = d.d;
          cnt++; end = d.d;
          if (cnt >= 7) return { start, end };
        } else cnt = 0;
      }
      return null;
    };

    // PHASE 7 — per-tech streak fix (up to 40 attempts).
    sortedTechs.forEach(s => {
      const ec = s.ec;
      for (let attempt = 0; attempt < 40; attempt++) {
        const j = findFirst7(ec);
        if (!j) break;
        const inRun = (dd) => dd.d >= j.start && dd.d <= j.end;
        const V = days.filter(B => inRun(B) && newGrid[ec][B.d] === "W" && B.dow !== 0);
        const Z = (j.start + j.end) / 2;
        const baseScore = (B) => (B.dow === 1 ? 60 : B.dow === 2 ? 40 : B.dow === 3 ? 20 : B.dow === 4 ? -40 : B.dow === 0 ? 10 : -45);
        const pA = days.filter(B => newGrid[ec][B.d] === "O" && B.dow !== 0 && !inRun(B));
        // Sort streak working-days by score (higher = better off-target)
        const EA = [...V].sort((B, eA) => {
          const sa = (W[B.d].currentOff < W[B.d].maxOff ? 200 : 0) + baseScore(B) - Math.abs(B.d - Z) * 0.8;
          const sb = (W[eA.d].currentOff < W[eA.d].maxOff ? 200 : 0) + baseScore(eA) - Math.abs(eA.d - Z) * 0.8;
          return sb - sa;
        });
        // Sort outside off-days by adjacency cluster score
        const oA = pA.map(B => {
          const others = days.filter(y => newGrid[ec][y.d] && newGrid[ec][y.d] !== "W" && y.d !== B.d).map(y => y.d);
          const minD = others.length > 0 ? Math.min(...others.map(y => Math.abs(y - B.d))) : 99;
          return { src: B, clusterScore: minD <= 2 ? 100 : minD <= 4 ? 30 : 0 };
        }).sort((a, b) => b.clusterScore - a.clusterScore);
        let fixed = false;
        for (const B of EA) {
          for (const { src: eA } of oA) {
            if (dayToWk.get(eA.d) !== dayToWk.get(B.d)) continue;
            // Try swap
            newGrid[ec][eA.d] = "W"; W[eA.d].currentOff--;
            newGrid[ec][B.d] = "O"; W[B.d].currentOff++;
            const newJ = findFirst7(ec);
            // Cap check on eA
            const eaWorking = totalStaff - W[eA.d].currentOff;
            if (eaWorking <= capacity && (!newJ || (newJ.end - newJ.start) < (j.end - j.start) || newJ.start > j.start)) {
              fixed = true;
              break;
            }
            // Revert
            newGrid[ec][B.d] = "W"; W[B.d].currentOff--;
            newGrid[ec][eA.d] = "O"; W[eA.d].currentOff++;
          }
          if (fixed) break;
        }
        if (fixed) continue;
        // Fallback 1: place new off in streak where tech is under target
        const HA = V.filter(B => techWkOffs(ec, dayToWk.get(B.d)) < techTarget(ec, dayToWk.get(B.d)));
        if (HA.length > 0) {
          HA.sort((B, eA) => {
            const sa = (W[B.d].currentOff < W[B.d].maxOff ? 200 : 0) + baseScore(B) - Math.abs(B.d - Z) * 0.8;
            const sb = (W[eA.d].currentOff < W[eA.d].maxOff ? 200 : 0) + baseScore(eA) - Math.abs(eA.d - Z) * 0.8;
            return sb - sa;
          });
          newGrid[ec][HA[0].d] = "O"; W[HA[0].d].currentOff++;
          continue;
        }
        // Fallback 2: same logic, mark as loose (tracked in zq for later trim protection)
        if (HA.length === 0) break;
      }
    });
    const zq = new Set();    // loose offs (placeholder — would normally be filled by HA fallback when target exceeded)

    // PHASE 8 — if total staff > station cap, force more offs to bring working ≤ cap.
    if (totalStaff > capacity) {
      days.forEach(h => {
        if (h.dow === 0) return;
        const wkH = dayToWk.get(h.d);
        const need = totalStaff - capacity;
        while (W[h.d].currentOff < need) {
          let bestS = null, bestSc = -999;
          for (const s of sortedTechs) {
            if (newGrid[s.ec][h.d]) continue;
            const o2 = techWkOffs(s.ec, wkH);
            const tg = techTarget(s.ec, wkH);
            const sc = tg - o2;
            if (sc > bestSc) { bestS = s; bestSc = sc; }
          }
          if (!bestS || bestSc <= 0) break;
          newGrid[bestS.ec][h.d] = "O"; W[h.d].currentOff++;
        }
      });
    }

    // PHASE 9 — top-up under-target weeks.
    weekChunks.forEach((wk, wkIdx) => {
      if (wk.length < 7) return;
      sortedTechs.forEach(s => {
        const ec = s.ec;
        const target = techTarget(ec, wkIdx);
        let cur = techWkOffs(ec, wkIdx);
        for (let iter = 0; iter < 14 && cur < target; iter++) {
          const opts = wk.filter(d => newGrid[ec][d.d] === "W" && d.dow !== 0);
          if (opts.length === 0) break;
          const score = (d) => {
            let s2 = 0;
            if (d.dow === 1 || d.dow === 2) s2 += 55;
            else if (d.dow === 3) s2 += 40;
            else if (d.dow === 4) s2 -= 15;
            else if (d.dow === 0) s2 += 15;
            else if (d.dow === 5 || d.dow === 6) s2 -= 45;
            if (W[d.d] && W[d.d].isPreHol) s2 -= 8;
            const r = W[d.d].maxOff - W[d.d].currentOff;
            s2 += r > 0 ? r * 8 : (r - 1) * 40;
            s2 -= Math.max(0, W[d.d].currentOff - 1) * 50;
            return s2;
          };
          opts.sort((a, b) => score(b) - score(a));
          newGrid[ec][opts[0].d] = "O"; W[opts[0].d].currentOff++; cur++;
        }
      });
    });

    // PHASE 10 — trim excess offs (over target).
    weekChunks.forEach((wk, wkIdx) => {
      if (wk.length < 7) return;
      sortedTechs.forEach(s => {
        const ec = s.ec;
        const target = techTarget(ec, wkIdx);
        const offDays = wk.filter(d => {
          const v = newGrid[ec][d.d];
          return (v === "O" || v === "R" || v === "L");
        });
        if (offDays.length <= target) return;
        let excess = offDays.length - target;
        const candidates = offDays.filter(d => {
          const v = newGrid[ec][d.d];
          return v === "O" && d.dow !== 0 && !zq.has(ec + "-" + d.d);
        });
        candidates.sort((a, b) => {
          const pri = (x) => (x.dow === 5 || x.dow === 6) ? 3 : (x.dow === 3 || x.dow === 4) ? 2 : 1;
          return pri(b) - pri(a);
        });
        for (const d of candidates) {
          if (excess <= 0) break;
          newGrid[ec][d.d] = "W"; W[d.d].currentOff--; excess--;
        }
      });
    });

    // PHASE 11 — per-day cap/floor enforcement.
    days.forEach(h => {
      if (h.dow === 0) return;
      const wkH = dayToWk.get(h.d);
      // Reduce excess offs (currentOff > maxOff)
      while (W[h.d].currentOff > W[h.d].maxOff) {
        let cand = null, best = -999;
        for (const s of sortedTechs) {
          if (newGrid[s.ec][h.d] !== "O") continue;
          const sc = techWkOffs(s.ec, wkH) - techTarget(s.ec, wkH);
          if (sc > best) { cand = s; best = sc; }
        }
        if (!cand || best <= 0) break;
        newGrid[cand.ec][h.d] = "W"; W[h.d].currentOff--;
      }
      // Push more off if working over station cap
      while ((totalStaff - W[h.d].currentOff) > capacity) {
        let cand = null, bestLow = 999;
        for (const s of sortedTechs) {
          if (newGrid[s.ec][h.d] !== "W") continue;
          const oc = techWkOffs(s.ec, wkH);
          if (oc >= techTarget(s.ec, wkH)) continue;
          if (oc < bestLow) { cand = s; bestLow = oc; }
        }
        if (!cand) break;
        newGrid[cand.ec][h.d] = "O"; W[h.d].currentOff++;
      }
    });

    // PHASE 12 — final safety pass for max-6-consecutive.
    let totalSwaps = 0, unresolved = 0;
    sortedTechs.forEach(s => {
      const ec = s.ec;
      for (let safIter = 0; safIter < 10; safIter++) {
        let cu = 0, rs = -1, maxRun = 0, maxRs = -1, maxRe = -1;
        for (let i = 0; i < days.length; i++) {
          const v = newGrid[ec][days[i].d];
          if (v === "W" || v === "WL" || v === "E") {
            if (cu === 0) rs = i;
            cu++;
            if (cu > maxRun) { maxRun = cu; maxRs = rs; maxRe = i; }
          } else { cu = 0; rs = -1; }
        }
        if (maxRun < 7) break;
        const runWks = new Set();
        for (let i = maxRs; i <= maxRe; i++) runWks.add(dayToWk.get(days[i].d));
        const swp = [];
        for (let i = 0; i < days.length; i++) {
          const dd = days[i];
          if (newGrid[ec][dd.d] !== "O" || dd.dow === 0) continue;
          if (!runWks.has(dayToWk.get(dd.d))) continue;
          if (i >= maxRs && i <= maxRe) continue;
          swp.push(i);
        }
        let fixed = false;
        for (const src of swp) {
          if (fixed) break;
          const srcWk = dayToWk.get(days[src].d);
          let bestIx = -1, bestNew = maxRun;
          for (let ix = maxRs; ix <= maxRe; ix++) {
            if (dayToWk.get(days[ix].d) !== srcWk) continue;
            if (days[ix].dow === 0) continue;
            if (W[days[ix].d].currentOff >= W[days[ix].d].maxOff) continue;
            newGrid[ec][days[src].d] = "W";
            newGrid[ec][days[ix].d] = "O";
            let nr = 0, nm = 0;
            for (const dd of days) {
              const v = newGrid[ec][dd.d];
              if (v === "W" || v === "WL" || v === "E") { nr++; if (nr > nm) nm = nr; } else nr = 0;
            }
            newGrid[ec][days[src].d] = "O";
            newGrid[ec][days[ix].d] = "W";
            if (nm < bestNew) { bestNew = nm; bestIx = ix; }
          }
          if (bestIx >= 0) {
            newGrid[ec][days[src].d] = "W"; W[days[src].d].currentOff--;
            newGrid[ec][days[bestIx].d] = "O"; W[days[bestIx].d].currentOff++;
            fixed = true;
            totalSwaps++;
          }
        }
        if (!fixed) { unresolved++; break; }
      }
    });

    // PHASE 13 — final fill to target across full weeks.
    weekChunks.forEach((wk, wkIdx) => {
      if (wk.length < 7) return;
      sortedTechs.forEach(s => {
        const ec = s.ec;
        let oc = techWkOffs(ec, wkIdx);
        const tg = techTarget(ec, wkIdx);
        if (oc >= tg) return;
        for (const wD of [1, 2, 3, 4, 0, 5, 6]) {
          if (oc >= tg) break;
          for (const dy of wk) {
            if (dy.dow !== wD || newGrid[ec][dy.d] !== "W") continue;
            newGrid[ec][dy.d] = "O"; W[dy.d].currentOff++; oc++;
            break;
          }
        }
      });
    });

    // PHASE 15 — balancing pass. Even out same-DOW off-totals across the cycle.
    for (let balIter = 0; balIter < 6; balIter++) {
      let changed = false;
      const byDow = {};
      days.forEach(d => { (byDow[d.dow] = byDow[d.dow] || []).push(d); });
      for (const dow of [1, 2, 3, 4]) {
        const ds = byDow[dow] || [];
        if (ds.length < 2) continue;
        ds.sort((u, v) => W[v.d].currentOff - W[u.d].currentOff);
        const heavy = ds[0], light = ds[ds.length - 1];
        const gap = W[heavy.d].currentOff - W[light.d].currentOff;
        if (gap <= 2) continue;
        for (const tech of sortedTechs) {
          if (newGrid[tech.ec][heavy.d] !== "O") continue;
          if (newGrid[tech.ec][light.d] !== "W") continue;
          newGrid[tech.ec][heavy.d] = "W";
          newGrid[tech.ec][light.d] = "O";
          let ok = true, run = 0;
          for (const d of days) {
            const v = newGrid[tech.ec][d.d];
            if (v === "W" || v === "WL" || v === "E") { run++; if (run >= 7) { ok = false; break; } } else run = 0;
          }
          if (!ok) {
            newGrid[tech.ec][heavy.d] = "O"; newGrid[tech.ec][light.d] = "W";
            continue;
          }
          const wkHeavy = dayToWk.get(heavy.d), wkLight = dayToWk.get(light.d);
          // Use techWkOffs so cross-month carry is included for the leading
          // partial week — the strict 2-cap must hold even when balancing.
          const heavyOffs = techWkOffs(tech.ec, wkHeavy);
          const lightOffs = techWkOffs(tech.ec, wkLight);
          const heavyQuota = techTarget(tech.ec, wkHeavy);
          const lightQuota = techTarget(tech.ec, wkLight);
          // Strict cross-month guard: if light is the leading partial and
          // would now exceed 2 offs (in-period + carry), revert.
          const lightHardCap = (isLeadingPartial && wkLight === 0) ? 2 : (lightQuota + 1);
          if (heavyOffs < heavyQuota || lightOffs > lightHardCap) {
            newGrid[tech.ec][heavy.d] = "O"; newGrid[tech.ec][light.d] = "W";
            continue;
          }
          W[heavy.d].currentOff--; W[light.d].currentOff++;
          changed = true;
          break;
        }
      }
      if (!changed) break;
    }

    // PHASE 16 — additional safety pass for max-6-consecutive (mid-streak insertion).
    for (let safIter = 0; safIter < 10; safIter++) {
      let fixedAny = false;
      for (const tech of sortedTechs) {
        const ec = tech.ec;
        let run = 0, runStart = -1;
        const runs = [];
        for (let i = 0; i < days.length; i++) {
          const v = newGrid[ec][days[i].d];
          if (v === "W" || v === "WL" || v === "E") {
            if (run === 0) runStart = i;
            run++;
          } else {
            if (run >= 7) runs.push({ start: runStart, len: run });
            run = 0; runStart = -1;
          }
        }
        if (run >= 7) runs.push({ start: runStart, len: run });
        if (runs.length === 0) continue;
        let broke = false;
        for (const ri of runs) {
          if (broke) break;
          for (let ki = ri.start + 1; ki < ri.start + ri.len - 1 && !broke; ki++) {
            const newOffD = days[ki];
            if (newOffD.dow === 0) continue;
            for (let j = 0; j < days.length; j++) {
              if (j >= ri.start && j < ri.start + ri.len) continue;
              const cd = days[j];
              if (newGrid[ec][cd.d] !== "O" || cd.dow === 0) continue;
              newGrid[ec][newOffD.d] = "O"; newGrid[ec][cd.d] = "W";
              let ok = true, r2 = 0;
              for (const dd2 of days) {
                const v = newGrid[ec][dd2.d];
                if (v === "W" || v === "WL" || v === "E") { r2++; if (r2 >= 7) { ok = false; break; } } else r2 = 0;
              }
              // Cross-month strict 2-cap: if newOffD lands in leading
              // partial and tech now exceeds 2 for that Mon-Sun week
              // (carry + in-period), revert.
              const newWk = dayToWk.get(newOffD.d);
              if (ok && isLeadingPartial && newWk === 0 && techWkOffs(ec, newWk) > 2) ok = false;
              if (ok) {
                W[newOffD.d].currentOff++; W[cd.d].currentOff--;
                fixedAny = true; broke = true;
                break;
              } else {
                newGrid[ec][newOffD.d] = "W"; newGrid[ec][cd.d] = "O";
              }
            }
          }
        }
        if (fixedAny) break;
      }
      if (!fixedAny) break;
    }

    // PHASE 17 — Table Bay late-shift WL assignment.
    // For each non-Sunday day at Table Bay, designate up to 3 working techs
    // as "WL" (work late). Distributed evenly using a per-tech counter so
    // no single tech is always on late shift.
    const lateShiftCount = {};
    if (branch === "Table Bay") {
      sortedTechs.forEach(s => { lateShiftCount[s.ec] = 0; });
      days.forEach(dy => {
        if (dy.dow === 0) return;
        const workers = sortedTechs.filter(s => newGrid[s.ec][dy.d] === "W");
        workers.sort((a, b) =>
          (lateShiftCount[a.ec] - lateShiftCount[b.ec]) ||
          a.ec.localeCompare(b.ec)
        );
        const need = Math.min(3, workers.length);
        for (let i = 0; i < need; i++) {
          newGrid[workers[i].ec][dy.d] = "WL";
          lateShiftCount[workers[i].ec]++;
        }
      });
    }

    // PHASE 18 — Onboarding & offboarding ghost cells.
    // Days BEFORE a tech's start date (onboarding) → "X" (pre-start marker).
    // Days AFTER a tech's left date (offboarding) → "X" (post-departure).
    sortedTechs.forEach(s => {
      const startDate = s.startDate || s._startDate;
      if (s._onboarding && startDate) {
        days.forEach(d => {
          const ymd = d.year + "-" + String(d.monthIdx + 1).padStart(2, "0") + "-" + String(d.d).padStart(2, "0");
          if (ymd < startDate) newGrid[s.ec][d.d] = "X";
        });
      }
      if (s.leftDate) {
        days.forEach(d => {
          const ymd = d.year + "-" + String(d.monthIdx + 1).padStart(2, "0") + "-" + String(d.d).padStart(2, "0");
          if (ymd > s.leftDate) newGrid[s.ec][d.d] = "X";
        });
      }
    });

    // On-maternity-leave staff: mark every day as L (Leave) so the cell shows
    // a clear leave indicator. They were excluded from the algorithm above.
    onMatTechs.forEach(t => {
      newGrid[t.ec] = newGrid[t.ec] || {};
      days.forEach(d => { newGrid[t.ec][d.d] = "L"; });
    });

    setGrid(newGrid);
    setDirty(true);
    const totalReqDays = dayRequests.reduce((n, r) => n + (r.days || []).length, 0);
    alert(
      "Schedule auto-filled.\n\n" +
      "• Total staff: " + totalStaff + "  (Group A: " + sortedTechs.filter(s=>sundayGroup[s.ec]==='A').length +
        ", Group B: " + sortedTechs.filter(s=>sundayGroup[s.ec]==='B').length + ")\n" +
      "• Weeks in period: " + weeks.length + "  (busy weeks: " + busyWeekIndices.length +
        (isLeadingPartial ? ", leading partial carries from prior month" : "") + ")\n" +
      "• Day-requests: " + (totalReqDays - unhonouredRequests) + " of " + totalReqDays + " honoured" +
        (unhonouredRequests > 0 ? " — " + unhonouredRequests + " skipped (would exceed 2-off/week cap)" : "") + "\n" +
      "• Station cap: " + capacity + " techs/day  (Mani " + (salon.mani || 0) + " + Pedi " + (salon.pedi || 0) + ")\n" +
      "• Max-6-consecutive: " + (totalSwaps > 0 ? totalSwaps + " off-days shifted to comply" : "no shifts needed") +
        (unresolved > 0 ? " — ⚠ " + unresolved + " unresolved" : "") + "\n\n" +
      "Review the grid + summary table below, then click Save."
    );
  }
  async function save() {
    // Strengthened overwrite confirmation. If a saved schedule already
    // exists, surface its last-saved time and remind the manager that the
    // previous version will be backed up to history (up to 5 versions
    // kept). Skips the prompt for first-time saves.
    try {
      const existing = await window.BOA_DB.loadSchedule(branch, ym, false);
      const hasExisting = existing && existing.grid && Object.keys(existing.grid).length > 0;
      if (hasExisting) {
        const ts = existing.savedAt ? new Date(existing.savedAt).toLocaleString() : "an earlier session";
        const ok = confirm(
          "⚠ You're about to OVERWRITE the saved schedule for this period.\n\n" +
          "Last saved: " + ts + "\n\n" +
          "The current saved version will be backed up to Version History (last 5 are kept) " +
          "so you can restore it later if needed.\n\n" +
          "Click OK to overwrite, or Cancel to keep the existing schedule."
        );
        if (!ok) return;
      }
    } catch (peekErr) {
      console.warn("Could not peek existing schedule before save:", peekErr);
    }
    setSaving(true);
    try {
      const v = await window.BOA_DB.saveSchedule(branch, ym, grid, false);
      setSavedAt(v.savedAt); setDirty(false);
      if (window.BOA_LOG_ACTIVITY) {
        window.BOA_LOG_ACTIVITY("Saved tech schedule", branch + " · " + ym, "");
      }
    } catch (e) { alert("Could not save: " + (e.message || e)); }
    finally { setSaving(false); }
  }

  const monthAbbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dowAbbr = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function rowCounts(ec) {
    const row = grid[ec] || {};
    let w = 0, off = 0;
    days.forEach(d => {
      const v = row[d.d];
      if (v === "W" || v === "WL" || v === "E") w++;
      if (v === "O" || v === "R" || v === "L")  off++;
    });
    return { w, off };
  }

  // ── Conflict detection: max 2 off-days per week per staff ──────────────
  // Groups the period into Mon-Sun weeks and flags any staff who has more
  // than 2 off-days (O / R / L combined) in any single week.
  const weekChunks = useMemo(() => {
    const out = []; let cur = [];
    days.forEach(d => { cur.push(d); if (d.dow === 0) { out.push(cur); cur = []; } });
    if (cur.length) out.push(cur);
    return out;
  }, [days]);

  // Map day-number → week index, for fast same-week checks during drag-drop
  const dayWeekMap = useMemo(() => {
    const map = {};
    weekChunks.forEach((w, idx) => w.forEach(d => { map[d.d] = idx; }));
    return map;
  }, [weekChunks]);

  // Drag-and-drop handlers — swap a cell's value with another cell's value
  // within the same staff row AND the same Mon-Sun week. Click-to-cycle
  // remains available; the browser only initiates a drag on mousedown+move.
  const handleDragStart = (e, ec, day, value, isOnMat) => {
    if (isOnMat) { e.preventDefault(); return; }
    setDragSource({ ec, day, value, weekIdx: dayWeekMap[day] });
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", ec + ":" + day); } catch (_) {}
    }
  };
  const isValidDropTarget = (ec, day) => {
    if (!dragSource) return false;
    if (dragSource.ec !== ec) return false;
    if (dragSource.day === day) return false;
    if (dayWeekMap[day] !== dragSource.weekIdx) return false;
    return true;
  };
  const handleDragOver = (e, ec, day) => {
    if (!isValidDropTarget(ec, day)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  };
  const handleDrop = (e, ec, day) => {
    e.preventDefault();
    if (!isValidDropTarget(ec, day)) { setDragSource(null); return; }
    const targetValue = (grid[ec] || {})[day] || "";
    setGrid(g => {
      const row = { ...(g[ec] || {}) };
      row[dragSource.day] = targetValue;
      row[day]            = dragSource.value;
      return { ...g, [ec]: row };
    });
    setDirty(true);
    setDragSource(null);
  };
  const handleDragEnd = () => setDragSource(null);

  const monthAbbr0 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  // Coverage / capacity helpers reused by both auto-fill and the bottom-row stats
  const salonForBranch = useMemo(() => SALONS.find(s => s.name === branch) || { capacity: 999 }, [branch]);

  // Identify busy-period weeks (full weeks containing prev-25 → cur-6)
  const ymParts = ym.split("-").map(Number);
  const isBusyDay = (d) => {
    const m = d.monthIdx + 1;
    const curMonth = ymParts[1], prevMonth = (curMonth === 1) ? 12 : curMonth - 1;
    if (m === prevMonth && d.d >= 25) return true;
    if (m === curMonth && d.d <= 6)   return true;
    return false;
  };
  const dayTargetPct = (dow, busyPeriod) => {
    let base;
    if (dow === 5 || dow === 6)      base = 1.00; // Fri/Sat full
    else if (dow === 4)              base = 0.70; // Thu
    else if (dow === 3)              base = 0.60; // Wed
    else if (dow === 2)              base = 0.50; // Tue
    else if (dow === 1)              base = 0.40; // Mon — fewest
    else                             base = 0.40; // Sun
    if (busyPeriod) base += 0.05;
    return Math.min(base, 1.0);
  };
  // Station cap = mani + pedi stations (hard physical limit).
  const stationCap = (salonForBranch.mani || 0) + (salonForBranch.pedi || 0);
  // Original uses Math.round, not ceil.
  const minWorkingFor = (d, totalStaff) => totalStaff <= 2 ? 1
    : Math.min(stationCap, Math.max(1, Math.round(dayTargetPct(d.dow, isBusyDay(d)) * totalStaff)));

  // SA public holidays for every year covered by the visible period
  const holidayLookup = useMemo(() => {
    const years = new Set(days.map(d => d.year));
    const out = {};
    years.forEach(y => Object.assign(out, saHolidays(y)));
    return out;
  }, [days]);
  const _hkey = (d) => d.year + "-" + String(d.monthIdx+1).padStart(2,"0") + "-" + String(d.d).padStart(2,"0");
  const isHoliday   = (d) => !!holidayLookup[_hkey(d)];
  const holidayName = (d) => holidayLookup[_hkey(d)] || "";

  // 7+ consecutive working days violations (HARD — labour law). Skip on-mat staff.
  const longStreaks = useMemo(() => {
    const out = [];
    techs.filter(t => !t.onMat).forEach(s => {
      let streak = 0, startIdx = -1;
      for (let i = 0; i < days.length; i++) {
        const v = (grid[s.ec] || {})[days[i].d];
        if (v === "W" || v === "WL" || v === "E") {
          if (streak === 0) startIdx = i;
          streak++;
        } else {
          if (streak >= 7) {
            const a = days[startIdx], b = days[i-1];
            out.push({ ec: s.ec, name: s.name, count: streak,
                       range: a.d + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][a.monthIdx] + " – " + b.d + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][b.monthIdx] });
          }
          streak = 0; startIdx = -1;
        }
      }
      if (streak >= 7) {
        const a = days[startIdx], b = days[days.length-1];
        out.push({ ec: s.ec, name: s.name, count: streak,
                   range: a.d + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][a.monthIdx] + " – " + b.d + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][b.monthIdx] });
      }
    });
    return out;
  }, [grid, techs, days]);

  const tooManyOff = useMemo(() => {
    const out = [];
    techs.filter(t => !t.onMat).forEach(s => {
      const row = grid[s.ec] || {};
      weekChunks.forEach((week, wIdx) => {
        const offDays = week.filter(d => {
          const v = row[d.d];
          return v === "O" || v === "R" || v === "L";
        });
        if (offDays.length > 2) {
          const first = week[0], last = week[week.length-1];
          out.push({
            ec: s.ec,
            name: s.name,
            weekIdx: wIdx + 1,
            range: first.d + " " + monthAbbr0[first.monthIdx] + " – " + last.d + " " + monthAbbr0[last.monthIdx],
            count: offDays.length,
            offCells: offDays.map(d => d.d + " " + monthAbbr0[d.monthIdx]).join(", ")
          });
        }
      });
    });
    return out;
  }, [grid, techs, weekChunks]);

  return (
    <div>
      <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:14 }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:24, fontWeight:700, color:"#831843" }}>📅 Schedule Editor</div>
        <select value={branch} onChange={e=>{ if(dirty && !confirm("You have unsaved changes. Discard?")) return; setBranch(e.target.value); }}
          style={{ padding:"8px 12px", borderRadius:9, border:"1px solid #FBCFE8", background:"#fff", fontFamily:"inherit", fontSize:14, color:"#831843", fontWeight:600 }}>
          {SALONS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <div style={{ display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #FBCFE8", borderRadius:9, padding:"4px" }}>
          <button onClick={()=>{ if(dirty && !confirm("Discard unsaved changes?")) return; setYm(window.BOA_DB.shiftYm(ym, -1)); }} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:"#BE185D", padding:"0 8px", lineHeight:1 }}>‹</button>
          <span style={{ fontSize:13, fontWeight:600, color:"#831843", padding:"0 6px" }}>{periodLbl}</span>
          <button onClick={()=>{ if(dirty && !confirm("Discard unsaved changes?")) return; setYm(window.BOA_DB.shiftYm(ym, +1)); }} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:"#BE185D", padding:"0 8px", lineHeight:1 }}>›</button>
        </div>
        {(() => {
          const active = techs.filter(t => !t.onMat).length;
          const onMat  = techs.filter(t => t.onMat).length;
          const cap    = (salonForBranch.mani || 0) + (salonForBranch.pedi || 0);
          return (
            <div style={{ display:"flex", alignItems:"center", gap:8, background:"#FFFFFF", border:"1px solid #FBCFE8", borderRadius:9, padding:"6px 12px", fontSize:11, color:"#831843" }}>
              <span style={{ fontWeight:700, fontSize:13 }}>{active}</span>
              <span style={{ color:"#9CA3AF" }}>active</span>
              {onMat > 0 && <span style={{ background:"#e5e7eb", color:"#374151", padding:"1px 6px", borderRadius:4, fontSize:10, fontWeight:700 }}>+{onMat} 🤱</span>}
              <span style={{ color:"#9CA3AF" }}>·</span>
              <span style={{ color:"#9CA3AF" }}>cap</span>
              <span style={{ fontWeight:700 }}>{cap}</span>
            </div>
          );
        })()}
        <div style={{ flex:1 }} />
        {savedAt && !dirty && <span style={{ fontSize:11, color:"#15803d", fontStyle:"italic" }}>✓ Saved {new Date(savedAt).toLocaleString()}</span>}
        {dirty && <span style={{ fontSize:11, color:"#b45309", fontWeight:600 }}>● Unsaved changes</span>}
        <button onClick={autoFill} style={{ padding:"8px 14px", borderRadius:9, border:"1px solid #BE185D", background:"#FCE7F3", color:"#831843", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>✨ Auto-fill</button>
        <button onClick={openHistory} style={{ padding:"8px 14px", borderRadius:9, border:"1px solid #FBCFE8", background:"#FFFFFF", color:"#BE185D", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600 }}>🕒 History</button>
        <button onClick={clearAll} style={{ padding:"8px 14px", borderRadius:9, border:"1px solid #FBCFE8", background:"#FFFFFF", color:"#BE185D", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600 }}>Clear period</button>
        <button onClick={save} disabled={saving || !dirty} style={{ padding:"8px 18px", borderRadius:9, border:"none", background:dirty?"#BE185D":"#FBCFE8", color:dirty?"#fff":"#9F1A4F", cursor:dirty?"pointer":"not-allowed", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>{saving ? "Saving…" : "Save"}</button>
      </div>

      {/* Version History modal — shows last 5 backups for this branch+period */}
      {historyOpen && (
        <div onClick={() => setHistoryOpen(false)} style={{ position:"fixed", inset:0, background:"rgba(131,24,67,0.35)", zIndex:9000, display:"flex", alignItems:"center", justifyContent:"center", padding:"40px 20px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background:"#fff", borderRadius:14, maxWidth:640, width:"100%", maxHeight:"80vh", overflow:"auto", padding:"22px 26px", boxShadow:"0 20px 50px rgba(131,24,67,0.25)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:700, color:"#831843" }}>🕒 Version History</div>
              <button onClick={() => setHistoryOpen(false)} style={{ background:"none", border:"none", fontSize:22, color:"#BE185D", cursor:"pointer", lineHeight:1 }}>×</button>
            </div>
            <div style={{ fontSize:12, color:"#831843", marginBottom:14, lineHeight:1.5 }}>
              {branch} · {periodLbl}<br />
              The last 5 saved versions of this schedule are kept here. Restoring will load that older version onto the editor — you'll still need to click Save to commit it (and the current schedule gets backed up automatically).
            </div>
            {historyLoading ? (
              <div style={{ padding:"24px 0", textAlign:"center", color:"#9CA3AF", fontStyle:"italic" }}>Loading history…</div>
            ) : historyVersions.length === 0 ? (
              <div style={{ padding:"24px 12px", textAlign:"center", color:"#9CA3AF", fontStyle:"italic", border:"1px dashed #FBCFE8", borderRadius:10 }}>
                No previous versions yet.<br />
                <span style={{ fontSize:11 }}>A snapshot is taken every time a saved schedule is overwritten.</span>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {historyVersions.map((v, i) => {
                  const ts = v.savedAt ? new Date(v.savedAt).toLocaleString() : "(unknown time)";
                  const techCount = v.grid ? Object.keys(v.grid).length : 0;
                  let offCount = 0, workCount = 0;
                  if (v.grid) {
                    Object.values(v.grid).forEach(row => Object.values(row || {}).forEach(cell => {
                      if (cell === "O" || cell === "R" || cell === "L") offCount++;
                      else if (cell === "W" || cell === "WL" || cell === "E") workCount++;
                    }));
                  }
                  return (
                    <div key={i} style={{ border:"1px solid #FBCFE8", borderRadius:10, padding:"12px 14px", display:"flex", alignItems:"center", gap:12, background:i===0 ? "#FDF2F8" : "#fff" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:"#831843" }}>{ts}{i===0 ? " · most recent backup" : ""}</div>
                        <div style={{ fontSize:11, color:"#9CA3AF", marginTop:3 }}>{techCount} techs · {workCount} working cells · {offCount} off cells</div>
                      </div>
                      <button onClick={() => restoreVersion(i)} style={{ padding:"6px 14px", borderRadius:8, border:"1px solid #BE185D", background:"#FCE7F3", color:"#831843", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>Restore</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ fontSize:12, color:"#831843", marginBottom:10, lineHeight:1.5 }}>
        Click a cell to cycle through statuses: <strong>W</strong> → WL → O → R → L → E → X → empty. Save commits the period to Supabase. Auto-fill applies BOA rules (Sunday rotation, day requests, 5-day weeks).
      </div>

      {/* Conflicts panel — too many consecutive working days (labour law) */}
      {longStreaks.length > 0 && (
        <div style={{ background:"#fee2e2", border:"1px solid #fca5a5", borderRadius:10, padding:"12px 14px", marginBottom:14, color:"#7f1d1d", fontSize:12, lineHeight:1.5 }}>
          <div style={{ fontWeight:700, marginBottom:6, fontSize:13 }}>
            ⚠ Labour law: {longStreaks.length} staff with 7+ consecutive working days
          </div>
          <ul style={{ margin:0, paddingLeft:20 }}>
            {longStreaks.map((c, i) => (
              <li key={i}>
                <strong>{c.name}</strong> ({c.ec}) · <strong>{c.count} consecutive working days</strong> ({c.range}) — must include an off-day before day 7.
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Conflicts panel — too many off-days per week */}
      {tooManyOff.length > 0 && (
        <div style={{ background:"#fef3c7", border:"1px solid #fcd34d", borderRadius:10, padding:"12px 14px", marginBottom:14, color:"#92400e", fontSize:12, lineHeight:1.5 }}>
          <div style={{ fontWeight:700, marginBottom:6, fontSize:13 }}>
            ⚠ {tooManyOff.length} week{tooManyOff.length > 1 ? 's' : ''} over the 2-off-days-per-week limit
          </div>
          <ul style={{ margin:0, paddingLeft:20 }}>
            {tooManyOff.map((c, i) => (
              <li key={i}>
                <strong>{c.name}</strong> ({c.ec}) · Week {c.weekIdx} ({c.range}): <strong>{c.count} off-days</strong> ({c.offCells})
              </li>
            ))}
          </ul>
        </div>
      )}

      {techs.length === 0 ? (
        <div style={{ padding:24, background:"#FCE7F3", borderRadius:10, color:"#831843" }}>No staff at <strong>{branch}</strong>.</div>
      ) : loading ? (
        <div style={{ padding:24, color:"#831843", fontStyle:"italic" }}>Loading schedule…</div>
      ) : (
        <div style={{ overflowX:"auto", border:"1px solid #FBCFE8", borderRadius:10, background:"#fff" }}>
          <table style={{ borderCollapse:"collapse", minWidth:"100%", fontSize:11 }}>
            <thead>
              <tr>
                <th style={{ position:"sticky", left:0, background:"#FCE7F3", padding:"8px 10px", textAlign:"left", borderBottom:"1px solid #FBCFE8", color:"#831843", minWidth:180, zIndex:2 }}>Staff</th>
                {days.map(d => {
                  const wknd = d.dow === 0 || d.dow === 6;
                  const weekEnd = d.dow === 0;
                  const busy = isBusyDay(d);
                  const hol  = isHoliday(d);
                  // SA public holiday → lavender (overrides busy yellow).
                  // Otherwise uniform yellow for busy days (25th–6th — peak revenue).
                  const headerBg = d.isToday ? "#FBCFE8"
                                  : hol ? "#ede9fe"
                                  : busy ? "#fef3c7"
                                  : "#FCE7F3";
                  const titleParts = [];
                  if (hol)  titleParts.push("🇿🇦 " + holidayName(d));
                  if (busy) titleParts.push("Busy day (25th–6th — peak revenue)");
                  return (
                    <th key={d.year+'-'+d.monthIdx+'-'+d.d} title={titleParts.join(" · ")} style={{ padding:"4px 2px", borderBottom:"1px solid #FBCFE8", borderLeft:"1px solid #FCE7F3", borderRight: weekEnd ? "3px solid #BE185D" : "none", background: headerBg, color: hol ? "#5b21b6" : "#831843", minWidth:34, textAlign:"center", fontWeight:600 }}>
                      <div style={{ fontSize:13, lineHeight:1 }}>{d.d}</div>
                      <div style={{ fontSize:8, fontWeight:500, color: hol ? "#5b21b6" : busy ? "#92400e" : "#BE185D", lineHeight:1, marginTop:2 }}>{monthAbbr[d.monthIdx]}</div>
                      <div style={{ fontSize:8, fontWeight:700, color: hol ? "#5b21b6" : wknd?"#BE185D":"#9CA3AF", lineHeight:1, marginTop:2, textTransform:"uppercase", letterSpacing:"0.04em" }}>{dowAbbr[d.dow]}</div>
                      {hol && <div style={{ fontSize:7, fontWeight:800, color:"#5b21b6", lineHeight:1, marginTop:2, letterSpacing:"0.05em" }}>HOL</div>}
                    </th>
                  );
                })}
                <th style={{ padding:"6px 8px", background:"#FCE7F3", borderBottom:"1px solid #FBCFE8", borderLeft:"2px solid #FBCFE8", color:"#831843", fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em" }}>W</th>
                <th style={{ padding:"6px 8px", background:"#FCE7F3", borderBottom:"1px solid #FBCFE8", color:"#831843", fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em" }}>Off</th>
              </tr>
            </thead>
            <tbody>
              {techs.map(s => {
                const counts = rowCounts(s.ec);
                const onMat  = !!s.onMat;
                // On-mat staff: greyed-out row, non-clickable cells, "ON MAT" badge.
                const rowOpacity = onMat ? 0.55 : 1;
                const nameBg     = onMat ? "#f3f4f6" : "#fff";
                const nameColor  = onMat ? "#6b7280" : "#831843";
                return (
                  <tr key={s.ec} style={{ opacity: rowOpacity }}>
                    <td style={{ position:"sticky", left:0, background:nameBg, padding:"6px 10px", borderBottom:"1px solid #FCE7F3", color:nameColor, fontWeight:600, fontSize:12 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span>{s.name}</span>
                        {onMat && <span style={{ background:"#e5e7eb", color:"#374151", padding:"1px 6px", borderRadius:4, fontSize:9, fontWeight:700, letterSpacing:"0.04em" }}>🤱 ON MAT</span>}
                      </div>
                      <div style={{ fontSize:10, color:"#9CA3AF", marginTop:1, letterSpacing:"0.04em" }}>{s.ec}</div>
                    </td>
                    {days.map(d => {
                      const v = (grid[s.ec] || {})[d.d] || "";
                      const weekEnd = d.dow === 0;
                      // On-mat cells: flat grey, non-clickable, non-draggable.
                      const matCell = onMat ? { background:"#e5e7eb", color:"#9ca3af" } : cellStyle(v);
                      // Drag-drop visual states
                      const isSrc        = dragSource && dragSource.ec === s.ec && dragSource.day === d.d;
                      const isValidDrop  = !onMat && isValidDropTarget(s.ec, d.d);
                      const dropOutline  = isValidDrop ? "2px solid #15803d"
                                          : isSrc      ? "2px dashed #BE185D"
                                          : d.isToday  ? "1px dashed rgba(190,24,93,0.45)"
                                          :              "none";
                      const dragCursor   = onMat ? "default" : (v ? "grab" : "pointer");
                      return (
                        <td key={s.ec+'-'+d.d}
                            draggable={!onMat && !!v}
                            onDragStart={e => handleDragStart(e, s.ec, d.d, v, onMat)}
                            onDragOver={e => handleDragOver(e, s.ec, d.d)}
                            onDrop={e => handleDrop(e, s.ec, d.d)}
                            onDragEnd={handleDragEnd}
                            onClick={onMat ? undefined : () => cycleCell(s.ec, d.d)}
                            title={onMat ? `${s.name} · on maternity leave` : `${s.name} · ${d.d} ${monthAbbr[d.monthIdx]} · click to cycle, drag to swap within the week`}
                            style={{ ...matCell, padding:0, height:30, textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft:"1px solid #FCE7F3", borderRight: weekEnd ? "3px solid #BE185D" : "none", cursor: dragCursor, fontSize:11, fontWeight:700, userSelect:"none", outline: dropOutline, outlineOffset:-1, opacity: isSrc ? 0.4 : undefined }}>
                          {onMat ? "—" : v}
                        </td>
                      );
                    })}
                    <td style={{ padding:"6px 8px", borderLeft:"2px solid #FBCFE8", borderBottom:"1px solid #FCE7F3", textAlign:"center", color: onMat ? "#9ca3af" : "#15803d", fontSize:11, fontWeight:700 }}>{onMat ? "—" : counts.w}</td>
                    <td style={{ padding:"6px 8px", borderBottom:"1px solid #FCE7F3", textAlign:"center", color: onMat ? "#9ca3af" : "#991b1b", fontSize:11, fontWeight:700 }}>{onMat ? "—" : counts.off}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ position:"sticky", left:0, background:"#831843", padding:"12px 10px", borderTop:"3px solid #831843", borderBottom:"3px solid #831843", color:"#FFFFFF", fontSize:11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase", zIndex:2 }}>Working / Needed</td>
                {(() => { const activeTechs = techs.filter(t => !t.onMat); return days.map(d => {
                  const working = activeTechs.filter(s => {
                    const v = (grid[s.ec] || {})[d.d];
                    return v === "W" || v === "WL" || v === "E";
                  }).length;
                  const needed = minWorkingFor(d, activeTechs.length);
                  const ok = working >= needed;
                  const weekEnd = d.dow === 0;
                  const wknd = d.dow === 0 || d.dow === 6;
                  const busy = isBusyDay(d);
                  const hol = isHoliday(d);
                  const footBg = hol ? "#ede9fe" : busy ? "#fef3c7" : "#FCE7F3";
                  return (
                    <td key={'foot-'+d.year+'-'+d.monthIdx+'-'+d.d}
                        style={{ padding:"10px 2px", borderTop:"3px solid #831843", borderBottom:"3px solid #831843", borderLeft:"1px solid #FBCFE8", borderRight: weekEnd ? "3px solid #BE185D" : "none", textAlign:"center", background: footBg }}>
                      <div style={{ display:"inline-block", padding:"5px 10px", borderRadius:10, background: ok ? "#15803d" : "#dc2626", color:"#FFFFFF", fontWeight:900, fontSize:14, lineHeight:1, minWidth:24, boxShadow: ok ? "0 2px 6px rgba(21,128,61,0.32)" : "0 2px 6px rgba(220,38,38,0.40)" }}>
                        {working}
                      </div>
                      <div style={{ fontSize:11, color:"#831843", marginTop:4, lineHeight:1, fontWeight:700, letterSpacing:"0.04em" }}>/ {needed}</div>
                    </td>
                  );
                }); })()}
                <td style={{ padding:"12px 8px", borderTop:"3px solid #831843", borderBottom:"3px solid #831843", borderLeft:"2px solid #FBCFE8", background:"#831843" }}></td>
                <td style={{ padding:"12px 8px", borderTop:"3px solid #831843", borderBottom:"3px solid #831843", background:"#831843" }}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginTop:14, fontSize:11, color:"#831843", alignItems:"center" }}>
        <strong>Legend:</strong>
        {["W","WL","O","R","L","E","X"].map(c => (
          <span key={c} style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
            <span style={{ ...cellStyle(c), padding:"2px 7px", borderRadius:4, fontWeight:700, minWidth:22, textAlign:"center" }}>{c}</span>
            {c==="W"?"Work":c==="WL"?"Work late":c==="O"?"Off":c==="R"?"Requested off":c==="L"?"Leave":c==="E"?"Extra cover":"Pre-start"}
          </span>
        ))}
        <span style={{ display:"inline-flex", alignItems:"center", gap:6, marginLeft:8 }}>
          <span style={{ background:"#fef3c7", color:"#92400e", padding:"2px 7px", borderRadius:4, fontWeight:700, fontSize:10 }}>BUSY</span>
          25th–6th — peak revenue period (yellow header)
        </span>
        <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
          <span style={{ background:"#ede9fe", color:"#5b21b6", padding:"2px 7px", borderRadius:4, fontWeight:700, fontSize:10 }}>HOL</span>
          🇿🇦 SA public holiday (lavender header — hover for name)
        </span>
      </div>

      {/* ─── Off-Days Per Week summary table ─────────────────────────── */}
      {techs.length > 0 && (() => {
        // Determine Sunday Group A/B by deterministic alphabetical sort (matches auto-fill)
        const sortedTechs = [...techs].sort((a,b) => (a.ec || "").localeCompare(b.ec || ""));
        const sundayGroup = {};
        sortedTechs.forEach((s, i) => { sundayGroup[s.ec] = (i % 2 === 0) ? "A" : "B"; });

        // Identify busy-period weeks: any FULL week that contains 25-31 of prev month or 1-6 of current month
        const ymP = ym.split("-").map(Number);
        const curMonth = ymP[1], prevMonth = (curMonth === 1) ? 12 : curMonth - 1;
        const isBusyDay = (d) => {
          const m = d.monthIdx + 1;
          if (m === prevMonth && d.d >= 25) return true;
          if (m === curMonth && d.d <= 6)   return true;
          return false;
        };
        // Match auto-fill: prefer busy weeks; fall back to earliest full weeks otherwise
        const fullWeekMeta = weekChunks
          .map((w, i) => ({ i, full: w.length === 7, hasBusy: w.some(isBusyDay) }))
          .filter(x => x.full);
        const busyWeekIndices = fullWeekMeta.filter(x => x.hasBusy).map(x => x.i);
        const fallbackWeekIndices = fullWeekMeta.filter(x => !x.hasBusy).sort((a,b)=>a.i-b.i).map(x => x.i);
        const designatedCandidates = busyWeekIndices.length > 0 ? busyWeekIndices : fallbackWeekIndices;

        // Each staff gets exactly ONE designated 6-day week per month
        function designatedBusyWeek(staffIdx) {
          if (designatedCandidates.length === 0) return -1;
          return designatedCandidates[staffIdx % designatedCandidates.length];
        }

        // Range label for a week's header (e.g. "27 – 3")
        const rangeLabel = (w) => {
          if (!w.length) return "";
          const first = w[0], last = w[w.length-1];
          const partial = w.length < 7 ? " (partial)" : "";
          if (first.monthIdx === last.monthIdx)
            return first.d + "–" + last.d + partial;
          return first.d + "–" + last.d + partial;
        };

        // Sunday counters
        const sundaysInPeriod = days.filter(d => d.dow === 0);

        // Status pill style
        const pill = (txt, status, isDesig) => {
          const bgs = { on:"#dcfce7", under:"#fee2e2", over:"#fef3c7", neutral:"#e0f2fe" };
          const fgs = { on:"#15803d", under:"#991b1b", over:"#92400e", neutral:"#075985" };
          return (
            <span style={{ display:"inline-block", padding:"3px 10px", borderRadius:14, background:bgs[status], color:fgs[status], fontWeight:700, fontSize:11, minWidth:30, textAlign:"center" }}>
              {txt}{isDesig ? "*" : ""}
            </span>
          );
        };

        const dotStyle = (color) => ({ display:"inline-block", width:10, height:10, borderRadius:"50%", background:color, marginRight:4, verticalAlign:"middle" });

        return (
          <div style={{ marginTop:24, background:"#fff", border:"1px solid #FBCFE8", borderRadius:14, padding:"18px 20px" }}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:700, color:"#831843" }}>Off-Days Per Week</div>
            <div style={{ fontSize:12, color:"#BE185D", marginTop:4, marginBottom:14, lineHeight:1.5 }}>
              Target: <strong>2 off</strong> per week. <strong>*</strong> = the staff's designated 6-day week (target: 1 off).
              <span style={dotStyle("#15803d")}></span>on target ·
              <span style={{ ...dotStyle("#991b1b"), marginLeft:8 }}></span>under ·
              <span style={{ ...dotStyle("#eab308"), marginLeft:8 }}></span>over (likely leave/requests).
              &nbsp;&nbsp;<strong>Sundays</strong> shows off-Sundays / total.
            </div>

            <div style={{ overflowX:"auto" }}>
              <table style={{ borderCollapse:"collapse", width:"100%", fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #FBCFE8" }}>
                    <th style={{ padding:"8px 10px", textAlign:"left", color:"#BE185D", fontSize:10, letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:700 }}>Staff</th>
                    <th style={{ padding:"8px 10px", color:"#BE185D", fontSize:10, letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:700 }}>Grp</th>
                    {weekChunks.map((w, wi) => (
                      <th key={wi} style={{ padding:"8px 8px", color:"#BE185D", fontSize:10, letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:700, textAlign:"center", borderRight: wi < weekChunks.length-1 ? "1px solid #FCE7F3" : "none" }}>
                        Wk {wi+1}<br/>
                        <span style={{ fontSize:9, fontWeight:500, color:"#F472B6", textTransform:"none", letterSpacing:"normal" }}>{rangeLabel(w)}</span>
                      </th>
                    ))}
                    <th style={{ padding:"8px 10px", color:"#BE185D", fontSize:10, letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:700, textAlign:"center", borderLeft:"2px solid #FBCFE8" }}>Total</th>
                    <th style={{ padding:"8px 10px", color:"#BE185D", fontSize:10, letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:700, textAlign:"center" }}>Sundays<br/><span style={{ fontSize:9, fontWeight:500, textTransform:"none", letterSpacing:"normal" }}>off / total</span></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTechs.map((s, sIdx) => {
                    const row = grid[s.ec] || {};
                    const designatedWk = designatedBusyWeek(sIdx);
                    let total = 0, sundaysOff = 0, sundaysWorked = 0;
                    sundaysInPeriod.forEach(d => {
                      const v = row[d.d];
                      if (v === "O" || v === "R" || v === "L") sundaysOff++;
                      else if (v === "W" || v === "WL" || v === "E") sundaysWorked++;
                    });
                    return (
                      <tr key={s.ec} style={{ borderBottom:"1px solid #FCE7F3" }}>
                        <td style={{ padding:"8px 10px" }}>
                          <div style={{ fontWeight:700, color:"#831843", fontSize:13 }}>{s.name}</div>
                          <div style={{ fontSize:10, color:"#9CA3AF", letterSpacing:"0.04em" }}>{s.ec}</div>
                        </td>
                        <td style={{ padding:"8px 10px", textAlign:"center" }}>
                          <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:10, background: sundayGroup[s.ec]==='A'?"#dbeafe":"#fce7f3", color: sundayGroup[s.ec]==='A'?"#1e3a8a":"#9d174d", fontWeight:700, fontSize:11 }}>
                            {sundayGroup[s.ec]}
                          </span>
                        </td>
                        {weekChunks.map((w, wi) => {
                          const offCount = w.filter(d => {
                            const v = row[d.d];
                            return v === "O" || v === "R" || v === "L";
                          }).length;
                          total += offCount;
                          const isDesig = wi === designatedWk;
                          const target = isDesig ? 1 : 2;
                          const isPartial = w.length < 7;
                          let status = "on";
                          if (isPartial) status = "neutral";
                          else if (offCount > target) status = "over";
                          else if (offCount < target) status = "under";
                          return (
                            <td key={wi} style={{ padding:"8px 6px", textAlign:"center", borderRight: wi < weekChunks.length-1 ? "1px solid #FCE7F3" : "none" }}>
                              {pill(offCount, status, isDesig)}
                            </td>
                          );
                        })}
                        <td style={{ padding:"8px 10px", textAlign:"center", borderLeft:"2px solid #FBCFE8" }}>
                          <span style={{ display:"inline-block", padding:"3px 12px", borderRadius:14, background:"#e0f2fe", color:"#075985", fontWeight:800, fontSize:12 }}>{total}</span>
                        </td>
                        <td style={{ padding:"8px 10px", textAlign:"center" }}>
                          <span style={{ display:"inline-block", padding:"3px 10px", borderRadius:14, background:"#fdf2f8", color:"#831843", fontWeight:700, fontSize:11 }}>
                            {sundaysOff} / {sundaysInPeriod.length}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Designated 6-day weeks summary */}
            {designatedCandidates.length > 0 && (
              <div style={{ marginTop:18, background:"#FCE7F3", border:"1px solid #FBCFE8", borderRadius:10, padding:"12px 14px", fontSize:12, color:"#831843" }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>
                  📌 Designated 6-day weeks
                  {busyWeekIndices.length > 0
                    ? <span> (preferring busy period <strong>{prevMonth}/25 – {curMonth}/6</strong>):</span>
                    : <span style={{ color:"#92400e" }}> (no busy-period weeks in this period — falling back to earliest full week):</span>}
                </div>
                <ul style={{ margin:0, paddingLeft:20, lineHeight:1.6 }}>
                  {designatedCandidates.map(wIdx => {
                    const staffOnThisWeek = sortedTechs.filter((_, i) => designatedBusyWeek(i) === wIdx);
                    const isBusyWk = busyWeekIndices.includes(wIdx);
                    return (
                      <li key={wIdx}>
                        <strong>Wk {wIdx+1}</strong> ({rangeLabel(weekChunks[wIdx])})
                        {isBusyWk ? <span style={{ background:"#fef3c7", color:"#92400e", padding:"1px 6px", borderRadius:4, fontSize:10, marginLeft:6, fontWeight:700 }}>BUSY</span> : <span style={{ background:"#e5e7eb", color:"#475569", padding:"1px 6px", borderRadius:4, fontSize:10, marginLeft:6, fontWeight:700 }}>FALLBACK</span>}
                        &nbsp;— {staffOnThisWeek.length} staff:&nbsp;{staffOnThisWeek.map(s => s.name.split(" ")[0]).join(", ")}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── PIN LOGIN SCREEN ─────────────────────────────────────────────────────────
// Gates the whole app behind a 4-digit personal PIN so the activity log can
// attribute every edit / transfer / off-board / schedule save to a specific
// staff member. Session is stored in sessionStorage (cleared on tab close).
function PinLogin({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const submit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const u = STAFF_USERS[pin];
    if (!u) {
      setError("Wrong PIN. Please try again.");
      setPin("");
      return;
    }
    const session = { pin, name: u.name, role: u.role, demo: !!u.demo, hideCategories: u.hideCategories || [], hideTabs: u.hideTabs || [], signedInAt: new Date().toISOString() };
    try { sessionStorage.setItem(PIN_SESSION_KEY, JSON.stringify(session)); } catch (_) {}
    window.BOA_CURRENT_USER = session;
    onUnlock(session);
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(180deg,#FCE7F3 0%,#FFFFFF 50%)", fontFamily:"'DM Sans',sans-serif" }}>
      <form onSubmit={submit} style={{ background:"#fff", padding:"36px 40px", borderRadius:18, border:"1px solid #FBCFE8", boxShadow:"0 10px 30px rgba(190,24,93,0.15)", width:340, textAlign:"center" }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:28, color:"#831843", fontWeight:700, marginBottom:6 }}>BOA HR</div>
        <div style={{ fontSize:12, color:"#BE185D", letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, marginBottom:22 }}>Staff Sign-In</div>
        <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#831843", letterSpacing:"0.08em", textAlign:"left", marginBottom:6 }}>ENTER YOUR 4-DIGIT PIN</label>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          value={pin}
          autoFocus
          onChange={e => { setPin(e.target.value.replace(/\D/g,"").slice(0,4)); setError(""); }}
          style={{ width:"100%", padding:"12px 14px", fontSize:22, letterSpacing:"0.5em", textAlign:"center", border:"1px solid #FBCFE8", borderRadius:10, fontFamily:"inherit", color:"#831843" }}
          placeholder="••••"
        />
        {error && <div style={{ color:"#dc2626", fontSize:12, marginTop:10, fontWeight:600 }}>{error}</div>}
        <button type="submit" disabled={pin.length !== 4}
          style={{ marginTop:18, width:"100%", padding:"11px 14px", background:pin.length===4?"#BE185D":"#FBCFE8", color:pin.length===4?"#fff":"#9F1A4F", border:"none", borderRadius:10, cursor:pin.length===4?"pointer":"not-allowed", fontFamily:"inherit", fontSize:13, fontWeight:700, letterSpacing:"0.06em" }}>
          UNLOCK
        </button>
        <div style={{ fontSize:10, color:"#9CA3AF", marginTop:14 }}>Each action you take is logged with your name.</div>
      </form>
    </div>
  );
}

// ─── APP GATE ─────────────────────────────────────────────────────────────────
// Mounts the PIN sign-in screen until a valid user is set. Once unlocked, the
// real <App/> mounts. Done as a wrapper so <App/>'s hooks always run in the
// same order — putting the PIN check inside <App/> would change hook count.
function AppGate() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const raw = sessionStorage.getItem(PIN_SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s && STAFF_USERS[s.pin]) {
        const u = STAFF_USERS[s.pin];
        const merged = { ...s, demo: !!u.demo, hideCategories: u.hideCategories || [], hideTabs: u.hideTabs || [] };
        window.BOA_CURRENT_USER = merged;
        return merged;
      }
    } catch (_) {}
    return null;
  });
  if (!currentUser) {
    return <PinLogin onUnlock={(s) => setCurrentUser(s)} />;
  }
  const signOut = () => {
    try { sessionStorage.removeItem(PIN_SESSION_KEY); } catch (_) {}
    window.BOA_CURRENT_USER = null;
    setCurrentUser(null);
  };
  return <App currentUser={currentUser} onSignOut={signOut} />;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────────
let seed = 5000;
function App({ currentUser, onSignOut }) {
  // ── Activity logger — records who did what to the boa_activity_log_v1 row.
  // Failures are swallowed so a logging hiccup never blocks the actual edit.
  const logActivity = async (action, target, details) => {
    if (!window.BOA_DB || !window.BOA_DB.appendActivity) return;
    const u = currentUser || window.BOA_CURRENT_USER || {};
    try {
      await window.BOA_DB.appendActivity({
        who:     u.name || "Unknown",
        role:    u.role || "",
        action:  action || "",
        target:  target || "",
        details: details || ""
      });
    } catch (e) { console.warn("logActivity:", e); }
  };
  // Expose for components defined outside App() (e.g. <Schedule/>).
  useEffect(() => { window.BOA_LOG_ACTIVITY = logActivity; }, [currentUser]);

  // Demo accounts: install no-op persistence shim so nothing saves to the server.
  useEffect(() => { if (currentUser?.demo) installDemoMode(); }, [currentUser]);

  const [staff, setStaff] = useState([]);
  const [matRecs, setMatRecs] = useState([]);
  const [tab, setTab] = useState("dashboard");
  // Recruitment is now a parent tab with two children (Nail Tech / Manager).
  // The Manager child further nests Coverage and Planner.
  const [recruitSubTab, setRecruitSubTab] = useState("nailTech");   // "nailTech" | "mgrRecruit"
  const [mgrSubTab, setMgrSubTab] = useState("coverage");           // "coverage" | "planner"
  // Scheduling is a parent tab with two children (Nail Tech / Manager).
  const [schedSubTab, setSchedSubTab] = useState("techs");          // "techs" | "managers"
  // Leave Planner has a similar split.
  const [leaveSubTab, setLeaveSubTab] = useState("techs");          // "techs" | "managers"
  const [staffModal, setStaffModal] = useState(null);
  const [matModal, setMatModal] = useState(null);
  const [transferModal, setTransferModal] = useState(null);
  const [managePanel, setManagePanel] = useState(null);
  const [managers, setManagers] = useState([]);
  const [mgrModal, setMgrModal] = useState(null);
  const [plannerMgrs, setPlannerMgrs] = useState(null); // null = not yet opened; initialised on first open
  const [dragMgr, setDragMgr] = useState(null); // {_id, name, role} being dragged
  const [search, setSearch] = useState("");
  const [fBranch, setFBranch] = useState("All");
  const [fPermit, setFPermit] = useState("All");
  const [fContract, setFContract] = useState("All");
  const [fShow, setFShow] = useState("all"); // all | on_mat | active_only
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // ── Manager personal PIN registry (boa_mgr_pins_v1) ─────────────────
  const [mgrPins, setMgrPins] = useState({});         // {ec: "6-digit-pin"}

  // ── Activity log viewer state ──────────────────────────────────────
  const [activityRows, setActivityRows]   = useState([]);
  const [activityLoad, setActivityLoad]   = useState(false);
  const [activityFWho, setActivityFWho]   = useState("All");
  const [activityFAction, setActivityFAction] = useState("All");
  const [activityTick, setActivityTick]   = useState(0);
  useEffect(() => {
    if (tab !== "activity") return;
    if (!window.BOA_DB || !window.BOA_DB.loadActivity) return;
    setActivityLoad(true);
    window.BOA_DB.loadActivity()
      .then(rows => setActivityRows(Array.isArray(rows) ? rows : []))
      .catch(() => setActivityRows([]))
      .finally(() => setActivityLoad(false));
  }, [tab, activityTick]);

  // ── Manager Schedule state ─────────────────────────────────────────
  const [mgrSchedBranch, setMgrSchedBranch] = useState(SALONS[0].name);
  const [mgrSchedCycle, setMgrSchedCycle] = useState(""); // YYYY-MM-25 cycle start
  const [navCategory, setNavCategory] = useState("People"); // open nav category
  // Whether the user has explicitly picked a category tile while on the dashboard.
  // Used to decide whether to show Quick Actions or the category's sub-tabs in the
  // panel under the tiles when tab === "dashboard".
  const [navShowCategory, setNavShowCategory] = useState(false);
  // Map of tab → category name. Kept in sync with the groups list below.
  const NAV_TAB_TO_CATEGORY = {
    onboard:"People", offboard:"People", staff:"People", recruitment:"People", maternity:"People",
    scheduling:"Operations", locations:"Operations", mgrclockins:"Operations", leave:"Operations", checkins:"Operations",
    attendance:"Payroll",
    alerts:"Insights", activity:"Insights"
  };
  useEffect(() => {
    // Manager Planner is a virtual tab that lives at recruitment+mgrRecruit+planner
    // but visually belongs under Operations.
    const isPlanner = tab === "recruitment" && recruitSubTab === "mgrRecruit" && mgrSubTab === "planner";
    const cat = isPlanner ? "Operations" : NAV_TAB_TO_CATEGORY[tab];
    if (cat && cat !== navCategory) setNavCategory(cat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, recruitSubTab, mgrSubTab]);
  const [mgrSchedTick, setMgrSchedTick] = useState(0);    // bump after edits to force refetch
  const [mgrSchedHist, setMgrSchedHist] = useState({});   // {branch|ym: [grids...]} for undo

  // ── Manager Clock-ins viewer state ─────────────────────────────────
  const [mgrClockinRows, setMgrClockinRows] = useState([]);
  const [mgrClockinMeta, setMgrClockinMeta] = useState({});  // {clockinId: meta}
  const [mgrClockinFilterBranch, setMgrClockinFilterBranch] = useState("All");
  const [mgrClockinDays, setMgrClockinDays] = useState(7);
  const [mgrClockinPhoto, setMgrClockinPhoto] = useState(null);   // {url, name, ts, ...}
  const [mgrClockinSchedCache, setMgrClockinSchedCache] = useState({});  // {branch|ym: grid}

  // ── Daily Check-ins (nail tech) state ──────────────────────────────
  // Loaded once when the Check-ins tab or the Attendance tab opens, so the
  // attendance grid can overlay check-in markers without a per-cell fetch.
  const [techClockinRows, setTechClockinRows] = useState([]);
  const [techClockinDays, setTechClockinDays] = useState(60);          // load window
  const [checkinFilterBranch, setCheckinFilterBranch] = useState("All");
  const [checkinDayRange,     setCheckinDayRange]     = useState(7);    // viewer range

  // ── Onboarding / Off-boarding state ────────────────────────────────
  const [obList, setObList] = useState([]);           // joiner records
  const [offList, setOffList] = useState([]);         // leaver records
  const [obForm, setObForm] = useState({              // onboarding inline form
    name:"", ec:"", branch: SALONS[0].name, position:"Nail Tech",
    positionOther:"", startDate:"", notes:"", _editId: null
  });
  const [quickPick, setQuickPick] = useState(null);   // pending-term quick-pick modal
  const [pendingTerms, setPendingTerms] = useState([]);  // auto-detected from attendance grid

  // ── Leave Planner state ────────────────────────────────────────────
  const [leaveRecs, setLeaveRecs] = useState([]);
  const [leaveBranch, setLeaveBranch] = useState(SALONS[0].name);
  const [leaveYM, setLeaveYM] = useState(window.BOA_DB ? window.BOA_DB.currentSchedYm() : "2026-05");
  const [leaveForm, setLeaveForm] = useState({ ec:"", startDate:"", endDate:"", emergency:false, emergencyNote:"" });
  // Schedule cache for theoretical-off-day calculation: keyed by `<branch>|<ym>`,
  // value is the saved schedule grid (or null if not generated yet for that month).
  const [schedCache, setSchedCache] = useState({});

  // Helper: convert a "YYYY-MM-DD" string to the schedule period <ym> that covers it.
  // Schedule periods run 25th-24th, so day > 24 belongs to the NEXT calendar month.
  const ymdToSchedYm = (ymd) => {
    const [y, m, d] = ymd.split("-").map(Number);
    let ym, yy = y, mm = m;
    if (d > 24) { mm = m + 1; if (mm > 12) { mm = 1; yy = y + 1; } }
    return yy + "-" + String(mm).padStart(2, "0");
  };

  // Pre-fetch schedule grids for all (branch, ym) pairs touched by leave records
  // and the currently-visible 6-month calendar range. Cached to avoid re-fetching.
  useEffect(() => {
    if (tab !== "leave") return;
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    const needed = new Set();
    // Months covered by leave records (need schedule per branch the leaver works at)
    leaveRecs.forEach(lv => {
      const s = staff.find(x => x.ec === lv.ec) || managers.find(x => x.ec === lv.ec);
      if (!s) return;
      const sd = new Date(lv.startDate), ed = new Date(lv.endDate);
      for (let d = new Date(sd); d <= ed; d.setDate(d.getDate()+1)) {
        const ymd = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
        needed.add(s.branch + "|" + ymdToSchedYm(ymd));
      }
    });
    // Visible 6 payroll cycles for the currently-selected branch.
    // Each cycle's ym IS the schedule key — no date-to-cycle mapping needed.
    const ymP = leaveYM.split("-").map(Number);
    for (let i = 0; i < 6; i++) {
      let y = ymP[0], m = ymP[1] + i;
      while (m > 12) { m -= 12; y++; }
      needed.add(leaveBranch + "|" + y + "-" + String(m).padStart(2,"0"));
    }
    const missing = [...needed].filter(k => !(k in schedCache));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map(async (k) => {
      const [branch, ym] = k.split("|");
      try {
        const sched = await window.BOA_DB.loadSchedule(branch, ym, false);
        return [k, (sched && sched.grid) || null];
      } catch (_) { return [k, null]; }
    })).then(pairs => {
      if (cancelled) return;
      setSchedCache(prev => {
        const next = { ...prev };
        for (const [k, g] of pairs) next[k] = g;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [tab, leaveBranch, leaveYM, leaveRecs, staff, managers]);

  // ── Attendance tab state ───────────────────────────────────────────
  const [attBranch, setAttBranch] = useState(SALONS[0].name);
  const [attYM,     setAttYM]     = useState(window.BOA_DB ? window.BOA_DB.currentSchedYm() : "2026-05");
  const [attGrid,   setAttGrid]   = useState({});      // per-staff per-day status codes
  const [attSched,  setAttSched]  = useState({});      // schedule grid for the same period (for mirror hints)
  const [attMeta,   setAttMeta]   = useState({});      // sidecar metadata e.g. { freshaCoverage:{through:"YYYY-MM-DD"} }
  const [attLoading,setAttLoading]= useState(false);

  // Load attendance grid + schedule grid whenever the tab/branch/period changes.
  useEffect(() => {
    if (tab !== "attendance") return;
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    setAttLoading(true);
    const safe = (p) => p.catch(() => null);
    // Tech schedules in BOA_DB.periodDays use an END-month ym convention
    // (ym="2026-05" means the cycle April 25 → May 24). Attendance and the
    // manager schedule use a START-month ym (ym="2026-04" means April 25 →
    // May 24). Convert attYM (start-month) to the matching tech ym.
    const _atP = attYM.split("-").map(Number);
    let _atY = _atP[0], _atM = _atP[1] + 1;
    if (_atM > 12) { _atM = 1; _atY++; }
    const techYm = _atY + "-" + String(_atM).padStart(2, "0");
    // Manager schedule grids key cells by YYYY-MM-DD strings (mgrSched line 141),
    // while tech schedule grids and the attendance UI use day-of-month numbers.
    // Re-key the manager grid so a shallow merge by EC works.
    const ymdReKey = (rawGrid) => {
      const out = {};
      for (const ec in rawGrid) {
        const row = rawGrid[ec] || {};
        const conv = {};
        for (const k in row) {
          const m = /^\d{4}-\d{2}-(\d{2})$/.exec(k);
          if (m) conv[parseInt(m[1], 10)] = row[k];
          else   conv[k] = row[k];
        }
        out[ec] = conv;
      }
      return out;
    };
    Promise.all([
      safe(window.BOA_DB.loadAttendance(attBranch, attYM)),
      safe(window.BOA_DB.loadSchedule(attBranch, techYm, false)),
      safe(window.BOA_DB.loadSchedule(attBranch, attYM, true))
    ]).then(([att, sch, mgrSch]) => {
      setAttGrid((att && att.grid) || {});
      setAttMeta(att ? { freshaCoverage: att.freshaCoverage || null } : {});
      const techGrid = (sch    && sch.grid)    || {};
      const mgrGrid  = ymdReKey((mgrSch && mgrSch.grid) || {});
      setAttSched({ ...techGrid, ...mgrGrid });
    }).catch(e => console.error("Attendance load:", e))
      .finally(() => setAttLoading(false));
  }, [tab, attBranch, attYM]);

  // ── Dashboard: count staff scheduled to work today across all branches ──
  const [dashScheduledToday, setDashScheduledToday] = useState(null); // null = loading
  const [dashByBranch, setDashByBranch] = useState({});
  useEffect(() => {
    if (tab !== "dashboard") return;
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    let cancelled = false;
    setDashScheduledToday(null);
    const today = new Date();
    const todayDay = today.getDate();
    const ymd = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,"0") + "-" + String(todayDay).padStart(2,"0");
    const ym = window.BOA_DB.currentSchedYm ? window.BOA_DB.currentSchedYm() : (today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,"0"));
    // Manager schedule stores under the START-month ym (cycle's 25th-of-month-X
    // is saved under ym "X"), while currentSchedYm() returns the END-month ym
    // for the same cycle. Shift back one month for the manager lookup.
    const _ymP = ym.split("-").map(Number);
    let _mgrY = _ymP[0], _mgrM = _ymP[1] - 1;
    if (_mgrM < 1) { _mgrM = 12; _mgrY--; }
    const mgrYm = _mgrY + "-" + String(_mgrM).padStart(2, "0");
    const safe = (p) => p.catch(() => null);
    Promise.all(SALONS.map(async (sl) => {
      const [tech, mgr] = await Promise.all([
        safe(window.BOA_DB.loadSchedule(sl.name, ym, false)),
        safe(window.BOA_DB.loadSchedule(sl.name, mgrYm, true))
      ]);
      const techGrid = (tech && tech.grid) || {};
      const mgrGrid  = (mgr  && mgr.grid)  || {};
      const isWorking = (v) => v === "W" || v === "WL" || v === "E";
      let count = 0;
      for (const ec in techGrid) {
        const v = techGrid[ec][todayDay];
        if (isWorking(v)) count++;
      }
      for (const ec in mgrGrid) {
        // manager grid is keyed by YMD strings (mgrSched line 141)
        const v = mgrGrid[ec][ymd] || mgrGrid[ec][todayDay];
        if (isWorking(v)) count++;
      }
      return [sl.name, count];
    })).then(pairs => {
      if (cancelled) return;
      const map = {};
      let total = 0;
      for (const [name, c] of pairs) { map[name] = c; total += c; }
      setDashByBranch(map);
      setDashScheduledToday(total);
    });
    return () => { cancelled = true; };
  }, [tab, staff, managers]);

  // ── Upcoming-cycle schedule check ── flags branches whose tech / manager
  // schedule for the coming month hasn't been saved. Deadline is the 15th.
  // Surfaces as a dashboard "Needs attention" item and as an Alerts entry.
  const SCHED_ALERT_PINS = new Set(["1993", "2023", "3030"]); // Master, Kelly, Rochelle
  const [upcomingMissing, setUpcomingMissing] = useState([]); // [{ branch, type, ym }]
  const [upcomingChecked, setUpcomingChecked] = useState(false);
  useEffect(() => {
    if (!SCHED_ALERT_PINS.has(currentUser.pin)) return;
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    if (!(tab === "dashboard" || tab === "alerts")) return;
    let cancelled = false;
    const today = new Date();
    // Schedules must be saved by the 15th of each month for the FOLLOWING
    // calendar month. The cycle covering month M+1 starts on the 25th of
    // month M and ends on the 24th of month M+1.
    //   - Before the 25th: the next cycle to plan covers next month (M+1).
    //   - On/after the 25th: that cycle has already begun, so next-to-plan
    //     covers month M+2.
    // upStartM/upStartY = the START month/year (manager schedule ym)
    // upEndM/upEndY     = the END / "covered" month/year (tech schedule ym + display label)
    let upStartY = today.getFullYear(), upStartM = today.getMonth(); // 0-11
    if (today.getDate() >= 25) { upStartM++; if (upStartM > 11) { upStartM = 0; upStartY++; } }
    let upEndY = upStartY, upEndM = upStartM + 1;
    if (upEndM > 11) { upEndM = 0; upEndY++; }
    const upMgrYm  = upStartY + "-" + String(upStartM + 1).padStart(2, "0"); // manager save key
    const upTechYm = upEndY   + "-" + String(upEndM   + 1).padStart(2, "0"); // tech save key
    const safe = (p) => p.catch(() => null);
    const isPopulated = (loaded) => {
      if (!loaded || !loaded.grid) return false;
      for (const ec in loaded.grid) for (const _ in loaded.grid[ec]) return true;
      return false;
    };
    Promise.all(SALONS.flatMap(sl => [
      safe(window.BOA_DB.loadSchedule(sl.name, upTechYm, false)).then(r => ({ branch: sl.name, type: "tech", saved: isPopulated(r), ym: upTechYm, endY: upEndY, endM: upEndM })),
      safe(window.BOA_DB.loadSchedule(sl.name, upMgrYm,  true )).then(r => ({ branch: sl.name, type: "mgr",  saved: isPopulated(r), ym: upMgrYm,  endY: upEndY, endM: upEndM }))
    ])).then(results => {
      if (cancelled) return;
      const missing = results.filter(r => !r.saved).map(r => ({ branch: r.branch, type: r.type, ym: r.ym, endY: r.endY, endM: r.endM }));
      setUpcomingMissing(missing);
      setUpcomingChecked(true);
    });
    return () => { cancelled = true; };
  }, [tab, currentUser.pin]);

  useEffect(() => {
    if (!window.BOA_DB || !window.BOA_DB.isReady) {
      setLoadError("Supabase isn't configured yet — fill in BOA_SUPABASE_CONFIG and reload.");
      setLoading(false);
      return;
    }
    Promise.all([
      window.BOA_DB.loadAll(),
      window.BOA_DB.loadOnboarding(),
      window.BOA_DB.loadOffboarding(),
      window.BOA_DB.loadLeaveRecords(),
      window.BOA_DB.loadManagerPins()
    ]).then(([d, ob, off, lv, pins]) => {
      setStaff(d.staff);
      setManagers(d.managers);
      setMatRecs(d.matRecs);
      setObList(Array.isArray(ob) ? ob : []);
      setOffList(Array.isArray(off) ? off : []);
      setLeaveRecs(Array.isArray(lv) ? lv : []);
      setMgrPins(pins && typeof pins === "object" ? pins : {});
      setLoading(false);
    }).catch((err) => {
      setLoadError("Could not load data: " + (err.message || err));
      setLoading(false);
    });
  }, []);

  // Default the manager-schedule cycle to "current cycle's 25th" when first opened.
  useEffect(() => {
    if (!(tab === "scheduling" && schedSubTab === "managers")) return;
    if (mgrSchedCycle) return;
    const today = new Date();
    let y = today.getFullYear();
    let m = today.getMonth();          // 0-indexed
    if (today.getDate() < 25) m--;
    if (m < 0) { m = 11; y--; }
    setMgrSchedCycle(y + "-" + String(m+1).padStart(2,"0") + "-25");
  }, [tab, schedSubTab, mgrSchedCycle]);

  // Load saved manager schedule for the selected branch+cycle. Stored under
  // boa_mgrsched_<branch>_<ym> via saveSchedule(..., true).
  const [mgrSchedSaved, setMgrSchedSaved]     = useState(null);    // grid persisted in DB (or null if none)
  const [mgrSchedDraft, setMgrSchedDraft]     = useState(null);    // grid currently in the editor
  const [mgrSchedDirty, setMgrSchedDirty]     = useState(false);   // edits since last save
  const [mgrSchedSavedAt, setMgrSchedSavedAt] = useState(null);    // ISO timestamp from DB
  const [mgrSchedSaving, setMgrSchedSaving]   = useState(false);
  const [mgrSchedLoaded, setMgrSchedLoaded]   = useState(false);
  useEffect(() => {
    if (!(tab === "scheduling" && schedSubTab === "managers")) return;
    if (!mgrSchedCycle) return;
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    setMgrSchedLoaded(false);
    let cancelled = false;
    const ymKey = mgrSchedCycle.slice(0, 7);
    window.BOA_DB.loadSchedule(mgrSchedBranch, ymKey, true)
      .then((s) => {
        if (cancelled) return;
        const hasGrid = s && s.grid && Object.keys(s.grid).length > 0;
        setMgrSchedSaved(hasGrid ? s.grid : null);
        setMgrSchedDraft(hasGrid ? s.grid : null);
        setMgrSchedSavedAt((s && s.savedAt) || null);
        setMgrSchedDirty(false);
        setMgrSchedLoaded(true);
      })
      .catch((e) => { console.error("loadMgrSched:", e); if (!cancelled) setMgrSchedLoaded(true); });
    return () => { cancelled = true; };
  }, [tab, schedSubTab, mgrSchedBranch, mgrSchedCycle, mgrSchedTick]);

  // Browser unload guard — warn if dirty
  useEffect(() => {
    if (!mgrSchedDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; return ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [mgrSchedDirty]);

  // ── Prior-cycle context (cross-month rollover for the leading partial week) ──
  // Loads the previous cycle's saved manager grid so mgrSched can seed
  // offWk[leading partial week] with how many off-days each manager
  // already has on the overlap days. Without this, the strict 2-off-per-
  // week cap can be silently broken across the 25th boundary.
  const [mgrPriorCtx, setMgrPriorCtx] = useState({ priorOffs: {}, priorMissing: false, nextOffs: {}, nextMissing: false });
  useEffect(() => {
    if (!(tab === "scheduling" && schedSubTab === "managers")) return;
    if (!mgrSchedCycle) return;
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    let cancelled = false;
    (async () => {
      const fmt = (dt) => dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0");
      // ── LEADING partial: days from previous Monday to (cycleStart - 1) ──
      const cs = new Date(mgrSchedCycle + "T00:00:00");
      const csDow = cs.getDay();             // 0=Sun..6=Sat
      const leadingCarry = (csDow === 0) ? 6 : csDow - 1;   // # days back to prev Monday
      const leadingOverlap = [];
      for (let k = leadingCarry; k > 0; k--) {
        const dt = new Date(cs); dt.setDate(cs.getDate() - k);
        leadingOverlap.push(fmt(dt));
      }
      // ── TRAILING partial: days from (cycleEnd + 1) to next Sunday ──
      // cycleEnd = 24th of the next month.
      const cycleEndDate = new Date(cs.getFullYear(), cs.getMonth() + 1, 24);
      const ceDow = cycleEndDate.getDay();
      const trailingCarry = (ceDow === 0) ? 0 : (7 - ceDow);   // # days forward to next Sunday
      const trailingOverlap = [];
      for (let k = 1; k <= trailingCarry; k++) {
        const dt = new Date(cycleEndDate); dt.setDate(cycleEndDate.getDate() + k);
        trailingOverlap.push(fmt(dt));
      }
      try {
        // Load PRIOR + NEXT cycle schedules in parallel
        const ymKey   = mgrSchedCycle.slice(0,7);
        const priorYm = window.BOA_DB.shiftYm(ymKey, -1);
        const nextYm  = window.BOA_DB.shiftYm(ymKey, +1);
        const [priorSched, nextSched] = await Promise.all([
          leadingCarry  > 0 ? window.BOA_DB.loadSchedule(mgrSchedBranch, priorYm, true) : Promise.resolve({ grid: {} }),
          trailingCarry > 0 ? window.BOA_DB.loadSchedule(mgrSchedBranch, nextYm,  true) : Promise.resolve({ grid: {} })
        ]);
        const tally = (sched, days) => {
          const grid = (sched && sched.grid) || {};
          const empty = !sched || !sched.grid || Object.keys(sched.grid).length === 0;
          const offs = {};
          if (!empty) {
            for (const ec of Object.keys(grid)) {
              const row = grid[ec] || {};
              let n = 0;
              for (const d of days) {
                const v = row[d];
                if (v === "O" || v === "R" || v === "L") n++;
              }
              if (n > 0) offs[ec] = n;
            }
          }
          return { offs, empty };
        };
        const lead  = leadingCarry  > 0 ? tally(priorSched, leadingOverlap) : { offs: {}, empty: false };
        const trail = trailingCarry > 0 ? tally(nextSched,  trailingOverlap) : { offs: {}, empty: false };
        if (!cancelled) setMgrPriorCtx({
          priorOffs:    lead.offs,
          priorMissing: leadingCarry  > 0 && lead.empty,
          nextOffs:     trail.offs,
          nextMissing:  trailingCarry > 0 && trail.empty
        });
      } catch (e) {
        console.warn("loadMgrPriorCtx:", e);
        if (!cancelled) setMgrPriorCtx({ priorOffs: {}, priorMissing: leadingCarry > 0, nextOffs: {}, nextMissing: trailingCarry > 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [tab, schedSubTab, mgrSchedBranch, mgrSchedCycle, mgrSchedTick]);

  // ── Manager off-day requests ────────────────────────────────────
  // Stored globally in app_state; we filter to current branch+cycle.
  const [mgrRequests, setMgrRequests]       = useState([]);
  const [mgrReqTick, setMgrReqTick]         = useState(0);
  const [mgrReqModal, setMgrReqModal]       = useState(null);  // {ec, name, date, note} draft
  useEffect(() => {
    if (!(tab === "scheduling" && schedSubTab === "managers")) return;
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    let cancelled = false;
    window.BOA_DB.loadMgrRequests()
      .then((arr) => { if (!cancelled) setMgrRequests(arr || []); })
      .catch((e) => { console.warn("loadMgrRequests:", e); });
    return () => { cancelled = true; };
  }, [tab, schedSubTab, mgrSchedTick, mgrReqTick]);

  // ── Manager-schedule trash (7-day soft-delete) ──────────────────
  const [mgrTrash, setMgrTrash]               = useState([]);
  const [mgrTrashOpen, setMgrTrashOpen]       = useState(false);
  const [mgrTrashTick, setMgrTrashTick]       = useState(0);
  useEffect(() => {
    if (!(tab === "scheduling" && schedSubTab === "managers")) return;
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    let cancelled = false;
    window.BOA_DB.listDeletedSchedules({ kind: "manager" })
      .then((arr) => { if (!cancelled) setMgrTrash(arr || []); })
      .catch((e) => { console.warn("listDeletedSchedules:", e); });
    return () => { cancelled = true; };
  }, [tab, schedSubTab, mgrSchedBranch, mgrSchedCycle, mgrSchedTick, mgrTrashTick]);

  // Load recent manager clock-ins when the viewer tab opens.
  useEffect(() => {
    if (tab !== "mgrclockins") return;
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await window.BOA_DB.listRecentManagerClockins(mgrClockinDays);
        if (cancelled) return;
        setMgrClockinRows(rows || []);
        // Lazily fetch metadata (photos + GPS) for the rows
        const need = (rows || []).filter(r => !(r.id in mgrClockinMeta));
        if (need.length > 0) {
          const pairs = await Promise.all(need.map(async (r) => {
            try { return [r.id, await window.BOA_DB.loadClockinMeta(r.id)]; }
            catch (_) { return [r.id, null]; }
          }));
          if (cancelled) return;
          setMgrClockinMeta(prev => {
            const next = { ...prev };
            pairs.forEach(([id, m]) => { next[id] = m; });
            return next;
          });
        }
        // ALSO load manager schedules for the cycles touched by the visible range,
        // for every branch — used to derive no-show flags.
        const today = new Date();
        const since = new Date(); since.setHours(0,0,0,0); since.setDate(since.getDate() - mgrClockinDays);
        const ymsInRange = new Set();
        // Helper: convert a date to its schedule period ym (cycle ending YYYY-MM-24)
        const ymdToYm = (d) => {
          let y = d.getFullYear(), m = d.getMonth() + 1;
          if (d.getDate() > 24) { m += 1; if (m > 12) { m = 1; y++; } }
          return y + "-" + String(m).padStart(2,"0");
        };
        for (let cur = new Date(since); cur <= today; cur.setDate(cur.getDate()+1)) {
          ymsInRange.add(ymdToYm(cur));
        }
        const need2 = [];
        for (const ym of ymsInRange) for (const sl of SALONS) {
          const k = sl.name + "|" + ym;
          if (!(k in mgrClockinSchedCache)) need2.push({ branch: sl.name, ym, key: k });
        }
        if (need2.length > 0) {
          const pairs = await Promise.all(need2.map(async (n) => {
            try { const s = await window.BOA_DB.loadSchedule(n.branch, n.ym, true); return [n.key, (s && s.grid) || null]; }
            catch (_) { return [n.key, null]; }
          }));
          if (cancelled) return;
          setMgrClockinSchedCache(prev => {
            const next = { ...prev };
            pairs.forEach(([k, g]) => { next[k] = g; });
            return next;
          });
        }
      } catch (e) { console.error("mgr clockins load:", e); }
    })();
    return () => { cancelled = true; };
  }, [tab, mgrClockinDays]);

  // Load recent nail-tech clock-ins when either the Check-ins tab or the
  // Attendance tab opens. The Attendance grid uses these to overlay check-in
  // markers on each cell and to flag discrepancies vs. the Fresha import.
  useEffect(() => {
    if (tab !== "checkins" && tab !== "attendance") return;
    if (!window.BOA_DB || !window.BOA_DB.isReady) return;
    if (!window.BOA_DB.listRecentTechClockins) return; // older deploys
    let cancelled = false;
    (async () => {
      try {
        const rows = await window.BOA_DB.listRecentTechClockins(techClockinDays);
        if (!cancelled) setTechClockinRows(rows || []);
      } catch (e) { console.error("tech clockins load:", e); }
    })();
    return () => { cancelled = true; };
  }, [tab, techClockinDays]);

  // Index check-ins by branch → ec → ymd, with per-day flags. Used by both the
  // Attendance grid and the Check-ins tab so the data is parsed once.
  const checkInsByBranch = useMemo(() => {
    const out = {};
    for (const r of techClockinRows || []) {
      if (!r || !r.staff || !r.staff.employee_code) continue;
      const branch = r.staff.branch || "";
      const ec = r.staff.employee_code;
      // ymd in local time so it lines up with the attendance grid's cycle days.
      const dt = new Date(r.ts);
      const ymd = dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0");
      if (!out[branch]) out[branch] = {};
      if (!out[branch][ec]) out[branch][ec] = {};
      const cell = out[branch][ec][ymd] = out[branch][ec][ymd] || { hasIn:false, hasOut:false, autoOut:false, firstInTs:null, name:r.staff.name || "" };
      if (r.type === "in")        { cell.hasIn  = true; cell.firstInTs = (cell.firstInTs && cell.firstInTs < dt) ? cell.firstInTs : dt; }
      if (r.type === "out")       { cell.hasOut = true; }
      if (r.type === "out_auto")  { cell.hasOut = true; cell.autoOut = true; }   // out_auto alone is NOT proof they clocked in
    }
    return out;
  }, [techClockinRows]);

  // Auto-detect pending terminations from attendance grids (current + 2 prior months)
  useEffect(() => {
    if (loading || !window.BOA_DB || !window.BOA_DB.isReady) return;
    if (tab !== "offboard") return;   // only refresh when the user opens the tab
    let cancelled = false;
    (async () => {
      const out = [];
      const seen = new Set();
      const now = new Date();
      for (let mOff = -2; mOff <= 0; mOff++) {
        const cur = new Date(now.getFullYear(), now.getMonth() + mOff, 1);
        const ymKey = cur.getFullYear() + "-" + String(cur.getMonth()+1).padStart(2,"0");
        for (const sl of SALONS) {
          let saved = null;
          try { saved = await window.BOA_DB.loadAttendance(sl.name, ymKey); } catch (_) {}
          if (!saved || !saved.grid) continue;
          for (const ec in saved.grid) {
            if (seen.has(ec)) continue;
            if (offList.some(o => o.ec === ec)) continue;
            const cells = saved.grid[ec] || {};
            const termDays = Object.keys(cells).filter(d => cells[d] === "term").map(d => parseInt(d, 10));
            if (termDays.length === 0) continue;
            const firstD = Math.min(...termDays);
            const firstYmd = cur.getFullYear() + "-" + String(cur.getMonth()+1).padStart(2,"0") + "-" + String(firstD).padStart(2,"0");
            const staffRec = staff.find(s => s.ec === ec) || managers.find(m => m.ec === ec);
            if (!staffRec) continue;
            seen.add(ec);
            out.push({ ec, name: staffRec.name, branch: staffRec.branch || sl.name, firstTermDate: firstYmd, month: ymKey });
          }
        }
      }
      if (!cancelled) setPendingTerms(out);
    })();
    return () => { cancelled = true; };
  }, [tab, loading, offList, staff, managers]);

  // ECs currently ON maternity leave (not just pregnant) → excluded from count
  const onMatEcs = useMemo(() =>
    new Set(matRecs.filter(r=>r.matStatus==="on_mat").map(r=>r.ec.trim()))
  , [matRecs]);

  // ECs who are pregnant (still in store)
  const pregnantEcs = useMemo(() =>
    new Set(matRecs.filter(r=>r.matStatus==="pregnant").map(r=>r.ec.trim()))
  , [matRecs]);

  // ECs that are off-boarded (any record in offList — current or future leftDate)
  const offboardedMap = useMemo(() => {
    const m = {};
    (offList || []).forEach(o => { if (o.ec) m[o.ec.trim()] = o; });
    return m;
  }, [offList]);

  // Enrich staff
  const enriched = useMemo(() => {
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return staff.map(s => {
      const off = offboardedMap[s.ec.trim()];
      // Days since leftDate: negative = future leftDate, 0 = today, positive = past
      let offDaysSinceLeft = null;
      let offHidden = false;
      if (off && off.leftDate) {
        const ld = new Date(off.leftDate + "T00:00:00");
        offDaysSinceLeft = Math.floor((t0 - ld) / 86400000);
        // Per business rule: leavers stay visible on Locations + Staff List
        // for 31 days from leftDate; after that they vanish from those views
        // (records persist in the Off-boarding tab as audit history).
        offHidden = offDaysSinceLeft > 31;
      }
      return {
        ...s,
        onMat:      onMatEcs.has(s.ec.trim()),     // excluded from count
        pregnant:   pregnantEcs.has(s.ec.trim()),  // still in store
        offboarded: !!off,                         // on the off-boarding list — vacancy now open
        offRec:     off || null,
        offDaysSinceLeft,                          // -ve / 0 / +ve days since leftDate
        offHidden,                                 // true when past 31-day display window
        matRec:     matRecs.find(r=>r.ec.trim()===s.ec.trim()),
      };
    });
  }, [staff, onMatEcs, pregnantEcs, offboardedMap, matRecs]);

  // Filtered & sorted staff list — always sort by EC (B-number then T-number).
  // Departed staff (leftDate has passed) are pinned to the bottom for the 31-day
  // grace window so the active list stays clean.
  const filtered = useMemo(() => {
    let list = enriched.filter(s => {
      if (s.offHidden) return false;          // hide off-boarded staff after the 31-day display window
      if (fShow==="on_mat" && !s.onMat) return false;
      if (fShow==="active_only" && s.onMat) return false;
      if (fBranch!=="All" && s.branch!==fBranch) return false;
      if (fPermit!=="All" && s.permit!==fPermit) return false;
      if (fContract!=="All" && s.contract!==fContract) return false;
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.ec.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    const isDeparted = (s) => s.offboarded && s.offDaysSinceLeft != null && s.offDaysSinceLeft >= 0;
    return list.sort((a, b) => {
      const ad = isDeparted(a) ? 1 : 0;
      const bd = isDeparted(b) ? 1 : 0;
      if (ad !== bd) return ad - bd;          // active first, departed last
      return ecSort(a, b);
    });
  }, [enriched, fShow, fBranch, fPermit, fContract, search]);

  const stats = useMemo(() => {
    // "active" excludes maternity AND off-boarded — both reduce the active headcount.
    const active = enriched.filter(s=>!s.onMat && !s.offboarded);
    const totalSeats = SALONS.reduce((a,s)=>a+s.capacity,0);
    const returning60 = matRecs.filter(r=>r.matStatus==="on_mat"&&r.returnDate&&daysDiff(r.returnDate)!==null&&daysDiff(r.returnDate)>=0&&daysDiff(r.returnDate)<=60).length;
    return {
      total:staff.length, active:active.length, onMat:onMatEcs.size,
      pregnant:pregnantEcs.size,
      zna:active.filter(s=>s.permit==="z_na").length,
      noContract:active.filter(s=>s.contract==="NO CONTRACT").length,
      // Vacancies and understaffed both treat off-boarded staff as gone, so leavers
      // immediately surface as open positions in the Recruitment tab.
      vacancies:SALONS.reduce((a,sl)=>{ const g=sl.targetCapacity||sl.capacity; const act=enriched.filter(s=>s.branch===sl.name&&!s.onMat&&!s.offboarded).length; return a+Math.max(0,g-act); },0),
      understaffed:SALONS.filter(sl=>enriched.filter(s=>s.branch===sl.name&&!s.onMat&&!s.offboarded).length<sl.capacity).length,
      returning60,
    };
  }, [enriched, matRecs, onMatEcs, pregnantEcs, staff]);

  // Locations
  const salonData = useMemo(() => SALONS.map(salon => {
    // .offHidden hides leavers older than 31 days post-leftDate from the cards.
    const all      = enriched.filter(s=>s.branch===salon.name && !s.offHidden).sort(ecSort);
    // Off-boarded staff are visually present (greyed) but excluded from the
    // active count and from urgency/fillRate — their seat is OPEN.
    const active   = all.filter(s=>!s.onMat && !s.isShadow && !s.offboarded);
    const onMat    = all.filter(s=>s.onMat);
    const offboarded = all.filter(s=>s.offboarded);          // greyed in UI, only those within the 31-day window
    const arriving = all.filter(s=>s.isShadow);              // pending incoming transfers — shown but not counted
    // Use targetCapacity for low-demand stores (e.g. Betty), full capacity otherwise
    const goal = salon.targetCapacity || salon.capacity;
    const fillRate = active.length/goal;
    const urgency = active.length===0?"critical":fillRate<0.5?"high":fillRate<1?"low":"full";
    return { ...salon, all, active, onMat, offboarded, arriving, urgency, goal };
  }), [enriched]);

  const uColor = { critical:"#dc2626", high:"#f97316", low:"#eab308", full:"#16a34a" };
  const uLabel = { critical:"UNSTAFFED", high:"UNDERSTAFFED", low:"NEEDS STAFF", full:"AT CAPACITY" };

  async function saveStaff(f) {
    try {
      const isEdit = f._id !== undefined;
      const saved = await window.BOA_DB.saveStaff(f);
      setStaff(p => isEdit ? p.map(x => x._id === f._id ? saved : x) : [...p, saved]);
      setStaffModal(null);
      logActivity(
        isEdit ? "Edited staff" : "Added staff",
        (saved.name || "") + (saved.ec ? " (" + saved.ec + ")" : ""),
        "Branch: " + (saved.branch || "—")
      );
    } catch (e) { alert("Could not save staff: " + (e.message || e)); }
  }

  function handleTransfer({ staff, toBranch, transferDate, note, isPending }) {
    setStaff(p => {
      // Remove any existing shadow record for this person first (in case of re-edit)
      let list = p.filter(x => !(x.isShadow && x.ec === staff.ec));
      list = list.map(x => {
        if (x._id !== staff._id) return x;
        if (isPending) {
          return { ...x, transferring:true, transferTo:toBranch, transferDate, transferNote:note };
        } else {
          // Immediate move — clean all transfer flags
          return { ...x, branch:toBranch, transferring:false, transferTo:null, transferDate:null, transferNote:note };
        }
      });
      if (isPending) {
        // Add fresh shadow on destination branch
        list = [...list, {
          ...staff, _id:++seed,
          branch:toBranch,
          transferring:true,
          transferFrom:staff.branch,
          transferDate,
          transferNote:note,
          isShadow:true,
        }];
      }
      return list;
    });
    setTransferModal(null);
    logActivity(
      isPending ? "Scheduled transfer" : "Transferred staff",
      (staff.name || "") + (staff.ec ? " (" + staff.ec + ")" : ""),
      (staff.branch || "—") + " → " + (toBranch || "—") +
        (transferDate ? " on " + transferDate : "") +
        (note ? " · " + note : "")
    );
  }

  function cancelTransfer(staff) {
    setStaff(p => {
      // Remove shadow record
      let list = p.filter(x => !(x.isShadow && x.ec === staff.ec));
      // Clear transfer flags on original record
      list = list.map(x => x._id !== staff._id ? x
        : { ...x, transferring:false, transferTo:null, transferDate:null, transferNote:null }
      );
      return list;
    });
    setTransferModal(null);
    logActivity(
      "Cancelled transfer",
      (staff.name || "") + (staff.ec ? " (" + staff.ec + ")" : ""),
      "Was → " + (staff.transferTo || "—")
    );
  }
  async function saveMat(f) {
    try {
      const saved = await window.BOA_DB.saveMat(f);
      setMatRecs(p => f._id !== undefined ? p.map(x => x._id === f._id ? saved : x) : [...p, saved]);
      setMatModal(null);
    } catch (e) { alert("Could not save: " + (e.message || e)); }
  }
  async function delMat(id) {
    try { await window.BOA_DB.deleteMat(id); setMatRecs(p => p.filter(x => x._id !== id)); setMatModal(null); }
    catch (e) { alert("Could not delete: " + (e.message || e)); }
  }
  async function saveMgr(f, newPin) {
    try {
      const isEdit = f._id !== undefined;
      const saved = await window.BOA_DB.saveManager(f);
      setManagers(p => isEdit ? p.map(x => x._id === f._id ? saved : x) : [...p, saved]);
      // Persist personal PIN if it was edited (validates 6 digits or empty-to-clear)
      if (newPin !== undefined) {
        const ec = saved.ec || f.ec;
        const next = { ...mgrPins };
        if (newPin === "")        delete next[ec];
        else                       next[ec] = newPin;
        setMgrPins(next);
        try { await window.BOA_DB.saveManagerPins(next); }
        catch (pe) { alert("Manager saved but PIN could not be saved: " + (pe.message || pe)); }
      }
      setMgrModal(null);
      logActivity(
        isEdit ? "Edited manager" : "Added manager",
        (saved.name || "") + (saved.ec ? " (" + saved.ec + ")" : ""),
        (saved.role || "") + (saved.branch ? " · " + saved.branch : "")
      );
    } catch (e) { alert("Could not save: " + (e.message || e)); }
  }
  async function delMgr(id) {
    const target = managers.find(x => x._id === id);
    try {
      await window.BOA_DB.deleteManager(id);
      setManagers(p => p.filter(x => x._id !== id));
      setMgrModal(null);
      if (target) logActivity("Deleted manager", target.name + (target.ec ? " (" + target.ec + ")" : ""), target.branch || "");
    }
    catch (e) { alert("Could not delete: " + (e.message || e)); }
  }

  const accent="#BE185D", cream="linear-gradient(180deg,#FCE7F3 0%,#FFFFFF 220px)", bdr="#FBCFE8";
  // Wrap setTab so leaving the manager-schedule tab with unsaved edits prompts.
  const tryChangeTab = (t) => {
    if (t === tab) return;
    if (tab === "scheduling" && schedSubTab === "managers" && mgrSchedDirty) {
      if (!window.confirm("Are you sure? The manager schedule has unsaved changes. They will be lost if you leave.")) return;
      setMgrSchedDirty(false);
      setMgrSchedDraft(mgrSchedSaved);
    }
    setTab(t);
  };
  // Switching between Scheduling sub-tabs — same unsaved-changes guard.
  const tryChangeSchedSub = (st) => {
    if (st === schedSubTab) return;
    if (schedSubTab === "managers" && mgrSchedDirty) {
      if (!window.confirm("Are you sure? The manager schedule has unsaved changes. They will be lost if you switch.")) return;
      setMgrSchedDirty(false);
      setMgrSchedDraft(mgrSchedSaved);
    }
    setSchedSubTab(st);
  };
  // Generic pill button for tabs and pseudo-tabs.
  // - For a real tab, pass `t`. Active state uses `tab === t` and click routes
  //   through tryChangeTab(t).
  // - For a composite/virtual entry that has to set multiple sub-state values,
  //   pass `isActive` and `onClick` to override.
  const tabBtnX = ({ t, label, isActive, onClick }) => {
    const active = isActive != null ? isActive : tab === t;
    const handle = onClick || (() => tryChangeTab(t));
    return (
      <button key={t || label} onClick={handle}
        style={{ padding:"10px 18px", borderRadius:14, cursor:"pointer", fontFamily:"inherit", fontWeight:700, fontSize:13, border:"none",
          background: active ? "#BE185D" : "#FFFFFF",
          color:    active ? "#FFFFFF" : "#831843",
          boxShadow: active ? "0 4px 12px rgba(190,24,93,0.32)" : "0 2px 6px rgba(0,0,0,0.06)",
          transition:"all .18s", margin:"4px 4px" }}>{label}</button>
    );
  };
  const tabBtn = (t, label) => tabBtnX({ t, label });

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", flexDirection:"column", gap:14, fontFamily:"'Outfit',system-ui,sans-serif", color:"#831843", letterSpacing:"0.18em", fontSize:14, fontWeight:700, textTransform:"uppercase" }}>
      <div style={{ width:28, height:28, border:"3px solid #FBCFE8", borderTopColor:"#BE185D", borderRadius:"50%", animation:"spin 0.9s linear infinite" }}></div>
      <div>BOA HR · Loading data…</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
  if (loadError) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", padding:24, fontFamily:"'Outfit',system-ui,sans-serif", color:"#831843", textAlign:"center" }}>
      <div style={{ maxWidth:400 }}>
        <div style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>Couldn't load HR data</div>
        <div style={{ fontSize:13, color:"#6b7280" }}>{loadError}</div>
      </div>
    </div>
  );
  return (
    <div style={{ minHeight:"100vh", background:cream, fontFamily:"'DM Sans',sans-serif", color:"#831843" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Playfair+Display:wght@700;900&family=Cormorant+Garamond:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {currentUser?.demo && (
        <div style={{ background:"#fde047", color:"#78350f", borderBottom:"2px solid #ca8a04", padding:"10px 24px", textAlign:"center", fontSize:13, fontWeight:700, letterSpacing:"0.02em" }}>
          ⚠ TRAINING / DEMO LOGIN — You can explore the portal but any changes you make will <u>NOT</u> be saved.
        </div>
      )}

      {/* HEADER */}
      <div style={{ background:"linear-gradient(135deg, #FBCFE8 0%, #F9A8D4 50%, #F472B6 100%)", color:"#FFFFFF" }}>
        <div style={{ maxWidth:1380, margin:"0 auto", padding:"0 24px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"22px 0 22px", flexWrap:"wrap", gap:24 }}>
            <div style={{ display:"flex", alignItems:"center", gap:16 }}>
              <img src="data:image/png;base64,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" alt="BOA Beauty Bar" style={{ height:34, width:"auto", objectFit:"contain", flex:"0 0 auto" }} />
              <div style={{ width:1, height:38, background:"rgba(255,255,255,0.4)" }} />
              <div>
                <div style={{ fontFamily:"'Outfit',system-ui,sans-serif", fontSize:28, color:"#FFFFFF", letterSpacing:"0.06em", fontWeight:800, textTransform:"uppercase", lineHeight:1.1, textShadow:"0 0 18px rgba(255,255,255,0.55)" }}>BOA HR PORTAL</div>
                <div style={{ fontFamily:"'Outfit',system-ui,sans-serif", fontSize:13, color:"#FFFFFF", letterSpacing:"0.04em", marginTop:5, fontWeight:500 }}>
                  {SALONS.length} LOCATIONS · {stats.active} ACTIVE (incl. {stats.pregnant} pregnant) · {stats.onMat} ON MATERNITY LEAVE
                </div>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              {stats.vacancies>0 && <div style={{ background:"#374151", color:"#fbbf24", borderRadius:20, padding:"4px 12px", fontSize:11, fontWeight:700 }}>🪑 {stats.vacancies} vacancies</div>}
              <button onClick={()=>setStaffModal({ ec:"", name:"", branch:"Sea Point", contract:"Permanent", permit:"sa_citizen", level:"" })}
                style={{ background:"#BE185D", color:"#fff", border:"none", borderRadius:9, padding:"8px 14px", cursor:"pointer", fontFamily:"inherit", fontWeight:700, fontSize:12 }}>+ Add Staff</button>
            </div>
          </div>
          {(() => {
            // Onboard count = starters whose start date is within ±31 days.
            const today = new Date(); const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const obCount = obList.filter(r => {
              if (!r.startDate) return false;
              const sd = new Date(r.startDate + "T00:00:00");
              const ds = Math.floor((t0 - sd) / 86400000);
              return ds <= 31;
            }).length;
            const onboardLbl  = "🌱 Onboarding"  + (obCount > 0 ? " (" + obCount + ")" : "");
            const offboardLbl = "👋 Off-boarding" + (offList.length > 0 ? " (" + offList.length + ")" : "");
            const matLbl      = "🤱 Maternity ("  + matRecs.length + ")";
            const groups = [
              { key:"People",     icon:"👥", title:"People",
                color:{ bg:"#FDEEF5", bgActive:"#FBCFE8", ink:"#831843" },
                items: [
                  { t:"onboard",     l: onboardLbl },
                  { t:"offboard",    l: offboardLbl },
                  { t:"staff",       l:"👥 Staff List"    },
                  { t:"recruitment", l:"🎯 Recruitment"   },
                  { t:"maternity",   l: matLbl }
                ] },
              { key:"Operations", icon:"⚙️", title:"Operations",
                color:{ bg:"#E0F2FE", bgActive:"#BAE6FD", ink:"#075985" },
                items: [
                  { t:"scheduling",  l:"📅 Scheduling"     },
                  { t:"locations",   l:"📍 Locations"      },
                  { t:"checkins",    l:"📲 Daily Check-ins" },
                  { t:"mgrclockins", l:"🕐 Mgr Clock-ins"  },
                  { t:"leave",       l:"🌴 Leave Planner"  },
                  { t:"mgrPlanner",  l:"🧩 Manager Planner",
                    isActive: tab==="recruitment" && recruitSubTab==="mgrRecruit" && mgrSubTab==="planner",
                    onClick: () => { setRecruitSubTab("mgrRecruit"); setMgrSubTab("planner"); tryChangeTab("recruitment"); }
                  }
                ] },
              { key:"Payroll",    icon:"💰", title:"Payroll",
                color:{ bg:"#DCFCE7", bgActive:"#BBF7D0", ink:"#14532d" },
                items: [
                  { t:"attendance",  l:"📕 Attendance"     }
                ] },
              { key:"Insights",   icon:"📊", title:"Insights",
                color:{ bg:"#EDE9FE", bgActive:"#DDD6FE", ink:"#5B21B6" },
                items: [
                  { t:"alerts",      l:"🔔 Alerts"         },
                  { t:"activity",    l:"📜 Activity Log"   }
                ] }
            ];
            // Category that owns the currently-active tab.
            // Permission filter: hide entire categories AND/OR individual tabs.
            const hideCats = new Set(currentUser.hideCategories || []);
            const hideTabs = new Set(currentUser.hideTabs || []);
            const visibleGroups = groups
              .filter(g => !hideCats.has(g.key))
              .map(g => ({ ...g, items: g.items.filter(it => !hideTabs.has(it.t)) }))
              .filter(g => g.items.length > 0);
            const tabToCategory = {};
            for (const g of visibleGroups) for (const it of g.items) tabToCategory[it.t] = g.key;
            const activeCategoryByTab = tabToCategory[tab]; // undefined when on dashboard
            // Whichever category is "open" — explicit user pick wins, otherwise follow the active tab.
            const openCategory = navCategory || activeCategoryByTab || visibleGroups[0].key;
            const openGroup = visibleGroups.find(g => g.key === openCategory) || visibleGroups[0];

            const tileBase = {
              flex:"1 1 0", minWidth:120, minHeight:108,
              borderRadius:18, padding:"16px 14px",
              fontFamily:"inherit", fontWeight:800, fontSize:14,
              cursor:"pointer", border:"none",
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6,
              transition:"all .18s"
            };
            // Pink neon ring + glow. Stronger for the active tile.
            const tileNeon = (active) => ({
              boxShadow: active
                ? "0 0 0 3px #F472B6, 0 0 18px rgba(244,114,182,0.9), 0 0 34px rgba(244,114,182,0.55), 0 4px 14px rgba(190,24,93,0.28)"
                : "0 0 0 2px #FBCFE8, 0 0 10px rgba(244,114,182,0.35), 0 2px 6px rgba(0,0,0,0.05)"
            });
            const dashActive = tab === "dashboard";
            // Light pink palette for the Dashboard tile.
            const dashColor = { bg:"#FCE7F3", bgActive:"#FBCFE8", ink:"#831843" };

            return (
              <div style={{ paddingTop:12 }}>
                {/* Big square category tiles — Dashboard plus the four groups */}
                <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                  <button onClick={()=>{ setNavShowCategory(false); tryChangeTab("dashboard"); }} title="Home"
                    style={{
                      ...tileBase, ...tileNeon(dashActive),
                      background: dashActive ? dashColor.bgActive : dashColor.bg,
                      color: dashColor.ink,
                      flex:"0 0 108px", minWidth:108
                    }}>
                    <span style={{ fontSize:46, lineHeight:1 }}>🏠</span>
                  </button>
                  {visibleGroups.map(g => {
                    const isOpen = openCategory === g.key && (!dashActive || navShowCategory);
                    return (
                      <button key={g.key} onClick={()=>{ setNavCategory(g.key); setNavShowCategory(true); }}
                        style={{
                          ...tileBase, ...tileNeon(isOpen),
                          background: isOpen ? g.color.bgActive : g.color.bg,
                          color: g.color.ink
                        }}>
                        <span style={{ fontSize:32, lineHeight:1 }}>{g.icon}</span>
                        <span style={{ fontSize:13 }}>{g.title}</span>
                        <span style={{ fontSize:9, fontWeight:700, color:g.color.ink, letterSpacing:"0.12em", textTransform:"uppercase", opacity:0.65 }}>
                          {g.items.length} tab{g.items.length !== 1 ? "s" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Sub-panel underneath the tiles.
                    On the dashboard, show Quick Actions (most-used tabs) instead of
                    a category's sub-tabs. Otherwise show the open category's tabs. */}
                {dashActive && !navShowCategory ? (
                  <div style={{ marginTop:10, padding:"10px 12px", background:dashColor.bg, border:"1px solid rgba(255,255,255,0.7)", borderRadius:14 }}>
                    <div style={{ fontSize:9, fontWeight:800, color:dashColor.ink, letterSpacing:"0.2em", textTransform:"uppercase", opacity:0.75, marginBottom:6, paddingLeft:4 }}>
                      ⚡ Quick actions
                    </div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      {[
                        { t:"staff",       l:"👥 Staff List"   },
                        { t:"scheduling",  l:"📅 Scheduling"   },
                        { t:"attendance",  l:"📕 Attendance"   },
                        { t:"recruitment", l:"🎯 Recruitment"  },
                        { t:"leave",       l:"🌴 Leave Planner"}
                      ]
                        .filter(it => !hideCats.has(NAV_TAB_TO_CATEGORY[it.t]) && !hideTabs.has(it.t))
                        .map(it => tabBtn(it.t, it.l))}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop:10, padding:"10px 12px", background:openGroup.color.bg, border:"1px solid rgba(255,255,255,0.7)", borderRadius:14 }}>
                    <div style={{ fontSize:9, fontWeight:800, color:openGroup.color.ink, letterSpacing:"0.2em", textTransform:"uppercase", opacity:0.75, marginBottom:6, paddingLeft:4 }}>
                      {openGroup.icon} {openGroup.title}
                    </div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      {openGroup.items.map(it => tabBtnX({ t: it.t, label: it.l, isActive: it.isActive, onClick: it.onClick }))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center", gap:10, paddingTop:8, fontSize:11, color:"#831843" }}>
            <span>Signed in as <strong>{currentUser.name}</strong> · {currentUser.role}</span>
            <button onClick={onSignOut}
              style={{ background:"#fff", border:"1px solid #FBCFE8", color:"#831843", borderRadius:7, padding:"4px 10px", cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1380, margin:"0 auto", padding:"22px 24px" }}>

        {/* STAT CARDS — only on recruitment tab (nail-tech sub-tab) */}
        {tab==="recruitment" && recruitSubTab!=="mgrRecruit" && <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))", gap:9, marginBottom:16 }}>
          {[
            { l:"Active Staff",   v:stats.active,       i:"👥", c:"#1e3a8a", bg:"#dbeafe", note:"incl. pregnant" },
            { l:"Pregnant (in store)", v:stats.pregnant, i:"🤰", c:"#92400e", bg:"#fef3c7" },
            { l:"On Mat. Leave",  v:stats.onMat,        i:"🤱", c:"#7A4258", bg:"#fce7f3", note:"excluded" },
            { l:"Returning ≤60d", v:stats.returning60,  i:"🔜", c:"#065f46", bg:"#d1fae5" },
            { l:"Z/NA (Risk)",    v:stats.zna,          i:"🚨", c:"#7f1d1d", bg:"#fee2e2" },
            { l:"No Contract",    v:stats.noContract,   i:"📄", c:"#7f1d1d", bg:"#fee2e2" },
            { l:"Still To Hire",   v:stats.vacancies,    i:"🎯", c:"#7c3aed", bg:"#ede9fe", note:"across all branches" },
            { l:"Understaffed",   v:stats.understaffed, i:"📍", c:"#78350f", bg:"#fef3c7" },
          ].map(c => (
            <div key={c.l} style={{ background:c.bg, borderRadius:13, padding:"12px 14px" }}>
              <div style={{ fontSize:18 }}>{c.i}</div>
              <div style={{ fontSize:24, fontWeight:800, color:c.c, lineHeight:1.1 }}>{c.v}</div>
              <div style={{ fontSize:9, fontWeight:700, color:c.c, opacity:0.72, marginTop:3, letterSpacing:"0.06em" }}>{c.l.toUpperCase()}</div>
              {c.note && <div style={{ fontSize:9, color:c.c, opacity:0.55, marginTop:1 }}>{c.note}</div>}
            </div>
          ))}
        </div>}


        {/* TO HIRE PER BRANCH — only on recruitment tab (nail-tech sub-tab) */}
        {tab==="recruitment" && recruitSubTab!=="mgrRecruit" && <>
        {stats.vacancies > 0 && (
          <div style={{ background:"#FFFFFF", borderRadius:13, border:"1px solid #E8C9D2", marginBottom:16, overflow:"hidden" }}>
            <div style={{ background:"#BE185D", color:"#fff", padding:"10px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <span style={{ fontWeight:700, fontSize:13 }}>🎯 Staff Still Needed — {stats.vacancies} position{stats.vacancies!==1?"s":""} across {stats.understaffed} branch{stats.understaffed!==1?"es":""}</span>
              <span style={{ fontSize:11, opacity:0.8 }}>Sorted by most urgent</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))" }}>
              {salonData.filter(s=>s.active.length<s.capacity).sort((a,b)=>(b.capacity-b.active.length)-(a.capacity-a.active.length)).map((s,i) => {
                const need = s.goal - s.active.length;
                const pct = Math.round(s.active.length/s.goal*100);
                const [col,bg] = need>=5?["#7f1d1d","#fee2e2"]:need>=3?["#9a3412","#ffedd5"]:["#78350f","#fef9c3"];
                return (
                  <div key={s.name} style={{ padding:"11px 15px", borderTop:`1px solid #e5e7eb`, borderRight:`1px solid #e5e7eb`, background:bg }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontWeight:700, fontSize:12, color:"#111827" }}>📍 {s.name}</div>
                      <div style={{ fontWeight:800, fontSize:22, color:col, lineHeight:1 }}>{need}</div>
                    </div>
                    <div style={{ fontSize:10, color:"#BE185D", marginTop:2 }}>{s.active.length}/{s.capacity} filled · {pct}%</div>
                    <div style={{ height:4, borderRadius:99, background:"#e5e7eb", marginTop:5, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:pct<60?"#dc2626":pct<80?"#f97316":"#eab308", borderRadius:99 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </>}

        {/* LEGEND — only relevant on the staff list */}
        {tab==="staff" && (
          <div style={{ background:"#FFFFFF", borderRadius:11, padding:"10px 16px", border:`1px solid ${bdr}`, marginBottom:14, display:"flex", gap:16, flexWrap:"wrap", alignItems:"center", fontSize:11, color:"#BE185D" }}>
            <span style={{ fontWeight:700, color:"#831843" }}>Legend:</span>
            <span>🤰 <strong>Pregnant</strong> = still working in store, counted in active headcount</span>
            <span>🤱 <strong>On Maternity Leave</strong> = not in store, <em>greyed out & excluded</em> from active count</span>
          </div>
        )}

        {/* ── DASHBOARD TAB ── */}
        {tab==="dashboard" && (() => {
          const now = new Date();
          const hr = now.getHours();
          const partOfDay = hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening";
          const dateLbl = now.toLocaleDateString("en-ZA", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
          const timeLbl = now.toLocaleTimeString("en-ZA", { hour:"2-digit", minute:"2-digit" });
          const understaffedBranches = SALONS
            .map(sl => {
              const goal = sl.targetCapacity || sl.capacity;
              const act = enriched.filter(s => s.branch === sl.name && !s.onMat && !s.offboarded).length;
              return { name: sl.name, gap: Math.max(0, goal - act), goal, act };
            })
            .filter(x => x.gap > 0)
            .sort((a, b) => b.gap - a.gap);
          const recentDepartures = enriched
            .filter(s => s.offboarded && s.offDaysSinceLeft != null && s.offDaysSinceLeft >= 0 && s.offDaysSinceLeft <= 7)
            .sort((a, b) => (a.offDaysSinceLeft ?? 0) - (b.offDaysSinceLeft ?? 0));

          // Shared style tokens (kept inline so we don't disturb the rest of the file)
          const PINK = { ink:"#831843", accent:"#BE185D", soft:"#FBCFE8", softer:"#FCE7F3", softest:"#FDEEF5", deep:"#9F1A4F" };
          const sectionTitle = { fontFamily:"'Outfit',system-ui,sans-serif", fontSize:11, fontWeight:700, color:PINK.ink, letterSpacing:"0.22em", textTransform:"uppercase", display:"flex", alignItems:"center", gap:10, marginBottom:12 };
          const sectionRule  = { flex:1, height:1, background:`linear-gradient(90deg,${PINK.soft} 0%,transparent 100%)` };
          const card         = { background:"#FFFFFF", border:`1px solid ${PINK.soft}`, borderRadius:16, padding:"18px 20px", boxShadow:"0 1px 6px rgba(190,24,93,0.04)", fontFamily:"'Outfit',system-ui,sans-serif" };
          const cardTitle    = { fontFamily:"'Outfit',system-ui,sans-serif", fontSize:13, fontWeight:700, color:PINK.ink, marginBottom:12, display:"flex", alignItems:"center", justifyContent:"space-between", letterSpacing:"0.06em" };

          const peopleActions = [
            { lbl:"Onboarding",   icon:"🌱", to:"onboard"   },
            { lbl:"Off-boarding", icon:"👋", to:"offboard"  },
            { lbl:"Maternity",    icon:"🤱", to:"maternity" },
            { lbl:"Locations",    icon:"📍", to:"locations" }
          ];
          const oversightActions = [
            { lbl:"Mgr Clock-ins", icon:"🕐", to:"mgrclockins" },
            { lbl:"Activity Log",  icon:"📜", to:"activity"    },
            { lbl:"Alerts",        icon:"🔔", to:"alerts"      }
          ];

          return (
            <div style={{ fontFamily:"'Outfit',system-ui,sans-serif" }}>
              {/* ── HERO ── greeting + role + date/time ── */}
              <div style={{ background:`linear-gradient(135deg,${PINK.softer} 0%,#FFFFFF 65%)`, border:`1px solid ${PINK.soft}`, borderRadius:20, padding:"26px 30px", marginBottom:20, boxShadow:"0 4px 18px rgba(190,24,93,0.07)", display:"flex", justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:18, fontFamily:"'Outfit',system-ui,sans-serif" }}>
                <div>
                  <div style={{ fontFamily:"'Outfit',system-ui,sans-serif", fontSize:11, fontWeight:700, color:PINK.accent, letterSpacing:"0.22em", textTransform:"uppercase" }}>BOA HR · Dashboard</div>
                  <div style={{ fontFamily:"'Outfit',system-ui,sans-serif", fontSize:34, color:PINK.ink, fontWeight:700, lineHeight:1.1, marginTop:6, letterSpacing:"-0.01em" }}>Good {partOfDay}, {currentUser.name}</div>
                  <div style={{ fontFamily:"'Outfit',system-ui,sans-serif", fontSize:12.5, color:PINK.accent, marginTop:8, fontWeight:500, letterSpacing:"0.02em" }}>{dateLbl}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontFamily:"'Outfit',system-ui,sans-serif", fontSize:32, fontWeight:600, color:PINK.ink, letterSpacing:"0.02em", lineHeight:1 }}>{timeLbl}</div>
                  <div style={{ fontFamily:"'Outfit',system-ui,sans-serif", fontSize:11, color:PINK.deep, marginTop:6, fontWeight:500, letterSpacing:"0.04em" }}>Signed in as <span style={{ color:PINK.accent, fontWeight:700 }}>{currentUser.role}</span></div>
                </div>
              </div>

              {/* ── SECTION: TODAY ── */}
              <div style={sectionTitle}>
                <span>✨ Today at a glance</span>
                <span style={sectionRule} />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:11, marginBottom:24 }}>
                {[
                  { l:"Scheduled today",   v: dashScheduledToday == null ? "…" : dashScheduledToday, sub:"across all branches",       i:"📅", c:"#1e3a8a", bg:"#dbeafe" },
                  { l:"Active staff",       v: stats.active,                                          sub:"incl. " + stats.pregnant + " pregnant", i:"👥", c:"#14532d", bg:"#dcfce7" },
                  { l:"On maternity",       v: stats.onMat,                                           sub: stats.returning60 + " returning ≤60d",  i:"🤱", c:"#7A4258", bg:"#fce7f3" },
                  { l:"Positions to hire",  v: stats.vacancies,                                       sub:"across " + stats.understaffed + " branch" + (stats.understaffed !== 1 ? "es" : ""), i:"🎯", c:"#7c3aed", bg:"#ede9fe", click:()=>tryChangeTab("recruitment") }
                ].map(c => (
                  <div key={c.l} onClick={c.click} style={{ background:c.bg, borderRadius:16, padding:"16px 18px", cursor:c.click ? "pointer" : "default", border:"1px solid rgba(255,255,255,0.6)" }}>
                    <div style={{ fontSize:24 }}>{c.i}</div>
                    <div style={{ fontSize:32, fontWeight:800, color:c.c, lineHeight:1.05, marginTop:4 }}>{c.v}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:c.c, letterSpacing:"0.1em", textTransform:"uppercase", marginTop:6 }}>{c.l}</div>
                    <div style={{ fontSize:10, color:c.c, opacity:0.6, marginTop:2 }}>{c.sub}</div>
                  </div>
                ))}
              </div>

              {/* ── SECTION: OPERATIONS ── */}
              <div style={sectionTitle}>
                <span>📋 Operations</span>
                <span style={sectionRule} />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(340px,1fr))", gap:14, marginBottom:24 }}>
                {/* Today by branch */}
                <div style={card}>
                  <div style={cardTitle}>
                    <span>📅 Scheduled today by branch</span>
                    <button onClick={()=>tryChangeTab("scheduling")} style={{ background:"transparent", border:"none", color:PINK.accent, cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>View schedules →</button>
                  </div>
                  {dashScheduledToday == null ? (
                    <div style={{ fontSize:12, color:"#9ca3af", fontStyle:"italic" }}>Loading schedules…</div>
                  ) : (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:8 }}>
                      {SALONS.map(sl => {
                        const c = dashByBranch[sl.name] || 0;
                        return (
                          <div key={sl.name} style={{ background:PINK.softest, border:`1px solid ${PINK.soft}`, borderRadius:11, padding:"10px 12px" }}>
                            <div style={{ fontSize:11, fontWeight:700, color:PINK.ink }}>📍 {sl.name}</div>
                            <div style={{ display:"flex", alignItems:"baseline", gap:5, marginTop:4 }}>
                              <span style={{ fontSize:22, fontWeight:800, color: c === 0 ? "#9ca3af" : PINK.accent }}>{c}</span>
                              <span style={{ fontSize:10, fontWeight:600, color:PINK.deep, opacity:0.75 }}>working</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Recruitment summary */}
                <div style={card}>
                  <div style={cardTitle}>
                    <span>🎯 Recruitment needs</span>
                    <button onClick={()=>tryChangeTab("recruitment")} style={{ background:PINK.accent, color:"#fff", border:"none", borderRadius:8, padding:"5px 12px", cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>Open →</button>
                  </div>
                  {stats.vacancies === 0 ? (
                    <div style={{ fontSize:13, color:"#16a34a", fontWeight:700, padding:"8px 0" }}>✅ All branches fully staffed.</div>
                  ) : (
                    <>
                      <div style={{ fontSize:12, color:PINK.ink, marginBottom:10 }}>
                        <strong>{stats.vacancies}</strong> position{stats.vacancies !== 1 ? "s" : ""} to fill across <strong>{stats.understaffed}</strong> branch{stats.understaffed !== 1 ? "es" : ""}.
                      </div>
                      <div style={{ display:"grid", gap:6 }}>
                        {understaffedBranches.slice(0, 6).map(b => (
                          <div key={b.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#fef3c7", border:"1px solid #fde68a", borderRadius:9, padding:"8px 12px" }}>
                            <span style={{ fontSize:12, color:"#78350f", fontWeight:700 }}>📍 {b.name}</span>
                            <span style={{ fontSize:12, color:"#92400e", fontWeight:800 }}>+{b.gap} <span style={{ fontWeight:500, opacity:0.7 }}>· {b.act}/{b.goal}</span></span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ── SECTION: ATTENTION ── */}
              <div style={sectionTitle}>
                <span>⚠ Needs attention</span>
                <span style={sectionRule} />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:11, marginBottom:24 }}>
                {(() => {
                  // Schedule alert: only for users responsible for scheduling.
                  let schedAlert = null;
                  if (SCHED_ALERT_PINS.has(currentUser.pin) && upcomingChecked && upcomingMissing.length > 0) {
                    const today = new Date();
                    // Display the COVERED (end) month — that's what users mean by
                    // "the schedule for June". Deadline is the 15th of the start month.
                    const m0 = upcomingMissing[0];
                    const monthLbl = new Date(m0.endY, m0.endM, 1).toLocaleDateString("en-ZA", { month:"long", year:"numeric" });
                    let deadlineY = m0.endY, deadlineM = m0.endM - 1;
                    if (deadlineM < 0) { deadlineM = 11; deadlineY--; }
                    const deadline = new Date(deadlineY, deadlineM, 15);
                    const overdue = today > deadline;
                    const techMissing = upcomingMissing.filter(m => m.type === "tech").length;
                    const mgrMissing  = upcomingMissing.filter(m => m.type === "mgr").length;
                    const parts = [];
                    if (techMissing > 0) parts.push(techMissing + " nail tech");
                    if (mgrMissing  > 0) parts.push(mgrMissing  + " manager");
                    schedAlert = {
                      i: overdue ? "🚨" : "📆",
                      l: parts.join(" + ") + " schedule" + (techMissing + mgrMissing !== 1 ? "s" : "") + " not saved for " + monthLbl,
                      sub: overdue
                        ? "OVERDUE — was due 15 " + deadline.toLocaleDateString("en-ZA", { month:"short" })
                        : "Due by 15 " + deadline.toLocaleDateString("en-ZA", { month:"short" }),
                      c: overdue ? "#7f1d1d" : "#92400e",
                      bg: overdue ? "#fee2e2" : "#fef3c7",
                      to:"scheduling"
                    };
                  }
                  return [
                    schedAlert,
                    stats.zna           > 0 && { i:"🚨", l: stats.zna + " staff with Z/NA risk", sub:"compliance issue", c:"#7f1d1d", bg:"#fee2e2", to:"staff" },
                    stats.noContract    > 0 && { i:"📄", l: stats.noContract + " staff with no contract", sub:"upload contracts", c:"#7f1d1d", bg:"#fee2e2", to:"staff" },
                    recentDepartures.length > 0 && { i:"👋", l: recentDepartures.length + " departure" + (recentDepartures.length !== 1 ? "s" : "") + " this week", sub:"in last 7 days", c:"#374151", bg:"#f3f4f6", to:"offboard" }
                  ];
                })().filter(Boolean).map(b => (
                  <div key={b.l} onClick={()=>tryChangeTab(b.to)} style={{ background:b.bg, border:`1px solid ${b.c}33`, borderRadius:14, padding:"14px 16px", cursor:"pointer" }}>
                    <div style={{ fontSize:22 }}>{b.i}</div>
                    <div style={{ fontSize:13, fontWeight:800, color:b.c, marginTop:4 }}>{b.l}</div>
                    <div style={{ fontSize:10, fontWeight:600, color:b.c, opacity:0.7, marginTop:2 }}>{b.sub}</div>
                  </div>
                ))}
                {stats.zna === 0 && stats.noContract === 0 && recentDepartures.length === 0 &&
                 (!SCHED_ALERT_PINS.has(currentUser.pin) || (upcomingChecked && upcomingMissing.length === 0)) && (
                  <div style={{ background:"#dcfce7", border:"1px solid #86efac", borderRadius:14, padding:"14px 16px", color:"#14532d", fontWeight:700, fontSize:13 }}>
                    ✅ Nothing urgent — everything in good shape.
                  </div>
                )}
              </div>

              {/* ── SECTION: ALL TOOLS ── grouped quick links ── */}
              <div style={sectionTitle}>
                <span>🧰 All tools</span>
                <span style={sectionRule} />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:14, marginBottom:8 }}>
                {[
                  { title:"People management", items: peopleActions    },
                  { title:"Oversight",         items: oversightActions }
                ].map(group => (
                  <div key={group.title} style={card}>
                    <div style={{ fontSize:11, fontWeight:700, color:PINK.deep, letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:10 }}>{group.title}</div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:7 }}>
                      {group.items.map(a => (
                        <button key={a.to} onClick={()=>tryChangeTab(a.to)} style={{ background:PINK.softest, color:PINK.ink, border:`1px solid ${PINK.soft}`, borderRadius:10, padding:"9px 12px", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700, textAlign:"left", display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontSize:16 }}>{a.icon}</span>
                          <span>{a.lbl}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── STAFF TAB ── */}
        {tab==="staff" && (
          <>
            <div style={{ background:"#FFFFFF", borderRadius:13, padding:"12px 15px", border:`1px solid ${bdr}`, marginBottom:14, display:"flex", flexWrap:"wrap", gap:8, alignItems:"center" }}>
              <input placeholder="🔍  Name or EC code…" value={search} onChange={e=>setSearch(e.target.value)}
                style={{ flex:"1 1 150px", padding:"7px 12px", borderRadius:7, border:`1px solid ${bdr}`, fontFamily:"inherit", fontSize:13, background:cream }} />
              <select value={fShow} onChange={e=>setFShow(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:`1px solid ${bdr}`, fontFamily:"inherit", fontSize:13, background:cream }}>
                <option value="all">All Staff</option>
                <option value="active_only">Active Only (excl. maternity)</option>
                <option value="on_mat">On Maternity Leave Only</option>
              </select>
              <select value={fBranch} onChange={e=>setFBranch(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:`1px solid ${bdr}`, fontFamily:"inherit", fontSize:13, background:cream }}>
                <option value="All">All Branches</option>{SALONS.map(s=><option key={s.name}>{s.name}</option>)}
              </select>
              <select value={fPermit} onChange={e=>setFPermit(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:`1px solid ${bdr}`, fontFamily:"inherit", fontSize:13, background:cream }}>
                <option value="All">All Compliance</option>{Object.entries(COMPLIANCE).map(([k,c])=><option key={k} value={k}>{c.icon} {c.label}</option>)}
              </select>
              <select value={fContract} onChange={e=>setFContract(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:`1px solid ${bdr}`, fontFamily:"inherit", fontSize:13, background:cream }}>
                <option value="All">All Contracts</option>{["Permanent","Fixed Term","NO CONTRACT","2 Weeks","Induction"].map(c=><option key={c}>{c}</option>)}
              </select>
              <span style={{ marginLeft:"auto", fontSize:11, color:"#BE185D", fontWeight:700 }}>{filtered.length} shown (sorted by EC)</span>
              <button onClick={()=>setStaffModal({ ec:"", name:"", branch:"Sea Point", contract:"Permanent", permit:"sa_citizen", level:"" })}
                style={{ background:"#BE185D", color:"#fff", border:"none", borderRadius:8, padding:"7px 14px", cursor:"pointer", fontFamily:"inherit", fontWeight:700, fontSize:12 }}>+ Add Staff</button>
            </div>

            <div style={{ background:"#FFFFFF", borderRadius:15, border:`1px solid ${bdr}`, overflow:"hidden", boxShadow:"0 2px 12px rgba(0,0,0,.05)" }}>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5 }}>
                  <thead>
                    <tr style={{ background:"#831843", color:"#FFFFFF" }}>
                      {["EC ↑","Name","Branch","Level","Contract","Compliance","Start Date","Status","Return Date",""].map(h=>(
                        <th key={h} style={{ padding:"11px 12px", textAlign:"left", fontWeight:600, fontSize:9.5, letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length===0 && <tr><td colSpan={10} style={{ textAlign:"center", padding:40, color:"#9ca3af" }}>No results.</td></tr>}
                    {filtered.map(s => {
                      const dBack = s.matRec?.returnDate ? daysDiff(s.matRec.returnDate) : null;
                      const departed = s.offboarded && s.offDaysSinceLeft != null && s.offDaysSinceLeft >= 0;
                      const rowBg = departed ? "#f3f4f6" : s.onMat ? "#fdf4ff" : s.pregnant ? "#fffbeb" : s.permit==="z_na" ? "#FAEEF1" : "#fff";
                      const rowOpacity = departed ? 0.5 : s.onMat ? 0.6 : 1;
                      return (
                        <tr key={s._id} style={{ background:rowBg, borderTop:`1px solid ${bdr}`, opacity:rowOpacity }}>
                          <td style={{ padding:"10px 12px", fontFamily:"monospace", fontSize:11, color:"#8E5570", fontWeight:700, textDecoration: departed ? "line-through" : "none" }}>{s.ec}</td>
                          <td style={{ padding:"10px 12px", fontWeight:700, color: departed ? "#6b7280" : s.onMat?"#7A4258":s.transferring?"#0369a1":"#111827", whiteSpace:"nowrap", fontStyle:s.onMat?"italic":"normal", textDecoration: departed ? "line-through" : "none" }}>
                            {departed?"👋 ":s.onMat?"🤱 ":s.pregnant?"🤰 ":s.isShadow?"🔄 Arriving · ":s.transferring&&!s.isShadow?"🔄 Transferring · ":""}{s.name}
                            {s.transferring&&!s.isShadow&&<span style={{ fontSize:10, marginLeft:5, background:"#FBCFE8", color:"#BE185D", borderRadius:4, padding:"1px 6px", fontWeight:700 }}>→ {s.transferTo} on {s.transferDate?new Date(s.transferDate).toLocaleDateString("en-ZA",{day:"2-digit",month:"short"}):""}</span>}
                            {s.isShadow&&<span style={{ fontSize:10, marginLeft:5, background:"#FBCFE8", color:"#BE185D", borderRadius:4, padding:"1px 6px", fontWeight:700 }}>from {s.transferFrom} on {s.transferDate?new Date(s.transferDate).toLocaleDateString("en-ZA",{day:"2-digit",month:"short"}):""}</span>}
                          </td>
                          <td style={{ padding:"10px 12px", fontSize:11, color:"#831843", whiteSpace:"nowrap" }}>📍 {s.branch}</td>
                          <td style={{ padding:"10px 12px" }}><LevelBadge level={s.level} /></td>
                          <td style={{ padding:"10px 12px", fontSize:11 }}>{s.contract}</td>
                          <td style={{ padding:"10px 12px" }}><CompBadge permit={s.permit} /></td>
                          <td style={{ padding:"10px 12px", fontSize:11, whiteSpace:"nowrap" }}>
                            {s.startDate ? (() => {
                              const d = new Date(s.startDate + "T00:00:00");
                              const days = Math.floor((Date.now() - d) / 86400000);
                              const dStr = d.toLocaleDateString("en-ZA", { day:"2-digit", month:"short", year:"numeric" });
                              const tenure = days < 365 ? days + "d" : (days/365).toFixed(1) + "y";
                              return (
                                <span style={{ display:"flex", flexDirection:"column", gap:1 }}>
                                  <span style={{ color:"#831843", fontWeight:600 }}>{dStr}</span>
                                  <span style={{ fontSize:9, color:"#9ca3af", fontWeight:600 }}>{tenure} tenure</span>
                                </span>
                              );
                            })() : <span style={{ color:"#d1d5db" }}>—</span>}
                          </td>
                          <td style={{ padding:"10px 12px" }}>
                            {departed
                              ? <Chip bg="#e5e7eb" color="#374151" border="#9ca3af">👋 Left {fmt(s.offRec.leftDate)}{s.offDaysSinceLeft > 0 ? " · " + s.offDaysSinceLeft + "d ago" : s.offDaysSinceLeft === 0 ? " · today" : ""}</Chip>
                              : s.onMat
                                ? <Chip bg="#fce7f3" color="#7A4258" border="#fbcfe8">🤱 On Maternity</Chip>
                                : s.pregnant
                                  ? <Chip bg="#fef3c7" color="#92400e" border="#fde68a">🤰 Pregnant – In Store</Chip>
                                  : <span style={{ color:"#d1d5db", fontSize:11 }}>—</span>}
                          </td>
                          <td style={{ padding:"10px 12px", fontSize:11 }}>
                            {s.onMat && s.matRec?.returnDate
                              ? <span>{fmt(s.matRec.returnDate)}<br/>
                                  <span style={{ fontSize:10, fontWeight:700, color:dBack!==null&&dBack<=30?"#15803d":"#7A4258" }}>
                                    {dBack!==null?(dBack>0?`in ${dBack}d`:dBack===0?"TODAY!":` ${Math.abs(dBack)}d ago`):""}
                                  </span>
                                </span>
                              : <span style={{ color:"#d1d5db" }}>—</span>}
                          </td>
                          <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
                            <button onClick={()=>setStaffModal(s)} style={{ background:"#f3f4f6", border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:11, fontFamily:"inherit", fontWeight:700, marginRight:4 }}>Edit</button>
                            {!s.isShadow&&<button onClick={()=>setTransferModal(s)} style={{ background:s.transferring?"#bfdbfe":"#e0f2fe", border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:11, fontFamily:"inherit", fontWeight:700, color:"#BE185D" }} title={s.transferring?"Edit transfer":"Transfer branch"}>🔄{s.transferring?" Edit":""}</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── SCHEDULES TAB (Phase 2a — manual editor) ── */}
        {/* ── SCHEDULING (parent tab with sub-tabs: nail tech / manager) ── */}
        {tab==="scheduling" && (
          <div style={{ display:"flex", gap:0, marginBottom:24, padding:6, background:"#FCE7F3", borderRadius:14, border:"1px solid #FBCFE8", maxWidth:680 }}>
            {[
              { k:"techs",    label:"💅 Nail Tech Schedule" },
              { k:"managers", label:"👔 Manager Schedule" }
            ].map(t => {
              const active = schedSubTab===t.k;
              return (
                <button key={t.k} onClick={()=>tryChangeSchedSub(t.k)}
                  style={{ flex:1, padding:"14px 22px", borderRadius:10, border:"none", background: active ? "#BE185D" : "transparent", color: active ? "#FFFFFF" : "#831843", cursor:"pointer", fontFamily:"inherit", fontSize:15, fontWeight:700, transition:"all .18s", boxShadow: active ? "0 4px 12px rgba(190,24,93,0.32)" : "none", letterSpacing:"0.01em", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:10 }}>
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
        {tab==="scheduling" && schedSubTab==="techs" && <Schedule allStaff={enriched} />}

        {/* ── LOCATIONS TAB ── */}
        {tab==="locations" && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))", gap:10, marginBottom:20 }}>
              {[
                { l:"At Capacity",  v:salonData.filter(s=>s.urgency==="full").length,  c:"#15803d", bg:"#dcfce7" },
                { l:"Needs Staff",  v:salonData.filter(s=>s.urgency==="low").length,   c:"#b45309", bg:"#fef9c3" },
                { l:"Understaffed", v:salonData.filter(s=>s.urgency==="high").length,  c:"#c2410c", bg:"#ffedd5" },
                { l:"Active (incl. pregnant)", v:stats.active, c:"#1e3a8a", bg:"#dbeafe" },
                { l:"On Mat. Leave",v:stats.onMat,    c:"#7A4258", bg:"#fce7f3" },
                { l:"Total Seats",  v:SALONS.reduce((a,s)=>a+s.capacity,0), c:"#111827", bg:"#f3f4f6" },
                { l:"Vacancies",    v:stats.vacancies, c:"#9a3412", bg:"#ffedd5" },
              ].map(c=>(
                <div key={c.l} style={{ background:c.bg, borderRadius:12, padding:"13px 14px" }}>
                  <div style={{ fontSize:26, fontWeight:800, color:c.c, lineHeight:1 }}>{c.v}</div>
                  <div style={{ fontSize:9, fontWeight:700, color:c.c, opacity:0.75, marginTop:4, letterSpacing:"0.05em" }}>{c.l.toUpperCase()}</div>
                </div>
              ))}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(295px,1fr))", gap:13 }}>
              {salonData.map(salon=>(
                <div key={salon.name} style={{ background:"#FFFFFF", borderRadius:16, border:`2px solid ${salon.urgency==="full"?"#86efac":"#e5e7eb"}`, padding:"17px 19px", position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", top:0, left:0, right:0, height:4, background:uColor[salon.urgency] }} />
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                    <div>
                      <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, fontWeight:700, color:"#111827" }}>📍 {salon.name}</div>
                      <div style={{ fontSize:9, fontWeight:800, color:uColor[salon.urgency], letterSpacing:"0.07em", marginTop:1 }}>{uLabel[salon.urgency]}</div>
                      <div style={{ fontSize:10, color:"#9ca3af", marginTop:2 }}>Mani {salon.mani} · Pedi {salon.pedi} · Max {salon.capacity}{salon.lowDemand && <span style={{ marginLeft:6, background:"#FFFFFF", color:"#BE185D", border:"1px solid #86efac", borderRadius:20, padding:"1px 7px", fontWeight:700, fontSize:9 }}>✦ LOW DEMAND · TARGET {salon.targetCapacity}</span>}</div>
                    </div>
                    <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                      <button onClick={()=>setStaffModal({ ec:"", name:"", branch:salon.name, contract:"Permanent", permit:"sa_citizen", level:"" })}
                        style={{ background:accent, color:"#fff", border:"none", borderRadius:7, padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700 }}>+ Add</button>
                      <button onClick={()=>setManagePanel(managePanel===salon.name?null:salon.name)}
                        style={{ background:managePanel===salon.name?"#1e3a8a":"#f3f4f6", color:managePanel===salon.name?"#fff":"#374151", border:"none", borderRadius:7, padding:"5px 11px", cursor:"pointer", fontSize:11, fontWeight:700 }}>
                        {managePanel===salon.name?"✕ Close":"⚙ Manage"}
                      </button>
                    </div>
                  </div>

                  {/* ── MANAGE PANEL ── slides open when Manage is clicked */}
                  {managePanel===salon.name && (
                    <div style={{ background:"#FCE7F3", border:"1px solid #FBCFE8", borderRadius:10, padding:"12px 14px", marginBottom:12 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"#831843", marginBottom:8 }}>Select a staff member to edit or transfer:</div>
                      {/* Managers sub-section */}
                      {managers.filter(m=>m.branch===salon.name).length>0 && (
                        <div style={{ marginBottom:8 }}>
                          <div style={{ fontSize:9, fontWeight:800, color:"#BE185D", letterSpacing:"0.08em", marginBottom:5 }}>MANAGEMENT</div>
                          {managers.filter(m=>m.branch===salon.name).sort((a,b)=>a.role===b.role?0:a.role==="SM"?-1:1).map(m=>(
                            <div key={m._id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", borderRadius:8, background:"#F9A8D4", border:"1px solid #FBCFE8", marginBottom:4 }}>
                              <span style={{ fontSize:11 }}>{m.role==="SM"?"👑":"⭐"}</span>
                              <span style={{ flex:1, fontSize:12, fontWeight:600, color:"#831843" }}>{m.name}</span>
                              <span style={{ fontSize:9, background:m.role==="SM"?"#7c3aed":"#0369a1", color:"#fff", borderRadius:4, padding:"1px 6px", fontWeight:700 }}>{m.role}</span>
                              {m.onMat&&<span style={{ fontSize:9, background:"#FBCFE8", color:"#8E5570", borderRadius:4, padding:"1px 6px", fontWeight:700 }}>🤱 mat.</span>}
                              {m.pregnant&&!m.onMat&&<span style={{ fontSize:9, background:"#FCE7F3", color:"#8E5570", borderRadius:4, padding:"1px 6px", fontWeight:700 }}>🤰 pregnant</span>}
                              <button onClick={()=>{ setMgrModal(m); setManagePanel(null); }}
                                style={{ background:"#e2e8f0", border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:11, fontWeight:700, color:"#831843" }}>✏️ Edit</button>
                            </div>
                          ))}
                          <button onClick={()=>{ setMgrModal({ec:"",name:"",branch:salon.name,role:"AM",contract:"Permanent"}); setManagePanel(null); }}
                            style={{ width:"100%", background:"#FCE7F3", border:"1px dashed #FBCFE8", borderRadius:7, padding:"5px", cursor:"pointer", fontSize:11, fontWeight:700, color:"#BE185D", marginBottom:6 }}>+ Add Manager</button>
                          <div style={{ height:1, background:"#e5e7eb", marginBottom:8 }} />
                        </div>
                      )}
                      <div style={{ display:"flex", flexDirection:"column", gap:5, maxHeight:220, overflowY:"auto" }}>
                        {/* Active + maternity — editable */}
                        {[...salon.active, ...salon.onMat].sort(ecSort).map(m=>(
                          <div key={m._id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:8, background:"#FFFFFF", border:"1px solid #FBCFE8" }}>
                            <span style={{ fontSize:9, color:"#9ca3af", fontFamily:"monospace", minWidth:36 }}>{m.ec}</span>
                            <span style={{ flex:1, fontSize:12, fontWeight:600, color:m.onMat?"#7A4258":m.transferring?"#1d4ed8":"#111827" }}>
                              {m.onMat?"🤱 ":m.pregnant?"🤰 ":m.transferring?"🔄 ":""}{m.name}
                              {m.transferring&&<span style={{ fontSize:9, marginLeft:4, color:"#BE185D", fontWeight:400 }}>→ {m.transferTo}</span>}
                            </span>
                            <button onClick={()=>{ setStaffModal(m); setManagePanel(null); }}
                              style={{ background:"#f3f4f6", border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:11, fontWeight:700, color:"#831843" }}>✏️ Edit</button>
                            {!m.onMat && (
                              <button onClick={()=>{ setTransferModal(m); setManagePanel(null); }}
                                style={{ background:m.transferring?"#bfdbfe":"#e0f2fe", border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:11, fontWeight:700, color:"#BE185D" }}>
                                🔄 {m.transferring?"Edit Transfer":"Transfer"}
                              </button>
                            )}
                          </div>
                        ))}
                        {/* Arriving — show with edit transfer option */}
                        {salon.arriving.map(m=>{
                          // Find the original record to allow editing the transfer
                          const original = staff.find(x=>x.ec===m.ec&&!x.isShadow);
                          return (
                            <div key={m._id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:8, background:"#FCE7F3", border:"1.5px dashed #93c5fd" }}>
                              <span style={{ fontSize:9, color:"#93c5fd", fontFamily:"monospace", minWidth:36 }}>{m.ec}</span>
                              <span style={{ flex:1, fontSize:12, fontWeight:600, color:"#1d4ed8" }}>
                                🔄 {m.name}
                                <span style={{ fontSize:9, marginLeft:4, color:"#2563eb", fontWeight:400 }}>from {m.transferFrom}{m.transferDate?" · "+new Date(m.transferDate).toLocaleDateString("en-ZA",{day:"2-digit",month:"short"}):""}</span>
                              </span>
                              {original && (
                                <button onClick={()=>{ setTransferModal(original); setManagePanel(null); }}
                                  style={{ background:"#bfdbfe", border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:11, fontWeight:700, color:"#BE185D" }}>
                                  🔄 Edit Transfer
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── MANAGERS SECTION ── */}
                  {(() => {
                    const mgrs = managers.filter(m=>m.branch===salon.name);
                    const sm   = mgrs.filter(m=>m.role==="SM");
                    const am   = mgrs.filter(m=>m.role==="AM");
                    if (mgrs.length===0) return null;
                    return (
                      <div style={{ background:"#FCE7F3", border:"1px solid #FBCFE8", borderRadius:10, padding:"9px 12px", marginBottom:10 }}>
                        <div style={{ fontSize:9, fontWeight:800, color:"#BE185D", letterSpacing:"0.1em", marginBottom:7 }}>MANAGEMENT TEAM</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                          {sm.map(m=>(
                            <div key={m._id} style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", opacity:m.onMat?0.5:1 }}>
                              <span style={{ fontSize:13 }}>{m.onMat?"🤱":"👑"}</span>
                              <span style={{ fontSize:11, fontWeight:700, color:m.onMat?"#7A4258":"#1e293b", fontStyle:m.onMat?"italic":"normal", flex:1 }}>{m.name}</span>
                              {m.onMat && <span style={{ fontSize:9, color:"#8E5570", background:"#FBCFE8", borderRadius:4, padding:"1px 5px", fontWeight:700 }}>on leave{m.matReturn?` · ↩${new Date(m.matReturn).toLocaleDateString("en-ZA",{day:"2-digit",month:"short"})}`:""}</span>}
                              {m.pregnant && !m.onMat && <span style={{ fontSize:9, color:"#8E5570", background:"#FCE7F3", borderRadius:4, padding:"1px 5px", fontWeight:700 }}>🤰 pregnant{m.matStart?` · leaves ${new Date(m.matStart).toLocaleDateString("en-ZA",{day:"2-digit",month:"short"})}`:""}</span>}
                              {!m.onMat && !m.pregnant && m.notes && <span style={{ fontSize:9, color:"#8E5570", fontStyle:"italic", maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={m.notes}>⚑ {m.notes}</span>}
                              <span style={{ fontSize:9, background:"#FBCFE8", color:"#BE185D", border:"1px solid #E8C9D2", borderRadius:4, padding:"1px 6px", fontWeight:700 }}>SM</span>
                            </div>
                          ))}
                          {am.map(m=>(
                            <div key={m._id} style={{ display:"flex", alignItems:"center", gap:6, opacity:m.onMat?0.5:1 }}>
                              <span style={{ fontSize:13 }}>{m.onMat?"🤱":"⭐"}</span>
                              <span style={{ fontSize:11, fontWeight:500, color:m.onMat?"#7A4258":"#475569", fontStyle:m.onMat?"italic":"normal", flex:1 }}>{m.name}</span>
                              {m.onMat && <span style={{ fontSize:9, color:"#8E5570", background:"#FBCFE8", borderRadius:4, padding:"1px 5px", fontWeight:700 }}>on leave{m.matReturn?` · ↩${new Date(m.matReturn).toLocaleDateString("en-ZA",{day:"2-digit",month:"short"})}`:""}</span>}
                              {m.pregnant && !m.onMat && <span style={{ fontSize:9, color:"#8E5570", background:"#FCE7F3", borderRadius:4, padding:"1px 5px", fontWeight:700 }}>🤰 pregnant{m.matStart?` · leaves ${new Date(m.matStart).toLocaleDateString("en-ZA",{day:"2-digit",month:"short"})}`:""}</span>}
                              {!m.onMat && !m.pregnant && m.notes && <span style={{ fontSize:9, color:"#BE185D", fontStyle:"italic", maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={m.notes}>⚑</span>}
                              <span style={{ fontSize:9, background:"#FBCFE8", color:"#BE185D", border:"1px solid #bae6fd", borderRadius:4, padding:"1px 6px", fontWeight:700 }}>AM</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{ marginBottom:10 }}><Meter current={salon.active.length} capacity={salon.capacity} goal={salon.goal} lowDemand={salon.lowDemand} /></div>
                  <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:270, overflowY:"auto" }}>
                    {/* Active staff */}
                    {salon.active.map(m=>(
                      <div key={m._id} style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 7px", borderRadius:7, background:m.isShadow?"#eff6ff":m.transferring?"#eff6ff":m.pregnant?"#fffbeb":m.permit==="z_na"?"#FAEEF1":"#f9fafb", border:`1px solid ${m.isShadow||m.transferring?"#bfdbfe":m.pregnant?"#fde68a":m.permit==="z_na"?"#fecaca":"#e5e7eb"}` }}>
                        <span style={{ fontSize:9, color:"#9ca3af", fontFamily:"monospace", minWidth:34 }}>{m.ec}</span>
                        <span style={{ flex:1, fontSize:11, fontWeight:600, color:m.isShadow||m.transferring?"#1d4ed8":"#111827", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          {m.pregnant?"🤰 ":m.isShadow?"🔄 ":m.transferring?"🔄 ":""}{m.name}
                          {m.transferring&&!m.isShadow&&<span style={{ fontSize:9, marginLeft:4, color:"#BE185D" }}>→{m.transferTo} {m.transferDate?new Date(m.transferDate).toLocaleDateString("en-ZA",{day:"2-digit",month:"short"}):""}</span>}
                          {m.isShadow&&<span style={{ fontSize:9, marginLeft:4, color:"#BE185D" }}>from {m.transferFrom} {m.transferDate?new Date(m.transferDate).toLocaleDateString("en-ZA",{day:"2-digit",month:"short"}):""}</span>}
                        </span>
                        {m.level && <LevelBadge level={m.level} />}
                        <span title={(COMPLIANCE[m.permit]||COMPLIANCE.z_na).label} style={{ fontSize:13 }}>{(COMPLIANCE[m.permit]||COMPLIANCE.z_na).icon}</span>
                      </div>
                    ))}
                    {/* Arriving (pending transfer) staff — shown but not counted */}
                    {salon.arriving.map(m=>(
                      <div key={m._id} style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 7px", borderRadius:7, background:"#FCE7F3", border:"1.5px dashed #93c5fd" }}>
                        <span style={{ fontSize:9, color:"#93c5fd", fontFamily:"monospace", minWidth:34 }}>{m.ec}</span>
                        <span style={{ flex:1, fontSize:11, fontWeight:600, color:"#1d4ed8", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          🔄 {m.name}
                          <span style={{ fontSize:9, marginLeft:5, color:"#2563eb", fontWeight:400 }}>arriving from {m.transferFrom}{m.transferDate?" on "+new Date(m.transferDate).toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"}):""}</span>
                        </span>
                        {m.level && <LevelBadge level={m.level} />}
                        <span style={{ fontSize:9, background:"#F9A8D4", color:"#1e40af", borderRadius:4, padding:"1px 6px", fontWeight:700, whiteSpace:"nowrap" }}>
                          {m.transferDate ? `${daysDiff(m.transferDate)}d` : "pending"}
                        </span>
                      </div>
                    ))}
                    {/* Maternity staff */}
                    {salon.onMat.map(m=>{
                      const mr = matRecs.find(r=>r.ec.trim()===m.ec.trim());
                      const dBack = mr?.returnDate ? daysDiff(mr.returnDate) : null;
                      return (
                        <div key={m._id} style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 7px", borderRadius:7, background:"#F5E1E7", border:"1px solid #FBCFE8", opacity:0.75 }}>
                          <span style={{ fontSize:9, color:"#d1d5db", fontFamily:"monospace", minWidth:34 }}>{m.ec}</span>
                          <span style={{ flex:1, fontSize:11, fontStyle:"italic", color:"#8E5570", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>🤱 {m.name}</span>
                          {dBack!==null && <span style={{ fontSize:10, color:"#8E5570", fontWeight:700, whiteSpace:"nowrap" }}>↩{dBack>0?`${dBack}d`:"today"}</span>}
                        </div>
                      );
                    })}
                    {/* Off-boarded staff — greyed out, seat counted as vacancy.
                        Visible for 31 days after leftDate (offHidden filters older). */}
                    {salon.offboarded.map(m=>{
                      const o = m.offRec || {};
                      const today = new Date(); const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                      const ld = o.leftDate ? new Date(o.leftDate+"T00:00:00") : null;
                      const ldStr = ld ? ld.toLocaleDateString("en-ZA",{day:"2-digit",month:"short"}) : "";
                      const isFuture = ld && ld >= t0;
                      const reason = (o.reason || "Off-boarded").toUpperCase();
                      // Color the pill by reason — red for terminated, blue for resigned, amber otherwise.
                      const pillBg = o.reason === "Terminated" ? "#fee2e2" : o.reason === "Resigned" ? "#dbeafe" : "#fef3c7";
                      const pillFg = o.reason === "Terminated" ? "#991b1b" : o.reason === "Resigned" ? "#1e3a8a" : "#92400e";
                      return (
                        <div key={m._id} style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 7px", borderRadius:7, background:"#f9fafb", border:"1px dashed #d1d5db", opacity:0.65 }} title={reason + " · " + (isFuture ? "last day " : "left ") + ldStr + (o.notes ? "\n" + o.notes : "")}>
                          <span style={{ fontSize:9, color:"#9ca3af", fontFamily:"monospace", minWidth:34 }}>{m.ec}</span>
                          <span style={{ flex:1, fontSize:11, color:"#6b7280", textDecoration:"line-through", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>👋 {m.name}</span>
                          <span style={{ fontSize:9, fontWeight:800, padding:"1px 6px", borderRadius:99, background: pillBg, color: pillFg, whiteSpace:"nowrap", letterSpacing:"0.04em" }}>{reason}</span>
                          <span style={{ fontSize:9, color:"#9ca3af", whiteSpace:"nowrap" }}>{isFuture ? "leaves " : ""}{ldStr}</span>
                        </div>
                      );
                    })}
                    {/* Vacant seats — off-boarded rows already visualise their open slot, so subtract them here too */}
                    {Array.from({ length:Math.max(0, salon.capacity - salon.active.length - salon.offboarded.length) }).map((_,i)=>(
                      <div key={i} style={{ padding:"5px 7px", borderRadius:7, border:"1.5px dashed #d1d5db", display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ fontSize:12, opacity:0.25 }}>👤</span>
                        <span style={{ fontSize:10, color:"#d1d5db", fontStyle:"italic" }}>Vacant seat</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── MATERNITY TAB ── */}
        {tab==="maternity" && (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, flexWrap:"wrap", gap:10 }}>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:22, color:"#8E5570" }}>Maternity Tracker · {matRecs.length} records</div>
              <button onClick={()=>setMatModal({ ec:"", name:"", branch:"Sea Point", matStatus:"on_mat", matStart:"", matEnd:"", returnDate:"", notes:"" })}
                style={{ background:"#BE185D", color:"#fff", border:"none", borderRadius:9, padding:"9px 18px", cursor:"pointer", fontFamily:"inherit", fontWeight:700, fontSize:13 }}>+ Add Record</button>
            </div>

            {/* Returning soon banner */}
            {matRecs.filter(r=>r.matStatus==="on_mat"&&r.returnDate&&daysDiff(r.returnDate)!==null&&daysDiff(r.returnDate)>=0&&daysDiff(r.returnDate)<=60).length>0 && (
              <div style={{ background:"#FBCFE8", border:"1px solid #6ee7b7", borderRadius:12, padding:"12px 18px", marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:800, color:"#8E5570", marginBottom:8, letterSpacing:"0.07em" }}>🔜 RETURNING WITHIN 60 DAYS — plan ahead</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                  {matRecs.filter(r=>r.matStatus==="on_mat"&&r.returnDate&&daysDiff(r.returnDate)>=0&&daysDiff(r.returnDate)<=60)
                    .sort((a,b)=>new Date(a.returnDate)-new Date(b.returnDate))
                    .map(r=>(
                      <div key={r._id} style={{ background:"#FFFFFF", borderRadius:10, padding:"8px 14px", border:"1px solid #6ee7b7", display:"flex", gap:10, alignItems:"center" }}>
                        <span style={{ fontWeight:700, fontSize:13 }}>{r.name}</span>
                        <span style={{ fontSize:11, color:"#BE185D" }}>📍 {r.branch}</span>
                        <span style={{ fontSize:12, fontWeight:800, color:"#8E5570" }}>↩ {fmt(r.returnDate)} ({daysDiff(r.returnDate)}d)</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Group by status */}
            {["on_mat","pregnant","returned","sick_leave"].map(status=>{
              const recs = matRecs.filter(r=>r.matStatus===status).sort(ecSort);
              if (!recs.length) return null;
              const s = MAT_STATUS[status];
              const isExcluded = status==="on_mat";
              return (
                <div key={status} style={{ marginBottom:26 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:s.color, letterSpacing:"0.08em", marginBottom:10, textTransform:"uppercase", display:"flex", alignItems:"center", gap:8 }}>
                    {s.icon} {s.label} — {recs.length} {recs.length===1?"person":"people"}
                    {isExcluded && <span style={{ background:"#FBCFE8", color:"#831843", borderRadius:20, padding:"2px 10px", fontSize:10, fontWeight:700 }}>EXCLUDED FROM STORE COUNT</span>}
                    {status==="pregnant" && <span style={{ background:"#FCE7F3", color:"#831843", borderRadius:20, padding:"2px 10px", fontSize:10, fontWeight:700 }}>COUNTED IN STORE</span>}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))", gap:10 }}>
                    {recs.map(r=>{
                      const dBack = r.returnDate ? daysDiff(r.returnDate) : null;
                      const totalDays = r.matStart&&r.matEnd ? Math.ceil((new Date(r.matEnd)-new Date(r.matStart))/86400000) : null;
                      const elapsed = r.matStart ? Math.ceil((TODAY-new Date(r.matStart))/86400000) : null;
                      const progress = totalDays&&elapsed ? Math.min(Math.max(elapsed/totalDays,0),1) : null;
                      return (
                        <div key={r._id} style={{ background:"#FFFFFF", borderRadius:14, border:`1.5px solid ${s.border}`, padding:"16px 18px" }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                            <div>
                              <div style={{ fontWeight:700, fontSize:14, color:"#111827" }}>{r.name}</div>
                              <div style={{ fontSize:11, color:"#BE185D", marginTop:2 }}>
                                <span style={{ fontFamily:"monospace", color:"#8E5570", fontWeight:700 }}>{r.ec}</span> · 📍 {r.branch}
                              </div>
                            </div>
                            <button onClick={()=>setMatModal(r)} style={{ background:"#f3f4f6", border:"none", borderRadius:7, padding:"5px 11px", cursor:"pointer", fontSize:11, fontFamily:"inherit", fontWeight:700 }}>Edit</button>
                          </div>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
                            <div style={{ background:"#fafafa", borderRadius:8, padding:"8px 10px" }}>
                              <div style={{ fontSize:9, fontWeight:700, color:"#F9A8D4", letterSpacing:"0.07em", marginBottom:3 }}>LEAVE STARTED</div>
                              <div style={{ fontSize:12, fontWeight:700, color:"#111827" }}>{fmt(r.matStart)}</div>
                            </div>
                            <div style={{ background:"#fafafa", borderRadius:8, padding:"8px 10px" }}>
                              <div style={{ fontSize:9, fontWeight:700, color:"#F9A8D4", letterSpacing:"0.07em", marginBottom:3 }}>LEAVE ENDS</div>
                              <div style={{ fontSize:12, fontWeight:700, color:"#111827" }}>{fmt(r.matEnd)}</div>
                            </div>
                            <div style={{ background:dBack!==null&&dBack<=30?"#d1fae5":"#fafafa", borderRadius:8, padding:"8px 10px", gridColumn:"1/-1" }}>
                              <div style={{ fontSize:9, fontWeight:700, color:"#F9A8D4", letterSpacing:"0.07em", marginBottom:3 }}>RETURN TO WORK</div>
                              <div style={{ fontSize:13, fontWeight:800, color:dBack!==null&&dBack<=30?"#065f46":"#111827", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                                <span>{fmt(r.returnDate)}</span>
                                {dBack!==null && (
                                  <span style={{ fontSize:11, padding:"2px 10px", borderRadius:20, background:dBack<=0?"#dcfce7":dBack<=30?"#d1fae5":"#f3f4f6", color:dBack<=0?"#15803d":dBack<=30?"#065f46":"#6b7280", fontWeight:700 }}>
                                    {dBack>0?`in ${dBack} days`:dBack===0?"🎉 TODAY":`${Math.abs(dBack)}d overdue`}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {status==="on_mat"&&progress!==null && (
                            <div style={{ marginBottom:10 }}>
                              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#9ca3af", marginBottom:3 }}><span>Leave progress</span><span>{Math.round(progress*100)}%</span></div>
                              <div style={{ height:6, borderRadius:99, background:"#f3f4f6", overflow:"hidden" }}>
                                <div style={{ height:"100%", width:`${progress*100}%`, background:progress>=1?"#16a34a":"#BE185D", borderRadius:99 }} />
                              </div>
                            </div>
                          )}
                          {r.notes && <div style={{ fontSize:11, color:"#BE185D", background:"#FCE7F3", borderRadius:7, padding:"6px 9px", lineHeight:1.5 }}>{r.notes}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ── ALERTS TAB ── */}
        {tab==="alerts" && (()=>{
          const active = enriched.filter(s=>!s.onMat);
          // Upcoming-cycle schedule alerts (only for users responsible for scheduling).
          const schedAlerts = [];
          if (SCHED_ALERT_PINS.has(currentUser.pin) && upcomingChecked && upcomingMissing.length > 0) {
            const today = new Date();
            const m0 = upcomingMissing[0];
            const monthLbl = new Date(m0.endY, m0.endM, 1).toLocaleDateString("en-ZA", { month:"long", year:"numeric" });
            let deadlineY = m0.endY, deadlineM = m0.endM - 1;
            if (deadlineM < 0) { deadlineM = 11; deadlineY--; }
            const deadline = new Date(deadlineY, deadlineM, 15);
            const overdue = today > deadline;
            const sev = overdue ? "critical" : "warning";
            for (const m of upcomingMissing) {
              const what = m.type === "tech" ? "Nail tech schedule" : "Manager schedule";
              schedAlerts.push({
                type: sev,
                msg: m.branch + " — " + what + " for " + monthLbl + " not yet saved." +
                     (overdue ? " Was due 15 " + deadline.toLocaleDateString("en-ZA", { month:"short" }) + "." : " Due by 15 " + deadline.toLocaleDateString("en-ZA", { month:"short" }) + "."),
                s: null
              });
            }
          }
          const alertItems = [
            ...schedAlerts,
            ...matRecs.filter(r=>r.matStatus==="on_mat"&&r.returnDate&&daysDiff(r.returnDate)<0).map(r=>({ type:"warning", msg:`${r.name} (${r.branch}) — return date ${fmt(r.returnDate)} was ${Math.abs(daysDiff(r.returnDate))} days ago. Confirm return or update dates.`, rec:r })),
            ...matRecs.filter(r=>r.matStatus==="on_mat"&&r.returnDate&&daysDiff(r.returnDate)>=0&&daysDiff(r.returnDate)<=14).map(r=>({ type:"info", msg:`${r.name} (${r.branch}) — returning in ${daysDiff(r.returnDate)} day(s) on ${fmt(r.returnDate)}`, rec:r })),
            ...active.filter(s=>s.permit==="z_na").map(s=>({ type:"critical", msg:`${s.name} (${s.branch}) — Z/NA: no valid work permit`, s })),
            ...active.filter(s=>s.contract==="NO CONTRACT").map(s=>({ type:"warning", msg:`${s.name} (${s.branch}) — no employment contract on file`, s })),
            ...SALONS.filter(sl=>enriched.filter(s=>s.branch===sl.name&&!s.onMat).length===0).map(sl=>({ type:"critical", msg:`${sl.name} — NO active staff assigned`, s:null })),
          ];
          return (
            <div>
              <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:22, marginBottom:16, color:"#111827" }}>Action Required · {alertItems.length} items</div>
              {alertItems.length===0 && <div style={{ textAlign:"center", padding:60, color:"#BE185D", fontSize:16, fontWeight:700 }}>✅ All clear!</div>}
              {["critical","warning","info"].map(type=>{
                const items = alertItems.filter(a=>a.type===type);
                if (!items.length) return null;
                const cfg = {
                  critical:{ icon:"🚨", label:"Critical", bg:"#fee2e2", bdr:"#fca5a5", btn:"#dc2626", c:"#7f1d1d" },
                  warning: { icon:"⚠️",  label:"Warning",  bg:"#fff7ed", bdr:"#fed7aa", btn:"#f97316", c:"#9a3412" },
                  info:    { icon:"🔜",  label:"Info",     bg:"#d1fae5", bdr:"#6ee7b7", btn:"#059669", c:"#065f46" },
                }[type];
                return (
                  <div key={type} style={{ marginBottom:20 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:cfg.c, letterSpacing:"0.08em", marginBottom:7, textTransform:"uppercase" }}>{cfg.icon} {cfg.label} — {items.length} items</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                      {items.map((item,i)=>(
                        <div key={i} style={{ background:cfg.bg, border:`1px solid ${cfg.bdr}`, borderRadius:11, padding:"11px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
                          <span style={{ fontSize:12.5, color:cfg.c, fontWeight:500 }}>{cfg.icon} {item.msg}</span>
                          {item.rec && <button onClick={()=>{ setMatModal(item.rec); setTab("maternity"); }} style={{ background:cfg.btn, color:"#fff", border:"none", borderRadius:7, padding:"5px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>Update</button>}
                          {item.s && <button onClick={()=>{ setStaffModal(item.s); setTab("staff"); }} style={{ background:cfg.btn, color:"#fff", border:"none", borderRadius:7, padding:"5px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>Resolve</button>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

        {/* ── RECRUITMENT TAB (parent) ── */}
        {tab==="recruitment" && (
          <div>
            {/* Sub-nav: Nail Tech vs Manager Recruitment — large, prominent toggle */}
            {(() => {
              // Manager vacancy total: sum of missing SMs (min 1/branch) + missing AMs (min 2/branch),
              // excluding Regional managers and active maternity leave.
              const MIN_SM = 1, MIN_AM = 2;
              const mgrVacancies = SALONS.reduce((a, sl) => {
                const mgrs = managers.filter(m => m.branch === sl.name && !m.onMat);
                const sms = mgrs.filter(m => m.role === "SM").length;
                const ams = mgrs.filter(m => m.role === "AM").length;
                return a + Math.max(0, MIN_SM - sms) + Math.max(0, MIN_AM - ams);
              }, 0);
              const counts = { nailTech: stats.vacancies, mgrRecruit: mgrVacancies };
              return (
                <div style={{ display:"flex", gap:0, marginBottom:24, padding:6, background:"#FCE7F3", borderRadius:14, border:"1px solid #FBCFE8", maxWidth:680 }}>
                  {[
                    { k:"nailTech",   label:"💅 Nail Tech Recruitment" },
                    { k:"mgrRecruit", label:"👔 Manager Recruitment" }
                  ].map(t => {
                    const active = recruitSubTab===t.k;
                    const n = counts[t.k];
                    return (
                      <button key={t.k} onClick={()=>setRecruitSubTab(t.k)}
                        style={{ flex:1, padding:"14px 22px", borderRadius:10, border:"none", background: active ? "#BE185D" : "transparent", color: active ? "#FFFFFF" : "#831843", cursor:"pointer", fontFamily:"inherit", fontSize:15, fontWeight:700, transition:"all .18s", boxShadow: active ? "0 4px 12px rgba(190,24,93,0.32)" : "none", letterSpacing:"0.01em", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:10 }}>
                        <span>{t.label}</span>
                        <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", minWidth:24, height:24, padding:"0 8px", borderRadius:12, background: active ? "#FFFFFF" : (n>0 ? "#BE185D" : "#FBCFE8"), color: active ? "#BE185D" : (n>0 ? "#FFFFFF" : "#9F1A4F"), fontSize:12, fontWeight:800, lineHeight:1 }}>{n}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {recruitSubTab==="nailTech" && (<>
            {/* Summary header */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10, marginBottom:20 }}>
              {[
                { l:"Positions Needed",   v:stats.vacancies,    i:"🎯", c:"#7c3aed", bg:"#ede9fe" },
                { l:"Branches Hiring",    v:stats.understaffed, i:"📍", c:"#9a3412", bg:"#ffedd5" },
                { l:"At Full Capacity",   v:SALONS.length-stats.understaffed, i:"✅", c:"#065f46", bg:"#d1fae5" },
                { l:"On Maternity Leave", v:stats.onMat,        i:"🤱", c:"#7A4258", bg:"#fce7f3", note:"returning soon may fill gaps" },
                { l:"Returning ≤60 Days", v:stats.returning60,  i:"🔜", c:"#065f46", bg:"#d1fae5" },
              ].map(c=>(
                <div key={c.l} style={{ background:c.bg, borderRadius:13, padding:"13px 16px" }}>
                  <div style={{ fontSize:20 }}>{c.i}</div>
                  <div style={{ fontSize:28, fontWeight:800, color:c.c, lineHeight:1.1 }}>{c.v}</div>
                  <div style={{ fontSize:9, fontWeight:700, color:c.c, opacity:0.72, marginTop:4, letterSpacing:"0.06em" }}>{c.l.toUpperCase()}</div>
                  {c.note && <div style={{ fontSize:9, color:c.c, opacity:0.5, marginTop:2 }}>{c.note}</div>}
                </div>
              ))}
            </div>

            {stats.vacancies === 0
              ? <div style={{ textAlign:"center", padding:60, color:"#BE185D", fontSize:16, fontWeight:700 }}>✅ All branches fully staffed — no recruitment needed!</div>
              : (
                <>
                  {/* Urgency legend */}
                  <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
                    <span style={{ fontSize:11, fontWeight:700, color:"#831843" }}>Urgency:</span>
                    {[["#fee2e2","#7f1d1d","5+ positions"],["#ffedd5","#9a3412","3–4 positions"],["#fef9c3","#78350f","1–2 positions"],["#dcfce7","#14532d","At target"]].map(([bg,c,l])=>(
                      <span key={l} style={{ background:bg, color:c, borderRadius:20, padding:"3px 12px", fontSize:11, fontWeight:700, border:`1px solid ${bg}` }}>{l}</span>
                    ))}
                  </div>

                  {/* Per-branch cards sorted by urgency */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
                    {salonData.sort((a,b)=>(b.goal-b.active.length)-(a.goal-a.active.length)).map(salon => {
                      const need = Math.max(0, salon.goal - salon.active.length);
                      const pct  = Math.min(Math.round(salon.active.length/salon.goal*100), 100);
                      const [col,bg,brd] = need===0?["#14532d","#dcfce7","#86efac"]:need>=5?["#7f1d1d","#fee2e2","#fca5a5"]:need>=3?["#9a3412","#ffedd5","#fcd34d"]:["#78350f","#fef9c3","#fde68a"];
                      return (
                        <div key={salon.name} style={{ background:"#FFFFFF", borderRadius:14, border:`2px solid ${brd}`, overflow:"hidden" }}>
                          {/* Top colour bar */}
                          <div style={{ height:5, background: need===0?"#16a34a":need>=5?"#dc2626":need>=3?"#f97316":"#eab308" }} />
                          <div style={{ padding:"16px 18px" }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                              <div>
                                <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:17, fontWeight:700, color:"#111827" }}>📍 {salon.name}</div>
                                {salon.lowDemand && <span style={{ fontSize:9, fontWeight:700, background:"#FFFFFF", color:"#BE185D", border:"1px solid #86efac", borderRadius:20, padding:"1px 8px", display:"inline-block", marginTop:2 }}>✦ LOW DEMAND STORE · TARGET {salon.targetCapacity}</span>}
                              </div>
                              <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:36, fontWeight:800, color:col, lineHeight:1 }}>{need}</div>
                                <div style={{ fontSize:9, color:col, fontWeight:700 }}>{need===0?"FULL":"TO HIRE"}</div>
                              </div>
                            </div>

                            {/* Fill meter */}
                            <div style={{ marginBottom:10 }}>
                              <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, fontWeight:700, marginBottom:4, color:need===0?"#15803d":"#9a3412" }}>
                                <span>{salon.active.length} of {salon.goal} staff {salon.lowDemand?"(target)":"(capacity)"}</span>
                                <span>{pct}% filled</span>
                              </div>
                              <div style={{ height:8, borderRadius:99, background:"#e5e7eb", overflow:"hidden" }}>
                                <div style={{ height:"100%", width:`${pct}%`, background:need===0?"#16a34a":pct<60?"#dc2626":pct<80?"#f97316":"#eab308", borderRadius:99, transition:"width .5s" }} />
                              </div>
                            </div>

                            {/* Returning staff that will fill gaps */}
                            {(() => {
                              const returning = matRecs.filter(r=>r.matStatus==="on_mat"&&r.branch===salon.name&&r.returnDate&&daysDiff(r.returnDate)!==null&&daysDiff(r.returnDate)>=0&&daysDiff(r.returnDate)<=90);
                              return returning.length>0&&need>0?(
                                <div style={{ background:"#FBCFE8", border:"1px solid #6ee7b7", borderRadius:8, padding:"7px 10px", marginBottom:8 }}>
                                  <div style={{ fontSize:10, fontWeight:700, color:"#8E5570", marginBottom:4 }}>🔜 Returning within 90 days — may fill {Math.min(returning.length,need)} position{returning.length>1?"s":""}:</div>
                                  {returning.sort((a,b)=>new Date(a.returnDate)-new Date(b.returnDate)).map(r=>(
                                    <div key={r.ec} style={{ fontSize:11, color:"#8E5570", display:"flex", justifyContent:"space-between" }}>
                                      <span>{r.name}</span>
                                      <span style={{ fontWeight:700 }}>↩ {fmt(r.returnDate)} ({daysDiff(r.returnDate)}d)</span>
                                    </div>
                                  ))}
                                </div>
                              ):null;
                            })()}

                            {/* Stations info */}
                            <div style={{ fontSize:10, color:"#9ca3af", display:"flex", gap:12 }}>
                              <span>💅 {salon.mani} mani stations</span>
                              <span>🦶 {salon.pedi} pedi stations</span>
                              {need===0 && <span style={{ color:"#BE185D", fontWeight:700 }}>✓ No hiring needed</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )
            }
            </>)}

            {recruitSubTab==="mgrRecruit" && (
              <div>
                {/* Nested sub-nav: Coverage vs Planner */}
                <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap", paddingLeft:4 }}>
                  {[
                    { k:"coverage", label:"📋 Manager Coverage" },
                    { k:"planner",  label:"🧩 Manager Planner" }
                  ].map(t => (
                    <button key={t.k} onClick={()=>setMgrSubTab(t.k)}
                      style={{ padding:"6px 14px", borderRadius:8, border:"1px solid " + (mgrSubTab===t.k ? "#9F1A4F" : "#FBCFE8"), background: mgrSubTab===t.k ? "#FCE7F3" : "#FFFFFF", color:"#831843", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight: mgrSubTab===t.k ? 700 : 600, transition:"all .15s" }}>
                      {t.label}
                    </button>
                  ))}
                </div>

        {/* ── MANAGER COVERAGE (nested) ── */}
        {mgrSubTab==="coverage" && (() => {
          const MIN_SM = 1, MIN_AM = 2;
          const branchStats = SALONS.map(salon => { // Regional managers excluded from store coverage
            const mgrs = managers.filter(m => m.branch === salon.name);
            const sms  = mgrs.filter(m => m.role === "SM" && !m.onMat);
            const ams  = mgrs.filter(m => m.role === "AM" && !m.onMat);
            const onMatMgrs = mgrs.filter(m => m.onMat);
            const missSM = Math.max(0, MIN_SM - sms.length);
            const missAM = Math.max(0, MIN_AM - ams.length);
            const ok = missSM === 0 && missAM === 0;
            return { salon, mgrs, sms, ams, onMatMgrs, missSM, missAM, ok };
          });
          const totalGaps    = branchStats.reduce((a,b) => a + b.missSM + b.missAM, 0);
          const totalSMNeeded = branchStats.reduce((a,b) => a + b.missSM, 0);
          const totalAMNeeded = branchStats.reduce((a,b) => a + b.missAM, 0);
          const gapBranches   = branchStats.filter(b => !b.ok).length;
          const totalActiveSM = managers.filter(m=>m.role==="SM"&&!m.onMat&&m.branch!=="Regional").length;
          const totalActiveAM = managers.filter(m=>m.role==="AM"&&!m.onMat&&m.branch!=="Regional").length;
          const totalPregnant = managers.filter(m=>m.pregnant&&!m.onMat).length;
          const totalOnMat    = managers.filter(m=>m.onMat).length;
          return (
            <div>
              {/* ── CURRENT HEADCOUNT ── */}
              <div style={{ marginBottom:6, fontSize:10, fontWeight:800, color:"#BE185D", letterSpacing:"0.08em" }}>CURRENT MANAGEMENT HEADCOUNT</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10, marginBottom:20 }}>
                {[
                  { l:"Store Managers",      v:totalActiveSM,  i:"👑", c:"#7c3aed", bg:"#ede9fe", note:"active in store" },
                  { l:"Asst. Managers",      v:totalActiveAM,  i:"⭐", c:"#0369a1", bg:"#e0f2fe", note:"active in store" },
                  { l:"Pregnant (upcoming)", v:totalPregnant,  i:"🤰", c:"#92400e", bg:"#fef3c7", note:"still working" },
                  { l:"On Maternity Leave",  v:totalOnMat,     i:"🤱", c:"#7A4258", bg:"#fce7f3", note:"not counted" },
                  { l:"Regional Managers",   v:managers.filter(m=>m.branch==="Regional"&&!m.onMat).length, i:"🌍", c:"#475569", bg:"#f1f5f9", note:"not store-based" },
                  { l:"Fully Covered Stores",v:SALONS.length-gapBranches, i:"✅", c:"#065f46", bg:"#d1fae5", note:`of ${SALONS.length} stores` },
                ].map(c=>(
                  <div key={c.l} style={{ background:c.bg, borderRadius:13, padding:"12px 14px" }}>
                    <div style={{ fontSize:18 }}>{c.i}</div>
                    <div style={{ fontSize:26, fontWeight:800, color:c.c, lineHeight:1.1 }}>{c.v}</div>
                    <div style={{ fontSize:9, fontWeight:700, color:c.c, opacity:0.72, marginTop:3, letterSpacing:"0.06em" }}>{c.l.toUpperCase()}</div>
                    {c.note&&<div style={{ fontSize:9, color:c.c, opacity:0.5 }}>{c.note}</div>}
                  </div>
                ))}
              </div>

              {/* ── HIRING NEEDED ── */}
              {totalGaps>0&&(
                <div style={{ background:"#FFFFFF", border:"2px solid #BE185D", borderRadius:14, overflow:"hidden", marginBottom:20 }}>
                  <div style={{ background:"#BE185D", color:"#fff", padding:"11px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                    <span style={{ fontWeight:800, fontSize:14 }}>🚨 Manager Recruitment Needed — {totalGaps} position{totalGaps!==1?"s":""} to fill</span>
                    <span style={{ fontSize:11, opacity:0.85 }}>Coverage standard: 1 SM + min 2 AM per store</span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:0 }}>
                    {/* SM column */}
                    <div style={{ padding:"16px 20px", borderRight:"1px solid #fee2e2" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                        <span style={{ fontSize:20 }}>👑</span>
                        <div>
                          <div style={{ fontWeight:800, fontSize:18, color:"#BE185D" }}>{totalSMNeeded}</div>
                          <div style={{ fontSize:10, fontWeight:700, color:"#BE185D", letterSpacing:"0.06em" }}>STORE MANAGERS NEEDED</div>
                        </div>
                      </div>
                      {branchStats.filter(b=>b.missSM>0).length===0
                        ? <div style={{ fontSize:12, color:"#BE185D", fontWeight:600 }}>✓ All stores have a Store Manager</div>
                        : branchStats.filter(b=>b.missSM>0).sort((a,b)=>b.missSM-a.missSM).map(b=>(
                            <div key={b.salon.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 10px", borderRadius:8, background:"#F5E1E7", border:"1px solid #FBCFE8", marginBottom:5 }}>
                              <span style={{ fontSize:12, fontWeight:600, color:"#831843" }}>📍 {b.salon.name}</span>
                              <span style={{ fontSize:11, fontWeight:800, color:"#BE185D" }}>+{b.missSM} SM</span>
                            </div>
                          ))
                      }
                    </div>
                    {/* AM column */}
                    <div style={{ padding:"16px 20px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                        <span style={{ fontSize:20 }}>⭐</span>
                        <div>
                          <div style={{ fontWeight:800, fontSize:18, color:"#BE185D" }}>{totalAMNeeded}</div>
                          <div style={{ fontSize:10, fontWeight:700, color:"#BE185D", letterSpacing:"0.06em" }}>ASST. MANAGERS NEEDED</div>
                        </div>
                      </div>
                      {branchStats.filter(b=>b.missAM>0).length===0
                        ? <div style={{ fontSize:12, color:"#BE185D", fontWeight:600 }}>✓ All stores have enough AMs</div>
                        : branchStats.filter(b=>b.missAM>0).sort((a,b)=>b.missAM-a.missAM).map(b=>(
                            <div key={b.salon.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 10px", borderRadius:8, background:"#FCE7F3", border:"1px solid #bae6fd", marginBottom:5 }}>
                              <span style={{ fontSize:12, fontWeight:600, color:"#831843" }}>📍 {b.salon.name}</span>
                              <span style={{ fontSize:11, fontWeight:800, color:"#BE185D" }}>+{b.missAM} AM</span>
                            </div>
                          ))
                      }
                    </div>
                  </div>
                  {totalPregnant>0&&(
                    <div style={{ background:"#FFFFFF", border:"1px solid #fde68a", borderRadius:0, borderTop:"1px solid #fde68a", padding:"10px 20px", fontSize:12, color:"#831843" }}>
                      ⚠ <strong>{totalPregnant} manager{totalPregnant!==1?"s are":" is"} pregnant</strong> and will go on leave soon — factor these into your hiring plan above.
                      {branchStats.filter(b=>b.mgrs.some(m=>m.pregnant&&!m.onMat)).map(b=>(
                        <span key={b.salon.name} style={{ marginLeft:8, background:"#FCE7F3", borderRadius:4, padding:"1px 8px", fontWeight:700 }}>📍 {b.salon.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {totalGaps===0&&(
                <div style={{ background:"#FBCFE8", border:"1px solid #6ee7b7", borderRadius:12, padding:"14px 20px", marginBottom:20, fontSize:13, color:"#8E5570", fontWeight:700, textAlign:"center" }}>
                  ✅ All stores are fully covered with Store Managers and Assistant Managers!
                  {totalPregnant>0&&<div style={{ fontSize:11, fontWeight:400, marginTop:4 }}>⚠ Note: {totalPregnant} manager{totalPregnant!==1?"s are":" is"} pregnant — plan cover for upcoming leave.</div>}
                </div>
              )}

              {/* Coverage standard reminder */}
              <div style={{ background:"#FCE7F3", border:"1px solid #FBCFE8", borderRadius:11, padding:"10px 16px", marginBottom:16, fontSize:11, color:"#8E5570", display:"flex", gap:20, flexWrap:"wrap" }}>
                <span>📏 <strong>Standard:</strong></span>
                <span>👑 Min <strong>1 SM</strong> per store</span>
                <span>⭐ Min <strong>2 AM</strong> per store</span>
                <span>🌍 Regional managers not counted toward store coverage</span>
                <span>🤱 Managers on maternity not counted</span>
              </div>

{/* Per-branch cards */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))", gap:12 }}>
                {branchStats.sort((a,b)=>(b.missSM+b.missAM)-(a.missSM+a.missAM)).map(({salon,mgrs,sms,ams,onMatMgrs,missSM,missAM,ok})=>{
                  const [brd,bg] = ok ? ["#86efac","#f0fdf4"] : missSM>0 ? ["#fca5a5","#fee2e2"] : ["#fde68a","#fef9c3"];
                  return (
                    <div key={salon.name} style={{ background:"#FFFFFF", borderRadius:14, border:`2px solid ${brd}`, overflow:"hidden" }}>
                      <div style={{ height:4, background:ok?"#16a34a":missSM>0?"#dc2626":"#eab308" }} />
                      <div style={{ padding:"14px 16px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:16, fontWeight:700 }}>📍 {salon.name}</div>
                          {ok
                            ? <span style={{ fontSize:11, background:"#FBCFE8", color:"#8E5570", borderRadius:20, padding:"2px 10px", fontWeight:700 }}>✓ Covered</span>
                            : <span style={{ fontSize:11, background:missSM>0?"#fee2e2":"#fef9c3", color:missSM>0?"#991b1b":"#78350f", borderRadius:20, padding:"2px 10px", fontWeight:700 }}>
                                {missSM>0?`Need ${missSM} SM`:`Need ${missAM} AM`}
                              </span>}
                        </div>
                        {/* SM row */}
                        <div style={{ marginBottom:6 }}>
                          <div style={{ fontSize:10, fontWeight:700, color:"#BE185D", marginBottom:4 }}>👑 STORE MANAGER{missSM>0&&<span style={{ marginLeft:6, color:"#BE185D" }}>⚠ {missSM} missing</span>}</div>
                          {sms.map(m=><div key={m._id} style={{ fontSize:12, color:"#831843", padding:"3px 0" }}>✓ {m.name}</div>)}
                          {Array.from({length:missSM}).map((_,i)=><div key={i} style={{ fontSize:12, color:"#BE185D", fontStyle:"italic" }}>✗ Vacant SM position</div>)}
                        </div>
                        {/* AM rows */}
                        <div style={{ marginBottom:onMatMgrs.length>0?6:0 }}>
                          <div style={{ fontSize:10, fontWeight:700, color:"#BE185D", marginBottom:4 }}>⭐ ASSISTANT MANAGERS{missAM>0&&<span style={{ marginLeft:6, color:"#BE185D" }}>⚠ {missAM} missing</span>}</div>
                          {ams.map(m=><div key={m._id} style={{ fontSize:12, color:"#8E5570", padding:"3px 0" }}>✓ {m.name}{m.notes&&<span style={{ fontSize:10, color:"#BE185D", marginLeft:6 }}>({m.notes})</span>}</div>)}
                          {Array.from({length:missAM}).map((_,i)=><div key={i} style={{ fontSize:12, color:"#BE185D", fontStyle:"italic" }}>✗ Vacant AM position</div>)}
                        </div>
                        {/* Pregnant — upcoming leave */}
                        {mgrs.filter(m=>m.pregnant&&!m.onMat).length>0&&(
                          <div style={{ borderTop:"1px solid #fef9c3", paddingTop:6, marginBottom:6 }}>
                            <div style={{ fontSize:10, fontWeight:700, color:"#8E5570", marginBottom:4 }}>🤰 PREGNANT — UPCOMING LEAVE (plan cover now)</div>
                            {mgrs.filter(m=>m.pregnant&&!m.onMat).map(m=>(
                              <div key={m._id} style={{ fontSize:12, color:"#8E5570", padding:"2px 0" }}>
                                {m.name} <span style={{ fontSize:9, color:"#8E5570" }}>({m.role}){m.matStart?` · leaves ${new Date(m.matStart).toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"})}`:" · leave date TBC"}{m.matReturn?` · returns ${new Date(m.matReturn).toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"})}`:""}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* On maternity */}
                        {onMatMgrs.length>0&&(
                          <div style={{ borderTop:"1px solid #f3e8ff", paddingTop:6 }}>
                            <div style={{ fontSize:10, fontWeight:700, color:"#8E5570", marginBottom:4 }}>🤱 ON MATERNITY LEAVE (not counted)</div>
                            {onMatMgrs.map(m=><div key={m._id} style={{ fontSize:12, color:"#8E5570", fontStyle:"italic", padding:"2px 0", opacity:0.75 }}>
                              {m.name} <span style={{ fontSize:9 }}>({m.role}){m.matReturn?` · ↩ ${new Date(m.matReturn).toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"})}`:""}</span>
                            </div>)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Regional managers panel */}
              {managers.filter(m=>m.branch==="Regional").length>0&&(
                <div style={{ background:"#FCE7F3", border:"1px solid #FBCFE8", borderRadius:12, padding:"14px 18px", marginBottom:0, marginTop:20 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:"#8E5570", letterSpacing:"0.08em", marginBottom:10 }}>🌍 REGIONAL MANAGERS — Not assigned to a specific store</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {managers.filter(m=>m.branch==="Regional").sort((a,b)=>a.role===b.role?0:a.role==="SM"?-1:1).map(m=>(
                      <div key={m._id} style={{ display:"flex", alignItems:"center", gap:6, background:"#FFFFFF", border:"1px solid #FBCFE8", borderRadius:8, padding:"6px 12px", opacity:m.onMat?0.55:1 }}>
                        <span style={{ fontSize:13 }}>{m.onMat?"🤱":m.pregnant?"🤰":m.role==="SM"?"👑":"⭐"}</span>
                        <span style={{ fontSize:12, fontWeight:600, color:m.onMat?"#7A4258":"#374151" }}>{m.name}</span>
                        {m.notes&&<span style={{ fontSize:10, color:"#BE185D", fontStyle:"italic" }}>— {m.notes}</span>}
                        <span style={{ fontSize:9, background:m.role==="SM"?"#ede9fe":"#e0f2fe", color:m.role==="SM"?"#7c3aed":"#0369a1", borderRadius:4, padding:"1px 6px", fontWeight:700 }}>{m.role}</span>
                        {m.onMat&&<span style={{ fontSize:9, color:"#8E5570", background:"#FBCFE8", borderRadius:4, padding:"1px 5px", fontWeight:700 }}>mat.</span>}
                        {m.pregnant&&!m.onMat&&<span style={{ fontSize:9, color:"#8E5570", background:"#FCE7F3", borderRadius:4, padding:"1px 5px", fontWeight:700 }}>🤰</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

                          </div>
          );
        })()}

        {/* ── MANAGER PLANNER (nested) ── */}
        {mgrSubTab==="planner" && (() => {
          // Initialise sandbox from live managers on first open
          if (!plannerMgrs) {
            setTimeout(() => setPlannerMgrs(managers.map(m=>({...m}))), 0);
            return <div style={{ padding:40, textAlign:"center", color:"#9ca3af" }}>Loading planner…</div>;
          }

          const MIN_SM = 1, MIN_AM = 2;

          const branchMgrs = salon => plannerMgrs.filter(m => m.branch === salon && m.branch !== 'Regional');
          const smCount  = salon => branchMgrs(salon).filter(m=>m.role==="SM"&&!m.onMat).length;
          const amCount  = salon => branchMgrs(salon).filter(m=>m.role==="AM"&&!m.onMat).length;
          const gapColor = salon => {
            if (smCount(salon) < MIN_SM) return "#dc2626";
            if (amCount(salon) < MIN_AM) return "#d97706";
            return "#16a34a";
          };

          const handleDrop = (e, targetBranch) => {
            e.preventDefault();
            if (!dragMgr) return;
            setPlannerMgrs(p => p.map(m => m._id === dragMgr._id ? {...m, branch: targetBranch} : m));
            setDragMgr(null);
          };

          const totalGaps = SALONS.reduce((a,s)=>a+Math.max(0,MIN_SM-smCount(s.name))+Math.max(0,MIN_AM-amCount(s.name)),0);

          return (
            <div>
              {/* Toolbar */}
              <div style={{ display:"flex", gap:10, marginBottom:18, flexWrap:"wrap", alignItems:"center" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:"'Playfair Display',serif", fontSize:22, color:"#8E5570" }}>🧩 Manager Planner — Sandbox</div>
                  <div style={{ fontSize:12, color:"#BE185D", marginTop:2 }}>Drag managers between stores to test coverage. Changes here don't affect the live data.</div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={()=>setPlannerMgrs(managers.map(m=>({...m})))}
                    style={{ padding:"8px 16px", borderRadius:9, border:"1px solid #FBCFE8", background:"#FFFFFF", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700, color:"#831843" }}>
                    ↺ Reset to Live
                  </button>
                  <button onClick={()=>{ if(window.confirm && !window.confirm("Apply this plan to live data? This will update all manager branch assignments.")) return; setManagers(plannerMgrs.map(m=>({...m}))); setTab("locations"); }}
                    onClick2={()=>{ setManagers(plannerMgrs.map(m=>({...m}))); alert("Plan applied to live data!"); setTab("locations"); }}
                    onClick={()=>{ if(totalGaps>0){ if(!window.confirm(`There are still ${totalGaps} coverage gaps. Apply anyway?`)) return; } setManagers(plannerMgrs.map(m=>({...m}))); setTab("locations"); }}
                    style={{ padding:"8px 16px", borderRadius:9, border:"none", background:"#BE185D", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>
                    ✓ Apply to Live Data
                  </button>
                </div>
              </div>

              {/* Coverage summary bar */}
              <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
                {SALONS.map(salon=>{
                  const col = gapColor(salon.name);
                  const ok = col === "#16a34a";
                  return (
                    <div key={salon.name} style={{ background:ok?"#d1fae5":col==="#dc2626"?"#fee2e2":"#fef9c3", border:`1px solid ${ok?"#6ee7b7":col==="#dc2626"?"#fca5a5":"#fde68a"}`, borderRadius:8, padding:"3px 10px", fontSize:11, fontWeight:700, color:col }}>
                      {salon.name.split(" ")[0]} {ok?"✓":`⚠ ${Math.max(0,MIN_SM-smCount(salon.name))>0?"SM!":"AM↓"}`}
                    </div>
                  );
                })}
              </div>

              {/* Unassigned pool — managers dragged here are "on bench" */}
              <div style={{ background:"#F9A8D4", border:"2px dashed #cbd5e1", borderRadius:14, padding:"12px 16px", marginBottom:16 }}
                onDragOver={e=>e.preventDefault()}
                onDrop={e=>handleDrop(e,"__bench__")}>
                <div style={{ fontSize:11, fontWeight:700, color:"#BE185D", marginBottom:8 }}>🪑 BENCH — Drag managers here to remove from a store temporarily</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, minHeight:32 }}>
                  {plannerMgrs.filter(m=>m.branch==="__bench__").map(m=>(
                    <div key={m._id} draggable
                      onDragStart={()=>setDragMgr(m)}
                      style={{ display:"flex", alignItems:"center", gap:6, background:"#FFFFFF", border:"1px solid #FBCFE8", borderRadius:8, padding:"5px 10px", cursor:"grab", fontSize:12, fontWeight:600, color:"#831843" }}>
                      {m.role==="SM"?"👑":"⭐"} {m.name}
                      <span style={{ fontSize:9, background:m.role==="SM"?"#ede9fe":"#e0f2fe", color:m.role==="SM"?"#7c3aed":"#0369a1", borderRadius:4, padding:"1px 5px", fontWeight:700 }}>{m.role}</span>
                    </div>
                  ))}
                  {plannerMgrs.filter(m=>m.branch==="__bench__").length===0&&<span style={{ color:"#cbd5e1", fontSize:12, fontStyle:"italic" }}>Empty — drag a manager here to bench them</span>}
                </div>
              </div>

              {/* Branch planner cards */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:12 }}>
                {SALONS.map(salon=>{
                  const mgrs = branchMgrs(salon.name);
                  const sms = mgrs.filter(m=>m.role==="SM");
                  const ams = mgrs.filter(m=>m.role==="AM");
                  const missSM = Math.max(0, MIN_SM - sms.length);
                  const missAM = Math.max(0, MIN_AM - ams.length);
                  const col = gapColor(salon.name);
                  const ok = col==="#16a34a";
                  return (
                    <div key={salon.name}
                      onDragOver={e=>e.preventDefault()}
                      onDrop={e=>handleDrop(e, salon.name)}
                      style={{ background:"#FFFFFF", borderRadius:14, border:`2px solid ${ok?"#86efac":col==="#dc2626"?"#fca5a5":"#fde68a"}`, overflow:"hidden", transition:"border-color .2s" }}>
                      <div style={{ height:4, background:col }} />
                      <div style={{ padding:"12px 14px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:15, fontWeight:700 }}>📍 {salon.name}</div>
                          <span style={{ fontSize:10, background:ok?"#d1fae5":col==="#dc2626"?"#fee2e2":"#fef9c3", color:ok?"#065f46":col==="#dc2626"?"#991b1b":"#78350f", borderRadius:20, padding:"2px 8px", fontWeight:700 }}>
                            {ok?"✓ OK":missSM>0?`⚠ Need SM`:`⚠ Need ${missAM} AM`}
                          </span>
                        </div>
                        {/* SM slots */}
                        <div style={{ marginBottom:6 }}>
                          <div style={{ fontSize:9, fontWeight:800, color:"#BE185D", marginBottom:4 }}>STORE MANAGER</div>
                          {plannerMgrs.filter(m=>m.branch===salon.name&&m.role==="SM").map(m=>(
                            <div key={m._id} draggable={!m.onMat} onDragStart={()=>!m.onMat&&setDragMgr(m)}
                              style={{ display:"flex", alignItems:"center", gap:6, background:m.onMat?"#fdf4ff":"#faf5ff", border:`1px solid ${m.onMat?"#fbcfe8":"#e9d5ff"}`, borderRadius:7, padding:"4px 8px", marginBottom:3, cursor:m.onMat?"default":"grab", fontSize:11, fontWeight:600, opacity:m.onMat?0.55:1 }}>
                              {m.onMat?"🤱":"👑"} <span style={{ flex:1, fontStyle:m.onMat?"italic":"normal", color:m.onMat?"#7A4258":"inherit" }}>{m.name}</span>
                              {m.onMat&&<span style={{ fontSize:9, color:"#8E5570" }}>mat.</span>}
                              <span style={{ fontSize:9, background:"#FBCFE8", color:"#BE185D", borderRadius:4, padding:"1px 5px", fontWeight:700 }}>SM</span>
                            </div>
                          ))}
                          {Array.from({length:missSM}).map((_,i)=>(
                            <div key={i} style={{ border:"1.5px dashed #BE185D", borderRadius:7, padding:"4px 8px", marginBottom:3, fontSize:11, color:"#BE185D", fontStyle:"italic", textAlign:"center" }}>
                              ⚠ No Store Manager
                            </div>
                          ))}
                        </div>
                        {/* AM slots */}
                        <div>
                          <div style={{ fontSize:9, fontWeight:800, color:"#BE185D", marginBottom:4 }}>ASSISTANT MANAGERS ({ams.length}/{MIN_AM} min)</div>
                          {plannerMgrs.filter(m=>m.branch===salon.name&&m.role==="AM").map(m=>(
                            <div key={m._id} draggable={!m.onMat} onDragStart={()=>!m.onMat&&setDragMgr(m)}
                              style={{ display:"flex", alignItems:"center", gap:6, background:m.onMat?"#fdf4ff":"#f0f9ff", border:`1px solid ${m.onMat?"#fbcfe8":"#bae6fd"}`, borderRadius:7, padding:"4px 8px", marginBottom:3, cursor:m.onMat?"default":"grab", fontSize:11, fontWeight:500, opacity:m.onMat?0.55:1 }}>
                              {m.onMat?"🤱":"⭐"} <span style={{ flex:1, color:m.onMat?"#7A4258":"#475569", fontStyle:m.onMat?"italic":"normal" }}>{m.name}</span>
                              {m.onMat&&<span style={{ fontSize:9, color:"#8E5570" }}>mat.</span>}
                              <span style={{ fontSize:9, background:"#FBCFE8", color:"#BE185D", borderRadius:4, padding:"1px 5px", fontWeight:700 }}>AM</span>
                            </div>
                          ))}
                          {Array.from({length:missAM}).map((_,i)=>(
                            <div key={i} style={{ border:"1.5px dashed #FBCFE8", borderRadius:7, padding:"4px 8px", marginBottom:3, fontSize:11, color:"#BE185D", fontStyle:"italic", textAlign:"center" }}>
                              ⚠ AM needed
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop:6, fontSize:10, color:"#BE185D", textAlign:"center", fontStyle:"italic" }}>↕ drag managers in or out</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
              </div>
            )}
          </div>
        )}

        {/* ── ONBOARDING TAB ── */}
        {tab==="onboard" && (() => {
          const now = new Date();
          const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const fmt = ymd => ymd ? new Date(ymd+"T00:00:00").toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"}) : "";
          const daysFrom = ymd => Math.floor((t0 - new Date(ymd+"T00:00:00")) / 86400000);
          const active = obList.filter(r => r.startDate && daysFrom(r.startDate) <= 31);
          const last30 = obList.filter(r => r.startDate && daysFrom(r.startDate) >= 0 && daysFrom(r.startDate) <= 30).length;
          const future = obList.filter(r => r.startDate && daysFrom(r.startDate) < 0).length;
          const grp = { "Nail Tech":[], "Manager":[], "Head Office":[], "Other":[] };
          for (const r of active) {
            if (r.branch === "Head Office")                                  grp["Head Office"].push(r);
            else if (r.position === "Nail Tech")                             grp["Nail Tech"].push(r);
            else if (r.position === "SM" || r.position === "AM" || r.position === "Manager") grp["Manager"].push(r);
            else                                                             grp["Other"].push(r);
          }
          const persistOb = async (next) => {
            setObList(next);
            try { await window.BOA_DB.saveOnboarding(next); }
            catch (e) { alert("Could not save onboarding: " + (e.message || e)); }
          };
          const addOb = () => {
            if (!obForm.name || !obForm.startDate) { alert("Name and start date are required."); return; }
            let next;
            const wasEdit = !!obForm._editId;
            if (wasEdit) {
              next = obList.map(r => r._id === obForm._editId
                ? { ...r, name: obForm.name, ec: obForm.ec, branch: obForm.branch, position: obForm.position, positionOther: obForm.positionOther||"", startDate: obForm.startDate, notes: obForm.notes, updatedAt: new Date().toISOString() }
                : r);
            } else {
              const newRec = { _id: Date.now(), name: obForm.name, ec: obForm.ec, branch: obForm.branch, position: obForm.position, positionOther: obForm.positionOther||"", startDate: obForm.startDate, notes: obForm.notes, addedAt: new Date().toISOString() };
              next = [...obList, newRec];
            }
            persistOb(next);
            logActivity(
              wasEdit ? "Edited onboarding" : "Onboarded staff",
              obForm.name + (obForm.ec ? " (" + obForm.ec + ")" : ""),
              (obForm.position || "") + " · " + (obForm.branch || "") + " · start " + obForm.startDate
            );
            setObForm({ name:"", ec:"", branch: SALONS[0].name, position:"Nail Tech", positionOther:"", startDate:"", notes:"", _editId: null });
          };
          const editOb = (r) => {
            setObForm({ name:r.name||"", ec:r.ec||"", branch:r.branch||SALONS[0].name, position:r.position||"Nail Tech", positionOther:r.positionOther||"", startDate:r.startDate||"", notes:r.notes||"", _editId:r._id });
            try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch(_) {}
          };
          const cancelEdit = () => setObForm({ name:"", ec:"", branch: SALONS[0].name, position:"Nail Tech", positionOther:"", startDate:"", notes:"", _editId:null });
          const delOb = (id) => {
            if (!confirm("Remove this onboarding record?")) return;
            const tgt = obList.find(r => r._id === id);
            persistOb(obList.filter(r => r._id !== id));
            if (tgt) logActivity("Removed onboarding", (tgt.name || "") + (tgt.ec ? " (" + tgt.ec + ")" : ""), tgt.branch || "");
          };

          return (
            <div>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:26, color:"#831843", fontWeight:700, marginBottom:6, letterSpacing:"0.02em" }}>🌱 Onboarding</div>
              <div style={{ fontSize:13, color:"#F472B6", marginBottom:18 }}>New starters within the last 31 days. Records auto-archive 31 days after start date.</div>

              <div style={{ display:"flex", gap:10, marginBottom:18, flexWrap:"wrap" }}>
                {[
                  { l:"Total Records",     v:obList.length, c:"#831843", bg:"#FCE7F3" },
                  { l:"Started ≤30 Days",  v:last30,        c:"#14532d", bg:"#dcfce7" },
                  { l:"Future Starts",     v:future,        c:"#1e3a8a", bg:"#dbeafe" }
                ].map(s => (
                  <div key={s.l} style={{ flex:"1 1 160px", background:"#FFFFFF", borderRadius:11, padding:"14px 16px", border:"1px solid #FBCFE8" }}>
                    <div style={{ fontSize:24, fontWeight:800, color:s.c, lineHeight:1.1 }}>{s.v}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:s.c, opacity:0.72, marginTop:3, letterSpacing:"0.06em" }}>{s.l.toUpperCase()}</div>
                  </div>
                ))}
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:13, border:"1px solid #FBCFE8", padding:"16px 18px", marginBottom:24 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#831843", marginBottom:10 }}>{obForm._editId ? "✏️ Editing starter" : "➕ Add a new starter"}</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10, marginBottom:10 }}>
                  <input type="text" placeholder="Full name" value={obForm.name} onChange={e=>setObForm({...obForm, name:e.target.value})} style={{ padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit" }} />
                  <input type="text" placeholder="EC code (e.g. B900)" value={obForm.ec} onChange={e=>setObForm({...obForm, ec:e.target.value})} style={{ padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit" }} />
                  <select value={obForm.branch} onChange={e=>setObForm({...obForm, branch:e.target.value})} style={{ padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit", background:"#fff" }}>
                    {SALONS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                    <option value="Head Office">🏢 Head Office</option>
                    <option value="Other">✨ Other</option>
                  </select>
                  <select value={obForm.position} onChange={e=>setObForm({...obForm, position:e.target.value})} style={{ padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit", background:"#fff" }}>
                    <option value="Nail Tech">Nail Tech</option>
                    <option value="SM">Store Manager (SM)</option>
                    <option value="AM">Assistant Manager (AM)</option>
                    <option value="Other">Other (custom…)</option>
                  </select>
                  <input type="date" value={obForm.startDate} onChange={e=>setObForm({...obForm, startDate:e.target.value})} style={{ padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit" }} />
                </div>
                {obForm.position === "Other" && (
                  <input type="text" placeholder="✏️ Position name (e.g. Receptionist, Cleaner, IT)" value={obForm.positionOther} onChange={e=>setObForm({...obForm, positionOther:e.target.value})} style={{ width:"100%", padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit", marginBottom:10 }} />
                )}
                <textarea placeholder="Notes (optional)" value={obForm.notes} onChange={e=>setObForm({...obForm, notes:e.target.value})} rows={2} style={{ width:"100%", padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit", marginBottom:10, resize:"vertical" }} />
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button onClick={addOb} style={{ padding:"8px 18px", borderRadius:9, border:"none", background:"#BE185D", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>{obForm._editId ? "💾 Update Starter" : "🌱 Add to Onboarding"}</button>
                  {obForm._editId && <button onClick={cancelEdit} style={{ padding:"8px 14px", borderRadius:9, border:"1px solid #FBCFE8", background:"#fff", color:"#831843", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600 }}>Cancel Edit</button>}
                </div>
              </div>

              {active.length === 0 ? (
                <div style={{ fontSize:13, color:"#9ca3af", padding:"30px 4px", textAlign:"center", border:"1px dashed #FBCFE8", borderRadius:11 }}>No new starters in the last 31 days yet.</div>
              ) : (
                [
                  { t:"Nail Tech",   l:"💅 Nail Techs",        c:"#F472B6" },
                  { t:"Manager",     l:"👔 Managers",          c:"#7c3aed" },
                  { t:"Head Office", l:"🏢 Head Office",       c:"#0f766e" },
                  { t:"Other",       l:"✨ Other Positions",   c:"#0891b2" }
                ].map(g => {
                  const items = (grp[g.t] || []).slice().sort((a,b) => (a.startDate||"").localeCompare(b.startDate||""));
                  if (items.length === 0) return null;
                  return (
                    <div key={g.t} style={{ marginBottom:20 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                        <div style={{ fontWeight:800, color:g.c, fontSize:14, letterSpacing:"0.02em" }}>{g.l}</div>
                        <div style={{ background:g.c, color:"#fff", fontSize:11, fontWeight:700, padding:"2px 9px", borderRadius:99 }}>{items.length}</div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        {items.map(r => {
                          const ds = daysFrom(r.startDate);
                          const statusLabel = ds<0 ? "starts in " + Math.abs(ds) + "d" : ds===0 ? "started today" : ds===1 ? "started yesterday" : ds + " days in";
                          const [bg, color] = ds<0 ? ["#dbeafe","#1e3a8a"] : ds<=7 ? ["#dcfce7","#14532d"] : ["#f3f4f6","#475569"];
                          const posLabel = r.position==="SM" ? "Store Manager" : r.position==="AM" ? "Assistant Manager" : (r.position==="Other" && r.positionOther) ? r.positionOther : r.position;
                          return (
                            <div key={r._id} style={{ background:"#FFFFFF", borderRadius:11, border:"1px solid #FBCFE8", padding:"12px 14px" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6, gap:8 }}>
                                <div>
                                  <div style={{ fontWeight:700, color:"#831843", fontSize:14 }}>{r.name}</div>
                                  <div style={{ fontSize:11, color:"#9ca3af" }}>{r.ec || "—"} · {r.branch}</div>
                                </div>
                                <div style={{ display:"flex", gap:4 }}>
                                  <button onClick={()=>editOb(r)} title="Edit" style={{ background:"none", border:"1px solid #FBCFE8", borderRadius:6, padding:"4px 8px", cursor:"pointer", fontSize:13 }}>✏️</button>
                                  <button onClick={()=>delOb(r._id)} title="Remove" style={{ background:"none", border:"1px solid #fca5a5", borderRadius:6, padding:"4px 8px", cursor:"pointer", fontSize:13 }}>🗑</button>
                                </div>
                              </div>
                              <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:8 }}>
                                <span style={{ background:"#fce7f3", color:"#831843", fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:99 }}>{posLabel}</span>
                                <span style={{ fontSize:11, color:"#831843", fontWeight:600 }}>📅 {fmt(r.startDate)}</span>
                                <span style={{ background:bg, color:color, fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:99 }}>{statusLabel}</span>
                              </div>
                              {r.notes && <div style={{ fontSize:12, color:"#6b7280", marginTop:8, fontStyle:"italic" }}>{r.notes}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

        {/* ── OFF-BOARDING TAB ── */}
        {tab==="offboard" && (() => {
          const now = new Date();
          const p2 = z => String(z).padStart(2,"0");
          const todayStr = now.getFullYear()+"-"+p2(now.getMonth()+1)+"-"+p2(now.getDate());
          const t30 = new Date(now.getTime() - 30*86400000);
          const t30Str = t30.getFullYear()+"-"+p2(t30.getMonth()+1)+"-"+p2(t30.getDate());
          const notice = offList.filter(o => o.leftDate >= todayStr).slice().sort((a,b) => a.leftDate.localeCompare(b.leftDate));
          const recent = offList.filter(o => o.leftDate < todayStr && o.leftDate >= t30Str).slice().sort((a,b) => b.leftDate.localeCompare(a.leftDate));
          const persistOff = async (next) => {
            setOffList(next);
            try { await window.BOA_DB.saveOffboarding(next); }
            catch (e) { alert("Could not save off-boarding: " + (e.message || e)); }
          };
          const submitOff = () => {
            const ec = document.getElementById("_offEc").value;
            const date = document.getElementById("_offDate").value;
            const reason = document.getElementById("_offReason").value;
            const notes = document.getElementById("_offNotes").value;
            if (!ec) { alert("Please select a staff member."); return; }
            if (!date) { alert("Please pick a last day."); return; }
            const sRec = staff.find(s => s.ec === ec) || managers.find(m => m.ec === ec);
            if (!sRec) { alert("Staff not found."); return; }
            const rec = { ec: sRec.ec, name: sRec.name, branch: sRec.branch||"", leftDate: date, reason, notes, addedAt: new Date().toISOString() };
            persistOff([...offList, rec]);
            logActivity(
              "Off-boarded staff",
              (sRec.name || "") + " (" + sRec.ec + ")",
              "Last day " + date + (reason ? " · " + reason : "") + (sRec.branch ? " · " + sRec.branch : "")
            );
            document.getElementById("_offEc").value = "";
            document.getElementById("_offDate").value = todayStr;
            document.getElementById("_offNotes").value = "";
          };
          const undoOff = (ec) => {
            if (!confirm("Restore this person to active staff?")) return;
            const tgt = offList.find(o => o.ec === ec);
            persistOff(offList.filter(o => o.ec !== ec));
            if (tgt) logActivity("Restored from off-board", (tgt.name || "") + " (" + tgt.ec + ")", tgt.branch || "");
          };
          const submitQuickPick = () => {
            if (!quickPick) return;
            const reason = document.getElementById("_qpReason").value;
            const userNotes = document.getElementById("_qpNotes").value || "";
            const ld = new Date(quickPick.firstTermDate + "T00:00:00");
            ld.setDate(ld.getDate() - 1);
            const lastDay = ld.getFullYear()+"-"+p2(ld.getMonth()+1)+"-"+p2(ld.getDate());
            const autoNote = "[Auto-added from attendance: terminated from " + quickPick.firstTermDate + "]";
            const finalNotes = userNotes ? userNotes + "\n" + autoNote : autoNote;
            const rec = { ec: quickPick.ec, name: quickPick.name, branch: quickPick.branch || "", leftDate: lastDay, reason, notes: finalNotes, addedAt: new Date().toISOString() };
            persistOff([...offList, rec]);
            logActivity(
              "Off-boarded staff",
              (quickPick.name || "") + " (" + quickPick.ec + ")",
              "Last day " + lastDay + (reason ? " · " + reason : "") + " · auto-detected from attendance"
            );
            setQuickPick(null);
          };
          const activeStaffOpts = [
            ...staff.filter(s => !s.onMat && !offList.some(o => o.ec === s.ec)),
            ...managers.filter(m => !offList.some(o => o.ec === m.ec))
          ].slice().sort((a,b) => (a.branch||"").localeCompare(b.branch||"") || (a.name||"").localeCompare(b.name||""));

          return (
            <div>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:26, color:"#831843", fontWeight:700, marginBottom:6, letterSpacing:"0.02em" }}>👋 Off-board Staff</div>

              {/* Pending Terminations banner */}
              {pendingTerms.length > 0 && (
                <div style={{ background:"#fef3c7", border:"1px solid #fde68a", borderRadius:13, padding:"14px 18px", marginBottom:18 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"#92400e", marginBottom:8 }}>⚠ Pending Terminations from Attendance</div>
                  <div style={{ fontSize:12, color:"#92400e", marginBottom:10 }}>{pendingTerms.length} staff marked as terminated in the daily attendance grid but not yet added to off-boarding. Add them with one click.</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:8 }}>
                    {pendingTerms.map(p => (
                      <div key={p.ec} style={{ background:"#fff", borderRadius:9, border:"1px solid #fde68a", padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700, color:"#831843" }}>{p.name}</div>
                          <div style={{ fontSize:10, fontFamily:"monospace", color:"#92400e", fontWeight:700 }}>{p.ec} · {p.branch}</div>
                          <div style={{ fontSize:11, color:"#92400e", marginTop:3 }}>From {p.firstTermDate}</div>
                        </div>
                        <button onClick={()=>setQuickPick(p)} style={{ padding:"6px 12px", borderRadius:7, border:"none", background:"#92400e", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>Add</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick-pick modal */}
              {quickPick && (
                <div onClick={()=>setQuickPick(null)} style={{ position:"fixed", inset:0, background:"rgba(131,24,67,0.35)", zIndex:9000, display:"flex", alignItems:"center", justifyContent:"center", padding:"40px 20px" }}>
                  <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:14, maxWidth:480, width:"100%", padding:"22px 26px" }}>
                    <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, fontWeight:700, color:"#831843", marginBottom:6 }}>Confirm off-boarding for {quickPick.name}</div>
                    <div style={{ fontSize:12, color:"#831843", marginBottom:14 }}>EC <strong>{quickPick.ec}</strong> · {quickPick.branch}<br/>Attendance shows termination from <strong>{quickPick.firstTermDate}</strong>. Last day worked will be set to one day before that.</div>
                    <label style={{ fontSize:11, fontWeight:700, color:"#831843", letterSpacing:"0.05em" }}>REASON</label>
                    <select id="_qpReason" defaultValue="Terminated" style={{ width:"100%", padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit", marginTop:4, marginBottom:12, background:"#fff" }}>
                      <option value="Terminated">Terminated</option>
                      <option value="Resigned">Resigned</option>
                      <option value="Mutual agreement">Mutual agreement</option>
                      <option value="End of contract">End of contract</option>
                      <option value="Other">Other</option>
                    </select>
                    <label style={{ fontSize:11, fontWeight:700, color:"#831843", letterSpacing:"0.05em" }}>NOTES (OPTIONAL)</label>
                    <input id="_qpNotes" placeholder="e.g. final salary processed" style={{ width:"100%", padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit", marginTop:4, marginBottom:14 }} />
                    <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                      <button onClick={()=>setQuickPick(null)} style={{ padding:"8px 14px", borderRadius:9, border:"1px solid #FBCFE8", background:"#fff", color:"#831843", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600 }}>Cancel</button>
                      <button onClick={submitQuickPick} style={{ padding:"8px 18px", borderRadius:9, border:"none", background:"#BE185D", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>Confirm Off-board</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Off-board form */}
              <div style={{ background:"#FFFFFF", borderRadius:13, padding:"16px 18px", border:"1px solid #FBCFE8", marginBottom:18 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#831843", marginBottom:10 }}>Mark a staff member as off-boarded</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:10, marginBottom:10 }}>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:"#831843", letterSpacing:"0.05em" }}>STAFF MEMBER</label>
                    <select id="_offEc" defaultValue="" style={{ width:"100%", marginTop:4, padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit", background:"#fff" }}>
                      <option value="">— select —</option>
                      {activeStaffOpts.map(s => <option key={s.ec} value={s.ec}>{s.name} ({s.ec}) · {s.branch || "—"}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:"#831843", letterSpacing:"0.05em" }}>LAST DAY WORKED</label>
                    <input id="_offDate" type="date" defaultValue={todayStr} style={{ width:"100%", marginTop:4, padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit" }} />
                  </div>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:"#831843", letterSpacing:"0.05em" }}>REASON</label>
                    <select id="_offReason" defaultValue="Resigned" style={{ width:"100%", marginTop:4, padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit", background:"#fff" }}>
                      <option value="Resigned">Resigned</option>
                      <option value="Terminated">Terminated</option>
                      <option value="Mutual agreement">Mutual agreement</option>
                      <option value="End of contract">End of contract</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:11, fontWeight:700, color:"#831843", letterSpacing:"0.05em" }}>NOTES (OPTIONAL)</label>
                  <input id="_offNotes" placeholder="e.g. Moving to JHB" style={{ width:"100%", marginTop:4, padding:"8px 10px", border:"1px solid #FBCFE8", borderRadius:8, fontSize:13, fontFamily:"inherit" }} />
                </div>
                <button onClick={submitOff} style={{ padding:"8px 18px", borderRadius:9, border:"none", background:"#BE185D", color:"#fff", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>OFF-BOARD</button>
              </div>

              {/* Working Notice card */}
              {notice.length > 0 && (
                <div style={{ background:"#fffbeb", borderRadius:13, padding:"16px 18px", border:"1px solid #fde68a", marginBottom:14 }}>
                  <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:14, flexWrap:"wrap" }}>
                    <div style={{ fontFamily:"'Playfair Display',serif", fontSize:16, fontWeight:600, color:"#92400e" }}>⏳ Working notice</div>
                    <div style={{ fontSize:11, color:"#92400e", fontWeight:600 }}>· {notice.length} {notice.length===1 ? "person" : "people"}</div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:10 }}>
                    {notice.map(o => {
                      const d = new Date(o.leftDate+"T00:00:00");
                      const dStr = d.toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"});
                      const t0n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                      const daysUntil = Math.floor((d - t0n) / 86400000);
                      return (
                        <div key={o.ec} style={{ background:"#FFFFFF", borderRadius:11, padding:"13px 14px", border:"1px solid #fde68a" }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:6, marginBottom:6 }}>
                            <div>
                              <div style={{ fontSize:13, fontWeight:700, color:"#831843" }}>{o.name}</div>
                              <div style={{ fontSize:10, fontFamily:"monospace", color:"#E84B9B", fontWeight:700 }}>{o.ec} · {o.branch}</div>
                            </div>
                            <span style={{ fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:99, background:"#fef3c7", color:"#92400e", letterSpacing:"0.02em" }}>{o.reason}</span>
                          </div>
                          <div style={{ fontSize:11, color:"#92400e", marginTop:4 }}>
                            Last day {dStr}<span style={{ opacity:0.75 }}> · {daysUntil===0?"today":daysUntil===1?"tomorrow":"in " + daysUntil + " days"}</span>
                          </div>
                          {o.notes && <div style={{ fontSize:11, color:"#831843", marginTop:6, fontStyle:"italic", whiteSpace:"pre-wrap" }}>{o.notes}</div>}
                          <button onClick={()=>undoOff(o.ec)} style={{ marginTop:8, background:"transparent", border:"1px solid #fde68a", color:"#92400e", padding:"4px 10px", borderRadius:5, fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>↺ Cancel</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recently Left card */}
              <div style={{ background:"#FFFFFF", borderRadius:13, padding:"16px 18px", border:"1px solid #FBCFE8" }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:14, flexWrap:"wrap" }}>
                  <div style={{ fontFamily:"'Playfair Display',serif", fontSize:16, fontWeight:600, color:"#831843" }}>Recently Left</div>
                  <div style={{ fontSize:11, color:"#BE185D", fontWeight:600 }}>· last 30 days · {recent.length} {recent.length===1 ? "person" : "people"}</div>
                </div>
                {recent.length === 0 ? (
                  <div style={{ fontSize:12, color:"#9ca3af", padding:"20px 4px", textAlign:"center" }}>No staff have left in the last 30 days.</div>
                ) : (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:10 }}>
                    {recent.map(o => {
                      const d = new Date(o.leftDate+"T00:00:00");
                      const dStr = d.toLocaleDateString("en-ZA",{day:"2-digit",month:"short",year:"numeric"});
                      const daysAgo = Math.floor((now - d) / 86400000);
                      const reasonBg = o.reason==="Terminated" ? "#fee2e2" : o.reason==="Resigned" ? "#dbeafe" : "#fef3c7";
                      const reasonColor = o.reason==="Terminated" ? "#991b1b" : o.reason==="Resigned" ? "#1e3a8a" : "#92400e";
                      return (
                        <div key={o.ec} style={{ background:"#FDEEF5", borderRadius:11, padding:"13px 14px", border:"1px solid #FBCFE8" }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:6, marginBottom:6 }}>
                            <div>
                              <div style={{ fontSize:13, fontWeight:700, color:"#831843" }}>{o.name}</div>
                              <div style={{ fontSize:10, fontFamily:"monospace", color:"#E84B9B", fontWeight:700 }}>{o.ec} · {o.branch}</div>
                            </div>
                            <span style={{ fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:99, background:reasonBg, color:reasonColor, letterSpacing:"0.02em" }}>{o.reason}</span>
                          </div>
                          <div style={{ fontSize:11, color:"#BE185D", marginTop:4 }}>
                            Left {dStr}<span style={{ opacity:0.7 }}> · {daysAgo===0?"today":daysAgo===1?"yesterday":daysAgo + " days ago"}</span>
                          </div>
                          {o.notes && <div style={{ fontSize:11, color:"#831843", marginTop:6, fontStyle:"italic", whiteSpace:"pre-wrap" }}>{o.notes}</div>}
                          <button onClick={()=>undoOff(o.ec)} style={{ marginTop:8, background:"transparent", border:"1px solid #FBCFE8", color:"#831843", padding:"4px 10px", borderRadius:5, fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>↺ Restore</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── ATTENDANCE TAB ── */}
        {tab==="attendance" && (currentUser.hideCategories || []).includes("Payroll") && (
          <div style={{ background:"#FFFFFF", border:"1px solid #FBCFE8", borderRadius:14, padding:"30px 26px", textAlign:"center", color:"#831843" }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🔒</div>
            <div style={{ fontFamily:"'Outfit',system-ui,sans-serif", fontSize:14, fontWeight:700 }}>Payroll is not available for your account.</div>
            <button onClick={()=>tryChangeTab("dashboard")} style={{ marginTop:14, background:"#BE185D", color:"#fff", border:"none", borderRadius:9, padding:"8px 16px", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>Back to Dashboard</button>
          </div>
        )}
        {tab==="attendance" && !((currentUser.hideCategories || []).includes("Payroll")) && (() => {
          // Status code dictionary — labels, colors, categories.
          const STAT = {
            on:     { lbl:"On Time",         bg:"#e5e7eb", fg:"#1f2937", cat:"work" },
            late:   { lbl:"Late",            bg:"#e5e7eb", fg:"#1f2937", cat:"work" },
            off:    { lbl:"OFF",             bg:"#f3f4f6", fg:"#475569", cat:"off" },
            ext:    { lbl:"Extra Day",       bg:"#6ee7b7", fg:"#064e3b", cat:"work" },
            sick_n: { lbl:"Sick + note",     bg:"#dcfce7", fg:"#166534", cat:"paid" },
            sick:   { lbl:"Sick NO note",    bg:"#fecaca", fg:"#7f1d1d", cat:"paid" },
            frl:    { lbl:"FRL + proof",     bg:"#fed7aa", fg:"#7c2d12", cat:"paid" },
            al:     { lbl:"Annual",          bg:"#bfdbfe", fg:"#1e40af", cat:"paid" },
            ph:     { lbl:"Public Holiday",  bg:"#86efac", fg:"#14532d", cat:"paid" },
            mat:    { lbl:"Maternity",       bg:"#d6c2a8", fg:"#7c2d12", cat:"paid" },
            no:     { lbl:"NO SHOW",         bg:"#e9d5ff", fg:"#581c87", cat:"unpaid" },
            unpaid: { lbl:"Unpaid",          bg:"#e9d5ff", fg:"#581c87", cat:"unpaid" },
            deduct: { lbl:"Hours Deduction", bg:"#fed7aa", fg:"#7f1d1d", cat:"unpaid_h" },
            trial:  { lbl:"Trial Day",       bg:"#fde047", fg:"#713f12", cat:"work" },
            term:   { lbl:"TERMINATED",      bg:"#dc2626", fg:"#FFFFFF", cat:"none" },
            swap_o: { lbl:"Swap (owes)",     bg:"#bae6fd", fg:"#075985", cat:"swap" },
            swap_i: { lbl:"Swap (owed)",     bg:"#bfdbfe", fg:"#1e40af", cat:"swap" }
          };
          const resolveStat = (v) => {
            if (!v) return null;
            const bare = v.indexOf("~") === 0 ? v.slice(1) : v;
            if (bare.indexOf("deduct") === 0) {
              const h = bare.indexOf(":") > 0 ? parseFloat(bare.split(":")[1]) || 0 : 0;
              const hLbl = h === Math.floor(h) ? h + "h" : Math.floor(h) + "h" + Math.round((h - Math.floor(h))*60);
              return { lbl: hLbl + " Unpaid", bg:"#fed7aa", fg:"#7f1d1d", cat:"unpaid_h", hours:h };
            }
            return STAT[bare] || null;
          };

          // Build the cycle (25th-24th) day list
          const ymP = attYM.split("-").map(Number);
          const cycStart = new Date(ymP[0], ymP[1]-1, 25);
          const cycEnd   = new Date(ymP[0], ymP[1],   24);
          const days = [];
          const p2 = z => String(z).padStart(2, "0");
          for (let cur = new Date(cycStart); cur <= cycEnd; cur.setDate(cur.getDate()+1)) {
            const ymd = cur.getFullYear() + "-" + p2(cur.getMonth()+1) + "-" + p2(cur.getDate());
            days.push({ d: cur.getDate(), dow: cur.getDay(), ymd });
          }
          // SA public holidays for the years covered by this cycle.
          // (holidayLookup lives inside the Schedule component, so we
          // build a local one here using the saHolidays() top-level helper.)
          const yearsCovered = new Set(days.map(d => parseInt(d.ymd.slice(0,4), 10)));
          const holidayLookup = {};
          yearsCovered.forEach(y => Object.assign(holidayLookup, saHolidays(y)));

          // Quick lookup: ec -> leftDate (only people on the off-board list)
          const offByEc = {};
          (offList || []).forEach(o => { if (o.ec && o.leftDate) offByEc[o.ec] = o.leftDate; });

          // Active staff for this branch + cycle (techs + managers, sorted SM > AM > NT > name).
          // Show anyone who was still employed during this cycle — if their
          // leftDate is on/after cycStart, include them so historical cycles
          // remain auditable for payroll. People who left before this cycle
          // are excluded entirely.
          const cycStartYmd = cycStart.getFullYear() + "-" + p2(cycStart.getMonth()+1) + "-" + p2(cycStart.getDate());
          const stillInCycle = (ec) => {
            const ld = offByEc[ec];
            return !ld || ld >= cycStartYmd;
          };
          const attStaff = [
            ...enriched.filter(s => s.branch === attBranch && stillInCycle(s.ec)).map(s => ({ ec:s.ec, name:s.name, role:"NT" })),
            ...managers.filter(m => m.branch === attBranch && stillInCycle(m.ec)).map(m => ({ ec:m.ec, name:m.name, role:m.role || "AM" }))
          ].sort((a, b) => {
            const order = { SM:0, AM:1, NT:2 };
            return (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.name.localeCompare(b.name);
          });
          // For a given (ec, ymd), is this day strictly AFTER their last day?
          const isPostLeftDate = (ec, ymd) => {
            const ld = offByEc[ec];
            return !!ld && ymd > ld;       // strictly after — leftDate itself is the "last day worked"
          };

          // Helpers
          const getStatus = (ec, d) => {
            // Cross-tab rule: anyone on the off-board list shows TERMINATED
            // automatically from the day AFTER their leftDate, regardless of
            // what's in the attendance or schedule grid.
            const dayObj = days.find(x => x.d === d);
            if (dayObj && isPostLeftDate(ec, dayObj.ymd)) return "term";

            const v = attGrid[ec] && attGrid[ec][d];
            if (v) return v.indexOf("~") === 0 ? v.slice(1) : v;
            // Fall back to schedule hint
            const sv = attSched[ec] && attSched[ec][d];
            if (sv === "O" || sv === "R") return "off";
            if (sv === "L") return "al";
            if (sv === "X") return "term";
            if (sv === "E") return "ext";
            if (sv === "W" || sv === "WL") return "on";
            return "";
          };
          const hasOverride = (ec, d) => {
            // Treat the auto-derived TERMINATED as a confirmed override so it
            // displays in bold red rather than faded/italic.
            const dayObj = days.find(x => x.d === d);
            if (dayObj && isPostLeftDate(ec, dayObj.ymd)) return true;
            const v = attGrid[ec] && attGrid[ec][d];
            return !!v && v.indexOf("~") !== 0;
          };
          const schedHint = (ec, d) => {
            const sv = attSched[ec] && attSched[ec][d];
            if (!sv) return null;
            if (sv === "W" || sv === "WL") return "on";
            if (sv === "O" || sv === "R")  return "off";
            if (sv === "L") return "al";
            if (sv === "X") return "term";
            if (sv === "E") return "ext";
            return null;
          };

          // Persist a single cell change (and update local React state)
          const setCell = async (ec, d, v) => {
            const next = { ...attGrid, [ec]: { ...(attGrid[ec] || {}) } };
            if (v === "" || v == null) delete next[ec][d];
            else                       next[ec][d] = v;
            setAttGrid(next);
            try { await window.BOA_DB.saveAttendance(attBranch, attYM, next); }
            catch (e) { alert("Could not save: " + (e.message || e)); }
          };

          // Reset every attendance entry for this branch+cycle (warns first)
          // ── Import Fresha appointments CSV ── any nail tech with at least one
          // completed appointment on a given day in the current cycle is marked
          // "On Time" for that day. Confirmed cells (bold, no leading ~) are
          // preserved. Unconfirmed and empty cells are overwritten with "on".
          const importFresha = () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".csv,text/csv";
            input.onchange = async (e) => {
              try {
              const file = e.target.files && e.target.files[0];
              if (!file) return;
              let text;
              try { text = await file.text(); }
              catch (err) { alert("Could not read file: " + (err.message || err)); return; }

              // Tiny CSV parser — handles quoted fields with embedded commas / quotes.
              const parseCSV = (s) => {
                const rows = [];
                let row = [], field = "", inQ = false;
                for (let i = 0; i < s.length; i++) {
                  const c = s[i];
                  if (inQ) {
                    if (c === '"') { if (s[i+1] === '"') { field += '"'; i++; } else inQ = false; }
                    else field += c;
                  } else {
                    if (c === '"') inQ = true;
                    else if (c === ',') { row.push(field); field = ""; }
                    else if (c === '\n' || c === '\r') {
                      if (field !== "" || row.length > 0) { row.push(field); rows.push(row); row = []; field = ""; }
                      if (c === '\r' && s[i+1] === '\n') i++;
                    } else field += c;
                  }
                }
                if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
                return rows;
              };
              const rows = parseCSV(text);
              if (rows.length < 2) { alert("CSV looks empty — no rows found after the header."); return; }

              const headers = rows[0].map(h => (h || "").trim().toLowerCase());
              const findCol = (...names) => {
                for (const n of names) {
                  const exact = headers.indexOf(n);
                  if (exact >= 0) return exact;
                  const partial = headers.findIndex(h => h.includes(n));
                  if (partial >= 0) return partial;
                }
                return -1;
              };
              const dateCol   = findCol("scheduled date", "scheduled at", "appointment date", "appointment start", "start date", "start time", "date");
              const staffCol  = findCol("team member", "staff", "employee", "technician", "tech", "stylist");
              const statusCol = findCol("appointment status", "status");
              if (dateCol < 0 || staffCol < 0) {
                alert(
                  "Could not find the expected columns in this CSV.\n\n" +
                  "Looking for a date column (e.g. 'Appointment date' / 'Date') and a staff column " +
                  "(e.g. 'Team member' / 'Staff'). Found: " + headers.join(", ")
                );
                return;
              }
              if (statusCol < 0) {
                alert(
                  "This CSV has no status column — refusing to import to avoid counting " +
                  "cancelled / no-show / scheduled appointments as worked days.\n\n" +
                  "Re-export from Fresha with the 'Appointment status' column included " +
                  "(it is in the default Appointments report).\n\n" +
                  "Headers found: " + headers.join(", ")
                );
                return;
              }

              // Robust date parser — Fresha exports use "04 May 2026, 2:25pm".
              // Also handles ISO, DD/MM/YYYY, MMM DD YYYY, and falls back to the
              // native parser as a last resort.
              const MONTH_IDX = {
                jan:0, january:0, feb:1, february:1, mar:2, march:2, apr:3, april:3,
                may:4, jun:5, june:5, jul:6, july:6, aug:7, august:7,
                sep:8, sept:8, september:8, oct:9, october:9, nov:10, november:10, dec:11, december:11
              };
              const parseDate = (raw) => {
                if (!raw) return null;
                const v = String(raw).trim();
                if (!v) return null;
                // "DD MMM YYYY[, time]"  e.g. "04 May 2026, 2:25pm"
                let m = v.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
                if (m) {
                  const mi = MONTH_IDX[m[2].toLowerCase()];
                  if (mi != null) {
                    const d = new Date(+m[3], mi, +m[1]);
                    if (!isNaN(d.getTime())) return d;
                  }
                }
                // "MMM DD[,] YYYY"  e.g. "May 04, 2026"
                m = v.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
                if (m) {
                  const mi = MONTH_IDX[m[1].toLowerCase()];
                  if (mi != null) {
                    const d = new Date(+m[3], mi, +m[2]);
                    if (!isNaN(d.getTime())) return d;
                  }
                }
                // ISO YYYY-MM-DD[Thh:mm…]
                m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (m) {
                  const d = new Date(+m[1], +m[2]-1, +m[3]);
                  if (!isNaN(d.getTime())) return d;
                }
                // DD/MM/YYYY (or DD-MM, DD.MM)
                m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
                if (m) {
                  let dd = +m[1], mm = +m[2], yy = +m[3];
                  if (yy < 100) yy += 2000;
                  const d = new Date(yy, mm - 1, dd);
                  if (!isNaN(d.getTime())) return d;
                }
                // Last resort: native parse
                const d = new Date(v);
                return isNaN(d.getTime()) ? null : d;
              };
              const norm = (s) => (s || "").toString().toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
              const extractEc = (raw) => {
                const m = String(raw || "").match(/^\s*([A-Z][0-9]+[A-Z]?)\b/i);
                return m ? m[1].toUpperCase() : null;
              };
              const stripEcPrefix = (raw) => String(raw || "").replace(/^\s*[A-Z][0-9]+[A-Z]?\s+/i, "");

              // Build a global staff lookup so the importer can match Fresha rows
              // for every branch in one go — not just the branch currently on screen.
              const branchSet = new Set(SALONS.map(sl => sl.name));
              const globalStaff = [
                ...(enriched || []).filter(s => !s.isShadow && stillInCycle(s.ec)).map(s => ({ ec: s.ec, name: s.name, role: "NT", branch: s.branch })),
                ...(managers || []).filter(m => stillInCycle(m.ec)).map(m => ({ ec: m.ec, name: m.name, role: m.role || "AM", branch: m.branch }))
              ];
              const globalByEc = new Map();
              for (const s of globalStaff) globalByEc.set(s.ec.toUpperCase(), s);

              const matchStaff = (raw) => {
                const ec = extractEc(raw);
                if (ec && globalByEc.has(ec)) {
                  const s = globalByEc.get(ec);
                  if (s.role !== "NT") return { kind: "manager", branch: s.branch };
                  return { kind: "tech", ec: s.ec, branch: s.branch };
                }
                const t = norm(stripEcPrefix(raw) || raw);
                if (!t) return { kind: "unknown" };
                let firstNameAmbig = false, firstNameHit = null;
                for (const s of globalStaff) {
                  if (s.role !== "NT") continue;
                  const n = norm(s.name); if (!n) continue;
                  if (n === t) return { kind: "tech", ec: s.ec, branch: s.branch };
                  const tp = t.split(" "), np = n.split(" ");
                  if (tp[0] === np[0] && tp[tp.length-1] === np[np.length-1]) return { kind: "tech", ec: s.ec, branch: s.branch };
                  if (tp[0] === np[0]) { if (firstNameHit) firstNameAmbig = true; else firstNameHit = { ec: s.ec, branch: s.branch }; }
                }
                if (firstNameHit && !firstNameAmbig) return { kind: "tech", ec: firstNameHit.ec, branch: firstNameHit.branch };
                for (const s of globalStaff) {
                  if (s.role === "NT") continue;
                  const n = norm(s.name); if (!n) continue;
                  if (n === t) return { kind: "manager", branch: s.branch };
                  const tp = t.split(" "), np = n.split(" ");
                  if (tp[0] === np[0] && tp[tp.length-1] === np[np.length-1]) return { kind: "manager", branch: s.branch };
                }
                return { kind: "unknown" };
              };

              // Load every branch's attendance grid for this cycle so we can write
              // to the right branch per row. The active branch starts from local
              // state; the others are fetched.
              const safeLoad = (p) => Promise.resolve(p).catch(() => null);
              const branchGrids = {};
              const allBranches = SALONS.map(sl => sl.name);
              await Promise.all(allBranches.map(async b => {
                if (b === attBranch) {
                  branchGrids[b] = JSON.parse(JSON.stringify(attGrid || {}));
                } else {
                  const data = await safeLoad(window.BOA_DB.loadAttendance(b, attYM));
                  branchGrids[b] = (data && data.grid) ? JSON.parse(JSON.stringify(data.grid)) : {};
                }
              }));

              const cycleYmd = new Set(days.map(d => d.ymd));
              const dayByYmd = {};
              for (const d of days) dayByYmd[d.ymd] = d.d;

              let total = 0, marked = 0, alreadyConfirmed = 0, outOfCycle = 0, badDate = 0;
              let cancelled = 0, noShow = 0, scheduled = 0, otherStatus = 0;
              let managerSkipped = 0;
              const otherStatusSeen = new Set();
              const badDateSamples = new Set();
              const unmatched = new Set();
              const seenDayPerEc = new Set(); // dedupe: only count first appt per (branch|ec, day)
              const markedByBranch = {};      // per-branch tally for the summary
              const freshaThroughByBranch = {}; // max in-cycle ymd seen per branch (drives off-day matching)

              // Strict status filter — only these count as actually worked.
              const isCompleted = (st) => st === "completed" || st === "complete" || st === "done" || st === "finished";

              for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                if (!r || r.length === 0) continue;
                if (r.length === 1 && (r[0] || "").trim() === "") continue;
                total++;
                const stRaw = (r[statusCol] || "").trim();
                const st = stRaw.toLowerCase();
                if (!isCompleted(st)) {
                  if (st.includes("cancel"))                         cancelled++;
                  else if (st.includes("no show") || st.includes("no-show") || st.includes("noshow")) noShow++;
                  else if (st.includes("scheduled") || st.includes("booked") || st.includes("upcoming") || st.includes("confirmed")) scheduled++;
                  else { otherStatus++; if (stRaw) otherStatusSeen.add(stRaw); }
                  continue;
                }
                const dt = parseDate(r[dateCol]);
                if (!dt) {
                  badDate++;
                  if (badDateSamples.size < 4 && (r[dateCol] || "").trim()) badDateSamples.add(String(r[dateCol]).trim());
                  continue;
                }
                const ymd = dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0");
                if (!cycleYmd.has(ymd)) { outOfCycle++; continue; }
                const match = matchStaff(r[staffCol]);
                if (match.kind === "manager") { managerSkipped++; continue; }
                if (match.kind !== "tech")    { unmatched.add((r[staffCol] || "").trim() || "(blank)"); continue; }
                const ec = match.ec;
                const techBranch = match.branch;
                const grid = branchGrids[techBranch];
                if (!grid) { unmatched.add((r[staffCol] || "").trim() + " (unknown branch '" + (techBranch || "?") + "')"); continue; }
                // Track the latest in-cycle ymd this branch's CSV has data for. Used to
                // gate the orange "all-match OFF" banner so future days (no appts yet)
                // aren't misread as confirmed off-days.
                if (!freshaThroughByBranch[techBranch] || ymd > freshaThroughByBranch[techBranch]) {
                  freshaThroughByBranch[techBranch] = ymd;
                }
                const dKey = techBranch + "|" + ec + "|" + ymd;
                if (seenDayPerEc.has(dKey)) continue;
                seenDayPerEc.add(dKey);
                const dayNum = dayByYmd[ymd];
                if (!grid[ec]) grid[ec] = {};
                const cur = grid[ec][dayNum];
                if (cur && cur.charAt(0) !== "~") { alreadyConfirmed++; continue; }
                grid[ec][dayNum] = "on";
                marked++;
                markedByBranch[techBranch] = (markedByBranch[techBranch] || 0) + 1;
              }

              const skipBreakdown =
                "• Cancelled: " + cancelled + "\n" +
                "• No-show: " + noShow + "\n" +
                "• Scheduled / not yet completed: " + scheduled + "\n" +
                "• Manager appointments (skipped): " + managerSkipped + "\n" +
                "• Other status (skipped): " + otherStatus +
                (otherStatusSeen.size > 0 ? " — " + [...otherStatusSeen].slice(0, 4).join(", ") + (otherStatusSeen.size > 4 ? ", …" : "") : "") + "\n" +
                "• Date column read: " + (dateCol >= 0 ? "'" + headers[dateCol] + "'" : "(none)") + "\n" +
                "• Unparseable dates: " + badDate +
                (badDateSamples.size > 0 ? " — e.g. " + [...badDateSamples].slice(0, 3).join(" | ") : "");

              const branchSummary = Object.keys(markedByBranch).length === 0
                ? ""
                : "\n• Per branch: " + Object.entries(markedByBranch).map(([b, n]) => b + " " + n).join(" · ");

              if (marked === 0) {
                alert(
                  "Imported the CSV but didn't mark any cells On Time.\n\n" +
                  "• Rows read: " + total + "\n" +
                  skipBreakdown + "\n" +
                  "• Out of " + cycLabel + ": " + outOfCycle + "\n" +
                  "• Unmatched staff: " + (unmatched.size === 0 ? "0" : unmatched.size + " — " + [...unmatched].slice(0, 6).join(", ") + (unmatched.size > 6 ? ", …" : "")) + "\n" +
                  "• Already confirmed (kept): " + alreadyConfirmed
                );
                return;
              }

              // Save every branch whose grid had cells written OR whose Fresha
              // coverage advanced this run. Carry the freshaCoverage extras so the
              // orange off-day banner only matches days actually covered by Fresha.
              const branchesToSave = Array.from(new Set([
                ...Object.keys(markedByBranch),
                ...Object.keys(freshaThroughByBranch)
              ]));
              const importedAt = new Date().toISOString();
              try {
                await Promise.all(branchesToSave.map(b => {
                  const extras = freshaThroughByBranch[b]
                    ? { freshaCoverage: { through: freshaThroughByBranch[b], importedAt } }
                    : null;
                  return window.BOA_DB.saveAttendance(b, attYM, branchGrids[b], extras);
                }));
              } catch (err) { alert("Could not save: " + (err.message || err)); return; }
              // Refresh the local grid + meta for the branch the user is viewing.
              if (markedByBranch[attBranch] || freshaThroughByBranch[attBranch]) {
                setAttGrid(branchGrids[attBranch]);
                if (freshaThroughByBranch[attBranch]) {
                  setAttMeta({ freshaCoverage: { through: freshaThroughByBranch[attBranch], importedAt } });
                }
              }
              alert(
                "✓ Fresha import done — only Completed nail-tech appointments were counted, across all branches.\n\n" +
                "• Rows read: " + total + "\n" +
                "• Marked On Time: " + marked + branchSummary + "\n" +
                skipBreakdown + "\n" +
                "• Out of " + cycLabel + ": " + outOfCycle + "\n" +
                "• Already confirmed (kept): " + alreadyConfirmed +
                (unmatched.size > 0 ? "\n• Unmatched staff (" + unmatched.size + "): " + [...unmatched].slice(0, 8).join(", ") + (unmatched.size > 8 ? ", …" : "") : "")
              );
              } catch (err) {
                console.error("Fresha import failed:", err);
                alert("Fresha import failed:\n\n" + (err && err.message ? err.message : err) + "\n\n(See browser console for details.)");
              }
            };
            input.click();
          };

          const resetCycle = async () => {
            const msg = "⚠ Reset attendance for " + attBranch + " — " + cycLabel + "?\n\n"
              + "This will undo ALL changes you've made for this cycle. Schedule-derived hints will reappear faded once you re-open the tab.\n\n"
              + "This cannot be undone. Continue?";
            if (!confirm(msg)) return;
            const next = {};
            setAttGrid(next);
            try { await window.BOA_DB.saveAttendance(attBranch, attYM, next); }
            catch (e) { alert("Could not reset: " + (e.message || e)); return; }
            alert("✓ Attendance reset for " + attBranch + " — " + cycLabel);
          };

          // Auto-fill empty cells from the schedule (writes "~hint" — italic, unconfirmed)
          // and re-sync unconfirmed cells if the schedule has changed since last fill.
          // Confirmed cells (no "~" prefix) are preserved.
          const autoFill = async () => {
            if (!confirm("Auto-fill missing days from the schedule? Empty cells will be set to the schedule's value, and faded/unconfirmed cells will be refreshed to match the latest schedule. Confirmed cells are kept as-is.")) return;
            const next = { ...attGrid };
            let filled = 0, refreshed = 0;
            const noScheduleStaff = [];
            for (const s of attStaff) {
              next[s.ec] = { ...(next[s.ec] || {}) };
              const schedRow = attSched[s.ec] || {};
              const schedCellsForCycle = days.filter(dy => schedRow[dy.d]).length;
              if (schedCellsForCycle === 0) {
                noScheduleStaff.push(s);
              }
              for (const dy of days) {
                const cur = next[s.ec][dy.d];
                const hint = schedHint(s.ec, dy.d);
                if (!hint) continue;
                const target = "~" + hint;
                if (!cur) {
                  next[s.ec][dy.d] = target;
                  filled++;
                } else if (cur.charAt(0) === "~" && cur !== target) {
                  next[s.ec][dy.d] = target;
                  refreshed++;
                }
                // confirmed (no leading ~) cells: leave alone
              }
            }
            // Warn loudly if any staff in this branch+cycle have no schedule data.
            // Most often these are managers whose schedule wasn't saved for this period.
            if (noScheduleStaff.length > 0) {
              const list = noScheduleStaff.map(s => "• " + s.name + " (" + s.ec + " · " + s.role + ")").join("\n");
              const proceedMsg =
                noScheduleStaff.length + " staff at " + attBranch + " have NO schedule data for " + cycLabel + ":\n\n" +
                list + "\n\n" +
                "Their attendance cells will stay blank. Open the Scheduling tab → " +
                (noScheduleStaff.some(s => s.role !== "NT") ? "Manager Schedule sub-tab → " : "") +
                "for this branch + cycle, generate or fill, and Save.\n\n" +
                "Continue auto-filling everyone else?";
              if (!confirm(proceedMsg)) return;
            }
            if (filled === 0 && refreshed === 0) {
              const validCodes = new Set(["W","WL","O","R","L","X","E"]);
              const cycleDays = new Set(days.map(d => d.d));
              const schedEcs = Object.keys(attSched || {});
              const matchingEcs = attStaff.filter(s => attSched[s.ec]);
              let totalCells = 0, cellsInCycle = 0, cellsWithCode = 0;
              const sampleCodes = new Set();
              for (const ec of schedEcs) {
                const row = attSched[ec] || {};
                for (const k in row) {
                  totalCells++;
                  sampleCodes.add(row[k]);
                  if (cycleDays.has(parseInt(k, 10))) cellsInCycle++;
                  if (validCodes.has(row[k])) cellsWithCode++;
                }
              }
              const sampleEcs = matchingEcs.slice(0, 4).map(s => s.ec + " (" + s.name + ")").join(", ");
              alert(
                "Auto-fill found nothing to fill.\n\n" +
                "• Staff in this branch + cycle: " + attStaff.length + "\n" +
                "• Schedule rows loaded: " + schedEcs.length + "\n" +
                "• Schedule rows matching staff here: " + matchingEcs.length + (sampleEcs ? " — " + sampleEcs : "") + "\n" +
                "• Total day-cells in those rows: " + totalCells + "\n" +
                "• Day-cells matching this cycle (" + Math.min(...cycleDays.size ? [...cycleDays] : [0]) + "..): " + cellsInCycle + "\n" +
                "• Day-cells with valid status codes (W/WL/O/R/L/X/E): " + cellsWithCode + "\n" +
                "• Codes seen: " + ([...sampleCodes].slice(0, 10).join(", ") || "(none)") + "\n\n" +
                (totalCells === 0
                  ? "The schedule rows are present but empty. Open the Scheduling tab on " + attBranch + " for this period and confirm the cells are filled in and saved."
                  : cellsInCycle === 0
                    ? "Schedule cells exist but their day numbers don't overlap with this cycle (" + cycLabel + "). The schedule may be saved under a different period."
                    : cellsWithCode === 0
                      ? "Schedule cells exist but use unrecognised status codes."
                      : "Cells exist and look valid — please share this dialog with support.")
              );
              return;
            }
            setAttGrid(next);
            try { await window.BOA_DB.saveAttendance(attBranch, attYM, next); }
            catch (e) { alert("Could not save: " + (e.message || e)); return; }
            // Per-role count of staff that ended up with at least one filled cell.
            const filledByRole = { SM:0, AM:0, NT:0 };
            for (const s of attStaff) {
              const row = next[s.ec] || {};
              if (days.some(dy => row[dy.d])) {
                filledByRole[s.role] = (filledByRole[s.role] || 0) + 1;
              }
            }
            const parts = [];
            if (filled    > 0) parts.push("filled " + filled + " empty cell" + (filled === 1 ? "" : "s"));
            if (refreshed > 0) parts.push("refreshed " + refreshed + " unconfirmed cell" + (refreshed === 1 ? "" : "s") + " to match latest schedule");
            const roleSummary = "Staff with at least one mirrored cell: " +
              filledByRole.SM + " SM · " + filledByRole.AM + " AM · " + filledByRole.NT + " NT.";
            alert("Auto-fill done — " + parts.join(", ") + ".\n\n" + roleSummary + "\n\nFaded cells are unconfirmed — click any to confirm.");
          };

          // Term cascade: from a chosen day, mark this period + next 2 cycles as "term"
          const cascadeTerm = async (ec, fromYmd, staffName) => {
            if (!confirm("Mark " + staffName + " as TERMINATED from " + fromYmd + " onwards? This cycle + the next 2 cycles will be filled with TERMINATED.")) return;
            const cur = { ...attGrid, [ec]: { ...(attGrid[ec] || {}) } };
            for (const dy of days) { if (dy.ymd >= fromYmd) cur[ec][dy.d] = "term"; }
            setAttGrid(cur);
            try { await window.BOA_DB.saveAttendance(attBranch, attYM, cur); }
            catch (e) { alert("Could not save current cycle: " + (e.message || e)); return; }
            // Cascade forward 2 months
            for (let mShift = 1; mShift <= 2; mShift++) {
              let futM = ymP[1] + mShift, futY = ymP[0];
              while (futM > 12) { futM -= 12; futY++; }
              const futKey = futY + "-" + p2(futM);
              try {
                const futSaved = await window.BOA_DB.loadAttendance(attBranch, futKey);
                const futG = (futSaved && futSaved.grid) || {};
                if (!futG[ec]) futG[ec] = {};
                const futCS = new Date(futY, futM-1, 25);
                const futCE = new Date(futY, futM,   24);
                for (let c = new Date(futCS); c <= futCE; c.setDate(c.getDate()+1)) {
                  const cYmd = c.getFullYear() + "-" + p2(c.getMonth()+1) + "-" + p2(c.getDate());
                  if (cYmd >= fromYmd) futG[ec][c.getDate()] = "term";
                }
                await window.BOA_DB.saveAttendance(attBranch, futKey, futG);
              } catch (e) { console.error("Forward cascade " + futKey + ":", e); }
            }
            // If already on off-board list, append a note
            const existingOff = offList.find(o => o.ec === ec);
            if (existingOff) {
              const noteAdd = "\n[Attendance: marked terminated from " + fromYmd + "]";
              if (!(existingOff.notes || "").includes(noteAdd)) {
                const updated = offList.map(o => o.ec === ec ? { ...o, notes: (o.notes || "") + noteAdd } : o);
                setOffList(updated);
                try { await window.BOA_DB.saveOffboarding(updated); } catch (_) {}
              }
            }
            alert("✓ Termination cascade applied for " + staffName + " from " + fromYmd);
          };

          // Per-staff totals
          const totalsFor = (ec) => {
            const t = { al:0, sick:0, sickNote:0, frl:0, ph:0, mat:0, unpaid:0, ext:0, late:0, td:0, worked:0, off:0, term:0, unpaidHours:0 };
            for (const dy of days) {
              const v = getStatus(ec, dy.d);
              if      (v === "al")     t.al++;
              else if (v === "sick")   { t.sick++; t.unpaid++; }
              else if (v === "sick_n") t.sickNote++;
              else if (v === "frl")    t.frl++;
              else if (v === "ph")     t.ph++;
              else if (v === "mat")    t.mat++;
              else if (v === "no" || v === "unpaid") t.unpaid++;
              else if (v === "ext")    t.ext++;
              else if (v === "late")   t.late++;
              else if (v === "trial")  t.td++;
              else if (v === "on")     t.worked++;
              else if (v === "off")    t.off++;
              else if (v === "swap_i") t.off++;
              else if (v === "swap_o") t.worked++;
              else if (v === "term")   { t.term++; t.unpaid++; }
              else if (v && v.indexOf("deduct") === 0) {
                let h = 0; if (v.indexOf(":") > 0) h = parseFloat(v.split(":")[1]) || 0;
                t.unpaidHours += h;
              }
            }
            t.unpaidFromHours = t.unpaidHours / 9;
            t.totalUnpaid = t.unpaid + t.unpaidFromHours;
            t.exdOffsetUnpaid = Math.min(t.ext, t.totalUnpaid);
            t.unpaidAfterExd = t.totalUnpaid - t.exdOffsetUnpaid;
            t.exdAfterUnpaid = t.ext - t.exdOffsetUnpaid;
            return t;
          };

          const moShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const cycLabel = cycStart.getDate() + " " + moShort[cycStart.getMonth()] + " → " + cycEnd.getDate() + " " + moShort[cycEnd.getMonth()] + " " + cycEnd.getFullYear();
          const shiftAttYM = (delta) => {
            let y = ymP[0], m = ymP[1] + delta;
            while (m < 1)  { m += 12; y--; }
            while (m > 12) { m -= 12; y++; }
            setAttYM(y + "-" + p2(m));
          };

          // BCEA eligibility checks for sick_n + frl
          const findStartDate = (ec) => {
            const obRec = obList.find(o => (o.ec || "") === ec);
            if (obRec && obRec.startDate) return obRec.startDate;
            const sRec = staff.find(x => x.ec === ec) || managers.find(x => x.ec === ec);
            return (sRec && sRec.startDate) || null;
          };
          const checkSickEligibility = async (ec, staffName, ymd) => {
            const sd = findStartDate(ec);
            if (!sd) return true;        // no start date → allow (legacy data)
            const sdDt = new Date(sd + "T00:00:00");
            const dyDt = new Date(ymd + "T00:00:00");
            if (dyDt < sdDt) { alert("⚠ " + staffName + " had not started yet on " + ymd + ".\n\nStart date: " + sd); return false; }
            let months = (dyDt.getFullYear() - sdDt.getFullYear()) * 12 + (dyDt.getMonth() - sdDt.getMonth());
            if (dyDt.getDate() < sdDt.getDate()) months--;
            if (months >= 6) return true;
            const daysFromStart = Math.floor((dyDt - sdDt) / 86400000);
            const daysWorked = Math.max(0, Math.floor(daysFromStart * 21 / 30));
            // Count sick_n already used in last 6 months across attendance grids
            let sickUsed = 0;
            for (let shift = -3; shift <= 3; shift++) {
              let futM = ymP[1] + shift, futY = ymP[0];
              while (futM < 1)  { futM += 12; futY--; }
              while (futM > 12) { futM -= 12; futY++; }
              const key = futY + "-" + p2(futM);
              try {
                const ad = (key === attYM) ? { grid: attGrid } : await window.BOA_DB.loadAttendance(attBranch, key);
                if (!ad || !ad.grid || !ad.grid[ec]) continue;
                for (const k in ad.grid[ec]) {
                  const vv = ad.grid[ec][k];
                  const bare = vv && vv.indexOf("~") === 0 ? vv.slice(1) : vv;
                  if (bare === "sick_n") sickUsed++;
                }
              } catch(_) {}
            }
            const earned = Math.max(0, Math.floor(daysWorked / 26));
            const available = Math.max(0, earned - sickUsed);
            if (available < 1) {
              alert("⚠ Paid sick leave not yet earned\n\n" + staffName + " has worked " + daysWorked + " day" + (daysWorked === 1 ? "" : "s") + " (started " + sd + ", " + months + " full month" + (months === 1 ? "" : "s") + " employed).\n\nBCEA rule: 1 paid sick day per 26 days worked in first 6 months.\nEarned so far: " + earned + "\nAlready used: " + sickUsed + "\nAvailable: " + available + "\n\nUse \"Sick NO note\" (unpaid) instead, or wait until enough days are accrued.");
              return false;
            }
            return true;
          };
          const checkFRLEligibility = (ec, staffName, ymd) => {
            const sd = findStartDate(ec);
            if (!sd) return true;
            const sdDt = new Date(sd + "T00:00:00");
            const dyDt = new Date(ymd + "T00:00:00");
            let months = (dyDt.getFullYear() - sdDt.getFullYear()) * 12 + (dyDt.getMonth() - sdDt.getMonth());
            if (dyDt.getDate() < sdDt.getDate()) months--;
            if (months < 4) {
              alert("⚠ FRL not yet eligible\n\n" + staffName + " started on " + sd + " — only " + months + " full month" + (months === 1 ? "" : "s") + " employed.\n\nFamily Responsibility Leave (FRL) requires at least 4 months of continuous employment. Use Unpaid instead.");
              return false;
            }
            return true;
          };

          // Cell change handler
          const onCellChange = async (s, dy, val) => {
            if (!val) return;
            // Block manual edits on auto-derived TERMINATED cells (post-leftDate).
            if (isPostLeftDate(s.ec, dy.ymd)) {
              alert(s.name + " left on " + offByEc[s.ec] + " — this day is automatically TERMINATED. Remove them from the Off-boarding tab to edit attendance after this date.");
              return;
            }
            if (val === "deduct") {
              const hStr = prompt("How many hours unpaid? (e.g. 1.5 for 1h30)\n\nEnter a number between 0.5 and 9.", "1");
              if (hStr == null) return;
              const h = parseFloat(hStr);
              if (isNaN(h) || h <= 0 || h > 9) { alert("Please enter a valid number of hours between 0.5 and 9."); return; }
              return setCell(s.ec, dy.d, "deduct:" + h);
            }
            if (val === "sick_n") {
              const ok = await checkSickEligibility(s.ec, s.name, dy.ymd);
              if (!ok) return;
              return setCell(s.ec, dy.d, "sick_n");
            }
            if (val === "frl") {
              if (!checkFRLEligibility(s.ec, s.name, dy.ymd)) return;
              return setCell(s.ec, dy.d, "frl");
            }
            if (val === "term") {
              return cascadeTerm(s.ec, dy.ymd, s.name);
            }
            if ((val === "on" || val === "late") && holidayLookup && holidayLookup[dy.ymd]) {
              if (val === "on") return setCell(s.ec, dy.d, "ph");
              await setCell(s.ec, dy.d, "ph");
              setTimeout(() => alert("This day is a public holiday — marked as Public Holiday (paid). Use Late manually after if needed."), 50);
              return;
            }
            return setCell(s.ec, dy.d, val);
          };

          return (
            <div>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontFamily:"'Playfair Display',serif", fontSize:24, color:"#831843", fontWeight:700, marginBottom:4 }}>📕 Attendance & Payroll</div>
                <div style={{ fontSize:12, color:"#F472B6" }}>Daily attendance log per store. Statuses auto-suggested from the schedule — confirm or override each day. Totals feed payroll.</div>
              </div>

              <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, background:"#FFFFFF", border:"1px solid #FBCFE8", borderRadius:8, padding:"6px 10px" }}>
                  <label style={{ fontSize:11, fontWeight:600, color:"#831843" }}>Store:</label>
                  <select value={attBranch} onChange={e=>setAttBranch(e.target.value)} style={{ border:"none", fontSize:13, fontWeight:600, color:"#831843", background:"transparent", cursor:"pointer", fontFamily:"inherit", outline:"none" }}>
                    {SALONS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6, background:"#FFFFFF", border:"1px solid #FBCFE8", borderRadius:8, padding:"4px 6px" }}>
                  <button onClick={()=>shiftAttYM(-1)} style={{ background:"transparent", border:"none", color:"#831843", cursor:"pointer", fontSize:16, fontWeight:600, padding:"2px 8px" }} title="Previous month">‹</button>
                  <div style={{ fontSize:12, fontWeight:600, color:"#831843", minWidth:160, textAlign:"center" }}>{cycLabel}</div>
                  <button onClick={()=>shiftAttYM(1)} style={{ background:"transparent", border:"none", color:"#831843", cursor:"pointer", fontSize:16, fontWeight:600, padding:"2px 8px" }} title="Next month">›</button>
                </div>
                <div style={{ flex:1 }} />
                {attLoading && <span style={{ fontSize:11, color:"#9ca3af", fontStyle:"italic" }}>Loading…</span>}
                {!attLoading && attMeta && attMeta.freshaCoverage && attMeta.freshaCoverage.through && (
                  <span title={"Fresha imported through this date — orange off-day banners only fire for days up to here. Last import: " + (attMeta.freshaCoverage.importedAt ? new Date(attMeta.freshaCoverage.importedAt).toLocaleString("en-ZA") : "—")}
                    style={{ fontSize:10, fontWeight:700, color:"#9a3412", background:"#ffedd5", border:"1px solid #fde68a", borderRadius:6, padding:"3px 8px", letterSpacing:"0.04em" }}>
                    📤 Fresha through {new Date(attMeta.freshaCoverage.through + "T00:00:00").toLocaleDateString("en-ZA", { day:"2-digit", month:"short" })}
                  </span>
                )}
                <button onClick={autoFill} style={{ padding:"7px 14px", background:"#fef3c7", color:"#78350f", border:"1px solid #fbbf24", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:11, fontWeight:600 }} title="Fill empty cells from schedule (faded, still unconfirmed)">✓ Auto-fill from Schedule</button>
                <button onClick={importFresha} style={{ padding:"7px 14px", background:"#dbeafe", color:"#1e3a8a", border:"1px solid #93c5fd", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:11, fontWeight:600 }} title="Upload a Fresha appointments CSV — every nail tech with a completed appointment that day is marked On Time">📤 Import Fresha CSV</button>
                <button onClick={resetCycle} style={{ padding:"7px 14px", background:"#fee2e2", color:"#7f1d1d", border:"1px solid #fca5a5", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:11, fontWeight:600 }} title="Clear every cell for this branch + cycle (with confirmation)">↺ Reset Cycle</button>
              </div>

              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", fontSize:11, color:"#831843", marginBottom:8, padding:"8px 12px", background:"#FDEEF5", border:"1px solid #FBCFE8", borderRadius:8 }}>
                <span style={{ fontWeight:700 }}>💡 Reading the grid:</span>
                <span style={{ fontStyle:"italic", opacity:0.75 }}>italic</span> = mirrored from schedule (no edits yet) ·
                <span style={{ fontWeight:700 }}>bold</span> = confirmed by you ·
                <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:"#be185d" }} /> = differs from schedule (deviation) ·
                <span style={{ background:"#dcfce7", color:"#15803d", fontWeight:800, padding:"1px 6px", borderRadius:4, borderLeft:"3px solid #16a34a" }}>✓✓</span> = Fresha + schedule + check-in all match (worked) ·
                <span style={{ background:"#ffedd5", color:"#9a3412", fontWeight:800, padding:"1px 6px", borderRadius:4, borderLeft:"3px solid #ea580c" }}>✓✓</span> = scheduled off · no appointment · no check-in (rest day match) ·
                <span style={{ color:"#16a34a", fontWeight:800 }}>✓</span> = checked in via app ·
                <span style={{ color:"#b45309", fontWeight:800 }}>!</span> = check-in / attendance mismatch ·
                <span style={{ color:"#b45309", fontWeight:800 }}>!?</span> = Fresha says worked, no check-in
              </div>

              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14, padding:"10px 12px", background:"#FFFFFF", border:"1px solid #FBCFE8", borderRadius:8 }}>
                {Object.entries(STAT).map(([k,v]) => (
                  <span key={k} style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, color:"#831843" }}>
                    <span style={{ display:"inline-block", width:14, height:14, background:v.bg, border:"1px solid " + v.fg + "33", borderRadius:3 }} /> {v.lbl}
                  </span>
                ))}
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:13, border:"1px solid #FBCFE8", overflowX:"auto", overflowY:"visible" }}>
                <table style={{ borderCollapse:"separate", borderSpacing:0, minWidth:"100%", fontSize:11 }}>
                  <thead>
                    <tr>
                      <th style={{ position:"sticky", left:0, top:0, background:"#FDEEF5", padding:"8px 10px", borderBottom:"2px solid #FBCFE8", borderRight:"2px solid #FBCFE8", fontSize:10, color:"#831843", letterSpacing:"0.05em", textAlign:"left", zIndex:3, minWidth:170 }}>STAFF</th>
                      {days.map(dy => {
                        const isWk = dy.dow === 0 || dy.dow === 6;
                        const isHol = !!(holidayLookup && holidayLookup[dy.ymd]);
                        return (
                          <th key={dy.d} title={isHol ? dy.ymd + " — South Africa Public Holiday" : undefined} style={{ padding:"4px 4px", fontSize:9, color: isHol ? "#991b1b" : (isWk ? "#831843" : "#BE185D"), textAlign:"center", borderBottom:"2px solid #FBCFE8", borderLeft:"1px solid #FCE7F3", background: isHol ? "#fecaca" : (isWk ? "#FCE7F3" : "#FDEEF5"), minWidth:36 }}>
                            <div style={{ fontSize:8, fontWeight:800, color: isHol ? "#991b1b" : "transparent", letterSpacing:"0.04em", height:11, lineHeight:"11px" }}>{isHol ? "PH" : "·"}</div>
                            <div style={{ fontSize:10, fontWeight:800 }}>{dy.d}</div>
                            <div style={{ fontSize:8, fontWeight:500, opacity:0.7 }}>{["S","M","T","W","T","F","S"][dy.dow]}</div>
                          </th>
                        );
                      })}
                      {[
                        { l:"AL",        bg:"#eff6ff", c:"#1e40af", t:"Annual Leave" },
                        { l:"SICK",      bg:"#fef2f2", c:"#7f1d1d", t:"Sick days" },
                        { l:"FRL",       bg:"#fffbeb", c:"#78350f", t:"Family Responsibility Leave" },
                        { l:"PPH",       bg:"#f0fdf4", c:"#14532d", t:"Public Holidays" },
                        { l:"MAT",       bg:"#fef3c7", c:"#7c2d12", t:"Maternity" },
                        { l:"LATE",      bg:"#fef3c7", c:"#92400e", t:"Late" },
                        { l:"EXD",       bg:"#d1fae5", c:"#064e3b", t:"Extra Days Worked" },
                        { l:"UNPAID",    bg:"#fee2e2", c:"#7f1d1d", t:"Unpaid" },
                        { l:"NET UNPAID",bg:"#f3f4f6", c:"#374151", t:"Unpaid - Extra credit" }
                      ].map((c, i) => (
                        <th key={c.l} title={c.t} style={{ padding:"6px 8px", fontSize:9, fontWeight:800, color:c.c, textAlign:"center", borderBottom:"2px solid #FBCFE8", borderLeft: i===0 || i===8 ? "3px solid #FBCFE8" : "1px solid #FCE7F3", background:c.bg, minWidth:42 }}>{c.l}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {attStaff.length === 0 && (
                      <tr><td colSpan={days.length + 10} style={{ padding:30, textAlign:"center", color:"#9ca3af", fontStyle:"italic" }}>No active staff at {attBranch}.</td></tr>
                    )}
                    {attStaff.map((s, idx) => {
                      const t = totalsFor(s.ec);
                      const isMgr = s.role === "SM" || s.role === "AM";
                      const prev = idx > 0 ? attStaff[idx-1] : null;
                      const prevIsMgr = prev ? (prev.role === "SM" || prev.role === "AM") : null;
                      const showSection = idx === 0 || isMgr !== prevIsMgr;
                      const sectionRow = showSection ? (
                        <tr key={"section-" + (isMgr ? "mgr" : "tech")}>
                          <td colSpan={days.length + 10} style={{ background: isMgr ? "#FCE7F3" : "#FDEEF5", padding:"8px 14px", borderTop:"2px solid #FBCFE8", borderBottom:"1px solid #FBCFE8", fontSize:11, fontWeight:800, color:"#831843", letterSpacing:"0.12em", textTransform:"uppercase" }}>
                            {isMgr ? "👑 Managers" : "💅 Nail Techs"}
                          </td>
                        </tr>
                      ) : null;
                      const dataRow = (
                        <tr key={s.ec} style={isMgr ? { background:"#fffaf0" } : undefined}>
                          <td style={{ position:"sticky", left:0, background: isMgr ? "#fffaf0" : "#FFFFFF", padding:"6px 10px", borderBottom:"1px solid #FCE7F3", borderRight:"2px solid #FBCFE8", zIndex:2, minWidth:170 }}>
                            <div style={{ fontSize:11, fontWeight:700, color:"#831843" }}>{isMgr ? (s.role === "SM" ? "👑 " : "⭐ ") : ""}{s.name}</div>
                            <div style={{ fontSize:9, color:"#9ca3af" }}>{s.ec} · {s.role}</div>
                          </td>
                          {days.map(dy => {
                            const v = getStatus(s.ec, dy.d);
                            const hint = schedHint(s.ec, dy.d);
                            const override = hasOverride(s.ec, dy.d);
                            const st = resolveStat(v) || { lbl:"", bg:"#FFFFFF", fg:"#9ca3af" };
                            const isWk = dy.dow === 0 || dy.dow === 6;
                            const deviation = override && hint && hint !== v;
                            const isHol = !!(holidayLookup && holidayLookup[dy.ymd]);
                            const hintLbl = hint ? (STAT[hint] || {}).lbl || "" : "";
                            const hintBg  = hint ? (STAT[hint] || {}).bg  || "#FFFFFF" : "#FFFFFF";
                            const hintFg  = hint ? (STAT[hint] || {}).fg  || "#9ca3af" : "#9ca3af";
                            // Tech check-in for this cell (if any). Only nail-tech rows
                            // get a check-in badge — managers are out of scope.
                            const checkin = (s.role === "NT")
                              ? ((checkInsByBranch[attBranch] || {})[s.ec] || {})[dy.ymd] || null
                              : null;
                            // Discrepancy logic:
                            //  - Tech checked in but attendance marks them OFF / Annual /
                            //    Sick / etc → mismatch (manager said not at work but app
                            //    says they were there).
                            //  - Fresha said worked but no check-in landed → mismatch
                            //    (the day of the past).
                            //  - "late" / "~late" never triggers — Fresha can't tell late
                            //    from on-time.
                            const bareV = v ? (v.charAt(0) === "~" ? v.slice(1) : v) : "";
                            const isWorking = bareV === "on" || bareV === "ext" || bareV === "trial" || bareV === "swap_o";
                            const isLate    = bareV === "late";
                            const isOff     = bareV === "off" || bareV === "swap_i" || bareV === "al" || bareV === "ph" ||
                                              bareV === "mat" || bareV === "term" || bareV === "sick" || bareV === "sick_n" || bareV === "frl";
                            const todayY = new Date(); const t0Ymd = todayY.getFullYear() + "-" + String(todayY.getMonth()+1).padStart(2,"0") + "-" + String(todayY.getDate()).padStart(2,"0");
                            const isPastOrToday = dy.ymd <= t0Ymd;
                            const checkinHasIn    = !!(checkin && checkin.hasIn);
                            const checkinMismatch = checkinHasIn && isOff;                                  // checked in but day marked off
                            const missingCheckin  = !checkinHasIn && isWorking && override && isPastOrToday; // Fresha confirmed work but no check-in
                            // Green-banner "all-match" — Fresha (override) AND schedule AND
                            // manager check-in all confirm this nail tech worked. Late counts
                            // as worked (Fresha can't tell late from on-time).
                            const freshaConfirmedWork = override && (isWorking || isLate);
                            const scheduleSaysWork    = hint === "on" || hint === "ext";
                            const allMatchWork        = s.role === "NT" && freshaConfirmedWork && scheduleSaysWork && checkinHasIn;
                            // Orange-banner "all-match OFF" — schedule says off, no Fresha
                            // appointment was imported (cell isn't in a working state) and the
                            // tech wasn't checked in. Only fires for days the most recent Fresha
                            // import actually covered: future days (no appts in CSV yet) shouldn't
                            // be misread as confirmed off-days when the user uploads mid-month.
                            const scheduleSaysOff     = hint === "off";
                            const freshaThrough       = attMeta && attMeta.freshaCoverage && attMeta.freshaCoverage.through;
                            const freshaCoversThisDay = !!freshaThrough && dy.ymd <= freshaThrough;
                            const allMatchOff         = s.role === "NT" && scheduleSaysOff && !isWorking && !isLate && !checkinHasIn && freshaCoversThisDay;
                            const ttl =
                              dy.ymd + ": " + (st.lbl || "—") +
                              (hint ? " — schedule: " + ((STAT[hint] || {}).lbl || "—") : "") +
                              (deviation ? " (deviation)" : "") +
                              (!override ? " (mirrored from schedule)" : "") +
                              (checkin ? "\nChecked in" + (checkin.firstInTs ? " at " + checkin.firstInTs.toLocaleTimeString("en-ZA", { hour:"2-digit", minute:"2-digit" }) : "") + (checkin.autoOut ? " · auto-out" : "") : "") +
                              (checkinMismatch ? "\n⚠ Discrepancy: tech checked in but day marked " + bareV : "") +
                              (missingCheckin  ? "\n⚠ Missing check-in: Fresha shows worked, no check-in record" : "") +
                              (isLate && checkin ? "\n(Late — counts as worked, no discrepancy)" : "");
                            const cellBaseBg = override ? (isHol ? "#fef2f2" : (isWk ? "#fdf4f8" : "#FFFFFF")) : (isHol ? "#fecaca40" : hintBg + "18");
                            const allMatchBg     = allMatchWork ? "#dcfce7" : allMatchOff ? "#ffedd5" : null;
                            const allMatchEdge   = allMatchWork ? "3px solid #16a34a" : allMatchOff ? "3px solid #ea580c" : "1px solid #FCE7F3";
                            const allMatchTxt    = allMatchWork ? "#14532d" : allMatchOff ? "#9a3412" : null;
                            const allMatchTip    = allMatchWork ? "\n✓ All match — Fresha + schedule + check-in agree"
                                                  : allMatchOff ? "\n✓ All match OFF — scheduled off, no Fresha appointment, no check-in"
                                                  : "";
                            return (
                              <td key={dy.d} style={{ padding:0, borderBottom:"1px solid #FCE7F3", borderLeft: allMatchEdge, background: allMatchBg || cellBaseBg, position:"relative" }}>
                                <div style={{ position:"relative", height:30 }}>
                                  {v && (
                                    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontStyle: override ? "normal" : "italic", fontWeight: override ? 700 : 400, color: override ? (allMatchTxt || st.fg) : (allMatchTxt || (hintFg + "70")), pointerEvents:"none", letterSpacing:"0.02em" }}>{st.lbl || hintLbl || ""}</div>
                                  )}
                                  <select value="" onChange={e=>onCellChange(s, dy, e.target.value)} title={ttl + allMatchTip}
                                    style={{ width:"100%", height:30, border: deviation ? "2px solid #be185d" : "none", background: (allMatchBg ? "transparent" : (override ? st.bg : "transparent")), color:"transparent", fontSize:9, fontWeight:400, opacity:1, textAlign:"center", cursor:"pointer", padding:"0 1px", fontFamily:"inherit", outline:"none", appearance:"none" }}>
                                    <option value="" style={{ color:"#000", background:"#fff" }}>—</option>
                                    {Object.entries(STAT).filter(([k]) => k !== "ph" || isHol).map(([k, vv]) => (
                                      <option key={k} value={k} style={{ color:"#000", background:"#fff" }}>{vv.lbl}</option>
                                    ))}
                                  </select>
                                  {deviation && !allMatchWork && !allMatchOff && <span style={{ position:"absolute", top:1, right:1, width:5, height:5, borderRadius:"50%", background:"#be185d", pointerEvents:"none" }} />}
                                  {allMatchWork && (
                                    <span title="Fresha + schedule + check-in all agree" style={{ position:"absolute", top:1, right:1, fontSize:9, lineHeight:1, color:"#15803d", fontWeight:800, pointerEvents:"none" }}>✓✓</span>
                                  )}
                                  {allMatchOff && (
                                    <span title="Scheduled off · no Fresha appointment · no check-in" style={{ position:"absolute", top:1, right:1, fontSize:9, lineHeight:1, color:"#c2410c", fontWeight:800, pointerEvents:"none" }}>✓✓</span>
                                  )}
                                  {!allMatchWork && !allMatchOff && checkinHasIn && !checkinMismatch && (
                                    <span style={{ position:"absolute", bottom:1, left:2, fontSize:9, lineHeight:1, color:"#16a34a", pointerEvents:"none", textShadow:"0 0 1px rgba(255,255,255,0.6)" }}>✓</span>
                                  )}
                                  {checkinMismatch && (
                                    <span title="Tech checked in but day marked off — discrepancy" style={{ position:"absolute", bottom:1, left:2, fontSize:9, lineHeight:1, color:"#b45309", pointerEvents:"none", fontWeight:800 }}>!</span>
                                  )}
                                  {missingCheckin && (
                                    <span title="Fresha shows worked but no check-in" style={{ position:"absolute", bottom:1, right:2, fontSize:9, lineHeight:1, color:"#b45309", pointerEvents:"none", fontWeight:800 }}>!?</span>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                          <td style={{ padding:"6px 8px", fontSize:11, fontWeight:800, color:"#1e40af", textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft:"3px solid #FBCFE8", background:"#eff6ff" }}>{t.al}</td>
                          <td style={{ padding:"6px 8px", fontSize:11, fontWeight:800, color:"#7f1d1d", textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft:"1px solid #FCE7F3", background:"#fef2f2" }} title={t.sickNote + " with note + " + t.sick + " no note"}>{t.sick + t.sickNote}</td>
                          <td style={{ padding:"6px 8px", fontSize:11, fontWeight:800, color:"#78350f", textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft:"1px solid #FCE7F3", background:"#fffbeb" }}>{t.frl}</td>
                          <td style={{ padding:"6px 8px", fontSize:11, fontWeight:800, color:"#14532d", textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft:"1px solid #FCE7F3", background:"#f0fdf4" }}>{t.ph}</td>
                          <td style={{ padding:"6px 8px", fontSize:11, fontWeight:800, color:"#7c2d12", textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft:"1px solid #FCE7F3", background:"#fef3c7" }}>{t.mat}</td>
                          <td style={{ padding:"6px 8px", fontSize:11, fontWeight:800, color:"#92400e", textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft:"1px solid #FCE7F3", background:"#fef3c7" }}>{t.late}</td>
                          <td style={{ padding:"6px 8px", fontSize:11, fontWeight:800, color:"#064e3b", textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft:"1px solid #FCE7F3", background:"#d1fae5" }}>{t.ext}</td>
                          <td style={{ padding:"6px 8px", fontSize:11, fontWeight:800, color: t.totalUnpaid > 0 ? "#7f1d1d" : "#9ca3af", textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft:"1px solid #FCE7F3", background: t.totalUnpaid > 0 ? "#fee2e2" : "#fef2f2" }} title={t.unpaidHours > 0 ? t.unpaid + " full + " + t.unpaidHours + "h = " + t.totalUnpaid.toFixed(2) + " days" : undefined}>{t.totalUnpaid === Math.floor(t.totalUnpaid) ? t.totalUnpaid : t.totalUnpaid.toFixed(2)}</td>
                          <td style={{ padding:"6px 8px", fontSize:12, fontWeight:800, color: t.unpaidAfterExd > 0 ? "#7f1d1d" : "#16a34a", textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft:"3px solid #FBCFE8", background: t.unpaidAfterExd > 0 ? "#fee2e2" : "#f0fdf4" }} title={t.totalUnpaid.toFixed(2) + " unpaid − " + t.exdOffsetUnpaid + " extras = " + t.unpaidAfterExd.toFixed(2) + " net unpaid" + (t.exdAfterUnpaid > 0 ? " (+" + t.exdAfterUnpaid + " extras after)" : "")}>
                            {t.unpaidAfterExd === Math.floor(t.unpaidAfterExd) ? t.unpaidAfterExd : t.unpaidAfterExd.toFixed(2)}
                            {t.exdAfterUnpaid > 0 && <span style={{ fontSize:8, color:"#16a34a", marginLeft:3, fontWeight:700 }}>+{t.exdAfterUnpaid}</span>}
                          </td>
                        </tr>
                      );
                      return <React.Fragment key={s.ec}>{sectionRow}{dataRow}</React.Fragment>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ── LEAVE PLANNER TAB ── */}
        {tab==="leave" && (() => {
          const br = leaveBranch;
          const ym = leaveYM;
          const f  = leaveForm;
          const isTechMode = leaveSubTab === "techs";
          const peopleType = isTechMode ? "nail tech" : "manager";
          const peopleTypePlural = isTechMode ? "nail techs" : "managers";
          const ROLE_GUARD = isTechMode
            ? (s) => /^[BT]/.test(s.ec) && !s.offHidden
            : (m) => m.role === "SM" || m.role === "AM";
          // Active people of the chosen type at this branch — exclude maternity / off-boarded / wrong role
          const sourceArr = isTechMode ? enriched : managers;
          const peopleAtBranch = (sourceArr || [])
            .filter(p => p.branch === br && !p.onMat && ROLE_GUARD(p))
            .sort((a,b) => (a.ec || "").localeCompare(b.ec || ""));
          // For dropdown — all people of this type across all branches
          const peopleAllBranches = (sourceArr || [])
            .filter(p => !p.onMat && ROLE_GUARD(p))
            .sort((a,b) => (a.ec || "").localeCompare(b.ec || ""));
          // 20% per-day cap, minimum 1
          const maxLeave = Math.max(1, Math.floor(peopleAtBranch.length * 0.2));
          // 6 PAYROLL CYCLES from selected start cycle. Each cycle runs from
          // the 25th of (M-1) through the 24th of M, named by M (matches the
          // YM convention used everywhere else in the portal).
          const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const ymP = ym.split("-").map(Number);
          const y0 = ymP[0], m0 = ymP[1];
          const allDays = [];
          const monthLabels = [];
          for (let i = 0; i < 6; i++) {
            let y = y0, m = m0 + i;
            while (m > 12) { m -= 12; y++; }
            // Previous calendar month — provides the 25th-end-of-month half.
            let prevY = y, prevM = m - 1;
            if (prevM < 1) { prevM = 12; prevY = y - 1; }
            const lastPrev = new Date(prevY, prevM, 0).getDate();
            const start = allDays.length;
            // First half of cycle: 25th → end of prev month.
            for (let d = 25; d <= lastPrev; d++) {
              const dt = new Date(prevY, prevM-1, d);
              const iso = prevY + "-" + String(prevM).padStart(2,"0") + "-" + String(d).padStart(2,"0");
              allDays.push({ d, m: prevM, y: prevY, iso, dow: dt.getDay(), peak: (prevM >= 10 || prevM <= 4) });
            }
            // Second half of cycle: 1st → 24th of named month.
            for (let d = 1; d <= 24; d++) {
              const dt = new Date(y, m-1, d);
              const iso = y + "-" + String(m).padStart(2,"0") + "-" + String(d).padStart(2,"0");
              allDays.push({ d, m, y, iso, dow: dt.getDay(), peak: (m >= 10 || m <= 4) });
            }
            // Cycle header: peak flag based on the cycle's named month (it
            // owns more days — 24 vs 6/7 — so it's the dominant influence).
            monthLabels.push({
              m, y,
              start,
              len: allDays.length - start,
              peak: (m >= 10 || m <= 4),
              label: MN[prevM-1] + " 25 – " + MN[m-1] + " 24, " + y
            });
          }
          const onLeaveAt = (ec, iso) => {
            for (const lv of leaveRecs) {
              if (lv.ec === ec && iso >= lv.startDate && iso <= lv.endDate) return lv;
            }
            return null;
          };
          const annualCount = (iso) => {
            let ct = 0;
            for (const lv of leaveRecs) {
              if (lv.type !== "Annual leave") continue;
              const p2 = (isTechMode ? enriched : managers).find(x => x.ec === lv.ec);
              if (!p2 || p2.branch !== br || p2.onMat) continue;
              if (!ROLE_GUARD(p2)) continue;
              if (iso >= lv.startDate && iso <= lv.endDate) ct++;
            }
            return ct;
          };
          const persistLeaves = async (next) => {
            setLeaveRecs(next);
            try { await window.BOA_DB.saveLeaveRecords(next); }
            catch (e) { alert("Could not save: " + (e.message || e)); }
          };
          const addLeave = () => {
            if (!f.ec || !f.startDate || !f.endDate) { alert("Please fill in " + peopleType + ", from, and to dates."); return; }
            if (new Date(f.startDate) > new Date(f.endDate)) { alert("Start date must be on or before end date."); return; }
            const stf = (isTechMode ? enriched : managers).find(p => p.ec === f.ec);
            if (!stf || stf.onMat || !ROLE_GUARD(stf)) { alert("This sub-tab manages annual leave for " + peopleTypePlural + " only."); return; }
            const stBr = stf.branch;
            const stPeople = (isTechMode ? enriched : managers).filter(p => p.branch === stBr && !p.onMat && ROLE_GUARD(p));
            const stMx = Math.max(1, Math.floor(stPeople.length * 0.2));
            // Peak season check (Oct-Apr)
            const sd = new Date(f.startDate), ed = new Date(f.endDate);
            let peakDays = 0;
            for (let d = new Date(sd); d <= ed; d.setDate(d.getDate()+1)) {
              const mo = d.getMonth() + 1;
              if (mo >= 10 || mo <= 4) peakDays++;
            }
            if (peakDays > 0 && !f.emergency) {
              alert("Cannot add: " + peakDays + " day(s) fall in peak season (October–April). Annual leave is blocked during peak season except for emergency leave with proof. Tick \"Emergency leave\" and add a reason.");
              return;
            }
            if (f.emergency && !f.emergencyNote.trim()) {
              alert("Emergency annual leave requires a reason / proof description.");
              return;
            }
            // Per-day cap check
            for (let d = new Date(sd); d <= ed; d.setDate(d.getDate()+1)) {
              const ds = d.toISOString().split("T")[0];
              let ct = 1;
              for (const lv of leaveRecs) {
                if (lv.type !== "Annual leave") continue;
                const ls = (isTechMode ? enriched : managers).find(p2 => p2.ec === lv.ec);
                if (!ls || ls.branch !== stBr || ls.onMat || !ROLE_GUARD(ls)) continue;
                if (ds >= lv.startDate && ds <= lv.endDate) ct++;
              }
              if (ct > stMx) {
                alert("Cannot add: " + ct + " " + peopleTypePlural + " would be on annual leave on " + ds + ". Max " + stMx + " allowed (20% of " + stPeople.length + " " + peopleTypePlural + " at " + stBr + ").");
                return;
              }
            }
            const notes = f.emergency ? "[EMERGENCY] " + f.emergencyNote : "";
            const newRec = { _id: Date.now(), ec: f.ec, startDate: f.startDate, endDate: f.endDate, type: "Annual leave", notes, emergency: !!f.emergency };
            persistLeaves([...leaveRecs, newRec]);
            setLeaveForm({ ec:"", startDate:"", endDate:"", emergency:false, emergencyNote:"" });
          };
          const removeLeave = (id) => {
            if (!confirm("Remove this leave record?")) return;
            persistLeaves(leaveRecs.filter(x => x._id !== id));
          };

          // Records list, filtered to this branch and the chosen role family
          const storeLeave = leaveRecs
            .filter(lv => {
              if (lv.type !== "Annual leave") return false;
              const p = (isTechMode ? enriched : managers).find(x => x.ec === lv.ec);
              if (!p) return false;
              if (p.branch !== br) return false;
              return ROLE_GUARD(p);
            })
            .slice()
            .sort((a, b) => a.startDate.localeCompare(b.startDate));

          // Compute "leave days used" = calendar days minus theoretical off-days.
          // Reads each tech's saved schedule grid (boa_sched_<branch>_<ym>) from
          // the schedCache populated by the useEffect above. Off-days = cells
          // marked O (off-day rotation) or R (requested off). For any month
          // where no schedule has been generated yet, falls back to Sundays-as-
          // proxy so the count is still informative.
          const computeLeaveDays = (lv) => {
            const sd2 = new Date(lv.startDate), ed2 = new Date(lv.endDate);
            if (isNaN(sd2) || isNaN(ed2) || sd2 > ed2) return { cal:0, off:0, used:0 };
            const techRec = staff.find(x => x.ec === lv.ec) || managers.find(x => x.ec === lv.ec);
            const techBranch = techRec ? techRec.branch : br;
            let cal = 0, off = 0;
            for (let d = new Date(sd2); d <= ed2; d.setDate(d.getDate()+1)) {
              cal++;
              const ymd = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
              const schedYm = ymdToSchedYm(ymd);
              const grid = schedCache[techBranch + "|" + schedYm];
              if (grid && grid[lv.ec]) {
                // Schedule grids key by day-of-month (string); count O / R as off
                const cell = grid[lv.ec][d.getDate()] || grid[lv.ec][String(d.getDate())];
                if (cell === "O" || cell === "R") off++;
              } else if (grid === null && d.getDay() === 0) {
                // Schedule loaded but missing/empty for this month → Sunday proxy
                off++;
              } else if (grid === undefined && d.getDay() === 0) {
                // Not yet fetched (rare) → Sunday proxy as fallback
                off++;
              }
            }
            return { cal, off, used: Math.max(0, cal - off) };
          };
          const totalStats = storeLeave.reduce((acc, lv) => {
            const s = computeLeaveDays(lv);
            return { cal: acc.cal + s.cal, off: acc.off + s.off, used: acc.used + s.used };
          }, { cal:0, off:0, used:0 });

          const aA = "#FDEEF5"; const Y = "#F9A8D4";

          return (
            <div>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontFamily:"'Playfair Display',serif", fontSize:24, color:"#831843", fontWeight:700, marginBottom:4 }}>🌴 Leave Planner</div>
                <div style={{ fontSize:12, color:"#F472B6" }}>Plan annual leave per store. 20% per-day cap enforced. Peak season (Oct–Apr) blocked except for emergency leave with proof.</div>
              </div>

              {/* Sub-tab pill bar */}
              <div style={{ display:"flex", gap:0, marginBottom:18, padding:6, background:"#FCE7F3", borderRadius:14, border:"1px solid #FBCFE8", maxWidth:680 }}>
                {[
                  { k:"techs",    label:"💅 Nail Tech Leave" },
                  { k:"managers", label:"👔 Manager Leave" }
                ].map(t => {
                  const active = leaveSubTab===t.k;
                  return (
                    <button key={t.k} onClick={()=>{ setLeaveSubTab(t.k); setLeaveForm({ ec:"", startDate:"", endDate:"", emergency:false, emergencyNote:"" }); }}
                      style={{ flex:1, padding:"14px 22px", borderRadius:10, border:"none", background: active ? "#BE185D" : "transparent", color: active ? "#FFFFFF" : "#831843", cursor:"pointer", fontFamily:"inherit", fontSize:15, fontWeight:700, transition:"all .18s", boxShadow: active ? "0 4px 12px rgba(190,24,93,0.32)" : "none", letterSpacing:"0.01em", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:10 }}>
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:13, padding:"14px 16px", border:"1px solid " + Y, marginBottom:14, display:"flex", flexWrap:"wrap", gap:14, alignItems:"flex-end" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:"#F472B6", letterSpacing:"0.06em" }}>STORE</label>
                  <select value={br} onChange={e=>setLeaveBranch(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:"1px solid " + Y, fontFamily:"inherit", fontSize:13, background:aA, minWidth:160 }}>
                    {SALONS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:"#F472B6", letterSpacing:"0.06em" }}>FROM CYCLE</label>
                  <input type="month" value={ym} onChange={e=>setLeaveYM(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:"1px solid " + Y, fontFamily:"inherit", fontSize:13, background:aA }} />
                </div>
                <div style={{ flex:1, minWidth:240, fontSize:12, color:"#831843", lineHeight:1.5 }}>
                  <div><strong>{peopleAtBranch.length}</strong> active {peopleAtBranch.length !== 1 ? peopleTypePlural : peopleType} at <strong>{br}</strong> · cap: <strong style={{ color:"#F472B6" }}>max {maxLeave} on annual leave per day</strong> (20%)</div>
                  <div style={{ fontSize:11, color:"#F472B6" }}>Calendar shows 6 payroll cycles (25th → 24th) starting from the selected cycle.</div>
                </div>
              </div>

              <div style={{ background:"#fef3c7", border:"1px solid #fcd34d", borderRadius:11, padding:"10px 14px", marginBottom:14, fontSize:12, color:"#78350f", display:"flex", gap:10, alignItems:"flex-start" }}>
                <span style={{ fontSize:16 }}>⚠️</span>
                <div>
                  <strong>Peak Season Block: October – April</strong>. No annual leave permitted during these months — it's the salon's busiest period. Only emergency leave with proof is allowed during peak season — tick the Emergency box and add a reason / proof description.
                </div>
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:13, padding:"14px 16px", border:"1px solid " + Y, marginBottom:14 }}>
                <div style={{ fontWeight:700, color:"#831843", marginBottom:10, fontSize:13 }}>Add Annual Leave</div>
                <div style={{ display:"grid", gridTemplateColumns:"1.5fr 1fr 1fr auto", gap:8, marginBottom:10, alignItems:"flex-end" }}>
                  <div>
                    <label style={{ fontSize:10, color:"#F472B6", fontWeight:700 }}>{isTechMode ? "NAIL TECH" : "MANAGER"}</label>
                    <select value={f.ec} onChange={e=>setLeaveForm({...f, ec:e.target.value})} style={{ width:"100%", padding:"6px 9px", borderRadius:6, border:"1px solid " + Y, fontFamily:"inherit", fontSize:12, background:aA }}>
                      <option value="">— select —</option>
                      {peopleAllBranches.map(z => <option key={z.ec} value={z.ec}>{z.ec} · {z.name} ({z.branch}{z.role && !isTechMode ? " · " + z.role : ""})</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:10, color:"#F472B6", fontWeight:700 }}>FROM</label>
                    <input type="date" value={f.startDate} onChange={e=>setLeaveForm({...f, startDate:e.target.value})} style={{ width:"100%", padding:"6px 9px", borderRadius:6, border:"1px solid " + Y, fontFamily:"inherit", fontSize:12, background:aA, boxSizing:"border-box" }} />
                  </div>
                  <div>
                    <label style={{ fontSize:10, color:"#F472B6", fontWeight:700 }}>TO</label>
                    <input type="date" value={f.endDate} onChange={e=>setLeaveForm({...f, endDate:e.target.value})} style={{ width:"100%", padding:"6px 9px", borderRadius:6, border:"1px solid " + Y, fontFamily:"inherit", fontSize:12, background:aA, boxSizing:"border-box" }} />
                  </div>
                  <button onClick={addLeave} style={{ background:"#F472B6", color:"#fff", border:"none", borderRadius:7, padding:"8px 14px", cursor:"pointer", fontFamily:"inherit", fontWeight:700, fontSize:12 }}>+ Add</button>
                </div>
                <div style={{ display:"flex", gap:14, alignItems:"flex-start", flexWrap:"wrap" }}>
                  <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"#831843", cursor:"pointer", whiteSpace:"nowrap" }}>
                    <input type="checkbox" checked={f.emergency} onChange={e=>setLeaveForm({...f, emergency:e.target.checked})} />
                    <strong>Emergency leave (with proof)</strong>
                    <span style={{ color:"#F472B6", fontSize:11 }}>— required for peak-season annual leave</span>
                  </label>
                  {f.emergency && (
                    <div style={{ flex:1, minWidth:240 }}>
                      <label style={{ fontSize:10, color:"#F472B6", fontWeight:700 }}>REASON / PROOF DESCRIPTION</label>
                      <input value={f.emergencyNote} onChange={e=>setLeaveForm({...f, emergencyNote:e.target.value})} placeholder="e.g. Family bereavement — death certificate provided" style={{ width:"100%", padding:"6px 9px", borderRadius:6, border:"1px solid " + Y, fontFamily:"inherit", fontSize:12, background:aA, boxSizing:"border-box" }} />
                    </div>
                  )}
                </div>
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:11, border:"1px solid " + Y, marginBottom:14, overflow:"auto" }}>
                <div style={{ padding:"12px 16px", fontWeight:700, color:"#831843", fontSize:13, borderBottom:"1px solid " + Y }}>Calendar Overview</div>
                <table style={{ borderCollapse:"collapse", fontSize:10, fontFamily:"inherit" }}>
                  <thead>
                    <tr>
                      <th style={{ padding:"6px 8px", textAlign:"left", position:"sticky", left:0, background:aA, zIndex:2, minWidth:160, fontSize:9, color:"#F472B6", borderBottom:"1px solid " + Y, borderRight:"2px solid " + Y }}>{isTechMode ? "NAIL TECH" : "MANAGER"}</th>
                      {monthLabels.map(ml => (
                        <th key={ml.y + "-" + ml.m} colSpan={ml.len} style={{ padding:"5px 0", textAlign:"center", borderBottom:"1px solid " + Y, background: ml.peak ? "#fef3c7" : aA, fontSize:11, fontWeight:700, color: ml.peak ? "#78350f" : "#831843", borderLeft:"2px solid " + Y }}>
                          {ml.label}{ml.peak ? " ⚠" : ""}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th style={{ padding:"3px 8px", position:"sticky", left:0, background:aA, zIndex:2, fontSize:9, color:"#F472B6", borderBottom:"1px solid " + Y, borderRight:"2px solid " + Y }}></th>
                      {allDays.map((d, di) => {
                        const isMS = di === 0 || d.m !== allDays[di-1].m;
                        return (
                          <th key={d.iso} style={{ padding:"3px 1px", textAlign:"center", borderBottom:"1px solid " + Y, background: d.peak ? "#fef3c7" : (d.dow === 0 || d.dow === 6 ? "#fafafa" : aA), fontSize:9, color: d.peak ? "#78350f" : (d.dow === 0 || d.dow === 6 ? "#7f1d1d" : "#831843"), minWidth:18, fontWeight:600, borderLeft: isMS ? "2px solid " + Y : "none" }}>{d.d}</th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {peopleAtBranch.map(st => (
                      <tr key={st.ec}>
                        <td style={{ padding:"4px 8px", position:"sticky", left:0, background:"#fff", zIndex:1, fontSize:11, borderBottom:"1px solid " + aA, borderRight:"2px solid " + Y }}>
                          <div>
                            <div style={{ fontWeight:700, color:"#831843" }}>{st.name}</div>
                            <div style={{ fontSize:9, color:"#9ca3af" }}>{st.ec}</div>
                          </div>
                        </td>
                        {allDays.map((d, di) => {
                          const lv = onLeaveAt(st.ec, d.iso);
                          let bg = "transparent", fg = "#831843", lbl = "";
                          if (lv) {
                            if (lv.type === "Annual leave") {
                              bg = lv.emergency ? "#fed7aa" : "#dbeafe";
                              fg = lv.emergency ? "#9a3412" : "#1e3a8a";
                              lbl = lv.emergency ? "E" : "A";
                            } else if (lv.type === "Sick leave") { bg = "#fee2e2"; fg = "#7f1d1d"; lbl = "S"; }
                            else if (lv.type === "Maternity") { bg = "#fce7f3"; fg = "#BE185D"; lbl = "M"; }
                            else if (lv.type === "Unpaid")    { bg = "#e5e7eb"; fg = "#374151"; lbl = "U"; }
                            else                                { bg = "#fef9c3"; fg = "#854d0e"; lbl = (lv.type || "?")[0]; }
                          } else if (d.peak) bg = "#fefce8";
                          else if (d.dow === 0 || d.dow === 6) bg = "#fafafa";
                          const isMS = di === 0 || d.m !== allDays[di-1].m;
                          const ttl = lv ? (lv.type + ": " + lv.startDate + " → " + lv.endDate + (lv.notes ? " · " + lv.notes : ""))
                                          : d.peak ? (d.iso + " (peak season)") : d.iso;
                          return (
                            <td key={d.iso} title={ttl} style={{ padding:0, minWidth:18, height:22, textAlign:"center", borderBottom:"1px solid " + aA, background:bg, color:fg, borderLeft: isMS ? "2px solid " + Y : "none", fontSize:9, fontWeight:700 }}>{lbl}</td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr style={{ background:aA }}>
                      <td style={{ padding:"5px 8px", position:"sticky", left:0, background:aA, fontSize:9, fontWeight:700, color:"#F472B6", letterSpacing:"0.04em", borderTop:"2px solid " + Y, borderRight:"2px solid " + Y }}>ANNUAL / {maxLeave}</td>
                      {allDays.map((d, di) => {
                        const ct = annualCount(d.iso);
                        const bg = ct === 0 ? "transparent" : ct < maxLeave ? "#dcfce7" : ct === maxLeave ? "#fef3c7" : "#fee2e2";
                        const fg = ct === 0 ? "#cbd5e1" : ct < maxLeave ? "#14532d" : ct === maxLeave ? "#78350f" : "#7f1d1d";
                        const isMS = di === 0 || d.m !== allDays[di-1].m;
                        return (
                          <td key={d.iso} title={d.iso + ": " + ct + " on annual leave"} style={{ padding:"3px 0", minWidth:18, textAlign:"center", borderTop:"2px solid " + Y, background:bg, color:fg, borderLeft: isMS ? "2px solid " + Y : "none", fontSize:9, fontWeight:800 }}>{ct || "·"}</td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:11, border:"1px solid " + Y, padding:"10px 16px", fontSize:11, display:"flex", gap:14, flexWrap:"wrap", color:"#831843", marginBottom:14, alignItems:"center" }}>
                <span style={{ fontWeight:700 }}>Legend:</span>
                <span><span style={{ background:"#dbeafe", color:"#1e3a8a", padding:"2px 6px", borderRadius:3, fontWeight:700 }}>A</span> Annual</span>
                <span><span style={{ background:"#fed7aa", color:"#9a3412", padding:"2px 6px", borderRadius:3, fontWeight:700 }}>E</span> Emergency</span>
                <span><span style={{ background:"#fee2e2", color:"#7f1d1d", padding:"2px 6px", borderRadius:3, fontWeight:700 }}>S</span> Sick</span>
                <span><span style={{ background:"#fce7f3", color:"#BE185D", padding:"2px 6px", borderRadius:3, fontWeight:700 }}>M</span> Maternity</span>
                <span><span style={{ background:"#e5e7eb", color:"#374151", padding:"2px 6px", borderRadius:3, fontWeight:700 }}>U</span> Unpaid</span>
                <span><span style={{ background:"#fef3c7", padding:"2px 8px", borderRadius:3, border:"1px solid #fcd34d" }}>&nbsp;&nbsp;&nbsp;</span> Peak season month</span>
                <span><span style={{ background:"#dcfce7", color:"#14532d", padding:"2px 6px", borderRadius:3, fontWeight:800 }}>3</span> count under cap</span>
                <span><span style={{ background:"#fef3c7", color:"#78350f", padding:"2px 6px", borderRadius:3, fontWeight:800 }}>{maxLeave}</span> at cap</span>
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:11, border:"1px solid " + Y, padding:"14px 16px" }}>
                <div style={{ fontWeight:700, color:"#831843", marginBottom:4, fontSize:13 }}>Annual Leave Records — {br}
                  <span style={{ marginLeft:10, fontSize:11, color:"#F472B6", fontWeight:500 }}>({storeLeave.length} record{storeLeave.length !== 1 ? "s" : ""})</span>
                </div>
                <div style={{ fontSize:11, color:"#F472B6", marginBottom:8 }}>
                  Leave-days used = calendar days minus theoretical off-days (read from each tech's saved schedule for the months covered — O and R cells count as off; Sundays count as a fallback if no schedule has been generated yet).
                  {storeLeave.length > 0 && <span style={{ marginLeft:6 }}>Total: <strong style={{ color:"#831843" }}>{totalStats.used}</strong> leave days across {totalStats.cal} calendar days ({totalStats.off} off-days excluded).</span>}
                </div>
                {storeLeave.length === 0 ? (
                  <div style={{ fontSize:12, color:"#9ca3af", padding:"10px 0" }}>No annual leave records yet for this store. Use the form above to plan.</div>
                ) : (
                  <div style={{ maxHeight:300, overflow:"auto" }}>
                    {storeLeave.map(lv => {
                      const s2 = (isTechMode ? enriched : managers).find(x => x.ec === lv.ec);
                      const stats = computeLeaveDays(lv);
                      return (
                        <div key={lv._id} style={{ display:"grid", gridTemplateColumns:"1.6fr 1fr 1fr auto auto auto", gap:8, alignItems:"center", padding:"7px 0", borderBottom:"1px solid " + aA, fontSize:12 }}>
                          <div><strong>{s2 ? s2.name : "?"}</strong> · <span style={{ color:"#9ca3af", fontSize:11 }}>{lv.ec}</span></div>
                          <div>{lv.startDate}</div>
                          <div>{lv.endDate}</div>
                          <div title={stats.cal + " calendar day" + (stats.cal !== 1 ? "s" : "") + ", " + stats.off + " theoretical off-day" + (stats.off !== 1 ? "s" : "") + " excluded, " + stats.used + " leave day" + (stats.used !== 1 ? "s" : "") + " used"} style={{ color:"#831843", fontSize:11, textAlign:"right", lineHeight:1.2 }}>
                            <div style={{ fontWeight:700 }}>{stats.used} leave day{stats.used !== 1 ? "s" : ""}</div>
                            <div style={{ fontSize:9, color:"#9ca3af" }}>{stats.cal} cal.{stats.off > 0 ? " (−" + stats.off + " off)" : ""}</div>
                          </div>
                          {lv.emergency
                            ? <div title={lv.notes || ""}><span style={{ background:"#fed7aa", color:"#9a3412", padding:"2px 8px", borderRadius:5, fontSize:10, fontWeight:700 }}>⚠ EMERGENCY</span></div>
                            : <div></div>}
                          <button onClick={()=>removeLeave(lv._id)} style={{ background:"transparent", border:"none", color:"#dc2626", cursor:"pointer", fontSize:14 }}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── MANAGER SCHEDULE TAB (sub-tab of Scheduling) ── */}
        {tab==="scheduling" && schedSubTab==="managers" && (() => {
          if (!mgrSchedCycle) return <div style={{ padding:20, color:"#9ca3af" }}>Loading…</div>;
          if (!mgrSchedLoaded) return <div style={{ padding:20, color:"#9ca3af" }}>Loading manager schedule…</div>;

          const branch = mgrSchedBranch;
          const cycleStart = mgrSchedCycle;
          const ymKey = cycleStart.slice(0, 7);
          // Build manager source list: managers state + onboarding (SM/AM only) records
          const today = new Date().toISOString().slice(0, 10);
          const nowMs = Date.parse(today + "T00:00:00");
          const obMgrs = (obList || [])
            .filter(o => (o.position === "SM" || o.position === "AM") && o.branch && o.branch !== "Head Office" && o.branch !== "Other" && o.startDate)
            .map(o => {
              const fs = o.startDate > today;
              const ds = Math.floor((nowMs - Date.parse(o.startDate + "T00:00:00")) / 86400000);
              return { ec: o.ec || ("_OBM_" + (o._id || Math.random()).toString().slice(-6)), name: o.name, branch: o.branch, role: o.position, _onboarding: true, _startDate: o.startDate, _futureStart: fs, _recentlyStarted: !fs && ds >= 0 && ds <= 14 };
            });
          // Annotate managers with leftDate from offList for ghost overlay
          const mgrsWithOff = managers.map(m => {
            const off = (offList || []).find(o => o.ec === m.ec);
            return off ? { ...m, leftDate: off.leftDate, offRec: off } : m;
          });
          const allMgrs = [...mgrsWithOff, ...obMgrs];
          const mgrLeaves = (leaveRecs || []).filter(L => allMgrs.some(m => m.ec === L.ec));

          // Build the structural skeleton (dates, manager filter, weeksMap, etc.).
          // We always run mgrSched once for that — but the GRID inside it is the
          // freshly auto-generated one. We only USE that grid when the user
          // explicitly clicks Generate; otherwise we render from mgrSchedDraft.
          // Filter requests to this branch and cycle window only.
          const cycleEndStr = (() => {
            const cs = new Date(cycleStart + "T00:00:00");
            const ed = new Date(cs.getFullYear(), cs.getMonth() + 1, 24);
            return ed.getFullYear() + "-" + String(ed.getMonth()+1).padStart(2,"0") + "-" + String(ed.getDate()).padStart(2,"0");
          })();
          const currentRequests = (mgrRequests || []).filter(r =>
            r && r.branch === branch && r.date >= cycleStart && r.date <= cycleEndStr
            && allMgrs.some(m => m.ec === r.ec)
          );
          let result = mgrSched(branch, cycleStart, allMgrs, mgrLeaves, currentRequests, mgrPriorCtx);
          const haveDraft = !!mgrSchedDraft;
          if (haveDraft) {
            const newGrid = JSON.parse(JSON.stringify(mgrSchedDraft));
            for (const m of result.managers) {
              if (!newGrid[m.ec]) newGrid[m.ec] = result.grid[m.ec] || {};
              else {
                for (const x of result.dates) {
                  const cur = result.grid[m.ec] && result.grid[m.ec][x.d];
                  if (cur === "L" || cur === "X") newGrid[m.ec][x.d] = cur;
                  else if (newGrid[m.ec][x.d] === "L") newGrid[m.ec][x.d] = null;
                }
                for (const x of result.dates) if (newGrid[m.ec][x.d] == null) newGrid[m.ec][x.d] = "W";
              }
            }
            for (const ec of Object.keys(newGrid)) if (!result.managers.find(m => m.ec === ec)) delete newGrid[ec];
            result = { ...result, grid: newGrid, _loadedFromSaved: true };
            // Recompute dayTotals + conflicts from merged grid
            const newDT = {};
            for (const x of result.dates) newDT[x.d] = { dow: x.dow, working: 0, off: 0, leave: 0 };
            for (const m of result.managers) for (const x of result.dates) {
              const v = newGrid[m.ec] && newGrid[m.ec][x.d];
              if (v === "W" || v === "E") newDT[x.d].working++;
              else if (v === "O" || v === "R") newDT[x.d].off++;
              else if (v === "L") newDT[x.d].leave++;
            }
            result.dayTotals = newDT;
            const newConflicts = [];
            const dows = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
            for (const x of result.dates) {
              const w = newDT[x.d].working;
              if (w < 2) newConflicts.push({ type:"understaffed", msg: x.d + " " + dows[x.dow] + ": " + w + " manager" + (w===1?"":"s") + " working, need at least 2", severity:"high" });
            }
            for (const m of result.managers) {
              let run = 0, rs = -1;
              for (let i = 0; i < result.dates.length; i++) {
                const v = newGrid[m.ec] && newGrid[m.ec][result.dates[i].d];
                if (v === "W" || v === "E") { if (run === 0) rs = i; run++; if (run >= 7) { newConflicts.push({ type:"consecutive", msg: m.name + ": 7+ consecutive working days starting " + result.dates[rs].d, severity:"high" }); break; } } else run = 0;
              }
            }
            // Cross-month rollover re-check on the merged grid
            const wkOrderM   = result.weekOrder || [];
            const wkMapM     = result.weeksMap  || {};
            const leadingWkM  = wkOrderM[0];
            const trailingWkM = wkOrderM[wkOrderM.length - 1];
            const isLeadingPartialM  = !!(leadingWkM  && wkMapM[leadingWkM]  && wkMapM[leadingWkM].length  < 7);
            const isTrailingPartialM = !!(trailingWkM && wkMapM[trailingWkM] && wkMapM[trailingWkM].length < 7 && trailingWkM !== leadingWkM);
            const countOffsInWeek = (mEc, wk) => {
              let n = 0;
              for (const x of (wkMapM[wk] || [])) {
                const v = newGrid[mEc] && newGrid[mEc][x.d];
                if (v === "O" || v === "R" || v === "L") n++;
              }
              return n;
            };
            if (isLeadingPartialM) {
              for (const m of result.managers) {
                const carry = +(mgrPriorCtx.priorOffs && mgrPriorCtx.priorOffs[m.ec]) || 0;
                const inCycle = countOffsInWeek(m.ec, leadingWkM);
                if (inCycle + carry > 2) {
                  newConflicts.push({ type:"rollover_overlimit", msg: m.name + " has " + (inCycle + carry) + " off-days in the leading rollover week (" + inCycle + " this cycle + " + carry + " prior) — over the 2-cap", severity:"high", ec: m.ec, week: leadingWkM });
                }
              }
              if (mgrPriorCtx.priorMissing) {
                newConflicts.push({ type:"prior_missing", msg: "Prior month's manager schedule not generated yet — the leading rollover week's 2-off cap can't be enforced across the boundary. Generate the prior cycle first for full coverage.", severity:"medium" });
              }
            }
            if (isTrailingPartialM) {
              for (const m of result.managers) {
                const carry = +(mgrPriorCtx.nextOffs && mgrPriorCtx.nextOffs[m.ec]) || 0;
                const inCycle = countOffsInWeek(m.ec, trailingWkM);
                if (inCycle + carry > 2) {
                  newConflicts.push({ type:"rollover_overlimit", msg: m.name + " has " + (inCycle + carry) + " off-days in the closing rollover week (" + inCycle + " this cycle + " + carry + " next) — over the 2-cap", severity:"high", ec: m.ec, week: trailingWkM });
                }
              }
              if (mgrPriorCtx.nextMissing) {
                newConflicts.push({ type:"next_missing", msg: "Next month's manager schedule not generated yet — the closing rollover week's 2-off cap is provisional. When you generate the next cycle, that boundary will be re-checked.", severity:"medium" });
              }
            }
            result.conflicts = newConflicts;
          } else {
            // No draft yet — show an empty grid + Generate CTA. We keep the
            // structural fields (dates, managers, weeksMap, weekOrder) but
            // wipe the auto-generated grid and counters so cells render blank.
            const emptyGrid = {};
            for (const mm of result.managers) emptyGrid[mm.ec] = {};
            const emptyTotals = {};
            for (const x of result.dates) emptyTotals[x.d] = { dow: x.dow, working: 0, off: 0, leave: 0 };
            result = { ...result, grid: emptyGrid, dayTotals: emptyTotals, conflicts: [] };
          }

          const editKey = branch + "|" + ymKey;
          const histArr = mgrSchedHist[editKey] || [];

          // Build day → ISO-week lookup from the result for same-week drag enforcement
          const dayWk = {};
          if (result.weeksMap) {
            for (const wk of Object.keys(result.weeksMap)) {
              for (const x of result.weeksMap[wk]) dayWk[x.d] = wk;
            }
          }

          // Drag-swap two days for the same manager (within the same ISO Mon–Sun week only)
          const dragSwap = async (ec, fromD, toD) => {
            if (fromD === toD) return;
            // HARD: same-week only
            if (dayWk[fromD] && dayWk[toD] && dayWk[fromD] !== dayWk[toD]) {
              alert("You can only drag off-days within the same week (Mon–Sun).");
              return;
            }
            const a = (result.grid[ec] && result.grid[ec][fromD]) || "W";
            const b = (result.grid[ec] && result.grid[ec][toD])   || "W";
            if (a === b) return;
            if (a === "L" || a === "R" || a === "X" || b === "L" || b === "R" || b === "X") {
              alert("Cannot drag onto leave (LV), request (REQ), or pre-start (—) cells.");
              return;
            }
            // HARD: cross-month rollover cap. If the swap touches a partial
            // ISO week (leading OR trailing), the carry-over from the
            // adjacent month plus the new in-cycle offs in that week mustn't
            // exceed 2. Same-week O↔W swap doesn't change the per-week count.
            const dragWk = dayWk[toD] || dayWk[fromD];
            const wkDays = (result.weeksMap && result.weeksMap[dragWk]) || [];
            if (dragWk && wkDays.length < 7) {
              // Determine whether this partial is the leading (use priorOffs)
              // or the trailing (use nextOffs) one.
              const wkOrderArr = result.weekOrder || [];
              const isLeading  = wkOrderArr[0] === dragWk;
              const isTrailing = wkOrderArr[wkOrderArr.length - 1] === dragWk && !isLeading;
              const carrySrc = isLeading ? mgrPriorCtx.priorOffs : (isTrailing ? mgrPriorCtx.nextOffs : null);
              const carryLabel = isLeading ? "prior month" : (isTrailing ? "next month" : "");
              const carry = +((carrySrc && carrySrc[ec]) || 0);
              if (carry > 0) {
                let curOff = 0;
                for (const x of wkDays) {
                  const v = result.grid[ec] && result.grid[ec][x.d];
                  if (v === "O" || v === "R" || v === "L") curOff++;
                }
                const wasOff  = (a === "O" || a === "E");
                const willOff = (b === "O" || b === "E");
                const fromInWeek = (dayWk[fromD] === dragWk);
                const toInWeek   = (dayWk[toD]   === dragWk);
                let delta = 0;
                if (fromInWeek) delta += (willOff ? 1 : 0) - (wasOff ? 1 : 0);
                if (toInWeek)   delta += ((a === "O" || a === "E") ? 1 : 0) - ((b === "O" || b === "E") ? 1 : 0);
                if (curOff + delta + carry > 2) {
                  alert("Blocked — that swap would put " + (curOff + delta + carry) + " off-days in the rollover week (this cycle + " + carryLabel + "). The 2-cap must hold across the boundary.");
                  return;
                }
              }
            }
            const newGrid = JSON.parse(JSON.stringify(result.grid));
            newGrid[ec][fromD] = b; newGrid[ec][toD] = a;
            // Coverage check
            const checkD = (d) => {
              let w = 0;
              for (const m of result.managers) {
                const v = (m.ec === ec) ? (newGrid[m.ec] && newGrid[m.ec][d]) : (result.grid[m.ec] && result.grid[m.ec][d]);
                if (v === "W" || v === "E") w++;
              }
              return w;
            };
            const warns = [];
            const dowsW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
            for (const d2 of [fromD, toD]) {
              const w = checkD(d2);
              if (w < 2) {
                const dt = result.dates.find(x => x.d === d2);
                warns.push("• " + d2 + " " + (dt ? dowsW[dt.dow] : "") + ": " + w + " manager" + (w===1?"":"s") + " would be working");
              }
            }
            // Push current grid to history (in-memory only — for undo)
            setMgrSchedHist(h => {
              const next = { ...h };
              const arr = (next[editKey] || []).slice(-49);
              arr.push(JSON.parse(JSON.stringify(result.grid)));
              next[editKey] = arr;
              return next;
            });
            // Apply locally to draft — DOES NOT touch the DB. Save explicitly.
            setMgrSchedDraft(newGrid);
            setMgrSchedDirty(true);
            if (warns.length > 0) {
              setTimeout(() => alert("⚠ Coverage warning — below 2 managers on shift:\n\n" + warns.join("\n") + "\n\nSwap applied (not saved yet — click Save). Use Undo to revert."), 50);
            }
          };
          const toggleReq = (ec, d) => {
            const cur = (result.grid[ec] && result.grid[ec][d]) || "W";
            if (cur !== "O" && cur !== "R" && cur !== "E") {
              alert("Only Off (OFF) cells can be cycled. Drag to make it Off first, then double-click to cycle OFF → REQ → EXT.");
              return;
            }
            const next = cur === "O" ? "R" : cur === "R" ? "E" : "O";
            const newGrid = JSON.parse(JSON.stringify(result.grid));
            if (!newGrid[ec]) newGrid[ec] = {};
            newGrid[ec][d] = next;
            setMgrSchedHist(h => {
              const updated = { ...h };
              const arr = (updated[editKey] || []).slice(-49);
              arr.push(JSON.parse(JSON.stringify(result.grid)));
              updated[editKey] = arr;
              return updated;
            });
            setMgrSchedDraft(newGrid);
            setMgrSchedDirty(true);
          };
          const undo = () => {
            const arr = mgrSchedHist[editKey] || [];
            if (arr.length === 0) return;
            const last = arr[arr.length - 1];
            setMgrSchedDraft(JSON.parse(JSON.stringify(last)));
            setMgrSchedDirty(true);
            setMgrSchedHist(h => {
              const updated = { ...h };
              updated[editKey] = (h[editKey] || []).slice(0, -1);
              return updated;
            });
          };

          // Generate fresh schedule into the draft (does not save).
          const generate = () => {
            if (mgrSchedDirty) {
              if (!window.confirm("This will replace the current draft with a freshly generated schedule. Discard your unsaved edits?")) return;
            }
            const fresh = mgrSched(branch, cycleStart, allMgrs, mgrLeaves, currentRequests, mgrPriorCtx);
            setMgrSchedDraft(JSON.parse(JSON.stringify(fresh.grid)));
            setMgrSchedDirty(true);
            setMgrSchedHist(h => { const n = { ...h }; delete n[editKey]; return n; });
          };

          // Save the current draft to the DB.
          const saveDraft = async () => {
            if (!mgrSchedDraft) { alert("Nothing to save — click Generate first."); return; }
            setMgrSchedSaving(true);
            try {
              const v = await window.BOA_DB.saveSchedule(branch, ymKey, mgrSchedDraft, true);
              setMgrSchedSaved(mgrSchedDraft);
              setMgrSchedSavedAt((v && v.savedAt) || new Date().toISOString());
              setMgrSchedDirty(false);
              logActivity("Saved manager schedule", branch + " · " + ymKey, "");
            } catch (e) {
              alert("Could not save: " + (e.message || e));
            } finally {
              setMgrSchedSaving(false);
            }
          };

          // Discard local changes — revert to last-saved (or empty if no save).
          const discardEdits = () => {
            if (!mgrSchedDirty) return;
            if (!window.confirm("Discard unsaved changes and revert to the last saved version?")) return;
            setMgrSchedDraft(mgrSchedSaved ? JSON.parse(JSON.stringify(mgrSchedSaved)) : null);
            setMgrSchedDirty(false);
            setMgrSchedHist(h => { const n = { ...h }; delete n[editKey]; return n; });
          };

          // Guarded versions of branch/cycle change — warn if unsaved.
          const tryChangeBranch = (b) => {
            if (mgrSchedDirty && !window.confirm("You have unsaved changes to this manager schedule. Discard and switch store?")) return;
            setMgrSchedDirty(false);
            setMgrSchedBranch(b);
          };
          const tryShiftCycle = (delta) => {
            if (mgrSchedDirty && !window.confirm("You have unsaved changes to this manager schedule. Discard and change cycle?")) return;
            setMgrSchedDirty(false);
            let y = csObj.getFullYear(), mo = csObj.getMonth() + delta;
            while (mo < 0) { mo += 12; y--; }
            while (mo > 11) { mo -= 12; y++; }
            setMgrSchedCycle(y + "-" + String(mo+1).padStart(2,"0") + "-25");
          };

          // Visual constants
          const cellBg    = { W:"#dcfce7", O:"#FCE7F3", L:"#fde68a", R:"#fbcfe8", X:"#f3f4f6", E:"#6ee7b7" };
          const cellTxt   = { W:"W",       O:"OFF",     L:"LV",      R:"REQ",     X:"—",       E:"EXT" };
          const cellColor = { W:"#15803d", O:"#831843", L:"#92400e", R:"#831843", X:"#9ca3af", E:"#064e3b" };
          const dowsAbbr  = ["Su","Mo","Tu","We","Th","Fr","Sa"];
          const moNames   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const csObj = new Date(cycleStart + "T00:00:00");
          const ceObj = new Date(result.cycleEnd + "T00:00:00");
          const cycleLabel = csObj.getDate() + " " + moNames[csObj.getMonth()] + " " + csObj.getFullYear() + " → " + ceObj.getDate() + " " + moNames[ceObj.getMonth()] + " " + ceObj.getFullYear();
          // Sort managers SM-first, then by name
          const sortedMgrs = [...result.managers].sort((a,b) => (a.role==="SM"?0:1)-(b.role==="SM"?0:1) || (a.name||"").localeCompare(b.name||""));

          return (
            <div>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontFamily:"'Playfair Display',serif", fontSize:24, color:"#831843", fontWeight:700, marginBottom:4 }}>👔 Manager Schedule</div>
                <div style={{ fontSize:12, color:"#F472B6" }}>25th → 24th cycle. SM 8:00–17:00 with 2 weekend pairs off. AM 9:30–18:30 with 1 weekend pair off. Always ≥ 2 managers on shift; 2 off-days per full week; max 6 days in a row. Drag to swap days within a manager. Double-click an OFF cell to cycle OFF → REQ → EXT.</div>
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:11, padding:"12px 14px", border:"1px solid #FBCFE8", marginBottom:14, display:"flex", gap:14, alignItems:"center", flexWrap:"wrap" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:"#F472B6", letterSpacing:"0.06em" }}>STORE</label>
                  <select value={branch} onChange={e=>tryChangeBranch(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:"1px solid #FBCFE8", fontSize:13, background:"#fff", minWidth:160 }}>
                    {SALONS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6, background:"#FFFFFF", border:"1px solid #FBCFE8", borderRadius:8, padding:"4px 6px" }}>
                  <button onClick={()=>tryShiftCycle(-1)} style={{ background:"transparent", border:"none", color:"#831843", cursor:"pointer", fontSize:16, fontWeight:600, padding:"2px 8px" }} title="Previous cycle">‹</button>
                  <div style={{ fontSize:12, fontWeight:600, color:"#831843", minWidth:200, textAlign:"center" }}>{cycleLabel}</div>
                  <button onClick={()=>tryShiftCycle(1)} style={{ background:"transparent", border:"none", color:"#831843", cursor:"pointer", fontSize:16, fontWeight:600, padding:"2px 8px" }} title="Next cycle">›</button>
                </div>
                <button onClick={generate}
                        title={mgrSchedDraft ? "Re-generate (replaces current draft)" : "Generate a fresh schedule"}
                        style={{ padding:"7px 14px", background: mgrSchedDraft ? "#FCE7F3" : "#BE185D", color: mgrSchedDraft ? "#831843" : "#fff", border:"1px solid #BE185D", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>
                  ✨ {mgrSchedDraft ? "Re-generate" : "Generate Schedule"}
                </button>
                <button onClick={saveDraft} disabled={mgrSchedSaving || !mgrSchedDirty}
                        style={{ padding:"7px 16px", background: mgrSchedDirty ? "#BE185D" : "#FBCFE8", color: mgrSchedDirty ? "#fff" : "#9F1A4F", border:"none", borderRadius:8, cursor: mgrSchedDirty ? "pointer" : "not-allowed", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>
                  {mgrSchedSaving ? "Saving…" : "💾 Save"}
                </button>
                {mgrSchedDirty && (
                  <button onClick={discardEdits} title="Revert to last saved version"
                          style={{ padding:"7px 12px", background:"#fff", color:"#831843", border:"1px solid #FBCFE8", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600 }}>
                    Discard
                  </button>
                )}
                {histArr.length > 0 && (
                  <button onClick={undo} style={{ padding:"7px 14px", background:"#fef3c7", color:"#78350f", border:"1px solid #fbbf24", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600 }}>↺ Undo ({histArr.length})</button>
                )}
                {/* Save status indicator */}
                {mgrSchedDirty
                  ? <span style={{ fontSize:11, color:"#b45309", fontWeight:700 }}>● Unsaved changes</span>
                  : (mgrSchedSavedAt && mgrSchedDraft)
                    ? <span style={{ fontSize:11, color:"#15803d", fontStyle:"italic" }}>✓ Saved {new Date(mgrSchedSavedAt).toLocaleString()}</span>
                    : null
                }
                <button
                  onClick={async () => {
                    if (!mgrSchedSaved) {
                      alert("Nothing to delete — this period has no saved schedule yet.");
                      return;
                    }
                    if (!window.confirm("Delete the saved manager schedule for " + branch + " (" + cycleLabel + ")?\n\nIt moves to the trash for 7 days — you can restore it from the Trash button until it expires.")) return;
                    try {
                      await window.BOA_DB.deleteSchedule(branch, ymKey, true);
                      setMgrSchedSaved(null);
                      setMgrSchedDraft(null);
                      setMgrSchedSavedAt(null);
                      setMgrSchedDirty(false);
                      setMgrSchedHist(h => { const n = { ...h }; delete n[editKey]; return n; });
                      setMgrSchedTick(t => t + 1);
                      setMgrTrashTick(t => t + 1);
                      logActivity("Deleted manager schedule", branch + " · " + ymKey, "Moved to 7-day trash");
                    } catch (e) {
                      alert("Could not delete schedule: " + (e.message || e));
                    }
                  }}
                  title="Move this saved schedule to trash (kept for 7 days)"
                  style={{ padding:"7px 14px", background:"#fee2e2", color:"#7f1d1d", border:"1px solid #fca5a5", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600 }}>🗑 Delete schedule</button>
                <button
                  onClick={() => setMgrTrashOpen(true)}
                  title="Recently deleted schedules (kept for 7 days)"
                  style={{ padding:"7px 14px", background:"#f3f4f6", color:"#374151", border:"1px solid #d1d5db", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600 }}>🗂 Trash{mgrTrash.length > 0 ? " (" + mgrTrash.length + ")" : ""}</button>
                <div style={{ flex:1 }} />
                <div style={{ display:"flex", gap:8, fontSize:11, color:"#831843", flexWrap:"wrap" }}>
                  {[
                    { l:"Working", bg:"#dcfce7", c:"#15803d" },
                    { l:"Off",     bg:"#FCE7F3", c:"#831843" },
                    { l:"Leave",   bg:"#fde68a", c:"#92400e" },
                    { l:"Request", bg:"#fbcfe8", c:"#831843" },
                    { l:"Extra",   bg:"#6ee7b7", c:"#064e3b" }
                  ].map(c => <span key={c.l} style={{ display:"inline-flex", alignItems:"center", gap:4 }}><span style={{ display:"inline-block", width:10, height:10, background:c.bg, borderRadius:2 }} /> {c.l}</span>)}
                </div>
              </div>

              {/* Conflicts panel */}
              {result.conflicts && result.conflicts.length > 0 && (
                <div style={{ background:"#fee2e2", border:"1px solid #fca5a5", borderRadius:11, padding:"12px 14px", marginBottom:14 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#7f1d1d", marginBottom:6 }}>⚠ {result.conflicts.length} conflict{result.conflicts.length===1?"":"s"}</div>
                  <ul style={{ margin:0, paddingLeft:20, fontSize:12, color:"#7f1d1d", lineHeight:1.6 }}>
                    {result.conflicts.slice(0, 12).map((c, i) => (
                      <li key={i} style={{ color: c.severity === "high" ? "#7f1d1d" : "#92400e" }}>{c.msg}</li>
                    ))}
                    {result.conflicts.length > 12 && <li style={{ fontStyle:"italic" }}>…and {result.conflicts.length - 12} more</li>}
                  </ul>
                </div>
              )}

              {/* ── Off-day requests panel ── */}
              <div style={{ background:"#FFFFFF", border:"1px solid #FBCFE8", borderRadius:11, padding:"12px 14px", marginBottom:14 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: currentRequests.length ? 10 : 0, gap:12, flexWrap:"wrap" }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:"#831843" }}>📝 Off-day requests for this cycle</div>
                    <div style={{ fontSize:11, color:"#9ca3af", marginTop:2 }}>The generator counts requests as one of the 2 weekly offs and respects the 2-cap. Requests can override the guaranteed weekend pair.</div>
                  </div>
                  <button onClick={() => setMgrReqModal({ ec: (sortedMgrs[0] && sortedMgrs[0].ec) || "", date: cycleStart, note: "" })}
                          disabled={sortedMgrs.length === 0}
                          style={{ padding:"7px 14px", background: sortedMgrs.length ? "#BE185D" : "#FBCFE8", color: sortedMgrs.length ? "#fff" : "#9F1A4F", border:"none", borderRadius:8, cursor: sortedMgrs.length ? "pointer" : "not-allowed", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>
                    + Request day off
                  </button>
                </div>
                {currentRequests.length > 0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {currentRequests.map(r => {
                      const mg = result.managers.find(m => m.ec === r.ec);
                      const nm = (mg && mg.name) || r.name || r.ec;
                      const dt = new Date(r.date + "T00:00:00");
                      const dowAbbr = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dt.getDay()];
                      return (
                        <div key={r.id} style={{ display:"inline-flex", alignItems:"center", gap:8, background:"#FCE7F3", border:"1px solid #FBCFE8", borderRadius:20, padding:"5px 12px", fontSize:11 }}>
                          <span style={{ fontWeight:700, color:"#831843" }}>{nm}</span>
                          <span style={{ color:"#831843" }}>· {r.date} ({dowAbbr})</span>
                          {r.note && <span style={{ color:"#9ca3af", fontStyle:"italic" }}>· "{r.note}"</span>}
                          <button
                            onClick={async () => {
                              if (!window.confirm("Remove the off-day request for " + nm + " on " + r.date + "?")) return;
                              try {
                                const next = (mgrRequests || []).filter(x => x.id !== r.id);
                                await window.BOA_DB.saveMgrRequests(next);
                                setMgrRequests(next);
                                setMgrReqTick(t => t + 1);
                              } catch (e) { alert("Could not remove: " + (e.message || e)); }
                            }}
                            title="Remove this request"
                            style={{ background:"transparent", border:"none", color:"#9F1A4F", cursor:"pointer", fontSize:14, fontWeight:700, lineHeight:1, padding:"0 4px" }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Empty state — no draft yet */}
              {!mgrSchedDraft && (
                <div style={{ background:"#FFFFFF", borderRadius:11, border:"1px dashed #FBCFE8", padding:"50px 24px", marginBottom:14, textAlign:"center" }}>
                  <div style={{ fontSize:48, marginBottom:8 }}>👔</div>
                  <div style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:700, color:"#831843", marginBottom:6 }}>No schedule for {branch}</div>
                  <div style={{ fontSize:13, color:"#9ca3af", marginBottom:18 }}>{cycleLabel}<br />Click below to generate a fresh schedule. You'll need to click <strong>Save</strong> to keep it.</div>
                  <button onClick={generate} style={{ padding:"11px 28px", background:"#BE185D", color:"#fff", border:"none", borderRadius:9, cursor:"pointer", fontFamily:"inherit", fontSize:14, fontWeight:700, boxShadow:"0 6px 18px rgba(190,24,93,0.3)" }}>
                    ✨ Generate Schedule
                  </button>
                </div>
              )}

              {/* Schedule grid */}
              {mgrSchedDraft && <div style={{ background:"#FFFFFF", borderRadius:11, border:"1px solid #FBCFE8", overflow:"auto" }}>
                <table style={{ borderCollapse:"separate", borderSpacing:0, minWidth:"100%", fontSize:11 }}>
                  <thead>
                    <tr>
                      <th style={{ position:"sticky", left:0, top:0, background:"#FDEEF5", padding:"8px 10px", borderBottom:"2px solid #FBCFE8", borderRight:"2px solid #FBCFE8", fontSize:10, color:"#831843", letterSpacing:"0.05em", textAlign:"left", zIndex:3, minWidth:200 }}>MANAGER</th>
                      {result.dates.map((dy, di) => {
                        const isMon = dy.dow === 1;
                        return (
                          <th key={dy.d} style={{ padding:"4px 4px", fontSize:9, color:"#831843", textAlign:"center", borderBottom:"2px solid #FBCFE8", borderLeft: isMon ? "3px solid #E84B9B" : "1px solid #FCE7F3", background:"#FDEEF5", minWidth:38 }}>
                            <div style={{ fontSize:10, fontWeight:800 }}>{dy.d.slice(8)}</div>
                            <div style={{ fontSize:8, fontWeight:500, opacity:0.7 }}>{dowsAbbr[dy.dow]}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMgrs.length === 0 && (
                      <tr><td colSpan={result.dates.length + 1} style={{ padding:30, textAlign:"center", color:"#9ca3af", fontStyle:"italic" }}>No managers at {branch}.</td></tr>
                    )}
                    {sortedMgrs.map(mg => (
                      <tr key={mg.ec}>
                        <td style={{ position:"sticky", left:0, background: mg._offGhost ? "#f9fafb" : (mg._obStarting ? "#fefce8" : "#fff"), padding:"6px 10px", borderBottom:"1px solid #FCE7F3", borderRight:"2px solid #FBCFE8", zIndex:2, minWidth:200, opacity: mg._offGhost ? 0.55 : 1 }}>
                          <div style={{ fontSize:12, fontWeight:700, color: mg._offGhost ? "#9ca3af" : "#831843", textDecoration: mg._offGhost ? "line-through" : "none", fontStyle: mg._offGhost ? "italic" : "normal" }}>{mg.name}</div>
                          {mg._offGhost
                            ? <div style={{ fontSize:9, color:"#9ca3af", fontStyle:"italic", marginTop:1 }}>Left {mg._offLeftDate}{mg._offReason ? " · " + mg._offReason : ""}</div>
                            : mg._obStarting
                              ? <div style={{ fontSize:9, color:"#854d0e", fontWeight:700, marginTop:1, fontStyle:"italic" }}>🌱 starts {mg._obStartDate}</div>
                              : <div style={{ fontSize:9, color:"#BE185D", marginTop:1 }}>{mg.role === "SM" ? "Store Manager · 8:00–17:00" : "Assistant Manager · 9:30–18:30"}</div>
                          }
                        </td>
                        {result.dates.map((dy, di) => {
                          const v = (result.grid[mg.ec] && result.grid[mg.ec][dy.d]) || "";
                          const bg = cellBg[v] || "#fff";
                          const fg = cellColor[v] || "#9ca3af";
                          const txt = cellTxt[v] || "";
                          const isMon = dy.dow === 1;
                          const draggable = (v === "W" || v === "O" || v === "E");
                          return (
                            <td key={dy.d}
                              draggable={draggable}
                              onDragStart={(e) => { e.dataTransfer.setData("text/plain", JSON.stringify({ ec: mg.ec, d: dy.d })); }}
                              onDragOver={(e) => { if (draggable) e.preventDefault(); }}
                              onDrop={(e) => {
                                e.preventDefault();
                                try {
                                  const data = JSON.parse(e.dataTransfer.getData("text/plain"));
                                  if (data.ec === mg.ec && data.d !== dy.d) dragSwap(mg.ec, data.d, dy.d);
                                } catch (_) {}
                              }}
                              onDoubleClick={() => toggleReq(mg.ec, dy.d)}
                              title={dy.d + ": " + (txt || "—") + (draggable ? " · drag to swap, double-click OFF→REQ→EXT" : "")}
                              style={{ padding:"4px 0", textAlign:"center", borderBottom:"1px solid #FCE7F3", borderLeft: isMon ? "3px solid #E84B9B" : "1px solid #FCE7F3", background: bg, color: fg, fontSize:10, fontWeight:700, cursor: draggable ? "grab" : "default", userSelect:"none" }}>
                              {txt}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ position:"sticky", left:0, background:"#FDEEF5", padding:"6px 10px", fontSize:10, fontWeight:700, color:"#831843", letterSpacing:"0.04em", borderTop:"2px solid #FBCFE8", borderRight:"2px solid #FBCFE8", zIndex:2 }}>WORKING TOTAL</td>
                      {result.dates.map((dy, di) => {
                        const w = result.dayTotals[dy.d] ? result.dayTotals[dy.d].working : 0;
                        const understaffed = w < 2;
                        const isMon = dy.dow === 1;
                        return (
                          <td key={dy.d} style={{ padding:"6px 0", textAlign:"center", borderTop:"2px solid #FBCFE8", borderLeft: isMon ? "3px solid #E84B9B" : "1px solid #FCE7F3", background: understaffed ? "#fee2e2" : "#FDEEF5", color: understaffed ? "#7f1d1d" : "#831843", fontSize:11, fontWeight:800 }}>{w}</td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>}

              {/* ── Add-request modal ── */}
              {mgrReqModal && (
                <div onClick={() => setMgrReqModal(null)}
                     style={{ position:"fixed", inset:0, background:"rgba(17,24,39,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
                  <div onClick={(e) => e.stopPropagation()}
                       style={{ background:"#fff", borderRadius:14, padding:"22px 24px", width:"94%", maxWidth:440, boxShadow:"0 30px 90px rgba(0,0,0,0.3)" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                      <div style={{ fontFamily:"'Playfair Display',serif", fontSize:20, color:"#831843", fontWeight:700 }}>📝 Request day off</div>
                      <button onClick={() => setMgrReqModal(null)}
                              style={{ background:"transparent", border:"none", color:"#9ca3af", cursor:"pointer", fontSize:22, lineHeight:1 }}>×</button>
                    </div>
                    <div style={{ fontSize:11, color:"#9ca3af", marginBottom:14 }}>For {branch} · {cycleLabel}</div>

                    <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#831843", letterSpacing:"0.04em", marginBottom:4 }}>MANAGER</label>
                    <select value={mgrReqModal.ec}
                            onChange={(e) => setMgrReqModal({ ...mgrReqModal, ec: e.target.value })}
                            style={{ width:"100%", padding:"9px 11px", borderRadius:8, border:"1px solid #FBCFE8", fontSize:13, background:"#fff", marginBottom:12 }}>
                      {sortedMgrs.map(m => <option key={m.ec} value={m.ec}>{m.name} ({m.role})</option>)}
                    </select>

                    <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#831843", letterSpacing:"0.04em", marginBottom:4 }}>DATE</label>
                    <input type="date" value={mgrReqModal.date}
                           min={cycleStart} max={cycleEndStr}
                           onChange={(e) => setMgrReqModal({ ...mgrReqModal, date: e.target.value })}
                           style={{ width:"100%", padding:"9px 11px", borderRadius:8, border:"1px solid #FBCFE8", fontSize:13, background:"#fff", marginBottom:12, fontFamily:"inherit" }} />

                    <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#831843", letterSpacing:"0.04em", marginBottom:4 }}>NOTE (OPTIONAL)</label>
                    <input type="text" value={mgrReqModal.note} placeholder="e.g. doctor's appointment"
                           onChange={(e) => setMgrReqModal({ ...mgrReqModal, note: e.target.value })}
                           style={{ width:"100%", padding:"9px 11px", borderRadius:8, border:"1px solid #FBCFE8", fontSize:13, background:"#fff", marginBottom:18, fontFamily:"inherit" }} />

                    <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                      <button onClick={() => setMgrReqModal(null)}
                              style={{ padding:"8px 16px", background:"#fff", color:"#831843", border:"1px solid #FBCFE8", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600 }}>Cancel</button>
                      <button
                        onClick={async () => {
                          if (!mgrReqModal.ec || !mgrReqModal.date) { alert("Pick a manager and a date."); return; }
                          if (mgrReqModal.date < cycleStart || mgrReqModal.date > cycleEndStr) { alert("Date must fall within the current cycle."); return; }
                          // Block duplicates (same ec + date already requested)
                          if ((mgrRequests || []).some(r => r.ec === mgrReqModal.ec && r.date === mgrReqModal.date)) {
                            alert("That manager already has a request for that date.");
                            return;
                          }
                          // HARD cap check: combined offs in target ISO week (incl. existing requests, leaves, and any saved schedule cells) must allow another off.
                          const wkOf = (ymd) => {
                            const x = new Date(ymd + "T00:00:00");
                            const dn = (x.getDay()+6) % 7;
                            x.setDate(x.getDate() - dn + 3);
                            const ff = new Date(x.getFullYear(), 0, 4);
                            const fdn = (ff.getDay()+6) % 7;
                            ff.setDate(ff.getDate() - fdn + 3);
                            const wk = 1 + Math.round((x - ff) / (7*86400000));
                            return x.getFullYear() + "-W" + String(wk).padStart(2,"0");
                          };
                          const targetWk = wkOf(mgrReqModal.date);
                          const sameWkRequests = (mgrRequests || []).filter(r => r.ec === mgrReqModal.ec && wkOf(r.date) === targetWk).length;
                          // Count leave + saved-schedule offs already in this week for this manager
                          let savedOffs = 0;
                          if (mgrSchedDraft && mgrSchedDraft[mgrReqModal.ec]) {
                            for (const day of Object.keys(mgrSchedDraft[mgrReqModal.ec])) {
                              if (wkOf(day) !== targetWk) continue;
                              const v = mgrSchedDraft[mgrReqModal.ec][day];
                              if (v === "L") savedOffs++;
                            }
                          }
                          if (sameWkRequests + savedOffs >= 2) {
                            alert("Blocked — that manager already has " + (sameWkRequests + savedOffs) + " off-day(s) in that week. The 2-offs-per-week cap is hard.");
                            return;
                          }
                          const mg = sortedMgrs.find(m => m.ec === mgrReqModal.ec);
                          const newReq = {
                            id: "req_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7),
                            ec: mgrReqModal.ec,
                            name: mg ? mg.name : "",
                            branch,
                            date: mgrReqModal.date,
                            note: mgrReqModal.note || "",
                            addedAt: new Date().toISOString()
                          };
                          try {
                            const next = [...(mgrRequests || []), newReq];
                            await window.BOA_DB.saveMgrRequests(next);
                            setMgrRequests(next);
                            setMgrReqModal(null);
                            setMgrReqTick(t => t + 1);
                          } catch (e) { alert("Could not save: " + (e.message || e)); }
                        }}
                        style={{ padding:"8px 18px", background:"#BE185D", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>
                        Save request
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Trash modal: deleted manager schedules (7-day window) ── */}
              {mgrTrashOpen && (
                <div onClick={() => setMgrTrashOpen(false)}
                     style={{ position:"fixed", inset:0, background:"rgba(17,24,39,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
                  <div onClick={(e) => e.stopPropagation()}
                       style={{ background:"#fff", borderRadius:14, padding:"22px 24px", maxWidth:640, width:"94%", maxHeight:"86vh", overflow:"auto", boxShadow:"0 30px 90px rgba(0,0,0,0.3)" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                      <div>
                        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:20, color:"#831843", fontWeight:700 }}>🗂 Schedule trash</div>
                        <div style={{ fontSize:11, color:"#9ca3af", marginTop:2 }}>Deleted manager schedules are kept for 7 days, then permanently removed.</div>
                      </div>
                      <button onClick={() => setMgrTrashOpen(false)}
                              style={{ background:"transparent", border:"none", color:"#9ca3af", cursor:"pointer", fontSize:22, lineHeight:1 }}>×</button>
                    </div>
                    {(() => {
                      const moNamesT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                      const fmtYm = (ym) => { const p = String(ym||"").split("-"); const m = +p[1]; return (moNamesT[m-1] || ym) + " " + p[0]; };
                      const fmtTs = (iso) => { try { return new Date(iso).toLocaleString("en-ZA", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }); } catch(_) { return iso; } };
                      const daysLeft = (iso) => { const ms = Date.parse(iso) - Date.now(); return Math.max(0, Math.ceil(ms / 86400000)); };
                      if (!mgrTrash || mgrTrash.length === 0) {
                        return <div style={{ padding:"30px 8px", textAlign:"center", color:"#9ca3af", fontStyle:"italic", fontSize:13 }}>No deleted schedules. When you delete one it appears here for 7 days.</div>;
                      }
                      return (
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          {mgrTrash.map(t => (
                            <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:"#FDEEF5", border:"1px solid #FBCFE8", borderRadius:9 }}>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:700, color:"#831843" }}>{t.branch} · {fmtYm(t.ym)}</div>
                                <div style={{ fontSize:10, color:"#9ca3af", marginTop:2 }}>Deleted {fmtTs(t.deletedAt)} · expires in {daysLeft(t.expiresAt)} day{daysLeft(t.expiresAt)===1?"":"s"}</div>
                              </div>
                              <button
                                onClick={async () => {
                                  if (!window.confirm("Restore the manager schedule for " + t.branch + " (" + fmtYm(t.ym) + ")?\n\nThis will overwrite any current saved schedule for that period.")) return;
                                  try {
                                    await window.BOA_DB.restoreSchedule(t.id);
                                    setMgrTrashTick(x => x + 1);
                                    if (t.branch === branch && t.ym === ymKey) {
                                      setMgrSchedTick(x => x + 1);
                                    }
                                    logActivity("Restored manager schedule", t.branch + " · " + t.ym, "From trash");
                                    alert("Restored " + t.branch + " · " + fmtYm(t.ym) + ".");
                                  } catch (e) { alert("Could not restore: " + (e.message || e)); }
                                }}
                                style={{ padding:"6px 12px", background:"#dcfce7", color:"#14532d", border:"1px solid #86efac", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 }}>↺ Restore</button>
                              <button
                                onClick={async () => {
                                  if (!window.confirm("Permanently delete the trashed schedule for " + t.branch + " (" + fmtYm(t.ym) + ")?\n\nThis cannot be undone.")) return;
                                  try {
                                    await window.BOA_DB.purgeDeletedSchedule(t.id);
                                    setMgrTrashTick(x => x + 1);
                                  } catch (e) { alert("Could not purge: " + (e.message || e)); }
                                }}
                                style={{ padding:"6px 10px", background:"#fee2e2", color:"#7f1d1d", border:"1px solid #fca5a5", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 }}>Purge</button>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── ACTIVITY LOG ── */}
        {tab==="activity" && (() => {
          const whoOpts    = ["All", ...Array.from(new Set(activityRows.map(r => r.who).filter(Boolean)))];
          const actionOpts = ["All", ...Array.from(new Set(activityRows.map(r => r.action).filter(Boolean))).sort()];
          const filtered = activityRows.filter(r =>
            (activityFWho === "All"    || r.who    === activityFWho) &&
            (activityFAction === "All" || r.action === activityFAction)
          );
          const fmtTs = (iso) => {
            try { return new Date(iso).toLocaleString("en-ZA", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }); }
            catch (_) { return iso; }
          };
          const colourFor = (action) => {
            const a = (action || "").toLowerCase();
            if (a.includes("delete") || a.includes("removed") || a.includes("off-board")) return { bg:"#fee2e2", fg:"#7f1d1d" };
            if (a.includes("transfer"))                                                   return { bg:"#dbeafe", fg:"#1e3a8a" };
            if (a.includes("schedule"))                                                   return { bg:"#fef3c7", fg:"#78350f" };
            if (a.includes("onboard"))                                                    return { bg:"#dcfce7", fg:"#14532d" };
            if (a.includes("restored"))                                                   return { bg:"#dcfce7", fg:"#14532d" };
            return { bg:"#fce7f3", fg:"#831843" };
          };
          return (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:14, flexWrap:"wrap", gap:10 }}>
                <div>
                  <div style={{ fontFamily:"'Playfair Display',serif", fontSize:26, color:"#831843", fontWeight:700, letterSpacing:"0.02em" }}>📜 Activity Log</div>
                  <div style={{ fontSize:12, color:"#F472B6", marginTop:3 }}>Who edited what · who transferred / off-boarded · who saved or deleted a schedule. Newest first, last 1,000 entries kept.</div>
                </div>
                <button onClick={() => setActivityTick(t => t + 1)}
                  style={{ padding:"7px 14px", background:"#FFFFFF", color:"#831843", border:"1px solid #FBCFE8", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700 }}>↻ Refresh</button>
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:11, padding:"12px 14px", border:"1px solid #FBCFE8", marginBottom:14, display:"flex", gap:14, alignItems:"center", flexWrap:"wrap" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:"#F472B6", letterSpacing:"0.06em" }}>WHO</label>
                  <select value={activityFWho} onChange={e=>setActivityFWho(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:"1px solid #FBCFE8", fontSize:13, background:"#fff", minWidth:140 }}>
                    {whoOpts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:"#F472B6", letterSpacing:"0.06em" }}>ACTION</label>
                  <select value={activityFAction} onChange={e=>setActivityFAction(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:"1px solid #FBCFE8", fontSize:13, background:"#fff", minWidth:200 }}>
                    {actionOpts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div style={{ marginLeft:"auto", fontSize:11, color:"#831843" }}>
                  Showing <strong>{filtered.length}</strong> of {activityRows.length}
                </div>
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:13, border:"1px solid #FBCFE8", overflow:"hidden" }}>
                {activityLoad ? (
                  <div style={{ padding:30, textAlign:"center", color:"#9CA3AF", fontSize:13 }}>Loading…</div>
                ) : filtered.length === 0 ? (
                  <div style={{ padding:30, textAlign:"center", color:"#9CA3AF", fontSize:13 }}>No activity yet for the chosen filters.</div>
                ) : (
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                    <thead>
                      <tr style={{ background:"#FCE7F3", color:"#831843", textAlign:"left" }}>
                        <th style={{ padding:"10px 12px", fontWeight:700, fontSize:10, letterSpacing:"0.08em" }}>WHEN</th>
                        <th style={{ padding:"10px 12px", fontWeight:700, fontSize:10, letterSpacing:"0.08em" }}>WHO</th>
                        <th style={{ padding:"10px 12px", fontWeight:700, fontSize:10, letterSpacing:"0.08em" }}>ROLE</th>
                        <th style={{ padding:"10px 12px", fontWeight:700, fontSize:10, letterSpacing:"0.08em" }}>ACTION</th>
                        <th style={{ padding:"10px 12px", fontWeight:700, fontSize:10, letterSpacing:"0.08em" }}>TARGET</th>
                        <th style={{ padding:"10px 12px", fontWeight:700, fontSize:10, letterSpacing:"0.08em" }}>DETAILS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(r => {
                        const c = colourFor(r.action);
                        return (
                          <tr key={r.id || r.when} style={{ borderTop:"1px solid #FCE7F3" }}>
                            <td style={{ padding:"8px 12px", whiteSpace:"nowrap", color:"#6b7280" }}>{fmtTs(r.when)}</td>
                            <td style={{ padding:"8px 12px", fontWeight:700, color:"#111827" }}>{r.who}</td>
                            <td style={{ padding:"8px 12px", color:"#6b7280" }}>{r.role}</td>
                            <td style={{ padding:"8px 12px" }}>
                              <span style={{ background:c.bg, color:c.fg, padding:"3px 8px", borderRadius:6, fontWeight:700, fontSize:11 }}>{r.action}</span>
                            </td>
                            <td style={{ padding:"8px 12px", color:"#111827" }}>{r.target}</td>
                            <td style={{ padding:"8px 12px", color:"#6b7280" }}>{r.details}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── MANAGER CLOCK-INS VIEWER ── */}
        {/* ── DAILY CHECK-INS (nail tech) ── */}
        {tab==="checkins" && (() => { try {
          // Filter rows by branch + range, and group by tech / day for compact display.
          const today = new Date(); const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const since = new Date(t0); since.setDate(since.getDate() - (checkinDayRange - 1));
          const filtered = (techClockinRows || []).filter(r => {
            if (!r.staff) return false;
            if (checkinFilterBranch !== "All" && r.staff.branch !== checkinFilterBranch) return false;
            return new Date(r.ts) >= since;
          });
          const fmtDateTime = (iso) => new Date(iso).toLocaleString("en-ZA", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
          const rangeOpts = [{v:1,l:"Today"},{v:3,l:"Last 3 days"},{v:7,l:"Last 7 days"},{v:14,l:"Last 14 days"},{v:30,l:"Last 30 days"},{v:60,l:"Last 60 days"}];

          // ── Discrepancies vs. Fresha (the active attendance grid) ──
          // Build the active cycle locally — `days` and `cycLabel` are scoped inside
          // the Attendance tab and aren't available here.
          const _ymP = (attYM || "").split("-").map(Number);
          const _p2  = z => String(z).padStart(2, "0");
          let cycLabelLocal = ""; const cycleYmds = new Set(); const dayMap = {};
          if (_ymP.length === 2 && !isNaN(_ymP[0]) && !isNaN(_ymP[1])) {
            const _cycStart = new Date(_ymP[0], _ymP[1]-1, 25);
            const _cycEnd   = new Date(_ymP[0], _ymP[1],   24);
            const moShortL = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            cycLabelLocal = _cycStart.getDate() + " " + moShortL[_cycStart.getMonth()] + " → " + _cycEnd.getDate() + " " + moShortL[_cycEnd.getMonth()] + " " + _cycEnd.getFullYear();
            for (let cur = new Date(_cycStart); cur <= _cycEnd; cur.setDate(cur.getDate()+1)) {
              const ymdL = cur.getFullYear() + "-" + _p2(cur.getMonth()+1) + "-" + _p2(cur.getDate());
              cycleYmds.add(ymdL);
              dayMap[ymdL] = cur.getDate();
            }
          }
          const isOffStatus = (v) => {
            if (!v) return false;
            const bare = v.indexOf("~") === 0 ? v.slice(1) : v;
            return bare === "off" || bare === "swap_i" || bare === "al" || bare === "ph" ||
                   bare === "mat" || bare === "term" || bare === "sick" || bare === "sick_n" || bare === "frl";
          };
          const discrepancies = [];
          if (checkInsByBranch[attBranch]) {
            for (const ec in checkInsByBranch[attBranch]) {
              const days_ = checkInsByBranch[attBranch][ec];
              for (const ymd in days_) {
                if (!cycleYmds.has(ymd)) continue;
                const dayNum = dayMap[ymd];
                const v = (attGrid && attGrid[ec] && attGrid[ec][dayNum]) || "";
                if (isOffStatus(v)) {
                  discrepancies.push({ ec, name: days_[ymd].name, ymd, kind: "checkin_but_off", attendance: v });
                }
              }
            }
          }

          return (
            <div>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontFamily:"'Outfit',system-ui,sans-serif", fontSize:24, color:"#831843", fontWeight:700, marginBottom:4 }}>📲 Daily Check-ins</div>
                <div style={{ fontSize:12, color:"#F472B6" }}>Nail-tech check-ins from the manager check-in app. Used to confirm attendance alongside the Fresha import.</div>
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:13, padding:"12px 14px", border:"1px solid #FBCFE8", marginBottom:14, display:"flex", gap:14, alignItems:"center", flexWrap:"wrap" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:"#F472B6", letterSpacing:"0.06em" }}>BRANCH</label>
                  <select value={checkinFilterBranch} onChange={e=>setCheckinFilterBranch(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:"1px solid #FBCFE8", fontSize:13, background:"#fff", minWidth:160 }}>
                    <option value="All">All branches</option>
                    {SALONS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:"#F472B6", letterSpacing:"0.06em" }}>RANGE</label>
                  <select value={checkinDayRange} onChange={e=>setCheckinDayRange(parseInt(e.target.value, 10))} style={{ padding:"7px 11px", borderRadius:7, border:"1px solid #FBCFE8", fontSize:13, background:"#fff" }}>
                    {rangeOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
                <div style={{ flex:1 }} />
                <div style={{ fontSize:12, color:"#831843" }}><strong>{filtered.length}</strong> record{filtered.length !== 1 ? "s" : ""}</div>
              </div>

              {/* Discrepancies vs Fresha attendance for the active cycle / branch */}
              {discrepancies.length > 0 && (
                <div style={{ background:"#fef3c7", border:"1px solid #fde68a", borderRadius:11, padding:"12px 14px", marginBottom:14 }}>
                  <div style={{ fontWeight:800, color:"#78350f", marginBottom:6, fontSize:13 }}>
                    ⚠ {discrepancies.length} discrepanc{discrepancies.length === 1 ? "y" : "ies"} for {attBranch} — {cycLabelLocal}
                  </div>
                  <div style={{ fontSize:11, color:"#78350f", marginBottom:10 }}>Tech checked in but attendance shows OFF / Annual / Sick / etc. Late status is never flagged (Fresha can't tell late from on-time).</div>
                  <div style={{ display:"grid", gap:6 }}>
                    {discrepancies.slice(0, 30).map((d, i) => (
                      <div key={i} style={{ background:"#FFFFFF", border:"1px solid #fde68a", borderRadius:8, padding:"7px 11px", display:"flex", justifyContent:"space-between", fontSize:12, color:"#78350f" }}>
                        <span><strong>{d.name}</strong> ({d.ec}) · {d.ymd}</span>
                        <span style={{ fontFamily:"monospace", color:"#92400e" }}>checked in · attendance = "{d.attendance || "(blank)"}"</span>
                      </div>
                    ))}
                    {discrepancies.length > 30 && <div style={{ fontSize:11, color:"#92400e" }}>… and {discrepancies.length - 30} more.</div>}
                  </div>
                </div>
              )}

              <div style={{ background:"#FFFFFF", border:"1px solid #FBCFE8", borderRadius:13, overflow:"hidden" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5 }}>
                  <thead>
                    <tr style={{ background:"#831843", color:"#FFFFFF" }}>
                      {["When","Type","Tech","EC","Branch"].map(h => (
                        <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontSize:9.5, letterSpacing:"0.07em", fontWeight:600 }}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign:"center", padding:30, color:"#9ca3af", fontStyle:"italic" }}>No check-ins in this range.</td></tr>
                    )}
                    {filtered.map(r => {
                      const t = r.type === "in"        ? { lbl:"IN",       bg:"#dcfce7", fg:"#14532d" }
                              : r.type === "out"       ? { lbl:"OUT",      bg:"#fef3c7", fg:"#92400e" }
                              : r.type === "out_auto"  ? { lbl:"AUTO-OUT", bg:"#fee2e2", fg:"#7f1d1d" }
                              :                          { lbl:r.type,     bg:"#f3f4f6", fg:"#374151" };
                      return (
                        <tr key={r.id} style={{ borderTop:"1px solid #FCE7F3" }}>
                          <td style={{ padding:"8px 12px", whiteSpace:"nowrap", color:"#831843" }}>{fmtDateTime(r.ts)}</td>
                          <td style={{ padding:"8px 12px" }}>
                            <span style={{ background:t.bg, color:t.fg, fontWeight:700, fontSize:10, padding:"2px 8px", borderRadius:5, letterSpacing:"0.05em" }}>{t.lbl}</span>
                          </td>
                          <td style={{ padding:"8px 12px", fontWeight:600 }}>{(r.staff && r.staff.name) || "—"}</td>
                          <td style={{ padding:"8px 12px", fontFamily:"monospace", fontSize:11, color:"#8E5570" }}>{(r.staff && r.staff.employee_code) || ""}</td>
                          <td style={{ padding:"8px 12px", color:"#831843" }}>📍 {(r.staff && r.staff.branch) || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        } catch (err) {
          console.error("Daily Check-ins render failed:", err);
          return (
            <div style={{ background:"#fee2e2", border:"1px solid #fca5a5", borderRadius:11, padding:"16px 18px", color:"#7f1d1d", fontFamily:"'Outfit',system-ui,sans-serif" }}>
              <div style={{ fontWeight:800, marginBottom:6 }}>Daily Check-ins failed to render.</div>
              <div style={{ fontSize:12 }}>{(err && err.message) || String(err)}</div>
              <div style={{ fontSize:11, marginTop:8, opacity:0.7 }}>See the browser console for details.</div>
            </div>
          );
        } })()}

        {tab==="mgrclockins" && (() => {
          const filtered = mgrClockinRows.filter(r =>
            mgrClockinFilterBranch === "All" || (r.staff && r.staff.branch === mgrClockinFilterBranch)
          );
          // Group by manager-day for compact display
          const fmtDate = (iso) => new Date(iso).toLocaleString("en-ZA", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
          const typeLabel = (t) => {
            if (t === "in")        return { lbl:"IN",       bg:"#dcfce7", fg:"#14532d" };
            if (t === "out")       return { lbl:"OUT",      bg:"#fef3c7", fg:"#92400e" };
            if (t === "out_auto")  return { lbl:"AUTO-OUT", bg:"#fee2e2", fg:"#7f1d1d" };
            return { lbl:t, bg:"#f3f4f6", fg:"#374151" };
          };
          const rangeOpts = [{v:1, l:"Today"},{v:3, l:"Last 3 days"},{v:7, l:"Last 7 days"},{v:14, l:"Last 14 days"},{v:30, l:"Last 30 days"}];

          return (
            <div>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontFamily:"'Playfair Display',serif", fontSize:24, color:"#831843", fontWeight:700, marginBottom:4 }}>🕐 Manager Clock-ins</div>
                <div style={{ fontSize:12, color:"#F472B6" }}>Spot-check manager attendance. Each row shows the selfie, GPS distance from store, and timestamp. Auto-out (red) means they forgot to clock out — talk to them.</div>
              </div>

              <div style={{ background:"#FFFFFF", borderRadius:13, padding:"12px 14px", border:"1px solid #FBCFE8", marginBottom:14, display:"flex", gap:14, alignItems:"center", flexWrap:"wrap" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:"#F472B6", letterSpacing:"0.06em" }}>BRANCH</label>
                  <select value={mgrClockinFilterBranch} onChange={e=>setMgrClockinFilterBranch(e.target.value)} style={{ padding:"7px 11px", borderRadius:7, border:"1px solid #FBCFE8", fontSize:13, background:"#fff", minWidth:160 }}>
                    <option value="All">All branches</option>
                    {SALONS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <label style={{ fontSize:10, fontWeight:700, color:"#F472B6", letterSpacing:"0.06em" }}>RANGE</label>
                  <select value={mgrClockinDays} onChange={e=>setMgrClockinDays(parseInt(e.target.value, 10))} style={{ padding:"7px 11px", borderRadius:7, border:"1px solid #FBCFE8", fontSize:13, background:"#fff" }}>
                    {rangeOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
                <div style={{ flex:1 }} />
                <div style={{ fontSize:12, color:"#831843" }}><strong>{filtered.length}</strong> clock-in record{filtered.length !== 1 ? "s" : ""}</div>
              </div>

              {/* No-show detection: managers scheduled to work but never clocked IN */}
              {(() => {
                // Build set of (ec, ymd) pairs that DID clock in (any "in" or "out_auto" — at least they were here)
                const clockedIn = new Set();
                mgrClockinRows.forEach(r => {
                  if (!r.staff || !r.staff.employee_code) return;
                  const ymd = new Date(r.ts).toISOString().slice(0, 10);
                  if (r.type === "in") clockedIn.add(r.staff.employee_code + "|" + ymd);
                });
                // For each branch+cycle in range, check the schedule for W/E cells
                // and cross-reference with clockins. Filter by branch dropdown.
                const noShows = [];
                const today = new Date();
                const since = new Date(); since.setHours(0,0,0,0); since.setDate(since.getDate() - mgrClockinDays);
                const ymdToYm = (d) => {
                  let y = d.getFullYear(), m = d.getMonth() + 1;
                  if (d.getDate() > 24) { m += 1; if (m > 12) { m = 1; y++; } }
                  return y + "-" + String(m).padStart(2,"0");
                };
                const branchesToCheck = mgrClockinFilterBranch === "All"
                  ? SALONS.map(s => s.name)
                  : [mgrClockinFilterBranch];
                for (const branchName of branchesToCheck) {
                  const branchMgrs = managers.filter(m => m.branch === branchName);
                  for (let cur = new Date(since); cur <= today; cur.setDate(cur.getDate()+1)) {
                    const ymd = cur.toISOString().slice(0, 10);
                    if (cur.getTime() > today.getTime()) continue;
                    const ym = ymdToYm(cur);
                    const grid = mgrClockinSchedCache[branchName + "|" + ym];
                    if (!grid) continue;        // schedule not loaded yet
                    for (const m of branchMgrs) {
                      const cell = grid[m.ec] && grid[m.ec][ymd];
                      if (cell !== "W" && cell !== "E") continue;     // not scheduled to work
                      if (clockedIn.has(m.ec + "|" + ymd)) continue;   // they did clock in
                      noShows.push({ ec: m.ec, name: m.name, branch: branchName, ymd });
                    }
                  }
                }
                noShows.sort((a, b) => b.ymd.localeCompare(a.ymd) || a.branch.localeCompare(b.branch) || a.name.localeCompare(b.name));
                if (noShows.length === 0) return null;
                return (
                  <div style={{ background:"#fee2e2", border:"1px solid #fca5a5", borderRadius:11, padding:"12px 16px", marginBottom:14 }}>
                    <div style={{ fontSize:13, fontWeight:800, color:"#7f1d1d", marginBottom:6 }}>⚠ {noShows.length} NO-SHOW{noShows.length === 1 ? "" : "S"} — scheduled to work but never clocked in</div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:6 }}>
                      {noShows.slice(0, 30).map((ns, i) => (
                        <div key={i} style={{ background:"#fff", borderRadius:7, padding:"7px 10px", border:"1px solid #fca5a5", fontSize:12 }}>
                          <div style={{ fontWeight:700, color:"#7f1d1d" }}>{ns.name}</div>
                          <div style={{ fontSize:11, color:"#9a1a1a" }}>{ns.branch} · {new Date(ns.ymd + "T12:00:00").toLocaleDateString("en-ZA",{day:"2-digit",month:"short",weekday:"short"})}</div>
                        </div>
                      ))}
                      {noShows.length > 30 && <div style={{ alignSelf:"center", fontSize:12, color:"#9a1a1a", fontStyle:"italic" }}>…and {noShows.length - 30} more</div>}
                    </div>
                  </div>
                );
              })()}

              {filtered.length === 0 ? (
                <div style={{ background:"#FFFFFF", borderRadius:11, border:"1px dashed #FBCFE8", padding:"30px 20px", textAlign:"center", color:"#9ca3af" }}>No manager clock-ins in this range.</div>
              ) : (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:10 }}>
                  {filtered.map(r => {
                    const t = typeLabel(r.type);
                    const meta = mgrClockinMeta[r.id] || {};
                    const photo = meta.photo;
                    const dist = meta.distanceM;
                    const oor = meta.outOfRange;
                    return (
                      <div key={r.id} style={{ background:"#FFFFFF", borderRadius:11, border:"1px solid #FBCFE8", padding:"10px 12px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, marginBottom:8 }}>
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color:"#831843" }}>{r.staff && r.staff.name}</div>
                            <div style={{ fontSize:10, fontFamily:"monospace", color:"#9ca3af" }}>{r.staff && r.staff.employee_code} · {r.branch || (r.staff && r.staff.branch) || "—"}</div>
                          </div>
                          <span style={{ fontSize:9, fontWeight:800, padding:"3px 8px", borderRadius:99, background: t.bg, color: t.fg, letterSpacing:"0.04em", whiteSpace:"nowrap" }}>{t.lbl}</span>
                        </div>
                        <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                          {photo ? (
                            <button onClick={()=>setMgrClockinPhoto({ url: photo, name: r.staff && r.staff.name, ts: r.ts, type: r.type, dist, oor })} style={{ padding:0, border:"1px solid #FBCFE8", borderRadius:8, background:"#FCE7F3", cursor:"pointer", overflow:"hidden", flexShrink:0 }}>
                              <img src={photo} alt="selfie" style={{ width:80, height:100, objectFit:"cover", display:"block" }} />
                            </button>
                          ) : (
                            <div style={{ width:80, height:100, borderRadius:8, background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"#9ca3af", flexShrink:0, textAlign:"center", padding:6 }}>no photo</div>
                          )}
                          <div style={{ flex:1, fontSize:11, color:"#374151", lineHeight:1.6 }}>
                            <div>📅 {fmtDate(r.ts)}</div>
                            {dist !== null && dist !== undefined ? (
                              <div style={{ color: oor ? "#7f1d1d" : "#14532d" }}>
                                📍 {dist}m from store{oor ? " ⚠ OUT OF RANGE" : ""}
                              </div>
                            ) : (
                              <div style={{ color:"#9ca3af" }}>📍 no GPS</div>
                            )}
                            {r.type === "out_auto" && <div style={{ color:"#7f1d1d", fontWeight:600 }}>⚠ Forgot to clock out</div>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Photo lightbox */}
              {mgrClockinPhoto && (
                <div onClick={()=>setMgrClockinPhoto(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:9000, display:"flex", alignItems:"center", justifyContent:"center", padding:30 }}>
                  <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:14, padding:18, maxWidth:480, width:"100%" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                      <div>
                        <div style={{ fontSize:15, fontWeight:700, color:"#831843" }}>{mgrClockinPhoto.name}</div>
                        <div style={{ fontSize:11, color:"#9ca3af" }}>{new Date(mgrClockinPhoto.ts).toLocaleString("en-ZA")}</div>
                        {mgrClockinPhoto.dist !== null && mgrClockinPhoto.dist !== undefined && (
                          <div style={{ fontSize:11, color: mgrClockinPhoto.oor ? "#7f1d1d" : "#14532d", marginTop:4 }}>
                            📍 {mgrClockinPhoto.dist}m from store{mgrClockinPhoto.oor ? " ⚠ OUT OF RANGE" : ""}
                          </div>
                        )}
                      </div>
                      <button onClick={()=>setMgrClockinPhoto(null)} style={{ background:"none", border:"none", fontSize:24, color:"#9CA3AF", cursor:"pointer", lineHeight:1 }}>×</button>
                    </div>
                    <img src={mgrClockinPhoto.url} alt="full selfie" style={{ width:"100%", borderRadius:8, display:"block" }} />
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      {staffModal && <StaffModal s={staffModal} onClose={()=>setStaffModal(null)} onSave={saveStaff} onTransfer={(s)=>setTransferModal(s)} allStaff={staff} />}
      {mgrModal && <ManagerModal m={mgrModal} pin={mgrPins[mgrModal.ec] || ""} onClose={()=>setMgrModal(null)} onSave={saveMgr} onDelete={delMgr} />}
      {transferModal && <TransferModal s={transferModal} onClose={()=>setTransferModal(null)} onConfirm={handleTransfer} onCancelTransfer={cancelTransfer} />}
      {matModal && <MatModal rec={matModal} onClose={()=>setMatModal(null)} onSave={saveMat} onDelete={delMat} />}
    </div>
  );
}


// ─── MOUNT ──────────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(React.StrictMode, null, React.createElement(AppGate))
);
