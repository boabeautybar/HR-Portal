/* ============================================================
   BOA Check-in App — data layer  (UPDATED with kiosk audit log)
   ------------------------------------------------------------
   Drop this file into checkin-app-deploy/js/ replacing the old
   data.js, then redeploy boacheckin.netlify.app to Netlify.
   No other files need changing.

   Adds the boa_kiosk_log_<branch>_<ym> audit log so the HR
   portal's Daily Check-ins tab can show ONLY kiosk submissions
   (with notes for sick/absent/extras + proof image references)
   and never get polluted by Fresha imports or HR-portal manual
   edits to the same attendance grid.
   ============================================================ */
(function () {
  var cfg = window.APP_CONFIG || {};
  var sb  = null;

  function isConfigured() {
    return !!(cfg.supabase && cfg.supabase.url && cfg.supabase.anonKey
              && window.supabase && typeof window.supabase.createClient === "function");
  }

  function client() {
    if (sb) return sb;
    if (!isConfigured()) return null;
    sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey, {
      auth: { persistSession: false }   // no Supabase Auth in use
    });
    return sb;
  }

  function branch()        { return cfg.branchName        || "Green Point"; }
  function branchDisplay() { return cfg.branchDisplayName || branch(); }

  // A staff row is a manager if it's tagged as one in the DB, OR its employee
  // code follows the manager convention. Branch managers use codes ending in
  // "M" (e.g. B147M) and head-office managers use an "M###" prefix (e.g. M005);
  // neither ends in the "-M" suffix the HR portal's role_type derivation looks
  // for, so some manager rows land in the DB with role_type "tech". Matching
  // the code pattern too keeps managers out of the tech lists and ensures they
  // still surface in the Manager Clock-in regardless of how role_type stored.
  // Tolerant Head Office branch matcher (branch strings drift in the data).
  function isHeadOfficeBranch(b) { return String(b == null ? "" : b).trim().toLowerCase() === "head office"; }
  function isManagerRow(s) {
    if (!s) return false;
    if (isHeadOfficeBranch(s.branch)) return false;   // HO staff are never salon managers, even with a -M code
    if (s.role_type === "manager") return true;
    var code = (s.employee_code || "").toUpperCase().trim();
    return !!code && (/\dM$/.test(code) || /^M\d/.test(code));
  }

  function todayStr() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  // ---- Cash-up go-live / store-opening config ----
  // Cash-up went live company-wide on this date — stores aren't chased for
  // cash-ups before it. Brand-new branches open later and only start being
  // expected from their opening date. Keep these in sync with the HR portal
  // (app.jsx → CASHUP_GO_LIVE / CASHUP_STORE_OPENING).
  var CASHUP_GLOBAL_GO_LIVE = "2026-06-01";
  var CASHUP_STORE_OPENING = { "Cobble Walk": "2026-07-01" };
  // Weekdays a store doesn't trade (0 = Sun) — skipped when chasing missing
  // cash-ups so days off aren't flagged.
  var CASHUP_CLOSED_DOW = { "Betty": [0, 1] };
  function cashupExpectedFrom() {
    var open = CASHUP_STORE_OPENING[branch()];
    return (open && open > CASHUP_GLOBAL_GO_LIVE) ? open : CASHUP_GLOBAL_GO_LIVE;
  }
  function ymdDaysAgo(n) {
    var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n);
    var p = function (x) { return String(x).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function isClosedDow(dateStr) {
    var closed = CASHUP_CLOSED_DOW[branch()];
    if (!closed) return false;
    var dow = new Date(dateStr + "T12:00:00").getDay();
    return closed.indexOf(dow) !== -1;
  }

  function startOfTodayIso() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  // ---------- Staff ----------
  // First-of-month ISO date (YYYY-MM-01) for the supplied reference date.
  // Used by listStaff(includeRecentLeavers) to keep mid-month leavers visible
  // until the calendar rolls into the next month.
  function _firstOfMonthIso(d) {
    d = d || new Date();
    return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  async function listStaff(opts) {
    opts = opts || {};
    var c = client(); if (!c) return [];
    var q = c.from("staff").select("*").eq("branch", branch());
    if (opts.activeOnly !== false) {
      if (opts.includeRecentLeavers) {
        // Active staff + recent leavers (active=false but left_date is in
        // the current calendar month, or set to a future date). Past-month
        // leavers are excluded so the kiosk drops them automatically on
        // month rollover.
        var monthStart = _firstOfMonthIso(opts.refDate || new Date());
        q = q.or("active.eq.true,and(active.eq.false,left_date.gte." + monthStart + ")");
      } else {
        q = q.eq("active", true);
      }
    }
    q = q.order("name", { ascending: true });
    var res = await q;
    if (res.error) { console.error("listStaff:", res.error); return []; }
    return res.data || [];
  }

  async function listMaternity() {
    var c = client(); if (!c) return [];
    var res = await c.from("maternity").select("*").eq("branch", branch());
    if (res.error) { console.error("listMaternity:", res.error); return []; }
    return res.data || [];
  }

  // Legal unpaid-leave records (HR Compliance → "Unpaid Leave (Legal)") so the
  // kiosk schedule overlays EL the same way it overlays ML — global key, matched
  // by employee code (not branch-filtered).
  async function listUnpaidLegal() {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", "boa_unpaid_legal_v1").maybeSingle();
    if (res.error) { console.error("listUnpaidLegal:", res.error); return []; }
    return (res.data && res.data.value) || [];
  }

  async function listLeaveRecords() {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", "boa_leave_v1").maybeSingle();
    if (res.error) { console.error("listLeaveRecords:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }

  // ── Off-boarding records ───────────────────────────────────────────
  // HR portal's off-boarding tab writes to app_state under
  // boa_offboard_v1: [{ ec, name, branch, leftDate, reason, notes,
  // addedAt }, ...]. It does NOT flip the staff row's active column or
  // set left_date — that only happens via the staff-edit modal — so the
  // kiosk MUST consult this list to know who's actually left. Otherwise
  // staff off-boarded via the dedicated tab still look active here.
  async function loadOffboarding() {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", "boa_offboard_v1").maybeSingle();
    if (res.error) { console.error("loadOffboarding:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }

  // ── Tech day-loans ──────────────────────────────────────────────────
  // HR portal (and the manager kiosk widget) write to app_state under
  // boa_tech_loans_v1: { _id, ec, name, date, fromBranch, toBranch, note,
  // ... }. listTechLoans(dateIso) returns just the rows for that date.
  // categorizeStaff applies them: drop staff loaned OUT of this kiosk for
  // the day, and add any guests loaned IN as honorary roster entries tagged
  // with _guest = true / _homeBranch = fromBranch so the UI can chip them.
  async function listTechLoans(dateIso) {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", "boa_tech_loans_v1").maybeSingle();
    if (res.error) { console.error("listTechLoans:", res.error); return []; }
    var v = res.data && res.data.value;
    var arr = Array.isArray(v) ? v : [];
    if (!dateIso) return arr;
    return arr.filter(function (l) { return l && l.date === dateIso; });
  }

  // Kiosk reminders. The HR portal writes daily tasks to
  // boa_daily_tasks_v1. Records with target === "kiosk" are branch-
  // wide broadcasts (no per-person done tracking). For everything else
  // we ignore — those are portal-user to-dos. Returns only reminders
  // that are active today (one-off date matches OR weekly repeatDow
  // includes today's weekday) and whose branches list includes this
  // kiosk's branch (or is empty, meaning all branches).
  async function listKioskReminders() {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", "boa_daily_tasks_v1").maybeSingle();
    if (res.error) { console.error("listKioskReminders:", res.error); return []; }
    var v = res.data && res.data.value;
    var all = Array.isArray(v) ? v : [];
    var now = new Date();
    var ymd = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0");
    var dow = now.getDay();
    var thisBranch = branch();
    return all.filter(function (t) {
      if (!t || t.target !== "kiosk") return false;
      // Branch scope: empty list = every branch.
      if (Array.isArray(t.branches) && t.branches.length > 0 && t.branches.indexOf(thisBranch) === -1) return false;
      // Active-today check.
      if (t.kind === "weekly") {
        if (!Array.isArray(t.repeatDow) || t.repeatDow.indexOf(dow) === -1) return false;
        if (t.startDate && ymd < t.startDate) return false;
        return true;
      }
      return t.date === ymd;
    }).map(function (t) {
      // Tag each task with this-branch's done status for today. Kiosk
      // reminders are branch-level: any manager at the kiosk can mark
      // them done, and the tick survives until tomorrow (weekly) or
      // forever (one-off, since the date passes).
      var done = t.kioskDoneByBranch && t.kioskDoneByBranch[thisBranch] && t.kioskDoneByBranch[thisBranch][ymd];
      return Object.assign({}, t, {
        _doneTodayHere: !!done,
        _doneAtHere:    done && done.at || null
      });
    });
  }

  // Mark / unmark a kiosk reminder as done for THIS branch on TODAY's
  // date. Reads the whole boa_daily_tasks_v1 row, mutates just the
  // matching task's kioskDoneByBranch[branch][ymd] field, writes back.
  // Returns the updated task or null on failure.
  async function _writeKioskDoneState(taskId, mark) {
    var c = client(); if (!c) return null;
    var res = await c.from("app_state").select("value").eq("key", "boa_daily_tasks_v1").maybeSingle();
    if (res.error) { console.error("kiosk-done read:", res.error); return null; }
    var v = res.data && res.data.value;
    var all = Array.isArray(v) ? v : [];
    var now = new Date();
    var ymd = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0");
    var thisBranch = branch();
    var changed = null;
    var next = all.map(function (t) {
      if (!t || t._id !== taskId) return t;
      var dbd = (t.kioskDoneByBranch && typeof t.kioskDoneByBranch === "object") ? Object.assign({}, t.kioskDoneByBranch) : {};
      var bMap = dbd[thisBranch] ? Object.assign({}, dbd[thisBranch]) : {};
      if (mark) {
        bMap[ymd] = { at: new Date().toISOString() };
      } else {
        delete bMap[ymd];
      }
      if (Object.keys(bMap).length === 0) {
        delete dbd[thisBranch];
      } else {
        dbd[thisBranch] = bMap;
      }
      changed = Object.assign({}, t, { kioskDoneByBranch: dbd });
      return changed;
    });
    if (!changed) return null;
    var w = await c.from("app_state").upsert({ key: "boa_daily_tasks_v1", value: next });
    if (w.error) { console.error("kiosk-done write:", w.error); throw w.error; }
    return changed;
  }
  function markKioskReminderDone(taskId)   { return _writeKioskDoneState(taskId, true); }
  function markKioskReminderUndone(taskId) { return _writeKioskDoneState(taskId, false); }

  // Save a single tech-loan record. Replaces any existing loan for the same
  // (ec, date) pair so a tech can't be in two places on the same day. Used by
  // the manager kiosk "Borrow tech today" flow.
  async function saveTechLoan(loan) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    if (!loan || !loan.ec || !loan.date || !loan.fromBranch || !loan.toBranch) {
      throw new Error("Loan needs ec, date, fromBranch and toBranch.");
    }
    var read = await c.from("app_state").select("value").eq("key", "boa_tech_loans_v1").maybeSingle();
    if (read.error) { console.error("saveTechLoan read:", read.error); throw read.error; }
    var v = read.data && read.data.value;
    var arr = Array.isArray(v) ? v : [];
    arr = arr.filter(function (l) { return !(l && l.ec === loan.ec && l.date === loan.date); });
    arr.push(loan);
    var wr = await c.from("app_state").upsert({ key: "boa_tech_loans_v1", value: arr });
    if (wr.error) { console.error("saveTechLoan write:", wr.error); throw wr.error; }
    return loan;
  }

  // Active staff across ALL branches (managers excluded). Used by the
  // "Borrow tech today" picker on the manager kiosk so a visiting tech can
  // be added regardless of which store she's normally based at.
  async function listStaffAllBranches() {
    var c = client(); if (!c) return [];
    var res = await c.from("staff").select("*").eq("active", true)
      .order("branch", { ascending: true }).order("name", { ascending: true });
    if (res.error) { console.error("listStaffAllBranches:", res.error); return []; }
    // Exclude Head Office staff outright — the borrow-a-tech picker is salon-only,
    // and HO people (now correctly non-managers) would otherwise pass !isManagerRow.
    return (res.data || []).filter(function (s) { return !isManagerRow(s) && !isHeadOfficeBranch(s.branch); });
  }
  async function _fetchStaffByEcs(ecs) {
    if (!ecs || !ecs.length) return [];
    var c = client(); if (!c) return [];
    var res = await c.from("staff").select("*").in("employee_code", ecs);
    if (res.error) { console.error("fetchStaffByEcs:", res.error); return []; }
    return res.data || [];
  }
  // Active staff whose home record still lives at another branch but who have
  // a pending/effective transfer INTO `toBranch`. The HR portal keeps the
  // staff row on its original branch and records the move via
  // transferring / transfer_to / transfer_date; the destination only "owns"
  // them on and after transfer_date. Callers apply that date cutoff.
  async function listTransfersInto(toBranch) {
    var c = client(); if (!c) return [];
    var res = await c.from("staff").select("*")
      .eq("transferring", true).eq("transfer_to", toBranch).eq("active", true);
    if (res.error) { console.error("listTransfersInto:", res.error); return []; }
    return (res.data || []).filter(function (s) { return s && s.branch !== toBranch; });
  }

  // Read-only: who called in sick / absent for TODAY via My BOA, scoped to the
  // people expected at THIS branch today — home-branch staff who weren't loaned
  // out, plus anyone loaned IN to us today. Uses the public list_called_in_today()
  // RPC (anon-safe; returns names only, no reason/proof). The kiosk only shows
  // this; it cannot review or change anything (that's for regional managers).
  async function calledInTodayForBranch() {
    var c = client(); if (!c) return [];
    var res;
    try { res = await c.rpc("list_called_in_today"); }
    catch (e) { console.error("calledInToday rpc:", e); return []; }
    if (res.error) { console.error("calledInToday:", res.error); return []; }
    var rows = (res.data || []).filter(function (r) { return r && r.name; });
    if (!rows.length) return [];
    var today = isoDate(new Date());
    var ecs = rows.map(function (r) { return r.ec; }).filter(Boolean);
    var staffRows = await _fetchStaffByEcs(ecs);
    var byEc = {};
    staffRows.forEach(function (s) { if (s && s.employee_code) byEc[String(s.employee_code).trim()] = s; });
    var loans = await listTechLoans(today);
    var loanByEc = {};
    (loans || []).forEach(function (l) { if (l && l.ec) loanByEc[String(l.ec).trim()] = l; });
    var thisBranch = branch();
    var out = [];
    rows.forEach(function (r) {
      var ec = r.ec ? String(r.ec).trim() : "";
      var s = ec ? byEc[ec] : null;
      var home = (s && s.branch) || r.store || "";
      var loan = ec ? loanByEc[ec] : null;
      var workBranch = (loan && loan.toBranch) ? loan.toBranch : home;     // home, or borrowed-to
      if (workBranch !== thisBranch) return;
      out.push({
        name: r.name,
        ec: ec,
        type: r.leave_type === "Sick" ? "sick" : "absent",
        role: isManagerRow(s) ? "manager" : "tech",
        borrowed: !!loan
      });
    });
    out.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    return out;
  }

  async function categorizeStaff(refDate, opts) {
    var refIso = isoDate(refDate || new Date());
    var monthStart = _firstOfMonthIso(refDate || new Date());
    var thisBranch = branch();
    // Always ask listStaff for current-month leavers so the manager kiosk
    // can show them greyed at the bottom (see "leftCompany" bucket below).
    // Callers can opt out with includeRecentLeavers:false if they need the
    // strict active-only roster (e.g. tech off-day requests).
    var listOpts = Object.assign({ activeOnly: true }, opts || {});
    if (listOpts.activeOnly !== false && listOpts.includeRecentLeavers !== false) {
      listOpts.includeRecentLeavers = true;
      listOpts.refDate = refDate || new Date();
    }
    var results = await Promise.all([
      listStaff(listOpts),
      listMaternity(),
      listLeaveRecords(),
      listTechLoans(refIso),
      loadOffboarding(),
      listTransfersInto(thisBranch)
    ]);
    var staff = results[0], matRecs = results[1], leaveRecs = results[2], loansToday = results[3], offList = results[4], transfersIn = results[5];

    // Off-boarding lookup: HR portal's dedicated tab writes leftDate into
    // boa_offboard_v1 (NOT the staff row's left_date column), so we have
    // to merge both. EC is unique across branches.
    var offByEc = {};
    (offList || []).forEach(function (o) {
      if (!o || !o.ec) return;
      offByEc[String(o.ec).trim()] = o;
    });
    function effectiveLeftDate(s) {
      var ec = s && s.employee_code && String(s.employee_code).trim();
      var off = ec ? offByEc[ec] : null;
      return (off && off.leftDate) || s.left_date || null;
    }

    // Pull current-month leavers out into their own bucket. Historical
    // leavers (left_date before the first of this month) are dropped
    // entirely — the kiosk shouldn't list techs who left last month or
    // earlier. Staff with a future left_date stay in the active flow so
    // they can still be checked in until their last day.
    var leftCompany = [];
    staff = staff.filter(function (s) {
      if (!s) return false;
      var eff = effectiveLeftDate(s);
      if (!eff) return true;                       // no leaving date
      if (eff < monthStart) return false;          // historical leaver
      if (eff > refIso) return true;               // future leaver, still active
      var ec = s.employee_code && String(s.employee_code).trim();
      var off = ec ? offByEc[ec] : null;
      s._leftCompany = true;
      s._leftDate = eff;
      s._offReason = (off && off.reason) || null;
      leftCompany.push(s);
      return false;
    });
    leftCompany.sort(function (a, b) {
      // Most recent leaver at the top of the (already-bottom) group so the
      // manager can see who just walked out first.
      var ad = a._leftDate || "", bd = b._leftDate || "";
      if (ad !== bd) return bd.localeCompare(ad);
      return (a.name || "").localeCompare(b.name || "");
    });

    // Transfers OUT: a tech moving to another branch drops off THIS branch's
    // roster on and after their transfer_date (the HR portal shows the same —
    // they appear at the destination from that day). Before the date they stay.
    staff = staff.filter(function (s) {
      return !(s && s.transferring && s.transfer_to && s.transfer_to !== thisBranch
               && s.transfer_date && refIso >= s.transfer_date);
    });

    // Loans: ECs leaving us today (loaned out) stay on the home roster so
    // the manager knows where they are - tagged with _loanedOut / _awayAt
    // and rendered with a chip + locked actions. ECs arriving from another
    // branch get fetched, tagged with _guest / _homeBranch, and merged in.
    var loanedOutEcs = {};   // ec -> loan record (this branch is `fromBranch`)
    var incomingByEc = {};   // ec -> loan record (this branch is `toBranch`)
    loansToday.forEach(function (l) {
      if (!l || !l.ec) return;
      if (l.fromBranch === thisBranch && l.toBranch && l.toBranch !== thisBranch) loanedOutEcs[l.ec] = l;
      if (l.toBranch === thisBranch && l.fromBranch && l.fromBranch !== thisBranch) incomingByEc[l.ec] = l;
    });
    staff.forEach(function (s) {
      var ln = s.employee_code && loanedOutEcs[s.employee_code];
      if (ln) {
        s._loanedOut = true;
        s._awayAt    = ln.toBranch || "";
        s._loanNote  = ln.note     || "";
      }
    });
    var incomingEcs = Object.keys(incomingByEc);
    if (incomingEcs.length > 0) {
      var guests = await _fetchStaffByEcs(incomingEcs);
      guests.forEach(function (g) {
        var ln = incomingByEc[g.employee_code];
        if (!ln) return;
        g._guest = true;
        g._homeBranch = ln.fromBranch || g.branch;
        g._loanNote = ln.note || "";
        staff.push(g);
      });
    }

    // Transfers IN: techs whose home record still lives at another branch but
    // whose transfer to THIS branch has taken effect (refIso >= transfer_date).
    // Their schedule for this branch is already stored under this branch's
    // grid, so adding them to the roster lets the check-in pick them up. The
    // home branch drops them via the "Transfers OUT" filter above.
    (transfersIn || []).forEach(function (t) {
      if (!t || !t.employee_code) return;
      if (!t.transfer_date || refIso < t.transfer_date) return;   // not arrived yet
      if (staff.some(function (s) { return s.id === t.id || s.employee_code === t.employee_code; })) return;
      t._transferredIn = true;
      t._homeBranch = t.branch || "";
      staff.push(t);
    });

    var matByEc = {};
    matRecs.forEach(function (m) {
      // dates_tbc is treated the same as on_mat — person is away even
      // though we don't have firm start / end / return dates yet.
      if ((m.mat_status === "on_mat" || m.mat_status === "dates_tbc") && m.employee_code) matByEc[m.employee_code] = m;
    });
    var leaveByEc = {};
    leaveRecs.forEach(function (l) {
      if (!l || l.type !== "Annual leave" || !l.ec) return;
      if (l.startDate && refIso < l.startDate) return;
      if (l.endDate   && refIso > l.endDate)   return;
      leaveByEc[l.ec] = l;
    });
    var active = [], onMat = [], onLeave = [];
    staff.forEach(function (s) {
      var ec = s.employee_code;
      if (ec && matByEc[ec])         onMat.push({ staff: s, record: matByEc[ec] });
      else if (ec && leaveByEc[ec])  onLeave.push({ staff: s, record: leaveByEc[ec] });
      else                           active.push(s);
    });
    return { active: active, onMat: onMat, onLeave: onLeave, loansToday: loansToday, leftCompany: leftCompany };
  }

  // Roster for the Off Requests picker: everyone who belongs to THIS branch at
  // any point during the 25th→24th cycle named by targetYm. The picker used to
  // take TODAY's active roster (categorizeStaff), which silently dropped people
  // who ARE on next month's schedule in the HR portal:
  //   • anyone on annual leave today — away now, but the off requests are for
  //     NEXT month, which they'll be back for;
  //   • a tech transferring INTO this branch whose transfer date hasn't arrived
  //     yet — the portal already rosters her here for the target cycle.
  // Cycle-aware rules instead: leavers and transfers OUT drop only when they're
  // gone BEFORE the cycle starts; transfers IN appear as soon as the move lands
  // on or before the cycle's last day; annual leave only excludes someone whose
  // approved leave covers EVERY day of the cycle; maternity stays excluded
  // (long-term away).
  async function listOffRequestStaff(targetYm) {
    var c = client(); if (!c) return [];
    var days = periodDays(targetYm);
    var p2 = function (n) { return String(n).padStart(2, "0"); };
    var first = days[0], last = days[days.length - 1];
    var cycleStart = first.year + "-" + p2(first.monthIdx + 1) + "-" + p2(first.day);
    var cycleEnd   = last.year  + "-" + p2(last.monthIdx + 1)  + "-" + p2(last.day);
    var thisBranch = branch();
    var results = await Promise.all([
      listStaff({ activeOnly: true }),
      listMaternity(),
      listLeaveRecords(),
      loadOffboarding(),
      listTransfersInto(thisBranch)
    ]);
    var staff = results[0], matRecs = results[1], leaveRecs = results[2], offList = results[3], transfersIn = results[4];
    var offByEc = {};
    (offList || []).forEach(function (o) { if (o && o.ec) offByEc[String(o.ec).trim()] = o; });
    var matByEc = {};
    (matRecs || []).forEach(function (m) {
      if ((m.mat_status === "on_mat" || m.mat_status === "dates_tbc") && m.employee_code) matByEc[m.employee_code] = true;
    });
    var fullCycleLeaveEcs = {};
    (leaveRecs || []).forEach(function (l) {
      if (!l || l.type !== "Annual leave" || !l.ec || !l.startDate || !l.endDate) return;
      if (l.startDate <= cycleStart && l.endDate >= cycleEnd) fullCycleLeaveEcs[String(l.ec).trim()] = true;
    });
    // Transfers IN that land before the cycle ends — already on this branch's
    // target-cycle schedule in the portal, so they must be pickable here.
    (transfersIn || []).forEach(function (t) {
      if (!t || !t.employee_code) return;
      if (!t.transfer_date || t.transfer_date > cycleEnd) return;
      if (staff.some(function (s) { return s.id === t.id || s.employee_code === t.employee_code; })) return;
      t._transferredIn = true;
      t._homeBranch = t.branch || "";
      staff.push(t);
    });
    return staff.filter(function (s) {
      if (!s) return false;
      var ec = s.employee_code ? String(s.employee_code).trim() : "";
      var left = (ec && offByEc[ec] && offByEc[ec].leftDate) || s.left_date || null;
      if (left && left < cycleStart) return false;                      // gone before the cycle
      if (s.transferring && s.transfer_to && s.transfer_to !== thisBranch
          && s.transfer_date && s.transfer_date <= cycleStart) return false;  // moved away before the cycle
      if (s.employee_code && matByEc[s.employee_code]) return false;    // on maternity
      if (ec && fullCycleLeaveEcs[ec]) return false;                    // on leave for the whole cycle
      return true;
    }).sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
  }

  async function addStaff(name, employeeCode) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var res = await c.from("staff").insert({
      branch: branch(), name: name.trim(),
      employee_code: (employeeCode || "").trim() || null, active: true
    }).select().single();
    if (res.error) throw res.error;
    return res.data;
  }

  async function updateStaff(id, patch) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var res = await c.from("staff").update(patch).eq("id", id).select().single();
    if (res.error) throw res.error;
    return res.data;
  }

  async function deactivateStaff(id) { return updateStaff(id, { active: false }); }

  // ---------- Clock-ins ----------
  async function lastClockinToday(staffId) {
    var c = client(); if (!c) return null;
    var res = await c.from("clockins").select("*")
      .eq("staff_id", staffId).eq("branch", branch())
      .gte("ts", startOfTodayIso())
      .order("ts", { ascending: false }).limit(1);
    if (res.error) { console.error("lastClockinToday:", res.error); return null; }
    return (res.data || [])[0] || null;
  }

  async function addClockin(staffId, type) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var res = await c.from("clockins").insert({
      staff_id: staffId, branch: branch(), type: type
    }).select().single();
    if (res.error) throw res.error;
    return res.data;
  }

  async function listTodayClockins() {
    var c = client(); if (!c) return [];
    var res = await c.from("clockins")
      .select("*, staff:staff_id ( id, name, employee_code )")
      .eq("branch", branch()).gte("ts", startOfTodayIso())
      .order("ts", { ascending: false });
    if (res.error) { console.error("listTodayClockins:", res.error); return []; }
    return res.data || [];
  }

  // ---------- Cash-ups ----------
  // Active (non-reopened) cash-up for this branch on a given day. Defaults to
  // today; pass a YYYY-MM-DD to fetch a previous day's (used when a store
  // completes a cash-up they missed).
  async function cashupForDate(dateStr) {
    var c = client(); if (!c) return null;
    var res = await c.from("cashups").select("*")
      .eq("branch", branch()).eq("date", dateStr || todayStr())
      .is("archived_at", null)
      .order("created_at", { ascending: false }).limit(1);
    if (res.error) { console.error("cashupForDate:", res.error); return null; }
    return (res.data || [])[0] || null;
  }
  async function todaysCashup() { return cashupForDate(todayStr()); }

  // Previous days (most recent first) this branch still owes a cash-up for —
  // from yesterday back to the store's go-live, within the lookback window,
  // skipping the store's known closed weekdays. Today is never included
  // (the store may still submit before close). Powers the home-screen
  // reminder and the clock-out nudge.
  async function outstandingCashupDates(maxLookbackDays) {
    var c = client(); if (!c) return [];
    var lookback = maxLookbackDays || 7;
    var expectedFrom = cashupExpectedFrom();
    var since = ymdDaysAgo(lookback);
    var floor = since > expectedFrom ? since : expectedFrom;
    var res = await c.from("cashups").select("date")
      .eq("branch", branch()).gte("date", floor).is("archived_at", null);
    if (res.error) { console.error("outstandingCashupDates:", res.error); return []; }
    var have = {};
    (res.data || []).forEach(function (r) { have[r.date] = true; });
    var out = [];
    for (var i = 1; i <= lookback; i++) {
      var d = ymdDaysAgo(i);
      if (d < floor) break;
      if (!have[d] && !isClosedDow(d)) out.push(d);
    }
    return out;
  }

  async function addCashup(payload) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var row = {
      branch: branch(), date: (payload.date || todayStr()),
      yoco:      Number(payload.yoco)      || 0,
      yoco_link: Number(payload.yoco_link) || 0,
      cash:      Number(payload.cash)      || 0,
      card_tips: Number(payload.card_tips) || 0,
      vouchers:  Number(payload.vouchers)  || 0,
      gift_card: Number(payload.gift_card) || 0,
      manual_discounts:       Number(payload.manual_discounts) || 0,
      manual_discount_reason: (payload.manual_discount_reason || "").trim() || null,
      notes: (payload.notes || "").trim() || null,
      signed_by: (payload.signedBy || "").trim(),
      cash_banked:   (payload.cash_banked === true || payload.cash_banked === false) ? payload.cash_banked : null,
      amount_banked: Number(payload.amount_banked) || 0,
      banking_ref:   (payload.banking_ref || "").trim() || null,
      banked_by:     (payload.banked_by   || "").trim() || null,
      banking_slip:  payload.banking_slip || null,
      yoco_photo:    payload.yoco_photo || null
    };
    var res = await c.from("cashups").insert(row).select().single();
    if (res.error) throw res.error;
    return res.data;
  }

  async function listRecentCashups(limit) {
    var c = client(); if (!c) return [];
    // Exclude reopened/deleted entries (archived_at set) so a cash-up that
    // was reopened or removed from the HR portal stops showing in the store's
    // Cash History.
    var res = await c.from("cashups").select("*").eq("branch", branch())
      .is("archived_at", null)
      .order("date", { ascending: false }).order("created_at", { ascending: false })
      .limit(limit || 30);
    if (res.error) { console.error("listRecentCashups:", res.error); return []; }
    return res.data || [];
  }

  // ---------- Attendance grid (boa_att_<branch>_<ym>) ----------
  function ymForDate(date) {
    var y = date.getFullYear(), m = date.getMonth() + 1;
    if (date.getDate() > 24) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + "-" + String(m).padStart(2, "0");
  }

  function attKey(ym) {
    var p = ym.split("-");
    var y = +p[0], m = +p[1] - 1;
    if (m < 1) { m = 12; y -= 1; }
    return "boa_att_" + branch() + "_" + y + "-" + String(m).padStart(2, "0");
  }
  function swapsKey(ym)     { return "boa_swaps_"     + branch() + "_" + ym; }
  function extrasKey(ym)    { return "boa_extras_"    + branch() + "_" + ym; }
  function absencesKey(ym)  { return "boa_absences_"  + branch() + "_" + ym; }
  function dailyKey(ymd)    { return "boa_dly_"       + branch() + "_" + ymd; }
  function proofKey(ym, ec, day) {
    return "boa_proof_" + branch() + "_" + ym + "_" + ec + "_" + day;
  }

  function endOfSchedulePeriod(date) {
    var ym = ymForDate(date);
    var p = ym.split("-");
    return new Date(+p[0], +p[1] - 1, 24);
  }

  // ── Family Responsibility Leave (FRL) balance guard ──────────────────────
  // Mirrors the HR portal: 3 paid days per employment year, only after 4
  // months' service, reset each work anniversary. The current balance is held
  // in app_state boa_frl_v1 and topped-up by FRL already marked in attendance.
  var FRL_DAYS = 3, FRL_QUALIFY_MONTHS = 4;
  function _normEc(ec) { return String(ec == null ? "" : ec).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function _normYmd(s) { return s ? String(s).replace(/\//g, "-").slice(0, 10) : ""; }
  function _ymdStr(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function _monthsBetween(f, t) { var a = new Date(_normYmd(f) + "T00:00:00"), b = new Date(_normYmd(t) + "T00:00:00"); if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 0; var m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()); if (b.getDate() < a.getDate()) m--; return Math.max(0, m); }
  function _frlCycle(startYmd, toYmd) { var s = _normYmd(startYmd); if (!s) return null; var a = new Date(s + "T00:00:00"), b = new Date(_normYmd(toYmd) + "T00:00:00"); if (isNaN(a.getTime()) || isNaN(b.getTime())) return null; var years = b.getFullYear() - a.getFullYear(); var anniv = new Date(a.getFullYear() + years, a.getMonth(), a.getDate()); if (anniv > b) years--; var st = new Date(a.getFullYear() + years, a.getMonth(), a.getDate()); var en = new Date(a.getFullYear() + years + 1, a.getMonth(), a.getDate()); en.setDate(en.getDate() - 1); return { start: _ymdStr(st), end: _ymdStr(en) }; }
  function _ymdToAttYm(ymd) { var p = _normYmd(ymd).split("-").map(Number); var yy = p[0], mm = p[1]; if (p[2] < 25) { mm--; if (mm < 1) { mm = 12; yy--; } } return yy + "-" + String(mm).padStart(2, "0"); }
  function _attCellYmd(attYm, dk) { var p = String(attYm).split("-").map(Number); var day = Number(dk); if (!day || day < 1 || day > 31) return ""; var Y = p[0], M = p[1]; if (day < 25) { M++; if (M > 12) { M = 1; Y++; } } return Y + "-" + String(M).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
  function _listAttYms(f, t) { var out = [], ym = _ymdToAttYm(f), end = _ymdToAttYm(t), g = 0; while (g++ < 24) { out.push(ym); if (ym === end) break; var q = ym.split("-").map(Number); var M = q[1] + 1, Y = q[0]; if (M > 12) { M = 1; Y++; } ym = Y + "-" + String(M).padStart(2, "0"); } return out; }
  async function loadFRL() {
    var c = client(); if (!c) return null;
    var res = await c.from("app_state").select("value").eq("key", "boa_frl_v1").maybeSingle();
    if (res.error) { console.error("loadFRL:", res.error); throw res.error; }
    return (res.data && res.data.value) || null;
  }
  // Returns { block, available, message }. Blocks FRL when the person isn't
  // eligible, has no days left this cycle, or the balance can't be determined.
  async function frlMarkGuard(ec, startDate, ym, dayKey) {
    var today = todayStr();
    var dateBeingMarked = _attCellYmd(ym, dayKey);
    var start = _normYmd(startDate);
    if (!start) return { block: true, message: "No start date on file, so FRL days can't be confirmed. Use Unpaid instead." };
    var cyc = _frlCycle(start, today); if (!cyc) return { block: true, message: "Couldn't work out the FRL cycle. Use Unpaid instead." };
    if (_monthsBetween(start, today) < FRL_QUALIFY_MONTHS) return { block: true, message: "Not eligible for paid FRL yet (it starts after 4 months' service). Use Unpaid instead." };
    var frl; try { frl = await loadFRL(); } catch (e) { return { block: true, message: "Couldn't load the FRL balance to check remaining days. Please try again, or use Unpaid." }; }
    var norm = _normEc(ec);
    var entry = frl && frl.entries && frl.entries[norm];
    var recorded = !!(entry && entry.cycleStart === cyc.start);
    var base = FRL_DAYS;
    if (recorded) base = entry.remaining != null ? Number(entry.remaining) : (entry.used != null ? FRL_DAYS - Number(entry.used) : FRL_DAYS);
    base = Math.max(0, Math.min(FRL_DAYS, base));
    var since = cyc.start;
    if (recorded) since = entry.asOf || (frl && frl.asOf) || since;
    else if (frl && frl.asOf && frl.asOf > cyc.start) since = frl.asOf;
    var days = {};
    try {
      var yms = _listAttYms(since, today);
      for (var i = 0; i < yms.length; i++) {
        var a = await getAttendance(yms[i]); var grid = (a && a.grid) || {};
        var rowg = grid[ec] || grid[String(ec).toUpperCase()] || {};
        for (var dk in rowg) { if (String(rowg[dk] == null ? "" : rowg[dk]).replace(/^~/, "") === "frl") days[_attCellYmd(yms[i], dk)] = 1; }
      }
    } catch (e) { return { block: true, message: "Couldn't check recent FRL for this person. Please try again, or use Unpaid." }; }
    var taken = 0; for (var d in days) { if (d !== dateBeingMarked && d > since && d >= cyc.start && d <= cyc.end && d <= today) taken++; }
    var available = Math.max(0, base - taken);
    if (available < 1) return { block: true, available: available, message: "No Family Responsibility Leave days left this cycle (" + available + " of " + FRL_DAYS + " remaining). Use Unpaid instead." };
    return { block: false, available: available };
  }

  // ---------- Practice-tour completions (boa_tour_done_v1) ----------
  // Managers record their name when they finish the check-in practice tour
  // (manager-app.js renderCheckinTour). One shared list across branches so
  // the HR portal can show who has done it. Read-merge-write append.
  var TOUR_DONE_KEY = "boa_tour_done_v1";
  async function saveTourCompletion(name) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var res = await c.from("app_state").select("value").eq("key", TOUR_DONE_KEY).maybeSingle();
    if (res.error) throw res.error;
    var v = (res.data && res.data.value) || {};
    var entries = Array.isArray(v.entries) ? v.entries.slice() : [];
    entries.push({ name: String(name || "").trim(), branch: branch(), at: new Date().toISOString() });
    var up = await c.from("app_state").upsert({ key: TOUR_DONE_KEY, value: { entries: entries } });
    if (up.error) throw up.error;
    return entries.length;
  }

  async function getAttendance(ym) {
    var c = client(); if (!c) return { grid: {}, branch: branch(), ym: ym };
    var res = await c.from("app_state").select("value").eq("key", attKey(ym)).maybeSingle();
    if (res.error) { console.error("getAttendance:", res.error); return { grid: {}, branch: branch(), ym: ym }; }
    return (res.data && res.data.value) || { grid: {}, branch: branch(), ym: ym };
  }

  async function setAttendanceStatus(ym, dayKey, ec, status, note) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var existing = await getAttendance(ym);
    var newGrid = JSON.parse(JSON.stringify(existing.grid || {}));
    if (status == null) {
      if (newGrid[ec]) {
        delete newGrid[ec][dayKey];
        if (Object.keys(newGrid[ec]).length === 0) delete newGrid[ec];
      }
    } else {
      if (!newGrid[ec]) newGrid[ec] = {};
      newGrid[ec][dayKey] = status;
    }
    // Preserve sidecar fields the portal layers onto this record (freshaWorked,
    // freshaCoverage, reviewedWarnings, mirrorSuppressed, names, …). Rebuilding
    // the value as only { grid, … } here wiped them on every kiosk write — e.g.
    // it erased the Fresha appointments import the day after it was done.
    // Mirrors data.js saveAttendance, which already merges.
    var newValue = Object.assign({}, existing, { grid: newGrid, branch: branch(), ym: ym, savedAt: new Date().toISOString() });
    var res = await c.from("app_state").upsert({ key: attKey(ym), value: newValue });
    if (res.error) throw res.error;

    // ---- Kiosk audit log (NEW) ----
    // The HR portal's Daily Check-ins tab reads ONLY from this log.
    try {
      var logKey = "boa_kiosk_log_" + branch() + "_" + attKey(ym).split("_").pop();
      var cycP = attKey(ym).split("_").pop().split("-");
      var cycY = +cycP[0], cycM = +cycP[1];
      var dayN = parseInt(dayKey, 10);
      var dt;
      if (dayN >= 25) { dt = new Date(cycY, cycM - 1, dayN); }
      else { var nm = cycM + 1, ny = cycY; if (nm > 12) { nm = 1; ny += 1; } dt = new Date(ny, nm - 1, dayN); }
      var ymd = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
      var sideCalls = await Promise.all([
        c.from("app_state").select("value").eq("key", logKey).maybeSingle(),
        c.from("app_state").select("value").eq("key", absencesKey(ym)).maybeSingle(),
        c.from("app_state").select("value").eq("key", extrasKey(ym)).maybeSingle(),
        c.from("app_state").select("value").eq("key", proofKey(ym, ec, dayKey)).maybeSingle()
      ]);
      var prior = sideCalls[0];
      var absences = (sideCalls[1].data && sideCalls[1].data.value) || {};
      var extras = (sideCalls[2].data && sideCalls[2].data.value) || {};
      var hasProof = !!(sideCalls[3].data && sideCalls[3].data.value && sideCalls[3].data.value.__raw);
      var log = (prior.data && Array.isArray(prior.data.value)) ? prior.data.value : [];
      var resolvedNote = note || null;
      if (!resolvedNote && absences[dayKey] && absences[dayKey][ec] && absences[dayKey][ec].reason) {
        resolvedNote = absences[dayKey][ec].reason;
      }
      if (!resolvedNote && extras[dayKey] && extras[dayKey][ec] && extras[dayKey][ec].approvedBy) {
        resolvedNote = "Approved by " + extras[dayKey][ec].approvedBy;
      }
      log.push({
        ec: ec, dayKey: String(dayKey), ymd: ymd,
        status: status == null ? "(cleared)" : status,
        note: resolvedNote, hasProof: hasProof,
        proofKey: hasProof ? proofKey(ym, ec, dayKey) : null,
        ts: new Date().toISOString()
      });
      if (log.length > 5000) log = log.slice(-5000);
      var lr = await c.from("app_state").upsert({ key: logKey, value: log });
      if (lr.error) console.warn("kiosk log upsert:", lr.error);
    } catch (e) {
      console.warn("kiosk log failed (non-fatal):", e);
    }

    return newValue;
  }

  // Make "Confirm and submit attendance" actually submit a complete record.
  // A kiosk-log entry is only written when a status is actively TAPPED (in
  // setAttendanceStatus). A status that was already showing on the tile — a
  // pre-filled grid value, or one whose original log-write failed (the log
  // push above is non-fatal) — leaves NO log entry, even though the day reads
  // as confirmed. The HR portal's Nail Tech Check-ins tab and the attendance
  // tooltip read only this log, so such a tech shows "no check-in recorded"
  // despite the kiosk/cell showing them present. At sign-off we reconcile:
  // for every tech with a status in the attendance grid for this day that the
  // log doesn't already reflect, append an entry so the log is complete.
  async function backfillCheckinLog(ym, dayKey) {
    var c = client(); if (!c) return 0;
    try {
      var cycSuffix = attKey(ym).split("_").pop();           // "YYYY-MM"
      var cycP = cycSuffix.split("-");
      var cycY = +cycP[0], cycM = +cycP[1];
      var dayN = parseInt(dayKey, 10);
      var dt;
      if (dayN >= 25) { dt = new Date(cycY, cycM - 1, dayN); }
      else { var nm = cycM + 1, ny = cycY; if (nm > 12) { nm = 1; ny += 1; } dt = new Date(ny, nm - 1, dayN); }
      var ymd = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");

      var att = await getAttendance(ym);
      var grid = (att && att.grid) || {};
      var logKey = "boa_kiosk_log_" + branch() + "_" + cycSuffix;
      var lr = await c.from("app_state").select("value").eq("key", logKey).maybeSingle();
      var log = (lr.data && Array.isArray(lr.data.value)) ? lr.data.value : [];

      // Latest log status per ec for THIS day (so we don't duplicate or
      // resurrect a deliberately-cleared mark).
      var latestByEc = {};
      for (var i = 0; i < log.length; i++) {
        var e = log[i];
        if (!e || e.ymd !== ymd || !e.ec) continue;
        var prev = latestByEc[e.ec];
        if (!prev || String(e.ts) > String(prev.ts)) latestByEc[e.ec] = e;
      }

      var now = new Date().toISOString(), added = 0;
      Object.keys(grid).forEach(function (ec) {
        var raw = grid[ec] && grid[ec][dayKey];
        if (!raw) return;
        var bare = String(raw).charAt(0) === "~" ? String(raw).slice(1) : String(raw);
        var latest = latestByEc[ec];
        // Already reflected, or the manager explicitly cleared it — leave alone.
        if (latest && (latest.status === bare || latest.status === "(cleared)")) return;
        log.push({ ec: ec, dayKey: String(dayKey), ymd: ymd, status: bare, note: null, hasProof: false, proofKey: null, ts: now, _backfill: true });
        added++;
      });

      if (added > 0) {
        if (log.length > 5000) log = log.slice(-5000);
        var up = await c.from("app_state").upsert({ key: logKey, value: log });
        if (up.error) console.warn("backfillCheckinLog upsert:", up.error);
      }
      return added;
    } catch (e) { console.warn("backfillCheckinLog (non-fatal):", e); return 0; }
  }

  // ---------- Swap registry ----------
  async function getSwaps(ym) {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", swapsKey(ym)).maybeSingle();
    if (res.error) { console.error("getSwaps:", res.error); return []; }
    return Array.isArray(res.data && res.data.value) ? res.data.value : [];
  }

  // Undo a previously-recorded swap. Only valid while BOTH dates the swap
  // touches are still un-signed-off (the user's rule: no changes after
  // submission). Defensive about manual changes — if a manager has since
  // overwritten a swap_i / swap_o entry with a real status like "on" or
  // "late", we don't clobber that; we only clear cells that still hold
  // the swap marker. The swap RECORD itself is always removed so the row
  // tag / footnote disappears.
  async function undoSwap(ym, swapId) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    if (!swapId) throw new Error("Swap id required.");
    var existing = await getSwaps(ym);
    var rec = null;
    for (var i = 0; i < existing.length; i++) {
      if (existing[i] && existing[i].id === swapId) { rec = existing[i]; break; }
    }
    if (!rec) throw new Error("Swap not found.");

    var dA = new Date(rec.dateA + "T12:00:00");
    var dB = new Date(rec.dateB + "T12:00:00");
    if (isNaN(dA) || isNaN(dB)) throw new Error("Bad swap dates on record.");
    var ymA = ymForDate(dA), ymB = ymForDate(dB);
    var dayA = String(dA.getDate()), dayB = String(dB.getDate());

    // Refuse if either day is already signed off.
    var dailyA = await getDailyRecord(dA);
    if (dailyA && dailyA.signedBy) {
      throw new Error("Can't undo — " + rec.dateA + " is already signed off.");
    }
    var dailyB = await getDailyRecord(dB);
    if (dailyB && dailyB.signedBy) {
      throw new Error("Can't undo — " + rec.dateB + " is already signed off.");
    }

    // Inspect each of the four attendance cells; clear only the ones still
    // tagged as swap markers.
    var attA = await getAttendance(ymA);
    var attB = (ymA === ymB) ? attA : await getAttendance(ymB);
    function cell(att, ec, dk) {
      return att && att.grid && att.grid[ec] && att.grid[ec][dk];
    }
    var aOwe = cell(attA, rec.oweEc,   dayA);
    var aCov = cell(attA, rec.coverEc, dayA);
    var bCov = cell(attB, rec.coverEc, dayB);
    var bOwe = cell(attB, rec.oweEc,   dayB);

    if (aOwe === "swap_o") await setAttendanceStatus(ymA, dayA, rec.oweEc,   null);
    if (aCov === "swap_i") await setAttendanceStatus(ymA, dayA, rec.coverEc, null);
    if (bCov === "swap_o") await setAttendanceStatus(ymB, dayB, rec.coverEc, null);
    if (bOwe === "swap_i") await setAttendanceStatus(ymB, dayB, rec.oweEc,   null);

    // Drop the swap record itself. ymA is the canonical key because
    // recordSwap enforces ymA === ymB on creation.
    var next = existing.filter(function (r) { return r && r.id !== swapId; });
    var res = await c.from("app_state").upsert({ key: swapsKey(ymA), value: next });
    if (res.error) throw res.error;
    return rec;
  }

  async function recordSwap(payload) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var dA = new Date(payload.dateA + "T12:00:00");
    var dB = new Date(payload.dateB + "T12:00:00");
    if (isNaN(dA) || isNaN(dB)) throw new Error("Bad swap dates.");
    if (dB <= dA) throw new Error("Swap-back date must be after the swap day.");
    var ymA = ymForDate(dA), ymB = ymForDate(dB);
    if (ymA !== ymB) throw new Error("Swap-back must be in the same payroll cycle (before the 25th of next month).");
    var dayA = String(dA.getDate()), dayB = String(dB.getDate());
    await setAttendanceStatus(ymA, dayA, payload.oweEc,   "swap_o");
    await setAttendanceStatus(ymA, dayA, payload.coverEc, "swap_i");
    await setAttendanceStatus(ymB, dayB, payload.coverEc, "swap_o");
    await setAttendanceStatus(ymB, dayB, payload.oweEc,   "swap_i");
    var existing = await getSwaps(ymA);
    var rec = {
      id: "sw_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      dateA: payload.dateA, dateB: payload.dateB,
      oweEc: payload.oweEc, oweName: payload.oweName || "",
      coverEc: payload.coverEc, coverName: payload.coverName || "",
      createdAt: new Date().toISOString()
    };
    existing.push(rec);
    var res = await c.from("app_state").upsert({ key: swapsKey(ymA), value: existing });
    if (res.error) throw res.error;
    return rec;
  }

  // ---------- Extra-day approvals ----------
  async function getExtras(ym) {
    var c = client(); if (!c) return {};
    var res = await c.from("app_state").select("value").eq("key", extrasKey(ym)).maybeSingle();
    if (res.error) { console.error("getExtras:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }

  async function recordExtraDay(ym, dayKey, ec, approvedBy) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    if (!approvedBy || approvedBy.trim().length < 2) throw new Error("Approver name is required to mark an Extra Day.");
    var approverName = approvedBy.trim();
    var nowIso       = new Date().toISOString();

    // We deliberately DON'T write "ext" to the attendance grid here.
    // The Extra Day designation is stored only in the extras sidecar, so
    // the manager can later tag the actual attendance (on time / late /
    // sick / etc.) on top of it without losing the "extra cover" flag.
    // The HR portal cross-references the extras sidecar to identify
    // Extra Day workers regardless of their on-the-day attendance code.
    var existing = await getExtras(ym);
    var data = JSON.parse(JSON.stringify(existing || {}));
    if (!data[dayKey]) data[dayKey] = {};
    data[dayKey][ec] = { approvedBy: approverName, approvedAt: nowIso };
    var res = await c.from("app_state").upsert({ key: extrasKey(ym), value: data });
    if (res.error) throw res.error;

    // Push an audit-log entry directly — setAttendanceStatus used to do
    // this for us as a side-effect, but we've broken that linkage.
    try {
      // Same START-month log bucket setAttendanceStatus writes to (attKey
      // shifts the END-month cycle key back one month).
      var logKey = "boa_kiosk_log_" + branch() + "_" + attKey(ym).split("_").pop();
      var prior  = await c.from("app_state").select("value").eq("key", logKey).maybeSingle();
      var log    = (prior.data && Array.isArray(prior.data.value)) ? prior.data.value : [];
      // ym here is the END-month cycle key (ymForDate names the 25th→24th
      // cycle by the month its 24th falls in; extrasKey uses it directly).
      // Days 25..31 therefore belong to the PREVIOUS calendar month and days
      // 1..24 to ym's own month. The old math assumed a START-month base
      // (like setAttendanceStatus, which first shifts ym back via attKey), so
      // every extra day logged here carried a ymd exactly ONE MONTH IN THE
      // FUTURE — and surfaced in the portal's Daily Check-ins as a phantom
      // EXTRA a month later, at the branch it was originally marked at.
      var cycP = ym.split("-");
      var cycY = +cycP[0], cycM = +cycP[1];
      var dayN = parseInt(dayKey, 10);
      var dt;
      if (dayN >= 25) { var pm = cycM - 1, py = cycY; if (pm < 1) { pm = 12; py -= 1; } dt = new Date(py, pm - 1, dayN); }
      else { dt = new Date(cycY, cycM - 1, dayN); }
      var ymd = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
      log.push({
        ec: ec, dayKey: String(dayKey), ymd: ymd,
        status: "ext",
        note:   "Approved by " + approverName,
        hasProof: false, proofKey: null,
        ts: nowIso
      });
      if (log.length > 5000) log = log.slice(-5000);
      await c.from("app_state").upsert({ key: logKey, value: log });
    } catch (e) { console.warn("extra-day audit log failed (non-fatal):", e); }

    return data[dayKey][ec];
  }

  // ---------- Absences ----------
  async function getAbsences(ym) {
    var c = client(); if (!c) return {};
    var res = await c.from("app_state").select("value").eq("key", absencesKey(ym)).maybeSingle();
    if (res.error) { console.error("getAbsences:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }

  async function recordAbsence(ym, dayKey, ec, reason) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    if (!reason || reason.trim().length < 2) {
      throw new Error("A reason is required to mark someone Absent. If there's no communication, use NO SHOW instead.");
    }
    // Pass the reason as the audit-log note so HR portal Daily Check-ins shows it inline.
    await setAttendanceStatus(ym, dayKey, ec, "absent", reason.trim());
    var existing = await getAbsences(ym);
    var data = JSON.parse(JSON.stringify(existing || {}));
    if (!data[dayKey]) data[dayKey] = {};
    data[dayKey][ec] = { reason: reason.trim(), recordedAt: new Date().toISOString() };
    var res = await c.from("app_state").upsert({ key: absencesKey(ym), value: data });
    if (res.error) throw res.error;
    return data[dayKey][ec];
  }

  async function clearAbsence(ym, dayKey, ec) {
    var c = client(); if (!c) return;
    var existing = await getAbsences(ym);
    var data = JSON.parse(JSON.stringify(existing || {}));
    if (data[dayKey] && data[dayKey][ec]) {
      delete data[dayKey][ec];
      if (Object.keys(data[dayKey]).length === 0) delete data[dayKey];
    }
    var res = await c.from("app_state").upsert({ key: absencesKey(ym), value: data });
    if (res.error) throw res.error;
  }

  // ---------- Early-leave (left early) sidecar ----------
  // Records that a tech left early on a given day, and how many hours.
  // HR PORTAL CONTRACT
  //   key:   "boa_early_<branch>_<startMonthYm>"   (one row per branch+payroll-cycle)
  //   shape: { [dayKey]: { [employee_code]: { hours, recordedAt, recordedBy } } }
  //     - startMonthYm   START-month of the 25-to-24 payroll cycle (e.g. the
  //                      "Apr 25 → May 24, 2026" cycle is stored as 2026-04).
  //                      This matches the attendance-grid key convention so
  //                      the HR portal can load both with the same ym.
  //     - dayKey         day-of-month string ("1".."31") matching the
  //                      attendance grid's day keys for this cycle
  //     - hours          positive number, 0.5 step. The HR portal deducts
  //                      this many hours from the tech's pay for that day.
  //     - recordedAt     ISO timestamp
  //     - recordedBy     manager name (optional, free text)
  //   The HR portal should subtract `hours` from each tech's day total on
  //   the attendance / payroll grid. Clearing the entry restores the day.
  function earlyKey(ym) {
    // Mirror attKey's end-month → start-month conversion so the HR portal
    // (which uses start-month for everything) finds our writes.
    var p = ym.split("-");
    var y = +p[0], m = +p[1] - 1;
    if (m < 1) { m = 12; y -= 1; }
    return "boa_early_" + branch() + "_" + y + "-" + String(m).padStart(2, "0");
  }

  async function getEarlyLeaves(ym) {
    var c = client(); if (!c) return {};
    var res = await c.from("app_state").select("value").eq("key", earlyKey(ym)).maybeSingle();
    if (res.error) { console.error("getEarlyLeaves:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }

  async function recordEarlyLeave(ym, dayKey, ec, hours, recordedBy, opts) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var h = Number(hours);
    if (!isFinite(h) || h <= 0) throw new Error("Hours must be a positive number.");
    if (h > 12) throw new Error("Hours can't exceed 12 — please double-check.");
    // Round to 30-minute intervals (0.5h) to keep payroll numbers clean.
    h = Math.round(h * 2) / 2;
    var existing = await getEarlyLeaves(ym);
    var data = JSON.parse(JSON.stringify(existing || {}));
    if (!data[dayKey]) data[dayKey] = {};
    // Optional reason / note added later for managers' early-out picker.
    // Older rows just have { hours, recordedAt, recordedBy } — the new
    // fields are appended and the HR portal treats them as optional.
    var reasonCode = opts && opts.reasonCode ? String(opts.reasonCode) : null;
    var reasonNote = opts && opts.reasonNote ? String(opts.reasonNote).trim() : null;
    var approver   = opts && opts.approver   ? String(opts.approver).trim()   : null;
    data[dayKey][ec] = {
      hours:       h,
      recordedAt:  new Date().toISOString(),
      recordedBy:  (recordedBy || "").trim() || null,
      reasonCode:  reasonCode,
      reasonNote:  reasonNote || null,
      approver:    approver || null
    };
    var res = await c.from("app_state").upsert({ key: earlyKey(ym), value: data });
    if (res.error) throw res.error;
    // Mirror into the kiosk audit log so the HR portal's Daily Check-ins tab
    // can show the deduction inline next to the tech's status for that day.
    // Key + calendar math both use the START-month of the cycle, matching
    // the convention setAttendanceStatus uses for its own log writes.
    try {
      var sp = ym.split("-");
      var sY = +sp[0], sM = +sp[1] - 1;
      if (sM < 1) { sM = 12; sY -= 1; }
      var startYm = sY + "-" + String(sM).padStart(2, "0");
      var logKey  = "boa_kiosk_log_" + branch() + "_" + startYm;
      // Compute the actual calendar date the dayKey falls on within this
      // start-month cycle: 25..31 → start month itself; 1..24 → next month.
      var dayN = parseInt(dayKey, 10);
      var dt;
      if (dayN >= 25) { dt = new Date(sY, sM - 1, dayN); }
      else { var nm = sM + 1, ny = sY; if (nm > 12) { nm = 1; ny += 1; } dt = new Date(ny, nm - 1, dayN); }
      var ymd = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");

      var prior  = await c.from("app_state").select("value").eq("key", logKey).maybeSingle();
      var log    = (prior.data && Array.isArray(prior.data.value)) ? prior.data.value : [];
      log.push({
        ec: ec, dayKey: String(dayKey), ymd: ymd,
        status:   "left_early",
        note:     "Left " + h + "h early" + (data[dayKey][ec].recordedBy ? " · recorded by " + data[dayKey][ec].recordedBy : ""),
        hours:    h,
        hasProof: false, proofKey: null,
        ts: new Date().toISOString()
      });
      if (log.length > 5000) log = log.slice(-5000);
      await c.from("app_state").upsert({ key: logKey, value: log });
    } catch (e) { console.warn("early-leave kiosk log failed (non-fatal):", e); }
    return data[dayKey][ec];
  }

  async function clearEarlyLeave(ym, dayKey, ec) {
    var c = client(); if (!c) return;
    var existing = await getEarlyLeaves(ym);
    var data = JSON.parse(JSON.stringify(existing || {}));
    if (data[dayKey] && data[dayKey][ec]) {
      delete data[dayKey][ec];
      if (Object.keys(data[dayKey]).length === 0) delete data[dayKey];
    }
    var res = await c.from("app_state").upsert({ key: earlyKey(ym), value: data });
    if (res.error) throw res.error;
  }

  // ---------- Proof images ----------
  async function setProof(ym, ec, day, dataUrl) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var res = await c.from("app_state").upsert({ key: proofKey(ym, ec, day), value: { __raw: dataUrl } });
    if (res.error) throw res.error;
  }

  async function getProof(ym, ec, day) {
    var c = client(); if (!c) return null;
    var res = await c.from("app_state").select("value").eq("key", proofKey(ym, ec, day)).maybeSingle();
    if (res.error) { console.error("getProof:", res.error); return null; }
    var v = res.data && res.data.value;
    if (v && typeof v === "object" && v.__raw) return v.__raw;
    if (typeof v === "string") return v;
    return null;
  }

  // ---------- Daily sign-off record ----------
  async function getDailyRecord(date) {
    var c = client(); if (!c) return null;
    var ymd = isoDate(date);
    var res = await c.from("app_state").select("value").eq("key", dailyKey(ymd)).maybeSingle();
    if (res.error) { console.error("getDailyRecord:", res.error); return null; }
    return (res.data && res.data.value) || null;
  }

  async function saveDailyRecord(date, signedBy, signedRole, staffCount) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var rec = {
      branch: branch(), date: isoDate(date),
      signedBy: (signedBy || "").trim(), signedRole: (signedRole || "").trim(),
      signedAt: new Date().toISOString(), staffCount: staffCount || 0
    };
    var res = await c.from("app_state").upsert({ key: dailyKey(rec.date), value: rec });
    if (res.error) throw res.error;
    return rec;
  }

  // ---------- Schedule ----------
  function currentSchedYm() {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
    if (d.getDate() > 24) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + "-" + String(m).padStart(2, "0");
  }

  function periodLabel(ym) {
    var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var p = ym.split("-"); var y = +p[0], m = +p[1];
    var sm = m === 1 ? 12 : m - 1;
    var sy = m === 1 ? y - 1 : y;
    return months[sm - 1] + " 25" + (sy !== y ? ", " + sy : "") +
           " — " + months[m - 1] + " 24, " + y;
  }

  function periodDays(ym) {
    var p = ym.split("-"); var y = +p[0], m = +p[1];
    var prevMonth = m === 1 ? 12 : m - 1;
    var prevYear  = m === 1 ? y - 1 : y;
    var lastPrev  = new Date(prevYear, prevMonth, 0).getDate();
    var todayStr  = new Date().toDateString();
    var out = [];
    for (var d = 25; d <= lastPrev; d++) {
      var dt = new Date(prevYear, prevMonth - 1, d);
      out.push({ day: d, monthIdx: prevMonth - 1, year: prevYear, isToday: dt.toDateString() === todayStr });
    }
    for (var d2 = 1; d2 <= 24; d2++) {
      var dt2 = new Date(y, m - 1, d2);
      out.push({ day: d2, monthIdx: m - 1, year: y, isToday: dt2.toDateString() === todayStr });
    }
    return out;
  }

  // kind: undefined  → combined tech + manager grids (legacy behaviour).
  // kind: "tech"     → tech schedule only.
  // kind: "mgr"      → manager schedule only, with cells re-keyed from
  //                    YYYY-MM-DD to day-of-month so the kiosk's render
  //                    code can read them just like the tech grid.
  //
  // IMPORTANT: ym key convention mismatch between tech and manager.
  // The HR portal saves these under DIFFERENT keys for the same cycle:
  //   - tech schedule: end-month ym  (cycle 25 Apr → 24 May → "2026-05")
  //   - mgr schedule:  start-month ym (same cycle → "2026-04")
  //   - attendance:    start-month ym
  // The kiosk's currentSchedYm() / _nextSchedYm() return end-month,
  // matching the tech convention. For the manager view we have to
  // translate the incoming ym back one month before looking it up;
  // otherwise we load a row from the wrong cycle (or nothing at all).
  function _toStartMonthYm(endYm) {
    if (!endYm) return endYm;
    var p = endYm.split("-"); var y = +p[0], m = +p[1] - 1;
    if (m < 1) { m = 12; y -= 1; }
    return y + "-" + String(m).padStart(2, "0");
  }
  // Collapse a manager row's keys to day-of-month, CYCLE-AWARE. Manager grids
  // can carry the same day under two key styles (a bare day number and a full
  // date), and may also hold stray full-date keys from OTHER months. A blind
  // collapse throws the month away, so e.g. "2026-05-10" lands on day 10 and
  // can overwrite the real 10 June cell depending on key order — which is why
  // the kiosk could show a different shift than the HR portal (whose readers
  // resolve by exact date). Mirror the portal's precedence instead: an
  // in-cycle full-date key always wins over a bare day number; out-of-cycle
  // full-date keys are dropped. `ym` is the cycle's END-month.
  function _collapseMgrRow(row2, ym) {
    var conv = {};
    var fromYmd = {};   // day-of-month → true when set from an in-cycle full date
    var ymP = String(ym).split("-");
    var cEy = parseInt(ymP[0], 10), cEm = parseInt(ymP[1], 10);
    var cSy = cEm === 1 ? cEy - 1 : cEy, cSm = cEm === 1 ? 12 : cEm - 1;
    var cycStart = cSy + "-" + String(cSm).padStart(2, "0") + "-25";
    var cycEnd   = cEy + "-" + String(cEm).padStart(2, "0") + "-24";
    Object.keys(row2 || {}).forEach(function (k) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
      if (m) {
        if (k < cycStart || k > cycEnd) return;        // stray date from another cycle — ignore
        // Mirror the HR portal Manager Coverage readCell (row[ymd] || row[dom]):
        // an in-cycle full-date key only wins when it actually holds a value. An
        // EMPTY full-date cell must NOT shadow a real bare day-number code —
        // otherwise the kiosk falls through to the stale approved snapshot and
        // shows the wrong shift (e.g. W instead of WL, or WE instead of WL).
        var _val = row2[k];
        if (_val === "" || _val == null) return;
        conv[parseInt(m[3], 10)] = _val;
        fromYmd[parseInt(m[3], 10)] = true;
      } else {
        var dn = parseInt(k, 10);
        var bare = String(dn) === String(k).trim() && dn >= 1 && dn <= 31;
        if (bare) { if (!fromYmd[dn]) conv[dn] = row2[k]; }
        else conv[k] = row2[k];
      }
    });
    return conv;
  }
  async function getSchedule(ym, kind) {
    var c = client(); if (!c) return { grid: {}, ym: ym, kind: kind || "combined" };
    var br = branch();
    // Tech keeps end-month; manager re-maps to start-month.
    var mgrYm = _toStartMonthYm(ym);
    var techKey = "boa_sched_"    + br + "_" + ym;
    var mgrKey  = "boa_mgrsched_" + br + "_" + mgrYm;
    var keys;
    if (kind === "tech")      keys = [techKey];
    else if (kind === "mgr")  keys = [mgrKey];
    else                       keys = [techKey, mgrKey];
    var res = await c.from("app_state").select("key,value").in("key", keys);
    if (res.error) { console.error("getSchedule:", res.error); return { grid: {}, ym: ym, kind: kind || "combined" }; }
    var combined = {};
    var names = {};   // ec → name saved alongside the grid (used to re-home legacy code rows)
    (res.data || []).forEach(function (row) {
      var grid = (row.value && row.value.grid) || {};
      var nm   = (row.value && row.value.names) || {};
      Object.keys(nm).forEach(function (ec) { if (names[ec] == null) names[ec] = nm[ec]; });
      var isMgr = row.key === mgrKey;
      Object.keys(grid).forEach(function (ec) {
        combined[ec] = isMgr ? _collapseMgrRow(grid[ec], ym) : grid[ec];
      });
    });
    return { grid: combined, names: names, ym: ym, kind: kind || "combined" };
  }
  // Most recent APPROVED schedule snapshot for this branch + cycle, collapsed
  // the same way as getSchedule. The HR portal's Manager Coverage view falls
  // back to this per cell when the live grid has no value for a manager+day —
  // the kiosk mirrors that so both always show the same shift.
  async function getApprovedSchedule(ym, kind) {
    var c = client(); if (!c) return { grid: {}, names: {}, ym: ym };
    var br = branch();
    var isMgr = kind === "mgr";
    var key = (isMgr ? "boa_mgrschedapproved_" : "boa_schedapproved_") + br + "_" + (isMgr ? _toStartMonthYm(ym) : ym);
    var res = await c.from("app_state").select("value").eq("key", key).maybeSingle();
    if (res.error) { console.error("getApprovedSchedule:", res.error); return { grid: {}, names: {}, ym: ym }; }
    var list = res.data && res.data.value;
    var top = (Array.isArray(list) && list.length > 0) ? list[0] : null;   // newest first
    var grid = (top && top.grid) || {};
    var out = {};
    Object.keys(grid).forEach(function (ec) {
      out[ec] = isMgr ? _collapseMgrRow(grid[ec], ym) : grid[ec];
    });
    return { grid: out, names: (top && top.names) || {}, ym: ym };
  }
  // Per-manager custom shift hours set in the HR portal coverage view.
  // Shared global key, keyed { [ec]: { "YYYY-MM-DD": "HH:MM - HH:MM" } }.
  // The Manager Schedule view layers these over the computed shift times
  // so a manager's one-off early-open / late-close hours show on the day.
  async function getMgrTimes() {
    var c = client(); if (!c) return {};
    var res = await c.from("app_state").select("value").eq("key", "boa_mgr_times_v1").maybeSingle();
    if (res.error) { console.error("getMgrTimes:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  // Batched cross-branch schedule load: { branchName -> merged grid }.
  // Used by the manager "Borrow Tech" picker to filter the candidate pool
  // to only techs who are scheduled to work TODAY at their home branch.
  async function getSchedulesForBranches(branches, ym) {
    if (!branches || !branches.length) return {};
    var c = client(); if (!c) return {};
    var keys = [];
    branches.forEach(function (br) {
      keys.push("boa_sched_"    + br + "_" + ym);
      keys.push("boa_mgrsched_" + br + "_" + ym);
    });
    var res = await c.from("app_state").select("key,value").in("key", keys);
    if (res.error) { console.error("getSchedulesForBranches:", res.error); return {}; }
    var byBranch = {};
    (res.data || []).forEach(function (row) {
      var k = row.key || "";
      var m = k.match(/^(boa_(?:mgr)?sched)_(.+?)_(\d{4}-\d{2})$/);
      if (!m) return;
      var br = m[2];
      var grid = (row.value && row.value.grid) || {};
      byBranch[br] = byBranch[br] || {};
      Object.keys(grid).forEach(function (ec) {
        byBranch[br][ec] = grid[ec];
      });
    });
    return byBranch;
  }

  // ---------- News ----------
  async function listNews() {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", "boa_news_v1").maybeSingle();
    if (res.error) { console.error("listNews:", res.error); return []; }
    var v = res.data && res.data.value;
    if (!Array.isArray(v)) return [];
    // Extra-Day announcements auto-expire from the feed off the live offer:
    //  • "offer" (✨ available) posts show while the offer is still OPEN,
    //  • "filled" (✅ filled) posts show while the offer is still FILLED.
    // Either drops once the work day has passed, the offer was deleted, or its
    // status changed (cancelled / reversed). Posts without an edOfferId (plain
    // announcements, and legacy untagged ones) pass through untouched. We only
    // do the lookup if at least one tagged post exists.
    var hasEdPost = v.some(function (n) { return n && n.edOfferId; });
    if (!hasEdPost) return v;
    var offerById = {};
    var today;
    try {
      var offers = await loadEdOffers();
      today = (function () { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })();
      (offers || []).forEach(function (o) { if (o && o.id) offerById[o.id] = o; });
    } catch (e) { return v; }   // on any error, don't hide anything
    return v.filter(function (n) {
      if (!n || !n.edOfferId) return true;                  // not a tagged ED post
      var o = offerById[n.edOfferId];
      if (!o) return false;                                 // offer gone → drop
      if (String(o.date || "") < today) return false;       // work day passed → drop
      return o.status === (n.edKind === "filled" ? "filled" : "open");
    });
  }

  // ---------- Store open gate (NEW) ----------
  // One Supabase key per branch per day. The HR portal can scan keys with the
  // prefix "boa_store_open_" and a known date suffix to build a per-day
  // "stores opened" overview across all branches.
  function storeOpenKey(ymd) { return "boa_store_open_" + branch() + "_" + ymd; }

  async function getStoreOpenedToday() {
    var c = client(); if (!c) return null;
    var res = await c.from("app_state").select("value").eq("key", storeOpenKey(todayStr())).maybeSingle();
    if (res.error) { console.error("getStoreOpenedToday:", res.error); return null; }
    var v = res.data && res.data.value;
    return (v && v.openedAt) ? v : null;
  }

  async function markStoreOpened(openedBy) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var name = (openedBy || "").trim();
    if (name.length < 2) throw new Error("Please enter your name.");
    // First open of the day WINS — if the store is already marked open today,
    // keep the original time + opener. Re-taps (e.g. after a re-sign-in that
    // re-shows the open-store gate) must NOT overwrite the real opening time.
    var existing = await getStoreOpenedToday();
    if (existing && existing.openedAt) return existing;
    var rec = {
      branch:    branch(),
      date:      todayStr(),
      openedBy:  name,
      openedAt:  new Date().toISOString()
    };
    var res = await c.from("app_state").upsert({ key: storeOpenKey(todayStr()), value: rec });
    if (res.error) throw res.error;
    return rec;
  }

  // ---------- Off-day requests ----------
  var TECH_REQUESTS_KEY = "boa_tech_requests_v1";
  var MGR_REQUESTS_KEY  = "boa_mgr_requests_v1";

  // The schedule month open for off-day requests. Requests for a schedule
  // month close on the 20th of the month before it (a schedule month runs
  // the 25th → 24th, so its end-month is the ym we return). Up to and
  // including the 20th the open month is two months out; from the 21st that
  // window has closed, so we open the following month. e.g. on 26 May the
  // June window (closes 20 May) is shut, so July (25 Jun → 24 Jul) is open.
  function nextMonthYm() {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 2;
    if (d.getDate() > 20) m += 1;
    while (m > 12) { m -= 12; y += 1; }
    return y + "-" + String(m).padStart(2, "0");
  }
  function nextMonthLabel() {
    var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var p = nextMonthYm().split("-");
    return months[+p[1] - 1] + " " + p[0];
  }

  function scheduleDayToDate(targetYm, dayNum) {
    var p = targetYm.split("-"); var y = +p[0], m = +p[1];
    if (dayNum >= 25) {
      var pm = m === 1 ? 12 : m - 1;
      var py = m === 1 ? y - 1 : y;
      return new Date(py, pm - 1, dayNum);
    }
    return new Date(y, m - 1, dayNum);
  }

  function isoDate(d) {
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  async function _loadRequestsAt(key) {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", key).maybeSingle();
    if (res.error) { console.error("loadRequests(" + key + "):", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function _saveRequestsAt(key, arr) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var res = await c.from("app_state").upsert({ key: key, value: arr || [] });
    if (res.error) throw res.error;
    return arr;
  }
  function _loadAllTechRequests() { return _loadRequestsAt(TECH_REQUESTS_KEY); }
  function _saveAllTechRequests(arr) { return _saveRequestsAt(TECH_REQUESTS_KEY, arr); }
  function _loadAllMgrRequests()  { return _loadRequestsAt(MGR_REQUESTS_KEY); }
  function _saveAllMgrRequests(arr)  { return _saveRequestsAt(MGR_REQUESTS_KEY, arr); }
  // Head Office off-day requests live in their OWN key so they never leak into
  // salon schedule generation (which reads the tech/mgr keys). One bucket — HO
  // has no manager/tech split. NOTE: no portal surface reads this key yet — the
  // requests board + department→approver routing (boa_ho_routing_v1) land in
  // Phase 5. Until then an HO off-request is stored but not actionable by an
  // approver; do not treat "submitted" as "will be seen".
  var HO_REQUESTS_KEY = "boa_ho_requests_v1";
  function _loadAllHoRequests()   { return _loadRequestsAt(HO_REQUESTS_KEY); }
  function _saveAllHoRequests(arr)   { return _saveRequestsAt(HO_REQUESTS_KEY, arr); }

  // ---------- Extra-Day (ED) offers + requests ----------
  // Offers are PUBLISHED by Ops in the portal (boa_mgr_ed_offers_v1); the kiosk
  // reads OPEN ones to alert managers, and writes their claims into
  // boa_mgr_ed_requests_v1. Approval (which applies the schedule change) happens
  // back in the portal. Reuse the generic request load/save helpers above.
  var ED_OFFERS_KEY   = "boa_mgr_ed_offers_v1";
  var ED_REQUESTS_KEY = "boa_mgr_ed_requests_v1";
  function loadEdOffers()   { return _loadRequestsAt(ED_OFFERS_KEY); }
  function loadEdRequests() { return _loadRequestsAt(ED_REQUESTS_KEY); }
  // Append a pending claim. Read-modify-write; a manager can hold only ONE
  // active (pending/approved) request per offer — idempotent re-claim.
  async function requestEd(rec) {
    rec = rec || {};
    if (!rec.offerId || !rec.ec) throw new Error("Missing offer or manager.");
    var arr = await loadEdRequests();
    var ecK = String(rec.ec).trim();
    var dup = arr.find(function (r) {
      return r && r.offerId === rec.offerId && String(r.ec).trim() === ecK
        && (r.status === "pending" || r.status === "approved");
    });
    if (dup) return dup;
    var row = {
      id: "edr_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      offerId: rec.offerId, ec: ecK, name: rec.name || "", homeBranch: rec.homeBranch || "",
      status: "pending", requestedAt: new Date().toISOString()
    };
    arr.push(row);
    await _saveRequestsAt(ED_REQUESTS_KEY, arr);
    return row;
  }
  // A manager cancels their OWN pending request.
  async function cancelEdRequest(requestId, ec) {
    var arr = await loadEdRequests();
    var ecK = String(ec || "").trim();
    var idx = arr.findIndex(function (r) {
      return r && r.id === requestId && String(r.ec).trim() === ecK && r.status === "pending";
    });
    if (idx < 0) return false;
    arr[idx] = Object.assign({}, arr[idx], { status: "cancelled", cancelledAt: new Date().toISOString() });
    await _saveRequestsAt(ED_REQUESTS_KEY, arr);
    return true;
  }

  async function listOffRequests(targetYm) {
    var c = client(); if (!c) return [];
    var p = targetYm.split("-"); var y = +p[0], m = +p[1];
    var prevMonth = m === 1 ? 12 : m - 1;
    var prevYear  = m === 1 ? y - 1 : y;
    var startIso  = isoDate(new Date(prevYear, prevMonth - 1, 25));
    var endIso    = isoDate(new Date(y, m - 1, 24));
    var br = branch();
    var allRequests;
    if (isHeadOfficeBranch(br)) {
      allRequests = await _loadAllHoRequests();
    } else {
      var techRequests = await _loadAllTechRequests();
      var mgrRequests  = await _loadAllMgrRequests();
      allRequests  = techRequests.concat(mgrRequests);
    }
    var byEc = {};
    allRequests.forEach(function (r) {
      if (!r || r.branch !== br) return;
      if (!r.date || r.date < startIso || r.date > endIso) return;
      if (!byEc[r.ec]) byEc[r.ec] = {
        id: "tx_" + r.ec, ec: r.ec, name: r.name || "",
        dates: [], days: [], notes: [], ts: 0, source: "explicit"
      };
      var g = byEc[r.ec];
      g.dates.push(r.date);
      g.days.push(parseInt(r.date.split("-")[2], 10));
      if (r.note) g.notes.push(r.note);
      var ts = r.addedAt ? new Date(r.addedAt).getTime() : 0;
      if (ts > g.ts) g.ts = ts;
    });
    var explicit = Object.keys(byEc).map(function (k) {
      var g = byEc[k];
      g.dates.sort();
      g.days.sort(function (a, b) { return a - b; });
      g.notes = g.notes.join("; ");
      return g;
    });

    var sched = await getSchedule(targetYm);
    var grid = (sched && sched.grid) || {};
    var staffList = await listStaff({ activeOnly: false });
    var staffByEc = {};
    staffList.forEach(function (s) { if (s.employee_code) staffByEc[s.employee_code] = s; });

    var derived = [];
    Object.keys(grid).forEach(function (ec) {
      var rDates = [], rDays = [];
      Object.keys(grid[ec]).forEach(function (day) {
        if (grid[ec][day] === "R") {
          var n = parseInt(day, 10);
          rDays.push(n);
          rDates.push(isoDate(scheduleDayToDate(targetYm, n)));
        }
      });
      if (rDates.length > 0) {
        var staff = staffByEc[ec];
        rDays.sort(function (a, b) { return a - b; });
        rDates.sort();
        derived.push({
          id: "sched-" + ec + "-" + targetYm, ec: ec,
          name: (staff && staff.name) || ec,
          days: rDays, dates: rDates,
          notes: "Approved off in HR portal schedule",
          ts: 0, source: "schedule"
        });
      }
    });

    derived.sort(function (a, b)  { return (a.name || "").localeCompare(b.name || ""); });
    explicit.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    return derived.concat(explicit);
  }

  async function addOffRequest(targetYm, payload) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    // Head Office writes to its own key regardless of the record's roleType —
    // HO is one bucket and must never touch the salon tech/mgr request arrays.
    var isHo = isHeadOfficeBranch(branch());
    var isManager = !isHo && payload && payload.roleType === "manager";
    var loadFn = isHo ? _loadAllHoRequests : (isManager ? _loadAllMgrRequests : _loadAllTechRequests);
    var saveFn = isHo ? _saveAllHoRequests : (isManager ? _saveAllMgrRequests : _saveAllTechRequests);
    var existing = await loadFn();
    var br = branch();
    var dates = (payload.dates || []).slice();
    if (dates.length === 0 && Array.isArray(payload.days)) {
      var p = targetYm.split("-"); var year = +p[0], month = +p[1];
      dates = payload.days.map(function (day) {
        return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      });
    }
    var nowIso = new Date().toISOString();
    var stamp = Date.now();
    var newRecords = dates.map(function (ymd, idx) {
      return {
        id: "tr_" + stamp + "_" + idx + "_" + Math.random().toString(36).slice(2, 7),
        ec: payload.ec || null, name: payload.name || "",
        branch: br, date: ymd,
        note: (payload.notes || "").trim(),
        addedAt: nowIso, source: "checkin"
      };
    });
    var newKeys = {};
    newRecords.forEach(function (r) { newKeys[r.ec + "|" + r.date] = true; });
    var keptExisting = existing.filter(function (r) {
      return !(r && r.ec && r.date && newKeys[r.ec + "|" + r.date]);
    });
    var arr = keptExisting.concat(newRecords);
    await saveFn(arr);
    return newRecords[0] || null;
  }

  async function deleteOffRequest(targetYm, id) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var br = branch();
    var p = targetYm.split("-"); var y = +p[0], m = +p[1];
    var prevMonth = m === 1 ? 12 : m - 1;
    var prevYear  = m === 1 ? y - 1 : y;
    var startIso  = isoDate(new Date(prevYear, prevMonth - 1, 25));
    var endIso    = isoDate(new Date(y, m - 1, 24));
    var isSynthetic = id && id.indexOf("tx_") === 0;
    var ec = isSynthetic ? id.slice(3) : null;

    function applyFilter(list) {
      if (isSynthetic) {
        return list.filter(function (r) {
          if (!r || r.branch !== br) return true;
          if (r.ec !== ec) return true;
          if (!r.date || r.date < startIso || r.date > endIso) return true;
          return false;
        });
      }
      return list.filter(function (r) { return r && r.id !== id; });
    }

    // Head Office deletes only touch the HO key (its requests live nowhere else).
    if (isHeadOfficeBranch(br)) {
      var hoExisting = await _loadAllHoRequests();
      var hoNext = applyFilter(hoExisting);
      if (hoNext.length !== hoExisting.length) await _saveAllHoRequests(hoNext);
      return;
    }

    var techExisting = await _loadAllTechRequests();
    var techNext = applyFilter(techExisting);
    if (techNext.length !== techExisting.length) await _saveAllTechRequests(techNext);

    var mgrExisting = await _loadAllMgrRequests();
    var mgrNext = applyFilter(mgrExisting);
    if (mgrNext.length !== mgrExisting.length) await _saveAllMgrRequests(mgrNext);
  }

  async function listTrialCandidates() {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", "boa_trial_period_v1").maybeSingle();
    if (res.error) { console.error("listTrialCandidates:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }

  async function recordTrialCheckin(candidateId, status) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var res = await c.from("app_state").select("value").eq("key", "boa_trial_period_v1").maybeSingle();
    if (res.error) throw res.error;
    var v = res.data && res.data.value;
    var list = Array.isArray(v) ? v : [];
    
    var candidate = list.find(function(item) { return String(item._id) === String(candidateId); });
    if (!candidate) throw new Error("Candidate not found");
    
    var today = todayStr();
    if (!candidate.checkins || Array.isArray(candidate.checkins)) candidate.checkins = {};
    
    candidate.checkins[today] = status;
    candidate.updatedAt = new Date().toISOString();
    
    var up = await c.from("app_state").upsert({ key: "boa_trial_period_v1", value: list });
    if (up.error) throw up.error;

    return candidate;
  }

  // Persist a completed trial evaluation (week-1 "mid" or week-2 "final") onto
  // the candidate's record and, in the SAME write, advance their trial status
  // when they pass. This is what makes the trial self-driving from the store:
  // the manager fills the form on the kiosk, and the HR portal simply reflects
  // the new status the next time it loads.
  //   evalKey   — "midEval" | "finalEval"
  //   evalObj   — { submittedAt, submittedBy, scores, total, max, pass, keyOk, heldForHr, notes }
  //   newStatus — the status to move the candidate to (or null to leave as-is;
  //               used when an evaluation falls below the pass mark and must be
  //               held for an HR decision instead of auto-advancing).
  async function saveTrialEvaluation(candidateId, evalKey, evalObj, newStatus) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var res = await c.from("app_state").select("value").eq("key", "boa_trial_period_v1").maybeSingle();
    if (res.error) throw res.error;
    var v = res.data && res.data.value;
    var list = Array.isArray(v) ? v : [];
    var candidate = list.find(function (item) { return String(item._id) === String(candidateId); });
    if (!candidate) throw new Error("Candidate not found");
    candidate[evalKey] = evalObj;
    if (newStatus) candidate.status = newStatus;
    candidate.updatedAt = new Date().toISOString();
    var up = await c.from("app_state").upsert({ key: "boa_trial_period_v1", value: list });
    if (up.error) throw up.error;
    return candidate;
  }

  window.APP_DATA = {
    isConfigured: isConfigured,
    isManagerRow: isManagerRow,
    branch: branch, branchDisplay: branchDisplay, todayStr: todayStr,
    listStaff: listStaff, listMaternity: listMaternity, listUnpaidLegal: listUnpaidLegal, listLeaveRecords: listLeaveRecords, loadOffboarding: loadOffboarding,
    listTechLoans: listTechLoans, saveTechLoan: saveTechLoan, listStaffAllBranches: listStaffAllBranches,
    calledInTodayForBranch: calledInTodayForBranch,
    listTransfersInto: listTransfersInto,
    listKioskReminders: listKioskReminders,
    listTrialCandidates: listTrialCandidates,
    recordTrialCheckin: recordTrialCheckin,
    saveTrialEvaluation: saveTrialEvaluation,
    markKioskReminderDone: markKioskReminderDone,
    markKioskReminderUndone: markKioskReminderUndone,
    categorizeStaff: categorizeStaff, listOffRequestStaff: listOffRequestStaff, addStaff: addStaff, updateStaff: updateStaff,
    deactivateStaff: deactivateStaff,
    lastClockinToday: lastClockinToday, addClockin: addClockin, listTodayClockins: listTodayClockins,
    todaysCashup: todaysCashup, cashupForDate: cashupForDate, outstandingCashupDates: outstandingCashupDates, addCashup: addCashup, listRecentCashups: listRecentCashups,
    currentSchedYm: currentSchedYm, periodLabel: periodLabel, periodDays: periodDays, getSchedule: getSchedule, getApprovedSchedule: getApprovedSchedule, getSchedulesForBranches: getSchedulesForBranches, getMgrTimes: getMgrTimes,
    ymForDate: ymForDate, endOfSchedulePeriod: endOfSchedulePeriod,
    getAttendance: getAttendance, setAttendanceStatus: setAttendanceStatus, backfillCheckinLog: backfillCheckinLog,
    saveTourCompletion: saveTourCompletion,
    loadFRL: loadFRL, frlMarkGuard: frlMarkGuard,
    getSwaps: getSwaps, recordSwap: recordSwap, undoSwap: undoSwap,
    getExtras: getExtras, recordExtraDay: recordExtraDay,
    getAbsences: getAbsences, recordAbsence: recordAbsence, clearAbsence: clearAbsence,
    getEarlyLeaves: getEarlyLeaves, recordEarlyLeave: recordEarlyLeave, clearEarlyLeave: clearEarlyLeave,
    setProof: setProof, getProof: getProof,
    getDailyRecord: getDailyRecord, saveDailyRecord: saveDailyRecord,
    isoDate: isoDate, listNews: listNews,
    nextMonthYm: nextMonthYm, nextMonthLabel: nextMonthLabel,
    listOffRequests: listOffRequests, addOffRequest: addOffRequest, deleteOffRequest: deleteOffRequest,
    loadEdOffers: loadEdOffers, loadEdRequests: loadEdRequests, requestEd: requestEd, cancelEdRequest: cancelEdRequest,
    getStoreOpenedToday: getStoreOpenedToday, markStoreOpened: markStoreOpened,
    loadManagerPins: loadManagerPins, saveManagerPins: saveManagerPins,
    lookupFreshaVoucher: lookupFreshaVoucher, logVoucherLookup: logVoucherLookup,
    activeSmTrialEcs: activeSmTrialEcs,
    listAllManagers: listAllManagers, listTodayManagerClockins: listTodayManagerClockins,
    addManagerClockinWithMeta: addManagerClockinWithMeta,
    loadClockinMeta: loadClockinMeta, listRecentManagerClockins: listRecentManagerClockins,

    // Manager-side absence reasons (set by the ROM via the HR portal). The
    // kiosk reads today's rows so the "haven't clocked in" warning can
    // suppress itself once a ROM has tagged a reason.
    listManagerDayStatusesToday: listManagerDayStatusesToday,

    // Manager overtime — submitted from the kiosk, approved on the portal.
    submitOvertimeRequest: submitOvertimeRequest,

    // Witness reports — a manager naming a colleague who left early without
    // clocking out. Stored as a single growing list for ROM review.
    submitEarlyLeaveReport: submitEarlyLeaveReport
  };

  async function submitEarlyLeaveReport(p) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    if (!p || !p.names) throw new Error("names is required.");
    var nowD = new Date();
    var ymd = nowD.getFullYear() + "-" + String(nowD.getMonth() + 1).padStart(2, "0") + "-" + String(nowD.getDate()).padStart(2, "0");
    var prior = await c.from("app_state").select("value").eq("key", "boa_mgr_early_reports_v1").maybeSingle();
    var list = (prior.data && Array.isArray(prior.data.value)) ? prior.data.value.slice() : [];
    list.push({
      id:             "elr_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      branch:         branch() || "",
      ymd:            ymd,
      reportedAt:     nowD.toISOString(),
      reportedByEc:   String(p.reportedByEc || "").trim() || null,
      reportedByName: String(p.reportedByName || "").trim() || null,
      names:          String(p.names).trim(),
      note:           String(p.note || "").trim() || null,
      reviewed:       false
    });
    // Cap so the row doesn't grow unbounded forever — keep last ~5k.
    if (list.length > 5000) list = list.slice(-5000);
    var res = await c.from("app_state").upsert({ key: "boa_mgr_early_reports_v1", value: list });
    if (res.error) throw res.error;
    return list[list.length - 1];
  }

  async function listManagerDayStatusesToday() {
    var c = client(); if (!c) return [];
    var today = todayStr();
    var res = await c.from("manager_day_status").select("staff_id,status").eq("date", today);
    if (res.error) { console.error("listManagerDayStatusesToday:", res.error); return []; }
    return res.data || [];
  }

  // Append a single OT entry to the boa_overtime_v1 list (created by the
  // HR portal's Overtime tab). Status defaults to "pending" — the entry
  // shows up under "Pending approval" on the portal until an admin acts.
  async function submitOvertimeRequest(p) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    if (!p || !p.ec || !p.date || !p.hours || !p.reason) {
      throw new Error("ec, date, hours and reason are required.");
    }
    var h = Number(p.hours);
    if (!isFinite(h) || h <= 0) throw new Error("Hours must be a positive number.");
    if (h > 12) throw new Error("Hours can't exceed 12 — please double-check.");
    h = Math.round(h * 2) / 2;
    var prior = await c.from("app_state").select("value").eq("key", "boa_overtime_v1").maybeSingle();
    var list = (prior.data && Array.isArray(prior.data.value)) ? prior.data.value.slice() : [];
    list.push({
      id:           "ot_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      ec:           String(p.ec).trim(),
      name:         (p.name || "").trim(),
      branch:       (p.branch || branch() || "").trim(),
      date:         String(p.date),
      hours:        h,
      reason:       String(p.reason).trim(),
      status:       "pending",
      submittedAt:  new Date().toISOString(),
      submittedBy:  (p.submittedBy || "").trim() || null,
      decidedAt:    null,
      decidedBy:    null,
      decisionNote: null
    });
    var res = await c.from("app_state").upsert({ key: "boa_overtime_v1", value: list });
    if (res.error) throw res.error;
    return list[list.length - 1];
  }

  // When `mgrIds` is provided, the clockins query is filtered server-side
  // via .in("staff_id", mgrIds) so only manager rows come back. This is a
  // regular column filter (not the broken embedded one) and it's
  // dramatically faster on the kiosk because clockins is dominated by
  // nail-tech rows. Falls back to the unfiltered HR-portal-style query
  // when no IDs are passed.
  async function listRecentManagerClockins(daysBack, mgrIds) {
    var c = client(); if (!c) return [];
    var since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (daysBack || 7));
    var q = c.from("clockins")
      .select("*, staff:staff_id ( id, name, employee_code, role_type, role, branch )")
      .gte("ts", since.toISOString())
      .order("ts", { ascending: true });
    if (Array.isArray(mgrIds) && mgrIds.length > 0) {
      q = q.in("staff_id", mgrIds);
    }
    var res = await q;
    if (res.error) { console.error("listRecentManagerClockins:", res.error); return []; }
    return (res.data || []).filter(function (r) { return r.staff && r.staff.role_type === "manager"; });
  }

  async function addManagerClockinWithMeta(staffId, type, meta) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    // One clock-in per manager per day. A second "in" is rejected outright so
    // a manager can't rack up multiple clock-ins. The UI also hides the button
    // once they're in, but this guards against a stale tablet view / double tap.
    if (type === "in") {
      var dup = await c.from("clockins").select("id")
        .eq("staff_id", staffId).eq("type", "in")
        .gte("ts", startOfTodayIso()).limit(1);
      if (dup.error) { console.error("clock-in dup check:", dup.error); }
      else if (dup.data && dup.data.length > 0) {
        throw new Error("Already clocked in today — only one clock-in per day is allowed.");
      }
    }
    var row = { staff_id: staffId, branch: branch(), type: type };
    if (meta && meta.tsOverride) row.ts = meta.tsOverride;
    var ins = await c.from("clockins").insert(row).select().single();
    if (ins.error) throw ins.error;
    if (meta && (meta.photoDataUrl || meta.lat !== undefined || meta.flags)) {
      var metaRow = {
        photo: meta.photoDataUrl || null,
        lat: (meta.lat !== undefined) ? meta.lat : null,
        lng: (meta.lng !== undefined) ? meta.lng : null,
        accuracyM: (meta.accuracy !== undefined) ? meta.accuracy : null,
        distanceM: (meta.distanceMeters !== undefined) ? meta.distanceMeters : null,
        outOfRange: !!meta.outOfRange,
        flags: meta.flags || []
      };
      try {
        var mr = await c.from("app_state").upsert({ key: "boa_mgrclockin_meta_" + ins.data.id, value: metaRow });
        if (mr.error) console.warn("Meta save failed:", mr.error);
      } catch (e) { console.warn("Meta save threw:", e); }
    }
    return ins.data;
  }

  async function loadClockinMeta(clockinId) {
    var c = client(); if (!c) return null;
    var res = await c.from("app_state").select("value").eq("key", "boa_mgrclockin_meta_" + clockinId).maybeSingle();
    if (res.error) { console.warn("loadClockinMeta:", res.error); return null; }
    return (res.data && res.data.value) || null;
  }

  async function loadManagerPins() {
    var c = client(); if (!c) return {};
    var res = await c.from("app_state").select("value").eq("key", "boa_mgr_pins_v1").maybeSingle();
    if (res.error) { console.error("loadManagerPins:", res.error); return {}; }
    var v = res.data && res.data.value;
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  }
  // Employee codes of AMs currently on an active Store-Manager trial. The HR
  // portal writes these to app_state['boa_sm_trial_v1'] and treats a matching
  // AM as an effective SM (badged "SM on trial"); the kiosk mirrors that.
  async function activeSmTrialEcs() {
    var c = client(); if (!c) return {};
    var res = await c.from("app_state").select("value").eq("key", "boa_sm_trial_v1").maybeSingle();
    if (res.error) { console.error("activeSmTrialEcs:", res.error); return {}; }
    var v = res.data && res.data.value;
    var arr = Array.isArray(v) ? v : [];
    var out = {};
    arr.forEach(function (r) {
      if (r && r.ec && r.status === "active") out[String(r.ec).trim()] = true;
    });
    return out;
  }
  async function saveManagerPins(map) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var res = await c.from("app_state").upsert({ key: "boa_mgr_pins_v1", value: map || {} });
    if (res.error) throw res.error;
    return map;
  }

  // ---------- Voucher code lookup (Shopify last-4 → Fresha) ----------
  // Shopify only reveals the LAST 4 of a gift-voucher code to the seller, so
  // the store's sheet maps that last-4 (plus the voucher amount) to a Fresha
  // voucher code. The manager is made to type the client's full code, but the
  // match is on the last 4 only; when two vouchers share the same last 4 we
  // return both with their amounts so the manager picks by amount.
  //
  // Data lives in a `vouchers` table: { last4 text, amount text, fresha_code
  // text }. `last4` is NOT unique (collisions are expected — that's why amount
  // is shown). Store last4 as TEXT so leading zeros (e.g. "0042") survive.
  function _normAmt(a) {
    var n = parseFloat(String(a == null ? "" : a).replace(/[^0-9.]/g, ""));
    return isNaN(n) ? null : n;
  }
  // The kiosk forces a full-length code, but the match only uses the last 4 —
  // so "000000000000XXXX" (12 zeros / ones / any single repeated char + the
  // real last 4) sails straight through. Flag a code whose prefix-before-last4
  // is a single repeated character (or empty) as a likely shortcut, so the UI
  // can warn and the lookup log can mark it.
  function _isDegeneratePrefix(prefix) {
    var p = String(prefix || "");
    if (p.length === 0) return true;
    var first = p.charAt(0);
    for (var i = 1; i < p.length; i++) { if (p.charAt(i) !== first) return false; }
    return true;
  }
  async function lookupFreshaVoucher(typed, amount) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    // Strip spaces / dashes so a 16-char code pasted as "ABCD EFGH IJKL MNOP"
    // still counts. Shopify codes are 16 chars; force the manager to enter the
    // whole thing (configurable) so they can't shortcut to just the last 4 —
    // even though the match itself only uses the last 4 characters.
    var full   = String(typed || "").replace(/[^A-Za-z0-9]/g, "");
    var minLen = (cfg.voucherMinChars != null) ? cfg.voucherMinChars : 16;
    if (full.length < minLen) {
      return { found: false, matches: [], last4: "", tooShort: true, minLen: minLen, suspiciousPad: false };
    }
    var last4 = full.slice(-4).toUpperCase();
    var suspiciousPad = _isDegeneratePrefix(full.slice(0, -4));
    var res = await c.from("vouchers").select("fresha_code, amount, balance, used_total, txn_count, last_used_at, txns").eq("last4", last4);
    if (res.error) { console.error("lookupFreshaVoucher:", res.error); throw res.error; }
    var matches = (res.data || [])
      .map(function (r) {
        return {
          fresha: r.fresha_code, amount: r.amount,
          balance: r.balance, used_total: r.used_total,
          txn_count: r.txn_count, last_used_at: r.last_used_at,
          txns: Array.isArray(r.txns) ? r.txns : []
        };
      })
      .filter(function (m) { return m.fresha; });
    // Disambiguate same-last4 collisions by amount: keep only rows whose amount
    // matches what the manager entered (tolerant of "500" vs "500.00" vs "R500").
    var want = _normAmt(amount);
    if (want != null) {
      matches = matches.filter(function (m) { return _normAmt(m.amount) === want; });
    }
    return { found: matches.length > 0, matches: matches, last4: last4, tooShort: false, suspiciousPad: suspiciousPad };
  }
  // Append one row to the voucher_lookups audit table for every kiosk lookup.
  // Best-effort: a failure here must NEVER block the manager's lookup. The HR
  // portal Voucher Admin → Audit tab reads these rows. `rec` carries the manager
  // identity (from the kiosk PIN gate), the typed code, the result, and the
  // suspicious-pad flag.
  async function logVoucherLookup(rec) {
    try {
      var c = client(); if (!c) return;
      rec = rec || {};
      var now = new Date();
      var ymd = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
      var row = {
        id:             "vl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
        looked_up_at:   now.toISOString(),
        looked_up_ymd:  ymd,
        branch:         branch(),
        manager_ec:     rec.managerEc != null ? String(rec.managerEc) : null,
        manager_name:   rec.managerName != null ? String(rec.managerName) : null,
        typed_code:     String(rec.typedCode || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null,
        last4:          rec.last4 != null ? String(rec.last4) : null,
        amount:         rec.amount != null ? String(rec.amount) : null,
        found:          !!rec.found,
        fresha_code:    rec.freshaCode != null ? String(rec.freshaCode) : null,
        match_count:    (typeof rec.matchCount === "number") ? rec.matchCount : null,
        balance_at:     (rec.balanceAt == null || rec.balanceAt === "") ? null : Number(rec.balanceAt),
        suspicious_pad: !!rec.suspiciousPad
      };
      var res = await c.from("voucher_lookups").insert(row);
      if (res.error) console.warn("logVoucherLookup:", res.error);
    } catch (e) { console.warn("logVoucherLookup failed:", e); }
  }
  async function listAllManagers() {
    var c = client(); if (!c) return [];
    // Project only the columns the Manager Clock-in screen needs. The
    // staff table carries photo blobs + several other heavy fields that
    // we don't use here, so `select("*")` was loading 100s of KB per call
    // and dominating the kiosk's screen-render time. left_date is needed so
    // we can drop managers who have left (see off-board merge below).
    // transferring/transfer_to/transfer_date are needed so a transferred
    // manager can be settled onto her NEW branch below — the HR portal
    // stores a transfer as flags without rewriting `branch`, so the raw
    // column goes stale the moment the transfer date passes.
    var res = await c.from("staff")
      .select("id,name,employee_code,role,role_type,branch,active,left_date,transferring,transfer_to,transfer_date")
      .eq("active", true)
      .order("name", { ascending: true });
    if (res.error) { console.error("listAllManagers:", res.error); return []; }
    // Off-boarding via the HR portal writes leftDate into boa_offboard_v1 and
    // does NOT flip the staff row's `active` column (see loadOffboarding), so
    // an off-boarded manager still comes back as active here — which left them
    // showing on the Manager Check-in list and the "not clocked in yet" nag.
    // Merge the off-board list and drop anyone whose effective last day is in
    // the past; keep last-day-today and future leavers so they can still clock
    // in until they actually leave.
    var offByEc = {};
    try {
      var offList = await loadOffboarding();
      (offList || []).forEach(function (o) { if (o && o.ec) offByEc[String(o.ec).trim()] = o; });
    } catch (_) {}
    var _p = function (n) { return String(n).padStart(2, "0"); };
    var _now = new Date();
    var todayIso = _now.getFullYear() + "-" + _p(_now.getMonth() + 1) + "-" + _p(_now.getDate());
    return (res.data || []).filter(isManagerRow).filter(function (m) {
      var ec = m && m.employee_code && String(m.employee_code).trim();
      var off = ec ? offByEc[ec] : null;
      var eff = (off && off.leftDate) || m.left_date || null;
      if (!eff) return true;            // not leaving
      return eff >= todayIso;           // keep last-day + future, drop past leavers
    }).map(function (m) {
      // Settle completed branch transfers: from the transfer date onward the
      // manager belongs to the NEW branch, so she shows in that store's
      // clock-in list (and stops showing at the old one). Pending (future)
      // transfers keep the stored branch.
      if (m && m.transferring && m.transfer_to && m.transfer_date && m.transfer_date <= todayIso) {
        return Object.assign({}, m, { branch: m.transfer_to });
      }
      return m;
    });
  }
  async function listTodayManagerClockins() {
    var c = client(); if (!c) return [];
    var res = await c.from("clockins")
      .select("*, staff:staff_id ( id, name, employee_code, role_type, branch )")
      .gte("ts", startOfTodayIso())
      .order("ts", { ascending: false });
    if (res.error) { console.error("listTodayManagerClockins:", res.error); return []; }
    return (res.data || []).filter(function (r) { return r.staff && r.staff.role_type === "manager"; });
  }
})();
