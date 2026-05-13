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

  function todayStr() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function startOfTodayIso() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  // ---------- Staff ----------
  async function listStaff(opts) {
    opts = opts || {};
    var c = client(); if (!c) return [];
    var q = c.from("staff").select("*").eq("branch", branch());
    if (opts.activeOnly !== false) q = q.eq("active", true);
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

  async function listLeaveRecords() {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", "boa_leave_v1").maybeSingle();
    if (res.error) { console.error("listLeaveRecords:", res.error); return []; }
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
    return (res.data || []).filter(function (s) { return s.role_type !== "manager"; });
  }
  async function _fetchStaffByEcs(ecs) {
    if (!ecs || !ecs.length) return [];
    var c = client(); if (!c) return [];
    var res = await c.from("staff").select("*").in("employee_code", ecs);
    if (res.error) { console.error("fetchStaffByEcs:", res.error); return []; }
    return res.data || [];
  }

  async function categorizeStaff(refDate, opts) {
    var refIso = isoDate(refDate || new Date());
    var thisBranch = branch();
    var results = await Promise.all([
      listStaff(opts || { activeOnly: true }),
      listMaternity(),
      listLeaveRecords(),
      listTechLoans(refIso)
    ]);
    var staff = results[0], matRecs = results[1], leaveRecs = results[2], loansToday = results[3];

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

    var matByEc = {};
    matRecs.forEach(function (m) {
      if (m.mat_status === "on_mat" && m.employee_code) matByEc[m.employee_code] = m;
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
    return { active: active, onMat: onMat, onLeave: onLeave, loansToday: loansToday };
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
  async function todaysCashup() {
    var c = client(); if (!c) return null;
    var res = await c.from("cashups").select("*")
      .eq("branch", branch()).eq("date", todayStr())
      .order("created_at", { ascending: false }).limit(1);
    if (res.error) { console.error("todaysCashup:", res.error); return null; }
    return (res.data || [])[0] || null;
  }

  async function addCashup(payload) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var row = {
      branch: branch(), date: todayStr(),
      yoco: Number(payload.yoco) || 0, cash: Number(payload.cash) || 0,
      vouchers: Number(payload.vouchers) || 0, discounts: Number(payload.discounts) || 0,
      notes: (payload.notes || "").trim() || null,
      signed_by: (payload.signedBy || "").trim()
    };
    var res = await c.from("cashups").insert(row).select().single();
    if (res.error) throw res.error;
    return res.data;
  }

  async function listRecentCashups(limit) {
    var c = client(); if (!c) return [];
    var res = await c.from("cashups").select("*").eq("branch", branch())
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
    var newValue = { grid: newGrid, branch: branch(), ym: ym, savedAt: new Date().toISOString() };
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
      var logKey = "boa_kiosk_log_" + branch() + "_" + ym;
      var prior  = await c.from("app_state").select("value").eq("key", logKey).maybeSingle();
      var log    = (prior.data && Array.isArray(prior.data.value)) ? prior.data.value : [];
      // ymd derivation mirrors setAttendanceStatus's calendar math: days
      // 25..31 belong to the previous month of the payroll cycle, 1..24
      // belong to the current month.
      var cycP = ym.split("-");
      var cycY = +cycP[0], cycM = +cycP[1];
      var dayN = parseInt(dayKey, 10);
      var dt;
      if (dayN >= 25) { dt = new Date(cycY, cycM - 1, dayN); }
      else { var nm = cycM + 1, ny = cycY; if (nm > 12) { nm = 1; ny += 1; } dt = new Date(ny, nm - 1, dayN); }
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

  async function recordEarlyLeave(ym, dayKey, ec, hours, recordedBy) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var h = Number(hours);
    if (!isFinite(h) || h <= 0) throw new Error("Hours must be a positive number.");
    if (h > 12) throw new Error("Hours can't exceed 12 — please double-check.");
    // Round to 30-minute intervals (0.5h) to keep payroll numbers clean.
    h = Math.round(h * 2) / 2;
    var existing = await getEarlyLeaves(ym);
    var data = JSON.parse(JSON.stringify(existing || {}));
    if (!data[dayKey]) data[dayKey] = {};
    data[dayKey][ec] = {
      hours:       h,
      recordedAt:  new Date().toISOString(),
      recordedBy:  (recordedBy || "").trim() || null
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

  async function getSchedule(ym) {
    var c = client(); if (!c) return { grid: {}, ym: ym };
    var br = branch();
    var keys = ["boa_sched_" + br + "_" + ym, "boa_mgrsched_" + br + "_" + ym];
    var res = await c.from("app_state").select("key,value").in("key", keys);
    if (res.error) { console.error("getSchedule:", res.error); return { grid: {}, ym: ym }; }
    var combined = {};
    (res.data || []).forEach(function (row) {
      var grid = (row.value && row.value.grid) || {};
      Object.keys(grid).forEach(function (ec) { combined[ec] = grid[ec]; });
    });
    return { grid: combined, ym: ym };
  }

  // ---------- News ----------
  async function listNews() {
    var c = client(); if (!c) return [];
    var res = await c.from("app_state").select("value").eq("key", "boa_news_v1").maybeSingle();
    if (res.error) { console.error("listNews:", res.error); return []; }
    var v = res.data && res.data.value;
    if (Array.isArray(v)) return v;
    return [];
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

  function nextMonthYm() {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 2;
    if (m > 12) { m -= 12; y += 1; }
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

  async function listOffRequests(targetYm) {
    var c = client(); if (!c) return [];
    var p = targetYm.split("-"); var y = +p[0], m = +p[1];
    var prevMonth = m === 1 ? 12 : m - 1;
    var prevYear  = m === 1 ? y - 1 : y;
    var startIso  = isoDate(new Date(prevYear, prevMonth - 1, 25));
    var endIso    = isoDate(new Date(y, m - 1, 24));
    var br = branch();
    var techRequests = await _loadAllTechRequests();
    var mgrRequests  = await _loadAllMgrRequests();
    var allRequests  = techRequests.concat(mgrRequests);
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
    var isManager = payload && payload.roleType === "manager";
    var loadFn = isManager ? _loadAllMgrRequests : _loadAllTechRequests;
    var saveFn = isManager ? _saveAllMgrRequests : _saveAllTechRequests;
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

    var techExisting = await _loadAllTechRequests();
    var techNext = applyFilter(techExisting);
    if (techNext.length !== techExisting.length) await _saveAllTechRequests(techNext);

    var mgrExisting = await _loadAllMgrRequests();
    var mgrNext = applyFilter(mgrExisting);
    if (mgrNext.length !== mgrExisting.length) await _saveAllMgrRequests(mgrNext);
  }

  window.APP_DATA = {
    isConfigured: isConfigured,
    branch: branch, branchDisplay: branchDisplay, todayStr: todayStr,
    listStaff: listStaff, listMaternity: listMaternity, listLeaveRecords: listLeaveRecords,
    listTechLoans: listTechLoans, saveTechLoan: saveTechLoan, listStaffAllBranches: listStaffAllBranches,
    categorizeStaff: categorizeStaff, addStaff: addStaff, updateStaff: updateStaff,
    deactivateStaff: deactivateStaff,
    lastClockinToday: lastClockinToday, addClockin: addClockin, listTodayClockins: listTodayClockins,
    todaysCashup: todaysCashup, addCashup: addCashup, listRecentCashups: listRecentCashups,
    currentSchedYm: currentSchedYm, periodLabel: periodLabel, periodDays: periodDays, getSchedule: getSchedule,
    ymForDate: ymForDate, endOfSchedulePeriod: endOfSchedulePeriod,
    getAttendance: getAttendance, setAttendanceStatus: setAttendanceStatus,
    getSwaps: getSwaps, recordSwap: recordSwap, undoSwap: undoSwap,
    getExtras: getExtras, recordExtraDay: recordExtraDay,
    getAbsences: getAbsences, recordAbsence: recordAbsence, clearAbsence: clearAbsence,
    getEarlyLeaves: getEarlyLeaves, recordEarlyLeave: recordEarlyLeave, clearEarlyLeave: clearEarlyLeave,
    setProof: setProof, getProof: getProof,
    getDailyRecord: getDailyRecord, saveDailyRecord: saveDailyRecord,
    isoDate: isoDate, listNews: listNews,
    nextMonthYm: nextMonthYm, nextMonthLabel: nextMonthLabel,
    listOffRequests: listOffRequests, addOffRequest: addOffRequest, deleteOffRequest: deleteOffRequest,
    getStoreOpenedToday: getStoreOpenedToday, markStoreOpened: markStoreOpened,
    loadManagerPins: loadManagerPins, saveManagerPins: saveManagerPins,
    listAllManagers: listAllManagers, listTodayManagerClockins: listTodayManagerClockins,
    addManagerClockinWithMeta: addManagerClockinWithMeta,
    loadClockinMeta: loadClockinMeta, listRecentManagerClockins: listRecentManagerClockins
  };

  async function listRecentManagerClockins(daysBack) {
    var c = client(); if (!c) return [];
    var since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (daysBack || 7));
    var res = await c.from("clockins")
      .select("*, staff:staff_id ( id, name, employee_code, role_type, branch )")
      .gte("ts", since.toISOString())
      .order("ts", { ascending: true });
    if (res.error) { console.error("listRecentManagerClockins:", res.error); return []; }
    return (res.data || []).filter(function (r) { return r.staff && r.staff.role_type === "manager"; });
  }

  async function addManagerClockinWithMeta(staffId, type, meta) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
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
  async function saveManagerPins(map) {
    var c = client(); if (!c) throw new Error("Supabase not configured");
    var res = await c.from("app_state").upsert({ key: "boa_mgr_pins_v1", value: map || {} });
    if (res.error) throw res.error;
    return map;
  }
  async function listAllManagers() {
    var c = client(); if (!c) return [];
    var res = await c.from("staff").select("*").eq("role_type", "manager").eq("active", true).order("name", { ascending: true });
    if (res.error) { console.error("listAllManagers:", res.error); return []; }
    return res.data || [];
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
