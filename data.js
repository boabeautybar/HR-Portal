/* ============================================================
   BOA HR Portal v2 — Supabase data layer.
   The React app calls window.BOA_DB.* methods to read/write.
   Row shapes here match the React component's expected shape
   (camelCase fields, _id, etc.) so the original App.jsx logic
   keeps working with minimal changes.
   ============================================================ */
(function () {
  var cfg = window.BOA_SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey || !window.supabase) {
    console.error("[BOA DB] Supabase not configured.");
    window.BOA_DB = { isReady: false };
    return;
  }
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false }
  });

  // ---------- Row ↔ React-shape transforms ----------
  function getRoleType(ec, existingRole) {
    if (!ec) return existingRole || "tech";
    const code = ec.toUpperCase().trim();
    if (code.endsWith("-W")) return "warehouse";
    if (code.endsWith("-F")) return "maintenance";
    if (code.endsWith("-CC")) return "call_centre";
    if (code.endsWith("-C")) return "cleaner";
    // Managers end in M — with or without a dash (B941M or legacy B941-M).
    // (Matches the /M$/ manager test used throughout the app.)
    if (code.endsWith("M")) return "manager";
    return existingRole || "tech";
  }

  // Drop keys whose value is null, undefined, or an empty string before
  // sending to Supabase. PostgREST rejects the whole request if the
  // payload references a column that isn't in its schema cache (or
  // doesn't exist on the table at all). For routine writes like a branch
  // transfer we only set transfer_* / branch — every other optional
  // field comes through as null because the in-memory record was built
  // by row-to-X with `r.field || ""`. Stripping those nulls lets the
  // write succeed against deployments whose `staff` table doesn't have
  // every column yet.
  function _prune(row) {
    var out = {};
    for (var k in row) {
      var v = row[k];
      if (v === null || v === undefined || v === "") continue;
      out[k] = v;
    }
    return out;
  }

  function rowToStaff(r) {
    var _nm = r.name || "";
    var _sp = _nm.indexOf(" ");
    return {
      _id: r.id,
      id: r.id,
      ec: r.employee_code,
      firstName: r.first_name || (_sp >= 0 ? _nm.slice(0, _sp) : _nm),
      surname: r.surname || (_sp >= 0 ? _nm.slice(_sp + 1).trim() : ""),
      name: _nm,
      branch: r.branch || "",
      role: r.role || "",
      roleType: getRoleType(r.employee_code, r.role_type),
      contract: r.contract || null,
      permit: r.permit || null,
      permitExpiry: r.permit_expiry || null,
      notes: r.notes || "",
      isShadow: !!r.is_shadow,
      transferring: !!r.transferring,
      transferTo: r.transfer_to || null,
      transferDate: r.transfer_date || null,
      transferNote: r.transfer_note || null,
      leftDate: r.left_date || null,
      startDate: r.start_date || null,
      level: r.level || null,
      cellNumber: r.cell_number || "",
      email: r.email || "",
      address: r.address || r.home_address || "",
      idNumber: r.id_number || "",
      passport: r.passport || r.passport_number || "",
      taxNumber: r.tax_number || "",
      gender: r.gender || "",
      active: r.active !== undefined ? (typeof r.active === 'string' ? r.active.toUpperCase() === 'TRUE' : !!r.active) : !r.left_date
    };
  }
  function staffToRow(s) {
    return {
      employee_code: s.ec,
      name: s.name || "",
      branch: s.branch || "",
      contract: s.contract || null,
      permit: s.permit || null,
      permit_expiry: s.permitExpiry || null,
      notes: s.notes || null,
      is_shadow: !!s.isShadow,
      transferring: !!s.transferring,
      transfer_to: s.transferTo || null,
      transfer_date: s.transferDate || null,
      transfer_note: s.transferNote || null,
      left_date: s.leftDate || null,
      start_date: s.startDate || null,
      level: s.level || null,
      role_type: getRoleType(s.ec, s.roleType),
      active: s.active !== undefined ? s.active : !s.leftDate,
      cell_number: s.cellNumber || null,
      email: s.email || null,
      address: s.address || null,
      id_number: s.idNumber || null,
      tax_number: s.taxNumber || null,
      gender: s.gender || null
    };
  }

  function rowToManager(r) {
    var _nm = r.name || "";
    var _sp = _nm.indexOf(" ");
    return {
      _id: r.id,
      id: r.id,
      ec: r.employee_code,
      firstName: r.first_name || (_sp >= 0 ? _nm.slice(0, _sp) : _nm),
      surname: r.surname || (_sp >= 0 ? _nm.slice(_sp + 1).trim() : ""),
      name: _nm,
      branch: r.branch || "",
      role: r.role || "",
      roleType: getRoleType(r.employee_code, r.role_type),
      notes: r.notes || "",
      contract: r.contract || null,
      permit: r.permit || null,
      permitExpiry: r.permit_expiry || null,
      transferring: !!r.transferring,
      transferTo: r.transfer_to || null,
      transferDate: r.transfer_date || null,
      transferNote: r.transfer_note || null,
      startDate: r.start_date || null,
      leftDate: r.left_date || null,
      cellNumber: r.cell_number || "",
      email: r.email || "",
      address: r.address || r.home_address || "",
      idNumber: r.id_number || "",
      passport: r.passport || r.passport_number || "",
      taxNumber: r.tax_number || "",
      gender: r.gender || "",
      active: r.active !== undefined ? (typeof r.active === 'string' ? r.active.toUpperCase() === 'TRUE' : !!r.active) : !r.left_date
    };
  }
  function managerToRow(m) {
    return {
      employee_code: m.ec,
      name: m.name || "",
      branch: m.branch || "",
      role: m.role || null,
      notes: m.notes || null,
      contract: m.contract || null,
      permit: m.permit || null,
      permit_expiry: m.permitExpiry || null,
      transferring: !!m.transferring,
      transfer_to: m.transferTo || null,
      transfer_date: m.transferDate || null,
      transfer_note: m.transferNote || null,
      start_date: m.startDate || null,
      left_date: m.leftDate || null,
      role_type: m.roleType || "manager",
      active: m.active !== undefined ? m.active : !m.leftDate,
      cell_number: m.cellNumber || null,
      email: m.email || null,
      address: m.address || null,
      id_number: m.idNumber || null,
      tax_number: m.taxNumber || null,
      gender: m.gender || null
    };
  }

  function rowToMat(r) {
    return {
      _id: r.id,
      id: r.id,
      ec: r.employee_code,
      name: r.name || "",
      branch: r.branch || "",
      matStatus: r.mat_status,
      matStart: r.mat_start || null,
      matEnd: r.mat_end || null,
      returnDate: r.return_date || null,
      notes: r.notes || ""
    };
  }
  function matToRow(m) {
    return {
      employee_code: m.ec,
      name: m.name || "",
      branch: m.branch || "",
      mat_status: m.matStatus,
      mat_start: m.matStart || null,
      mat_end: m.matEnd || null,
      return_date: m.returnDate || null,
      notes: m.notes || null
    };
  }

  // ---------- Initial load ----------
  async function loadAll() {
    var [allRows, mat] = await Promise.all([
      sb.from("staff").select("*").order("employee_code"),
      sb.from("maternity").select("*")
    ]);
    if (allRows.error) console.error("[BOA DB] staff list load error:", allRows.error);
    if (mat.error) console.error("[BOA DB] maternity load error:", mat.error);

    var data = allRows.data || [];
    // Separate into techs and managers
    // Managers are those with role_type === 'manager'
    // Techs are everyone else (role_type !== 'manager', including empty/null role_types)
    var techs = data.filter(function (r) { return r.role_type !== "manager"; }).map(rowToStaff);
    var mgrs = data.filter(function (r) { return r.role_type === "manager"; }).map(rowToManager);

    return {
      staff: techs,
      managers: mgrs,
      matRecs: (mat.data || []).map(rowToMat)
    };
  }

  // ---------- Staff CRUD ----------
  // Insert/update a staff row, surviving deployments whose `staff` table
  // doesn't have every optional column yet. PostgREST rejects the WHOLE write
  // when the payload names a column missing from its schema cache ("Could not
  // find the 'cell_number' column of 'staff' in the schema cache"), which
  // blocked onboarding outright whenever a phone/email/ID was typed in. Strip
  // the offending column and retry so the person is still saved; warn once per
  // column so someone runs sql/staff_contact_columns.sql to stop the dropping.
  var _warnedMissingStaffCols = {};
  function _warnDroppedStaffCols(dropped) {
    var fresh = dropped.filter(function (c) { return !_warnedMissingStaffCols[c]; });
    if (!fresh.length) return;
    fresh.forEach(function (c) { _warnedMissingStaffCols[c] = true; });
    console.warn("[BOA DB] staff table is missing column(s): " + dropped.join(", "));
    try {
      alert("Saved — but the database's staff table doesn't have the column(s) "
        + dropped.join(", ") + " yet, so those details could NOT be stored (everything else saved fine).\n\n"
        + "Run sql/staff_contact_columns.sql in the Supabase SQL editor to add them, then re-save this person to capture the missing details.");
    } catch (_e) {}
  }
  async function _writeStaffRow(row, id) {
    var dropped = [];
    for (var attempt = 0; attempt < 10; attempt++) {
      var q = id ? sb.from("staff").update(row).eq("id", id) : sb.from("staff").insert(row);
      var res = await q.select().single();
      if (!res.error) {
        if (dropped.length) _warnDroppedStaffCols(dropped);
        return res.data;
      }
      var m = /Could not find the '([^']+)' column/.exec(res.error.message || "");
      if (!m || !(m[1] in row)) throw res.error;
      dropped.push(m[1]);
      var slim = {};
      for (var k in row) { if (k !== m[1]) slim[k] = row[k]; }
      row = slim;
    }
    throw new Error("Could not save the staff record (too many unknown columns).");
  }
  async function saveStaff(s) {
    var data = await _writeStaffRow(_prune(staffToRow(s)), s.id);
    return rowToStaff(data);
  }
  async function deleteStaff(id) {
    var r = await sb.from("staff").delete().eq("id", id);
    if (r.error) throw r.error;
  }

  // ---------- Manager CRUD ----------
  async function saveManager(m) {
    // Same unknown-column tolerance as saveStaff — manager rows live on the
    // same `staff` table and carry the same optional contact columns.
    var data = await _writeStaffRow(_prune(managerToRow(m)), m.id);
    return rowToManager(data);
  }
  async function deleteManager(id) {
    var r = await sb.from("staff").delete().eq("id", id);
    if (r.error) throw r.error;
  }
  
  async function loadConsolidatedStaff() {
    var res = await sb.from("Consolodated Staff List").select("*").order("employee_code");
    if (res.error) { console.error("[BOA DB] loadConsolidatedStaff error:", res.error); return []; }
    return res.data || [];
  }

  // ---------- Schedule (boa_sched_<branch>_<ym>) ----------
  function schedKey(branch, ym, isManager) {
    return (isManager ? "boa_mgrsched_" : "boa_sched_") + branch + "_" + ym;
  }
  // Version history key — separate row so the schedule itself stays a clean
  // single object. Stored as an array of {savedAt, grid, branch, ym}, newest
  // first, capped at 5 entries.
  function schedHistKey(branch, ym, isManager) {
    return (isManager ? "boa_mgrschedhist_" : "boa_schedhist_") + branch + "_" + ym;
  }
  // Approved-version key — list of {id, name, grid, madeBy, approvedBy,
  // savedAt, savedBy}, newest first. Separate row from the rolling
  // history so users can name and keep specific "final" versions without
  // them being overwritten by the 5-snapshot history cap.
  function schedApprovedKey(branch, ym, isManager) {
    return (isManager ? "boa_mgrschedapproved_" : "boa_schedapproved_") + branch + "_" + ym;
  }
  var SCHED_APPROVED_LIMIT = 25;
  var SCHED_HISTORY_LIMIT = 5;
  async function loadSchedule(branch, ym, isManager) {
    var res = await sb.from("app_state").select("value").eq("key", schedKey(branch, ym, isManager)).maybeSingle();
    if (res.error) { console.error("loadSchedule:", res.error); return { grid: {}, branch: branch, ym: ym }; }
    return (res.data && res.data.value) || { grid: {}, branch: branch, ym: ym };
  }
  async function loadScheduleHistory(branch, ym, isManager) {
    var res = await sb.from("app_state").select("value").eq("key", schedHistKey(branch, ym, isManager)).maybeSingle();
    if (res.error) { console.error("loadScheduleHistory:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : (v && v.versions) || [];
  }
  // Approved-version helpers — explicit named "final" snapshots the user
  // saves on top of the schedule. Each entry: { id, name, grid, madeBy,
  // approvedBy, note, savedAt, savedBy }. Order: newest first, capped at
  // SCHED_APPROVED_LIMIT so they don't grow unbounded.
  async function loadApprovedSchedules(branch, ym, isManager) {
    var res = await sb.from("app_state").select("value").eq("key", schedApprovedKey(branch, ym, isManager)).maybeSingle();
    if (res.error) { console.error("loadApprovedSchedules:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveApprovedSchedule(branch, ym, isManager, entry) {
    if (!entry || !entry.grid) return null;
    var existing = await loadApprovedSchedules(branch, ym, isManager);
    var rec = {
      id: "ap_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      name: (entry.name || "Untitled").toString().slice(0, 80),
      grid: entry.grid,
      names: (entry.names && typeof entry.names === "object") ? entry.names : null,
      madeBy: (entry.madeBy || "").toString().slice(0, 80),
      approvedBy: (entry.approvedBy || "").toString().slice(0, 80),
      note: (entry.note || "").toString().slice(0, 500),
      savedAt: new Date().toISOString(),
      savedBy: (entry.savedBy || "").toString().slice(0, 80)
    };
    var next = [rec].concat(existing).slice(0, SCHED_APPROVED_LIMIT);
    var res = await sb.from("app_state").upsert({ key: schedApprovedKey(branch, ym, isManager), value: next });
    if (res.error) { console.error("saveApprovedSchedule:", res.error); throw res.error; }
    return rec;
  }
  async function deleteApprovedSchedule(branch, ym, isManager, id) {
    var existing = await loadApprovedSchedules(branch, ym, isManager);
    var next = existing.filter(function (x) { return x && x.id !== id; });
    var res = await sb.from("app_state").upsert({ key: schedApprovedKey(branch, ym, isManager), value: next });
    if (res.error) { console.error("deleteApprovedSchedule:", res.error); throw res.error; }
    return next;
  }
  async function saveSchedule(branch, ym, grid, isManager, names) {
    // Snapshot existing schedule into history BEFORE overwriting. We only
    // record the previous saved state if one actually exists and has at
    // least one tech row (skips the very first save of an empty period).
    try {
      var prior = await sb.from("app_state").select("value").eq("key", schedKey(branch, ym, isManager)).maybeSingle();
      var priorVal = prior && prior.data && prior.data.value;
      var hasPriorContent = priorVal && priorVal.grid && Object.keys(priorVal.grid).length > 0;
      if (hasPriorContent) {
        var histRow = await sb.from("app_state").select("value").eq("key", schedHistKey(branch, ym, isManager)).maybeSingle();
        var existing = (histRow && histRow.data && histRow.data.value) || [];
        if (!Array.isArray(existing)) existing = existing.versions || [];
        // Prepend prior version (newest-first), drop oldest beyond limit
        var snapshot = {
          savedAt: priorVal.savedAt || new Date().toISOString(),
          grid: priorVal.grid,
          branch: priorVal.branch || branch,
          ym: priorVal.ym || ym
        };
        var updated = [snapshot].concat(existing).slice(0, SCHED_HISTORY_LIMIT);
        await sb.from("app_state").upsert({ key: schedHistKey(branch, ym, isManager), value: updated });
      }
    } catch (snapErr) {
      // Don't block the save itself if history write fails
      console.warn("saveSchedule: history snapshot failed (continuing):", snapErr);
    }
    var v = { grid: grid, branch: branch, ym: ym, savedAt: new Date().toISOString() };
    // Optional ec→name map (managers). Lets readers re-home a row to a renamed
    // employee code by matching the name, so correcting a code doesn't orphan
    // the person's schedule.
    if (names && typeof names === "object") v.names = names;
    else if (priorVal && priorVal.names) v.names = priorVal.names;   // preserve across saves that don't pass names
    var res = await sb.from("app_state").upsert({ key: schedKey(branch, ym, isManager), value: v });
    if (res.error) throw res.error;
    return v;
  }

  // ---------- Employee-code migration ----------
  // Schedule, attendance, leave, request, custom-hours and leave-balance data
  // are all keyed by EMPLOYEE CODE. Clock-ins and absence reasons are keyed by
  // the stable staff_id, so those follow a person automatically — but the
  // code-keyed stores get orphaned when a code is corrected. This moves every
  // code-keyed record from oldEc → newEc across ALL existing cycles, in one go,
  // so a code correction is seamless. Returns a per-store summary of moves.
  async function migrateEmployeeCode(oldEc, newEc) {
    var _o = String(oldEc == null ? "" : oldEc).trim();
    var _n = String(newEc == null ? "" : newEc).trim();
    var norm = function (s) { return String(s == null ? "" : s).replace(/[^A-Za-z0-9]/g, "").toUpperCase(); };
    var oN = norm(_o), nN = norm(_n);
    var summary = { schedules: 0, attendance: 0, history: 0, approved: 0, earlyLeaves: 0, leave: 0, requests: 0, customTimes: 0, balances: 0 };
    // Skip only when the LITERAL code is unchanged. A case/dash-only change
    // (e.g. B185-M → B185M) still needs migrating: schedule grids, attendance,
    // leave records, day-off requests and custom hours are stored under the
    // EXACT old spelling and most reads look the code up exactly — so without
    // moving the data the person drops off schedules/coverage and their leave
    // records orphan. The rewrite helpers below match by NORMALISED code, so
    // they correctly consolidate every dash/case variant onto the new spelling.
    if (!_o || !_n || _o === _n) return summary;

    // Rewrite an {ec:{...}} grid: move the row whose key matches oldEc → newEc.
    function rewriteGrid(grid) {
      if (!grid || typeof grid !== "object") return false;
      var changed = false;
      Object.keys(grid).forEach(function (k) {
        if (norm(k) !== oN || k === _n) return;
        var src = grid[k] || {};
        if (grid[_n] && typeof grid[_n] === "object") {
          Object.keys(src).forEach(function (d) { if (!(d in grid[_n])) grid[_n][d] = src[d]; });
        } else { grid[_n] = src; }
        delete grid[k]; changed = true;
      });
      return changed;
    }
    // Rewrite an {ec:name} names sidecar map.
    function rewriteNames(names) {
      if (!names || typeof names !== "object") return false;
      var changed = false;
      Object.keys(names).forEach(function (k) {
        if (norm(k) !== oN || k === _n) return;
        if (!(_n in names)) names[_n] = names[k];
        delete names[k]; changed = true;
      });
      return changed;
    }

    async function processGridRows(pattern, kind) {
      var res = await sb.from("app_state").select("key, value").like("key", pattern);
      if (res.error || !Array.isArray(res.data)) return;
      for (var i = 0; i < res.data.length; i++) {
        var row = res.data[i], v = row.value, changed = false;
        if (!v) continue;
        if (Array.isArray(v)) {                          // history / approved: array of {grid, names}
          v.forEach(function (snap) { if (snap) { if (rewriteGrid(snap.grid)) changed = true; if (rewriteNames(snap.names)) changed = true; } });
        } else {                                          // live grid: {grid, names}
          if (rewriteGrid(v.grid)) changed = true;
          if (rewriteNames(v.names)) changed = true;
        }
        if (changed) { await sb.from("app_state").upsert({ key: row.key, value: v }); summary[kind]++; }
      }
    }
    await processGridRows("boa_sched_%", "schedules");
    await processGridRows("boa_mgrsched_%", "schedules");
    await processGridRows("boa_schedhist_%", "history");
    await processGridRows("boa_mgrschedhist_%", "history");
    await processGridRows("boa_schedapproved_%", "approved");
    await processGridRows("boa_mgrschedapproved_%", "approved");
    await processGridRows("boa_att_%", "attendance");

    // Early-leave sidecar boa_early_<branch>_<ym>: shape { day: { ec: hours } }.
    try {
      var eRes = await sb.from("app_state").select("key, value").like("key", "boa_early_%");
      if (!eRes.error && Array.isArray(eRes.data)) {
        for (var e = 0; e < eRes.data.length; e++) {
          var eRow = eRes.data[e], ev = eRow.value, eChanged = false;
          if (ev && typeof ev === "object") {
            Object.keys(ev).forEach(function (day) {
              var dayMap = ev[day]; if (!dayMap || typeof dayMap !== "object") return;
              Object.keys(dayMap).forEach(function (k) {
                if (norm(k) !== oN || k === _n) return;
                if (!(_n in dayMap)) dayMap[_n] = dayMap[k];
                delete dayMap[k]; eChanged = true;
              });
            });
          }
          if (eChanged) { await sb.from("app_state").upsert({ key: eRow.key, value: ev }); summary.earlyLeaves++; }
        }
      }
    } catch (_e) { /* non-fatal */ }

    // List rows keyed by item.ec: leave records + off-day requests.
    async function rewriteEcList(key, kind) {
      var res = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
      if (res.error) return;
      var arr = res.data && res.data.value;
      if (!Array.isArray(arr)) return;
      var changed = false;
      arr.forEach(function (it) { if (it && it.ec != null && norm(it.ec) === oN && String(it.ec) !== _n) { it.ec = _n; changed = true; } });
      if (changed) { await sb.from("app_state").upsert({ key: key, value: arr }); summary[kind]++; }
    }
    await rewriteEcList("boa_leave_v1", "leave");
    await rewriteEcList("boa_mgr_requests_v1", "requests");
    await rewriteEcList("boa_tech_requests_v1", "requests");

    // Maps keyed by ec: custom manager hours.
    try {
      var ctRes = await sb.from("app_state").select("value").eq("key", "boa_mgr_times_v1").maybeSingle();
      var ct = ctRes && ctRes.data && ctRes.data.value;
      if (ct && typeof ct === "object") {
        var ctChanged = false;
        Object.keys(ct).forEach(function (k) {
          if (norm(k) !== oN || k === _n) return;
          if (!(_n in ct)) ct[_n] = ct[k]; else Object.keys(ct[k] || {}).forEach(function (d) { if (!(d in ct[_n])) ct[_n][d] = ct[k][d]; });
          delete ct[k]; ctChanged = true;
        });
        if (ctChanged) { await sb.from("app_state").upsert({ key: "boa_mgr_times_v1", value: ct }); summary.customTimes++; }
      }
    } catch (_e2) { /* non-fatal */ }

    // Leave balances (entries keyed by NORMALISED ec).
    try {
      var lbRes = await sb.from("app_state").select("value").eq("key", "boa_leave_balances_v1").maybeSingle();
      var lb = lbRes && lbRes.data && lbRes.data.value;
      if (lb && lb.entries && typeof lb.entries === "object" && lb.entries[oN]) {
        var ent = lb.entries[oN];
        ent.ec = nN; ent.rawEc = _n;
        if (nN !== oN) { lb.entries[nN] = ent; delete lb.entries[oN]; } else { lb.entries[oN] = ent; }
        await sb.from("app_state").upsert({ key: "boa_leave_balances_v1", value: lb });
        summary.balances++;
      }
    } catch (_e3) { /* non-fatal */ }

    return summary;
  }

  // ---------- Schedule trash (7-day soft-delete) ----------
  // Single global key holding an array of trash entries. Each entry:
  //   { id, kind:"manager"|"tech", branch, ym, grid, deletedAt, expiresAt }
  // expiresAt = deletedAt + 7 days (ISO string). Expired entries are pruned
  // automatically on every read/write.
  var SCHED_TRASH_KEY = "boa_sched_trash_v1";
  var SCHED_TRASH_TTL_DAYS = 7;

  function _trashId() {
    return "tr_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }
  function _trashPrune(arr) {
    var now = Date.now();
    return (arr || []).filter(function (e) {
      var t = e && e.expiresAt ? Date.parse(e.expiresAt) : 0;
      return t > now;
    });
  }
  async function _trashRead() {
    var res = await sb.from("app_state").select("value").eq("key", SCHED_TRASH_KEY).maybeSingle();
    if (res.error) { console.error("trashRead:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? _trashPrune(v) : [];
  }
  async function _trashWrite(arr) {
    var res = await sb.from("app_state").upsert({ key: SCHED_TRASH_KEY, value: arr || [] });
    if (res.error) throw res.error;
    return arr;
  }

  // Soft-delete the saved schedule for a (branch, ym, kind). Moves the live
  // schedule into the trash bucket (7-day retention) and removes the live key.
  // Returns the trash entry on success, or null if there was nothing to delete.
  async function deleteSchedule(branch, ym, isManager) {
    var liveKey = schedKey(branch, ym, isManager);
    var live = await sb.from("app_state").select("value").eq("key", liveKey).maybeSingle();
    if (live.error) throw live.error;
    var liveVal = live.data && live.data.value;
    if (!liveVal || !liveVal.grid || Object.keys(liveVal.grid).length === 0) {
      return null;
    }
    var now = new Date();
    var entry = {
      id: _trashId(),
      kind: isManager ? "manager" : "tech",
      branch: branch,
      ym: ym,
      grid: liveVal.grid,
      deletedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SCHED_TRASH_TTL_DAYS * 86400000).toISOString()
    };
    var arr = await _trashRead();
    arr.unshift(entry);
    await _trashWrite(arr);
    // Remove the live key (so the next open regenerates fresh).
    var del = await sb.from("app_state").delete().eq("key", liveKey);
    if (del.error) throw del.error;
    // Also clear the version-history row for this period to keep things tidy.
    await sb.from("app_state").delete().eq("key", schedHistKey(branch, ym, isManager));
    return entry;
  }

  // List all non-expired trash entries (newest first), optionally filtered.
  async function listDeletedSchedules(opts) {
    var arr = await _trashRead();
    // Persist pruned list back so storage doesn't grow forever.
    _trashWrite(arr).catch(function (e) { console.warn("trash prune persist:", e); });
    if (opts && opts.branch) arr = arr.filter(function (e) { return e.branch === opts.branch; });
    if (opts && opts.kind) arr = arr.filter(function (e) { return e.kind === opts.kind; });
    return arr;
  }

  // Restore a trash entry back to its live schedule key. Removes it from trash.
  async function restoreSchedule(trashId) {
    var arr = await _trashRead();
    var idx = arr.findIndex(function (e) { return e.id === trashId; });
    if (idx < 0) throw new Error("Deleted schedule not found (it may have expired).");
    var e = arr[idx];
    var isMgr = e.kind === "manager";
    await saveSchedule(e.branch, e.ym, e.grid, isMgr);
    arr.splice(idx, 1);
    await _trashWrite(arr);
    return e;
  }

  // Permanently remove a trash entry (no restore possible afterwards).
  async function purgeDeletedSchedule(trashId) {
    var arr = await _trashRead();
    var next = arr.filter(function (e) { return e.id !== trashId; });
    await _trashWrite(next);
    return true;
  }

  // ---------- Manager off-day requests (boa_mgr_requests_v1) ----------
  // Each record: { id, ec, name, branch, date (YYYY-MM-DD), note, addedAt }
  async function loadMgrRequests() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_mgr_requests_v1").maybeSingle();
    if (res.error) { console.error("loadMgrRequests:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveMgrRequests(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_mgr_requests_v1", value: records || [] });
    if (res.error) throw res.error;
    return records;
  }

  // ---------- Nail-tech off-day requests (boa_tech_requests_v1) ----------
  // Same shape as the manager list. The check-in app's manager dashboard
  // writes to this same key when a tech submits a day-off request, so the
  // HR portal sees them automatically.
  async function loadTechRequests() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_tech_requests_v1").maybeSingle();
    if (res.error) { console.error("loadTechRequests:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveTechRequests(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_tech_requests_v1", value: records || [] });
    if (res.error) throw res.error;
    return records;
  }

  // Diagnostic: list every app_state row whose key looks request-related so we
  // can find where the check-in app actually writes day-off requests.
  async function listRequestKeys() {
    var keys = [];
    var patterns = ["%request%", "%dayoff%", "%day_off%", "%offday%", "%off_day%"];
    for (var i = 0; i < patterns.length; i++) {
      var res = await sb.from("app_state").select("key, value").like("key", patterns[i]);
      if (res.error) continue;
      (res.data || []).forEach(function (r) {
        var len = Array.isArray(r.value) ? r.value.length : (r.value ? 1 : 0);
        if (!keys.find(function (k) { return k.key === r.key; })) {
          keys.push({ key: r.key, count: len, sample: Array.isArray(r.value) ? r.value[0] : r.value });
        }
      });
    }
    return keys;
  }
  // Probe likely Supabase tables for day-off requests. The check-in app may use
  // a dedicated table instead of an app_state row. Returns one entry per table
  // we tried, with either a row count + sample or the error message that came
  // back so the user can paste it for diagnosis.
  async function probeRequestTables() {
    var candidates = [
      "day_off_requests", "dayoff_requests", "time_off_requests", "off_day_requests",
      "off_requests", "leave_requests", "requests", "day_off", "dayoff",
      "staff_requests", "manager_requests", "tech_requests"
    ];
    var out = [];
    for (var i = 0; i < candidates.length; i++) {
      var t = candidates[i];
      var res = null;
      try {
        res = await sb.from(t).select("*").limit(3);
      } catch (e) {
        out.push({ table: t, error: (e && e.message) || String(e) });
        continue;
      }
      if (res.error) {
        // 42P01 = table does not exist; PGRST205 = relation not found in cache.
        var code = res.error.code || "";
        if (code === "42P01" || code === "PGRST205" || /relation .* does not exist/i.test(res.error.message || "")) {
          // Skip — table just isn't there.
          continue;
        }
        out.push({ table: t, error: res.error.message || JSON.stringify(res.error) });
        continue;
      }
      out.push({ table: t, rows: (res.data || []).length, sample: (res.data || [])[0] || null });
    }
    return out;
  }
  // One-shot load of any app_state row by key, for ad-hoc inspection.
  async function loadByKey(key) {
    var res = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
    if (res.error) return null;
    return (res.data && res.data.value) || null;
  }
  // helpers used by the grid UI
  function currentSchedYm() {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
    if (d.getDate() > 24) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + "-" + String(m).padStart(2, "0");
  }
  // Start-month ym for the cycle that contains today. The Attendance grid and
  // manager schedule both key rows by the START-month of the 25th-to-24th cycle
  // (April 25 → May 24, 2026 lives at "2026-04"). currentSchedYm() returns the
  // END-month convention used by the tech schedule, which is one month ahead —
  // do NOT use it as the Attendance tab's default ym or you load the WRONG
  // cycle's row, which is what was hiding Bree's kiosk check-ins.
  function currentAttYm() {
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
    if (d.getDate() <= 24) { m -= 1; if (m < 1) { m = 12; y -= 1; } }
    return y + "-" + String(m).padStart(2, "0");
  }
  function periodDays(ym) {
    var p = ym.split("-"), y = +p[0], m = +p[1];
    var prevM = m === 1 ? 12 : m - 1, prevY = m === 1 ? y - 1 : y;
    var lastPrev = new Date(prevY, prevM, 0).getDate();
    var todayStr = new Date().toDateString();
    var out = [];
    for (var d = 25; d <= lastPrev; d++) {
      var dt = new Date(prevY, prevM - 1, d);
      out.push({ d: d, monthIdx: prevM - 1, year: prevY, isToday: dt.toDateString() === todayStr, dow: dt.getDay() });
    }
    for (var d2 = 1; d2 <= 24; d2++) {
      var dt2 = new Date(y, m - 1, d2);
      out.push({ d: d2, monthIdx: m - 1, year: y, isToday: dt2.toDateString() === todayStr, dow: dt2.getDay() });
    }
    return out;
  }
  function periodLabel(ym) {
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    var p = ym.split("-"), y = +p[0], m = +p[1];
    var sm = m === 1 ? 12 : m - 1, sy = m === 1 ? y - 1 : y;
    return months[sm - 1] + " 25" + (sy !== y ? ", " + sy : "") + " — " + months[m - 1] + " 24, " + y;
  }
  function shiftYm(ym, delta) {
    var p = ym.split("-"), y = +p[0], m = +p[1] + delta;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return y + "-" + String(m).padStart(2, "0");
  }

  // ---------- HR Tasks (boa_hrtasks_v1) ----------
  async function loadHRTasks() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_hrtasks_v1").maybeSingle();
    if (res.error) { console.error("loadHRTasks:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveHRTasks(tasks) {
    var res = await sb.from("app_state").upsert({ key: "boa_hrtasks_v1", value: tasks });
    if (res.error) throw res.error;
    return tasks;
  }

  // ---------- Onboarding (boa_onboard_v1) ----------
  // Each record: {_id, name, ec, branch, position, positionOther, startDate, notes, addedAt, updatedAt}
  async function loadOnboarding() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_onboard_v1").maybeSingle();
    if (res.error) { console.error("loadOnboarding:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveOnboarding(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_onboard_v1", value: records || [] });
    if (res.error) throw res.error;
    return records;
  }

  // ---------- Trial Period (boa_trial_period_v1) ----------
  // Separate from onboarding — this tracks the 1-week induction + 2-week branch
  // trial BEFORE the 3-month contract is signed.
  // Each record: {
  //   _id, name, phone, email, homeAddress, trainerName,
  //   inductionPassDate, inductionNotes,
  //   branch,           -- assigned branch (closest to home)
  //   status: "induction" | "trial_w1" | "pending_mid_review" | "trial_w2" |
  //           "pending_final_review" | "passed" | "failed",
  //   startDate,        -- trial start date (when they enter branch)
  //   midEval:  { submittedAt, submittedBy, scores, notes },
  //   finalEval:{ submittedAt, submittedBy, scores, notes, outcome },
  //   promotedToOnboarding: true|false,
  //   promotedAt: ISO string,
  //   addedAt, updatedAt
  // }
  async function loadTrialPeriod() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_trial_period_v1").maybeSingle();
    if (res.error) { console.error("loadTrialPeriod:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveTrialPeriod(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_trial_period_v1", value: records || [] });
    if (res.error) throw res.error;
    return records;
  }

  // ---------- Off-boarding (boa_offboard_v1) ----------
  // Each record: {ec, name, branch, leftDate, reason, notes, addedAt}
  async function loadOffboarding() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_offboard_v1").maybeSingle();
    if (res.error) { console.error("loadOffboarding:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveOffboarding(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_offboard_v1", value: records || [] });
    if (res.error) throw res.error;
    return records;
  }

  // ---------- SM (Store Manager) trial (boa_sm_trial_v1) ----------
  // Existing AMs put on a 3-month trial to become Store Managers. Lives in
  // its own list so the manager record stays clean (and a tagged AM can
  // still be edited / moved exactly like any other manager). Each record:
  // {
  //   _id, ec, name, branch,
  //   startDate (YYYY-MM-DD),                // when the trial began
  //   trialDays (default 90),                // total trial length
  //   evaluations: [                         // 3 evaluation checkpoints
  //     {key:"m1", dueOffset:30, doneAt:null, notes:""},
  //     {key:"m2", dueOffset:60, doneAt:null, notes:""},
  //     {key:"final", dueOffset:90, doneAt:null, notes:""}
  //   ],
  //   status: "active" | "passed" | "failed" | "withdrawn",
  //   outcomeAt, notes, addedAt, updatedAt
  // }
  async function loadSmTrial() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_sm_trial_v1").maybeSingle();
    if (res.error) { console.error("loadSmTrial:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveSmTrial(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_sm_trial_v1", value: records || [] });
    if (res.error) throw res.error;
    return records;
  }

  // ---------- Manager clock-ins viewer ----------
  // Recent manager clock-in rows (joined with staff name) for the HR
  // Daily cash-up rows from the kiosk. The kiosk writes one row per
  // branch/date into the `cashups` table. The HR portal reads this for
  // the Cash Ups page so finance / regional ops can monitor banking
  // status across all stores. We pull everything across branches —
  // region & branch filtering happens client-side using SALONS.
  async function listRecentCashups(daysBack) {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (daysBack || 14));
    var since = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    var res = await sb.from("cashups").select("*")
      .gte("date", since)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000);
    if (res.error) { console.error("listRecentCashups:", res.error); return []; }
    return res.data || [];
  }

  // Cash-ups for a single day across every branch — powers the HR portal's
  // day-by-day Cash Ups navigator (region/branch filtering stays client-side).
  async function listCashupsForDate(dateStr) {
    if (!dateStr) return [];
    var res = await sb.from("cashups").select("*")
      .eq("date", dateStr)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (res.error) { console.error("listCashupsForDate:", res.error); return []; }
    return res.data || [];
  }

  // Manager day-status — reason captured by a ROM when a scheduled manager
  // didn't clock in. Powers the "Mark reason" flow on Manager Check-ins,
  // overlays the absence on the attendance grid, and feeds the ROM dashboard
  // to-do list. Stored as one row per (staff_id, date).
  async function loadManagerDayStatuses(daysBack) {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (daysBack || 60));
    var since = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    var res = await sb.from("manager_day_status").select("*")
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(5000);
    if (res.error) { console.error("loadManagerDayStatuses:", res.error); return []; }
    return res.data || [];
  }

  async function saveManagerDayStatus(p) {
    if (!p || !p.staffId || !p.date || !p.status) throw new Error("staffId, date and status are required");
    var row = {
      staff_id:    p.staffId,
      date:        p.date,
      status:      p.status,
      note:        (p.note || "").trim() || null,
      proof:       p.proof || null,
      recorded_by: (p.recordedBy || "").trim() || null,
      updated_by:  (p.recordedBy || "").trim() || null,
      updated_at:  new Date().toISOString()
    };
    var res = await sb.from("manager_day_status")
      .upsert(row, { onConflict: "staff_id,date" })
      .select()
      .maybeSingle();
    if (res.error) { console.error("saveManagerDayStatus:", res.error); throw res.error; }
    return res.data;
  }

  // Hard-delete a single (staff_id, date) row. Used when a ROM-tagged
  // reason is stale — e.g. the schedule was later corrected to OFF and
  // the absence reason no longer applies.
  async function deleteManagerDayStatus(p) {
    if (!p || !p.staffId || !p.date) throw new Error("staffId and date are required");
    var res = await sb.from("manager_day_status")
      .delete()
      .eq("staff_id", p.staffId)
      .eq("date", p.date);
    if (res.error) { console.error("deleteManagerDayStatus:", res.error); throw res.error; }
    return true;
  }

  // Manually enter a cash-up from the HR portal for a store that forgot to
  // submit (typically a previous day). Mirrors the kiosk's addCashup shape but
  // for an arbitrary branch + date, and stamps the notes so it's clear in the
  // table that finance/ops keyed it in rather than the store. `total` is a
  // generated column in Supabase, so we never set it. Banking-slip and
  // Yoco-photo aren't capturable here (no kiosk camera) and stay null.
  async function addCashupManual(p) {
    if (!p || !p.branch || !p.date) throw new Error("Branch and date are required");
    var stamp = "[Entered manually via HR portal" + (p.entered_by ? " by " + String(p.entered_by).trim() : "") + "]";
    var notes = (p.notes || "").trim();
    notes = notes ? (notes + " " + stamp) : stamp;
    var row = {
      branch: p.branch,
      date:   p.date,
      yoco:      Number(p.yoco)      || 0,
      yoco_link: Number(p.yoco_link) || 0,
      cash:      Number(p.cash)      || 0,
      card_tips: Number(p.card_tips) || 0,
      vouchers:  Number(p.vouchers)  || 0,
      gift_card: Number(p.gift_card) || 0,
      manual_discounts:       Number(p.manual_discounts) || 0,
      manual_discount_reason: (p.manual_discount_reason || "").trim() || null,
      notes:     notes,
      signed_by: (p.signed_by || "").trim() || (p.entered_by || "").trim() || "HR portal",
      cash_banked:   (p.cash_banked === true || p.cash_banked === false) ? p.cash_banked : null,
      amount_banked: Number(p.amount_banked) || 0,
      banking_ref:   (p.banking_ref || "").trim() || null,
      banked_by:     (p.banked_by   || "").trim() || null
    };
    var res = await sb.from("cashups").insert(row).select().single();
    if (res.error) { console.error("addCashupManual:", res.error); throw res.error; }
    return res.data;
  }

  // Soft-delete a cash-up so the store can submit a fresh one for the
  // same date from the kiosk. The kiosk's todaysCashup() filters
  // archived rows out, so a reopened row falls off the "already
  // submitted" check and the empty form is shown again. The archived
  // row stays in the table for audit — finance can still see what was
  // originally entered and who reopened it.
  async function reopenCashup(id, actorName) {
    if (!id) throw new Error("Missing cashup id");
    var res = await sb.from("cashups")
      .update({ archived_at: new Date().toISOString(), reopened_by: (actorName || "").trim() || null })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (res.error) { console.error("reopenCashup:", res.error); throw res.error; }
    return res.data;
  }

  // Permanently remove a cash-up row (hard delete). Unlike reopenCashup, which
  // keeps the entry for audit, this fully removes it from Supabase — so it
  // disappears from the HR portal AND the store's kiosk. Intended for clearing
  // test or duplicate entries.
  async function deleteCashup(id) {
    if (!id) throw new Error("Missing cashup id");
    var res = await sb.from("cashups").delete().eq("id", id);
    if (res.error) { console.error("deleteCashup:", res.error); throw res.error; }
    return true;
  }

  // Mark a cash-up as reviewed ("ticked off") by a reviewer — e.g. the
  // portfolio / regional ops manager confirming the day's takings match.
  // Stamps who reviewed it, when, and an optional comment. Re-calling
  // updates the comment / reviewer (re-stamps the time). Requires the
  // reviewed_at / reviewed_by / review_comment columns (sql/cashup_review.sql).
  async function reviewCashup(id, reviewer, comment) {
    if (!id) throw new Error("Missing cashup id");
    var res = await sb.from("cashups")
      .update({
        reviewed_at:    new Date().toISOString(),
        reviewed_by:    (reviewer || "").trim() || null,
        review_comment: (comment || "").trim() || null
      })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (res.error) { console.error("reviewCashup:", res.error); throw res.error; }
    return res.data;
  }

  // Undo a review (clear the tick-off) — for when a cash-up was ticked off
  // by mistake. Wipes reviewer, timestamp and comment.
  async function unreviewCashup(id) {
    if (!id) throw new Error("Missing cashup id");
    var res = await sb.from("cashups")
      .update({ reviewed_at: null, reviewed_by: null, review_comment: null })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (res.error) { console.error("unreviewCashup:", res.error); throw res.error; }
    return res.data;
  }

  // portal's spot-check viewer. Photo + GPS lives in app_state under
  // boa_mgrclockin_meta_<id> — fetch lazily per row.
  // Fetch ALL clockins since a cutoff, paging past PostgREST's server-side
  // row cap (~1000 rows per request). The old single request silently
  // returned only the NEWEST ~1000 rows — as daily volume grew, the visible
  // window shrank below the requested daysBack and older days' clock-ins
  // appeared to vanish "day by day". Nothing was ever deleted; the rows just
  // fell past the cap. Newest-first so consumers keep their ordering.
  async function _allClockinsSince(sinceIso) {
    var out = [], page = 1000, from = 0;
    for (;;) {
      var res = await sb.from("clockins")
        .select("*, staff:staff_id ( id, name, employee_code, role_type, branch )")
        .gte("ts", sinceIso)
        .order("ts", { ascending: false })
        .range(from, from + page - 1);
      if (res.error) { console.error("clockins page @" + from + ":", res.error); break; }
      var rows = res.data || [];
      for (var i = 0; i < rows.length; i++) out.push(rows[i]);
      if (rows.length < page || out.length >= 60000) break;   // exhausted (or sanity stop)
      from += page;
    }
    return out;
  }
  async function listRecentManagerClockins(daysBack) {
    var since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - (daysBack || 14));
    var rows = await _allClockinsSince(since.toISOString());
    return rows.filter(function (r) { return r.staff && r.staff.role_type === "manager"; });
  }
  // Same as the manager viewer but filtered to nail-tech clock-ins. Used by
  // the Daily Check-ins tab and by the Attendance tab to overlay check-in
  // markers on the grid.
  async function listRecentTechClockins(daysBack) {
    var since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - (daysBack || 60));
    var rows = await _allClockinsSince(since.toISOString());
    // Keep tech rows AND orphan rows (staff join failed) so the Daily Check-ins
    // tab can surface them as diagnostics. Only manager-tagged rows are dropped.
    return rows.filter(function (r) { return !r.staff || r.staff.role_type !== "manager"; });
  }
  // Lazily fetch a single proof image from app_state. The kiosk app stores
  // proof-of-sickness/FRL pictures as data URLs at boa_proof_<branch>_<ym>_<ec>_<day>
  // wrapped in {__raw: <dataUrl>}. Used by the Daily Check-ins tab when the user
  // clicks "View proof" on a sick/frl/absent entry.
  async function loadKioskProof(proofKeyName) {
    if (!proofKeyName) return null;
    var res = await sb.from("app_state").select("value").eq("key", proofKeyName).maybeSingle();
    if (res.error) { console.error("loadKioskProof:", res.error); return null; }
    var v = res.data && res.data.value;
    if (v && typeof v === "object" && v.__raw) return v.__raw;
    if (typeof v === "string") return v;
    return null;
  }
  // List kiosk-app submissions across every branch and recent cycles. The kiosk
  // appends each submission to boa_kiosk_log_<branch>_<ym> in app_state with
  // {ec, dayKey, status, note, ts}. We read that log here so Daily Check-ins
  // shows only what the kiosk wrote — NOT the noisy attendance grid which is
  // also written by Fresha imports and HR-portal manual edits.
  async function listRecentKioskCheckins(daysBack, branchNames) {
    var d = daysBack || 60;
    var now = new Date();
    var ymKeys = [];
    var startCycle = (now.getDate() <= 24) ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    var cyclesNeeded = Math.max(2, Math.ceil(d / 30) + 1);
    for (var i = 0; i < cyclesNeeded; i++) {
      var c = new Date(startCycle.getFullYear(), startCycle.getMonth() - i, 1);
      ymKeys.push(c.getFullYear() + "-" + String(c.getMonth() + 1).padStart(2, "0"));
    }
    var allKeys = [];
    (branchNames || []).forEach(function (b) {
      ymKeys.forEach(function (ym) { allKeys.push("boa_kiosk_log_" + b + "_" + ym); });
    });
    if (allKeys.length === 0) return [];
    var rows = [];
    var CHUNK = 200;
    for (var off = 0; off < allKeys.length; off += CHUNK) {
      var slice = allKeys.slice(off, off + CHUNK);
      var res = await sb.from("app_state").select("key, value").in("key", slice);
      if (res.error) { console.error("listRecentKioskCheckins chunk:", res.error); continue; }
      rows = rows.concat(res.data || []);
    }
    var since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - d);
    var out = [];
    rows.forEach(function (row) {
      var keyM = /boa_kiosk_log_(.+)_(\d{4}-\d{2})$/.exec(row.key || "");
      if (!keyM) return;
      var rowBranch = keyM[1];
      var entries = Array.isArray(row.value) ? row.value : [];
      entries.forEach(function (e) {
        if (!e || !e.ts) return;
        var ts = new Date(e.ts);
        if (isNaN(ts) || ts < since) return;
        // Heal kiosk extra-day entries dated one cycle forward. The kiosk's
        // markExtraDay used START-month date math on its END-month cycle key,
        // stamping a ymd exactly one month in the future — so a May 12 extra
        // day surfaced as a phantom EXTRA on June 12. A kiosk "ext" mark is
        // always made ON the day itself, so its ymd can never be after the
        // date it was written: pull such entries back to the timestamp's day.
        // (The kiosk write is fixed too, but the bad entries persist in the
        // log, and a kiosk with a stale cached script may still write more.)
        var ymd = e.ymd || null;
        if (ymd && e.status === "ext" && !e.manual) {
          var tsYmd = ts.getFullYear() + "-" + String(ts.getMonth() + 1).padStart(2, "0") + "-" + String(ts.getDate()).padStart(2, "0");
          if (ymd > tsYmd) ymd = tsYmd;
        }
        out.push({
          id: "kiosk_" + rowBranch + "_" + e.ts + "_" + (e.ec || ""),
          ts: e.ts,
          dayKey: e.dayKey,
          ymd: ymd,
          type: "att",
          status: e.status,
          note: e.note || null,
          hasProof: !!e.hasProof,
          proofKey: e.proofKey || null,
          markedBy: e.markedBy || e.manager || e.by || null,        // which manager submitted this
          manual: !!e.manual,                                       // created from the HR portal, not the kiosk
          ec: e.ec,
          branch: rowBranch,
          source: "kiosk_log"
        });
      });
    });
    // Tag each entry with whether its day was signed off in the kiosk — i.e.
    // the manager tapped "Confirm and submit attendance", which writes
    // boa_dly_<branch>_<ymd> with a signedBy. The Daily Check-ins tab uses
    // this to surface ONLY submitted days, so a manager's live tagging
    // (late → on time → …) doesn't show up as half-finished duplicates.
    // Left as a per-row flag rather than a filter so other consumers of this
    // data (attendance-grid marks, importer, Fresha discrepancies) keep their
    // existing live behaviour.
    var dlyKeySet = {};
    out.forEach(function (r) { if (r.ymd) dlyKeySet["boa_dly_" + r.branch + "_" + r.ymd] = true; });
    var dlyKeys = Object.keys(dlyKeySet);
    var signedOff = {};
    for (var dk = 0; dk < dlyKeys.length; dk += CHUNK) {
      var dslice = dlyKeys.slice(dk, dk + CHUNK);
      var dres = await sb.from("app_state").select("key, value").in("key", dslice);
      if (dres.error) { console.error("listRecentKioskCheckins signoff:", dres.error); continue; }
      (dres.data || []).forEach(function (row) {
        if (row.value && row.value.signedBy) signedOff[row.key] = true;
      });
    }
    out.forEach(function (r) {
      r.signedOff = r.ymd ? !!signedOff["boa_dly_" + r.branch + "_" + r.ymd] : false;
    });
    out.sort(function (a, b) { return b.ts.localeCompare(a.ts); });
    return out;
  }

  // Create a check-in manually from the HR portal. Writes an entry into the
  // same boa_kiosk_log_<branch>_<ym> the kiosk uses (under the date's calendar
  // month) tagged manual:true, so it shows in the Nail Tech Check-ins feed even
  // for days the kiosk hasn't signed off, and is picked up by "Import Check-ins"
  // like any kiosk submission. Re-adding for the same (ec, day) replaces it.
  async function addManualKioskCheckin(branch, ec, ymd, status, note, markedBy) {
    if (!branch || !ec || !ymd || !status) throw new Error("Need branch, tech, date and status.");
    var ym = String(ymd).slice(0, 7);                 // YYYY-MM (calendar month)
    var key = "boa_kiosk_log_" + branch + "_" + ym;
    var dayKey = String(parseInt(String(ymd).slice(8, 10), 10));
    var read = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
    if (read.error) { console.error("addManualKioskCheckin read:", read.error); throw read.error; }
    var arr = (read.data && Array.isArray(read.data.value)) ? read.data.value : [];
    arr = arr.filter(function (e) { return !(e && e.manual && e.ec === ec && e.ymd === ymd); });
    arr.push({
      ec: ec, dayKey: dayKey, ymd: ymd, status: status,
      note: note || null, manual: true,
      markedBy: markedBy || "HR portal",
      ts: new Date().toISOString()
    });
    var wr = await sb.from("app_state").upsert({ key: key, value: arr });
    if (wr.error) { console.error("addManualKioskCheckin write:", wr.error); throw wr.error; }
    // Also stamp the attendance grid (boa_att_<branch>_<cycleYm>) so it shows
    // on the Attendance sheet straight away — mirroring what the kiosk does
    // when a manager tags a status. The grid is keyed under the cycle's
    // START-month (same convention as currentAttYm()/loadAttendance): the
    // 25th→24th cycle means days 1..24 of month M belong to the cycle that
    // STARTED on the 25th of month M-1, so they key under month M-1; only days
    // 25..31 stay in month M. (The old code shifted the wrong way — +1 instead
    // of -1 — so e.g. a 6 June check-in landed in the 25 Jun→24 Jul grid at
    // day-of-month 6 and rendered as a phantom "On Time" on 6 July.) The grid
    // is keyed by ec → day-of-month. Best-effort: a failure here never blocks
    // the check-in (it still shows in the feed and is importable).
    try {
      var p = String(ymd).split("-").map(Number);
      var ay = p[0], am = p[1];
      if (p[2] <= 24) { am = p[1] - 1; if (am < 1) { am = 12; ay = p[0] - 1; } }
      var attYm = ay + "-" + String(am).padStart(2, "0");
      var att = await loadAttendance(branch, attYm);
      var grid = (att && att.grid && typeof att.grid === "object") ? JSON.parse(JSON.stringify(att.grid)) : {};
      if (!grid[ec]) grid[ec] = {};
      grid[ec][String(p[2])] = status;        // day-of-month key, plain (confirmed) status
      await saveAttendance(branch, attYm, grid);
    } catch (attErr) {
      console.warn("addManualKioskCheckin: attendance-grid stamp failed (non-fatal):", attErr);
    }
    return true;
  }

  // Re-open (unlock) a store's daily check-in by removing the kiosk sign-off
  // record boa_dly_<branch>_<ymd>. After this the kiosk no longer treats the
  // day as locked, so a manager can tag the remaining techs and submit again.
  async function reopenDailyCheckin(branch, ymd) {
    if (!branch || !ymd) throw new Error("Need branch and date.");
    var key = "boa_dly_" + branch + "_" + ymd;
    var r = await sb.from("app_state").delete().eq("key", key);
    if (r.error) { console.error("reopenDailyCheckin:", r.error); throw r.error; }
    return true;
  }

  // ---------- Early-leave sidecar (kiosk) ----------
  // The check-in app's "Left work early" button writes to a separate row
  // per (branch, startYm) under boa_early_<branch>_<startYm>. The value is
  // a nested map { [dayKey]: { [ec]: { hours, recordedAt, recordedBy } } }
  // — startYm uses the same start-month convention as attendance
  // (e.g. "2026-04" for the April 25 → May 24 cycle).
  async function loadEarlyLeaves(branch, ym) {
    var key = "boa_early_" + branch + "_" + ym;
    var res = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
    if (res.error) { console.error("loadEarlyLeaves:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  // ---------- Extra-day sidecar (kiosk) ----------
  // The kiosk's "Extra Day" approval writes to its extras sidecar as a nested
  // map { [dayKey]: { [ec]: { approvedBy, approvedAt } } } where dayKey is the
  // DAY-OF-MONTH string. KEYING QUIRK: unlike the attendance grid and the
  // early-leave sidecar — which the kiosk stores under the START-month of the
  // 25th→24th cycle (attKey/earlyKey subtract a month) — the extras sidecar is
  // keyed by the RAW ymForDate, i.e. the END-month. The portal passes the
  // START-month (attYM, same as loadAttendance), so we shift +1 month here to
  // read the row the kiosk actually wrote.
  async function loadExtras(branch, ym) {
    var p = String(ym).split("-");
    var y = +p[0], m = (+p[1]) + 1; if (m > 12) { m = 1; y += 1; }
    var key = "boa_extras_" + branch + "_" + y + "-" + String(m).padStart(2, "0");
    var res = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
    if (res.error) { console.error("loadExtras:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  // Write / clear a single Extra-Day approval in the kiosk extras sidecar so
  // the store kiosk reads "Extra Day" for that tech on that day, and the
  // attendance sheet shows Extra Day once she's checked in. Unlike loadExtras
  // (which takes the START-month and shifts), these take the END-month `ym`
  // directly — the exact value ymForDate() produces and the key the kiosk
  // itself writes (boa_extras_<branch>_<END-month>). dayKey is day-of-month.
  async function saveExtraDay(branch, ym, dayKey, ec, approvedBy) {
    var key = "boa_extras_" + branch + "_" + ym;
    var res = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
    if (res.error) { console.error("saveExtraDay load:", res.error); throw res.error; }
    var data = (res.data && res.data.value) || {};
    if (!data[dayKey]) data[dayKey] = {};
    data[dayKey][String(ec).trim()] = { approvedBy: (approvedBy || "").toString().slice(0, 80), approvedAt: new Date().toISOString() };
    var up = await sb.from("app_state").upsert({ key: key, value: data });
    if (up.error) { console.error("saveExtraDay:", up.error); throw up.error; }
    return data;
  }
  async function clearExtraDay(branch, ym, dayKey, ec) {
    var key = "boa_extras_" + branch + "_" + ym;
    var res = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
    if (res.error) { console.error("clearExtraDay load:", res.error); throw res.error; }
    var data = (res.data && res.data.value) || {};
    if (data[dayKey]) { delete data[dayKey][String(ec).trim()]; if (Object.keys(data[dayKey]).length === 0) delete data[dayKey]; }
    var up = await sb.from("app_state").upsert({ key: key, value: data });
    if (up.error) { console.error("clearExtraDay:", up.error); throw up.error; }
    return data;
  }
  // Fresha "to-do" open-status for approved extra days — a single app_state
  // row { [requestId]: { opened, by, at } }. Lets the Fresha To-Do ops tab
  // tick an approved extra day as "opened on Fresha" without touching the
  // extra_day_requests table.
  async function loadFreshaExtraOpenings() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_fresha_extra_open_v1").maybeSingle();
    if (res.error) { console.error("loadFreshaExtraOpenings:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  async function saveFreshaExtraOpenings(map) {
    var res = await sb.from("app_state").upsert({ key: "boa_fresha_extra_open_v1", value: map || {} });
    if (res.error) { console.error("saveFreshaExtraOpenings:", res.error); throw res.error; }
    return map || {};
  }
  // Fresha To-Do (closing side): tick a sick/absent nail tech as "blocked on
  // Fresha" — i.e. greyed out so no client bookings land while she's off —
  // keyed by leave-request id, without touching the leave_requests table.
  async function loadFreshaBlocks() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_fresha_blocks_v1").maybeSingle();
    if (res.error) { console.error("loadFreshaBlocks:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  async function saveFreshaBlocks(map) {
    var res = await sb.from("app_state").upsert({ key: "boa_fresha_blocks_v1", value: map || {} });
    if (res.error) { console.error("saveFreshaBlocks:", res.error); throw res.error; }
    return map || {};
  }
  // Persist the boa_early_<branch>_<ym> sidecar (the whole nested map). Used
  // by the attendance sheet to clear a single day's 'left early' short-hours
  // when an admin overrides that cell, so the orange -Xh overlay can be
  // removed (it lives in this sidecar, not the attendance grid).
  async function saveEarlyLeaves(branch, ym, value) {
    var key = "boa_early_" + branch + "_" + ym;
    var res = await sb.from("app_state").upsert({ key: key, value: value || {} });
    if (res.error) { console.error("saveEarlyLeaves:", res.error, "key:", key); throw res.error; }
    return value || {};
  }
  // Delete the boa_early_<branch>_<ym> sidecar entirely. Called by the
  // Attendance Total Reset so the 'left early' orange overlay clears
  // along with the rest of the display state. The next Import Check-ins
  // recreates the sidecar from the kiosk early-leave entries.
  async function deleteEarlyLeaves(branch, ym) {
    var key = "boa_early_" + branch + "_" + ym;
    var r = await sb.from("app_state").delete().eq("key", key);
    if (r.error) { console.error("deleteEarlyLeaves:", r.error, "key:", key); throw r.error; }
    return true;
  }

  // ---------- Store-opening status ----------
  // The kiosk's "open the store" button writes one row per (branch, ymd) to
  // app_state under boa_store_open_<branch>_<YYYY-MM-DD> with value
  // { openedAt: ISO, openedBy: "Manager Name", branch: "..." }. Used by the
  // Operations "Store Openings" tab to flag branches still closed for the
  // day so the ops manager knows who to chase.
  async function listStoreOpenings(ymd) {
    if (!ymd) {
      var today = new Date();
      ymd = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    }
    var like = "boa_store_open_%_" + ymd;
    var res = await sb.from("app_state").select("key,value").like("key", like);
    if (res.error) { console.error("listStoreOpenings:", res.error); return []; }
    var rows = res.data || [];
    var out = [];
    rows.forEach(function (row) {
      var m = /^boa_store_open_(.+)_(\d{4}-\d{2}-\d{2})$/.exec(row.key || "");
      if (!m) return;
      var val = row.value || {};
      out.push({
        branch: val.branch || m[1],
        ymd: val.ymd || m[2],
        openedAt: val.openedAt || null,
        openedBy: val.openedBy || null
      });
    });
    return out;
  }

  // DEPRECATED: pulled every cell of the attendance grid, including Fresha
  // imports, manual HR-portal edits, and schedule mirrors — way too noisy.
  // Kept for the diagnostics probe only. Use listRecentKioskCheckins instead
  // for the Daily Check-ins display.
  async function listRecentAttendanceCheckins(daysBack, branchNames) {
    var d = daysBack || 60;
    // Cycle keys are START-month of the 25-to-24 cycle. Cover the cycle that
    // contains today, plus enough prior cycles to span `daysBack` days. One
    // cycle is ~30 days, so two prior cycles is plenty for the default 60.
    var now = new Date();
    var ymKeys = [];
    var startCycle = (now.getDate() <= 24) ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    var cyclesNeeded = Math.max(2, Math.ceil(d / 30) + 1);
    for (var i = 0; i < cyclesNeeded; i++) {
      var c = new Date(startCycle.getFullYear(), startCycle.getMonth() - i, 1);
      ymKeys.push(c.getFullYear() + "-" + String(c.getMonth() + 1).padStart(2, "0"));
    }
    var allKeys = [];
    (branchNames || []).forEach(function (b) {
      ymKeys.forEach(function (ym) { allKeys.push("boa_att_" + b + "_" + ym); });
    });
    if (allKeys.length === 0) return [];
    // Supabase IN-list cap is 1000+ items, but we chunk to be safe.
    var rows = [];
    var CHUNK = 200;
    for (var off = 0; off < allKeys.length; off += CHUNK) {
      var slice = allKeys.slice(off, off + CHUNK);
      var res = await sb.from("app_state").select("key, value").in("key", slice);
      if (res.error) { console.error("listRecentAttendanceCheckins chunk:", res.error); continue; }
      rows = rows.concat(res.data || []);
    }
    // Flatten grids → one record per (branch, ec, ymd, status). Skip empty days
    // and the "~" mirror-prefix (those are unconfirmed mirror cells, not real
    // kiosk submissions).
    var since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - d);
    var out = [];
    rows.forEach(function (row) {
      var v = row.value || {};
      var grid = v.grid || {};
      var rowBranch = v.branch || "";
      // Always derive ym from the KEY: the key is reliably written in
      // START-month convention by both apps (HR portal saves with attYM, kiosk
      // converts via attKey()). value.ym is unreliable — the kiosk stores its
      // internal END-month value there, so trusting it shifts every cell forward
      // by one calendar month (e.g. May 8 cells render as Jun 8).
      var rowYm = "";
      var keyM = /boa_att_(.+)_(\d{4}-\d{2})$/.exec(row.key || "");
      if (keyM) { rowBranch = rowBranch || keyM[1]; rowYm = keyM[2]; }
      if (!rowYm) return;
      var ymP = rowYm.split("-").map(Number);
      var cycY = ymP[0], cycM = ymP[1]; // 1-indexed start month
      Object.keys(grid).forEach(function (ec) {
        var byDay = grid[ec] || {};
        Object.keys(byDay).forEach(function (dayKey) {
          var status = byDay[dayKey];
          if (!status) return;
          if (typeof status === "string" && status.charAt(0) === "~") return; // mirror, not a real check-in
          // Daily Check-ins is conceptually "who showed up to work today" — drop
          // every status that isn't a presence code. This excludes off-days,
          // leave, sick, term, etc. (which get written to the same grid by
          // Fresha imports and HR-portal admin actions, not by the kiosk's
          // Nail Tech Check-in tile). Statuses like "deduct:<hours>" still
          // start with "on" semantics — keep "on"-prefixed values.
          var bare = status;
          var PRESENCE = { on: 1, late: 1, ext: 1, trial: 1, swap_o: 1 };
          if (!PRESENCE[bare]) return;
          // dayKey is "1".."31" within the cycle. Days 25..31 belong to the
          // start month; days 1..24 belong to the next month.
          var dayNum = parseInt(dayKey, 10);
          if (!dayNum) return;
          var dt;
          if (dayNum >= 25) {
            dt = new Date(cycY, cycM - 1, dayNum);
          } else {
            var nm = cycM + 1, ny = cycY; if (nm > 12) { nm = 1; ny += 1; }
            dt = new Date(ny, nm - 1, dayNum);
          }
          if (dt < since) return;
          var ymd = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
          out.push({
            id: "att_" + rowBranch + "_" + ymd + "_" + ec,
            ts: dt.toISOString(),
            ymd: ymd,
            type: "att",
            status: status,
            ec: ec,
            branch: rowBranch,
            source: "attendance_grid"
          });
        });
      });
    });
    out.sort(function (a, b) { return b.ts.localeCompare(a.ts); });
    return out;
  }
  // Probe the attendance-grid app_state rows for a branch under both ym conventions
  // (start-month and end-month). The check-in kiosk app writes daily attendance
  // statuses there, NOT into the clockins table. Used by the Daily Check-ins tab
  // diagnostics to confirm where check-ins actually landed.
  async function probeAttendanceGrid(branch) {
    var now = new Date();
    var ymCandidates = [];
    for (var off = -1; off <= 1; off++) {
      var d = new Date(now.getFullYear(), now.getMonth() + off, 1);
      ymCandidates.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    }
    var keys = ymCandidates.map(function (ym) { return "boa_att_" + branch + "_" + ym; });
    var res = await sb.from("app_state").select("key, value").in("key", keys);
    if (res.error) return { error: res.error.message || JSON.stringify(res.error), grids: [] };
    var grids = (res.data || []).map(function (row) {
      var v = row.value || {};
      var grid = v.grid || {};
      var ecs = Object.keys(grid);
      var dayCounts = {};
      ecs.forEach(function (ec) {
        Object.keys(grid[ec] || {}).forEach(function (day) {
          dayCounts[day] = (dayCounts[day] || 0) + 1;
        });
      });
      return { key: row.key, ym: v.ym, savedAt: v.savedAt, ecCount: ecs.length, dayCounts: dayCounts };
    });
    return { grids: grids, probedKeys: keys };
  }
  // Raw probe used by the Daily Check-ins tab to bypass the staff join and any
  // related RLS filtering. Returns the unfiltered rows + counts so the diagnostic
  // panel can show whether records exist in clockins at all.
  async function probeRecentClockinsRaw(daysBack) {
    var since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - (daysBack || 60));
    var raw = await sb.from("clockins")
      .select("*")
      .gte("ts", since.toISOString())
      .order("ts", { ascending: false })
      .limit(5000);
    if (raw.error) return { error: raw.error.message || JSON.stringify(raw.error), rows: [], count: 0 };
    var rows = raw.data || [];
    // Probe distinct staff_ids to see whether they resolve in the staff table.
    var ids = Array.from(new Set(rows.map(function (r) { return r.staff_id; }).filter(Boolean)));
    var staffById = {};
    if (ids.length) {
      var sres = await sb.from("staff").select("id, name, employee_code, role_type, branch").in("id", ids);
      if (!sres.error) (sres.data || []).forEach(function (s) { staffById[s.id] = s; });
    }
    return { rows: rows, count: rows.length, staffById: staffById, sinceIso: since.toISOString() };
  }
  async function loadClockinMeta(clockinId) {
    var res = await sb.from("app_state").select("value").eq("key", "boa_mgrclockin_meta_" + clockinId).maybeSingle();
    if (res.error) { console.warn("loadClockinMeta:", res.error); return null; }
    return (res.data && res.data.value) || null;
  }

  // Manually log a manager clock-in from the HR portal — used when a
  // manager forgot to clock in on the kiosk. Writes the same row shape
  // the kiosk uses, so it flows naturally into every downstream view
  // (Manager Check-ins list, no-show banner, Manager Coverage green
  // dot, dashboard tile). Mirrors the kiosk's `addManagerClockinWithMeta`
  // without GPS/photo metadata, and tags the meta row so an audit can
  // tell manual entries from real kiosk taps.
  async function recordManualManagerClockin(opts) {
    if (!opts || !opts.staffId) throw new Error("staffId required");
    var type = opts.type || "in";
    var row = {
      staff_id: opts.staffId,
      branch: opts.branch || null,
      type: type
    };
    if (opts.ts) row.ts = opts.ts;
    var ins = await sb.from("clockins").insert(row).select().single();
    if (ins.error) throw ins.error;
    try {
      await sb.from("app_state").upsert({
        key: "boa_mgrclockin_meta_" + ins.data.id,
        value: {
          source: "hr_portal_manual",
          recordedBy: opts.recordedBy || null,
          note: opts.note || null,
          createdAt: new Date().toISOString()
        }
      });
    } catch (e) { console.warn("manual clock-in meta save:", e); }
    return ins.data;
  }

  // Hard-delete a single clock-in row (owner-only action in the UI). Used to
  // remove a test / mistaken clock-in so it stops driving the attendance sheet.
  // Also clears the row's selfie/GPS meta sidecar. Does NOT touch attendance
  // grids or manager_day_status.
  async function deleteClockin(id) {
    if (id == null) throw new Error("clock-in id is required");
    var res = await sb.from("clockins").delete().eq("id", id);
    if (res.error) { console.error("deleteClockin:", res.error); throw res.error; }
    try { await sb.from("app_state").delete().eq("key", "boa_mgrclockin_meta_" + id); }
    catch (e) { console.warn("deleteClockin meta cleanup:", e); }
    return true;
  }

  // ---------- Manager personal PIN registry (boa_mgr_pins_v1) ----------
  // Map of {employee_code: 6-digit-pin}. Used by the check-in app's
  // Clock-in tab so each manager can confirm their own attendance.
  // Stored separately from the staff table to avoid a schema migration.
  async function loadManagerPins() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_mgr_pins_v1").maybeSingle();
    if (res.error) { console.error("loadManagerPins:", res.error); return {}; }
    var v = res.data && res.data.value;
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  }
  async function saveManagerPins(map) {
    var res = await sb.from("app_state").upsert({ key: "boa_mgr_pins_v1", value: map || {} });
    if (res.error) throw res.error;
    return map;
  }

  // ---------- Leave records (boa_leave_v1) ----------
  // Each record: {_id, ec, startDate, endDate, type, notes, emergency}
  // type values: "Annual leave" | "Sick leave" | "Maternity" | "Unpaid"
  async function loadLeaveRecords() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_leave_v1").maybeSingle();
    if (res.error) { console.error("loadLeaveRecords:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveLeaveRecords(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_leave_v1", value: records || [] });
    if (res.error) throw res.error;
    return records;
  }

  // ---------- Unpaid legal-status leave records (boa_unpaid_legal_v1) ----------
  // Stored as a JSON array on app_state so we don't need a schema migration.
  // Each record: { _id, ec, name, branch, status, startDate, endDate,
  //                hearingDate, terminated, notes }
  // status: "on_leave"   = currently off due to expired/missing documents
  //         "returned"   = documents received, back at work
  //         "terminated" = hearing held + contract terminated
  // Used by the HR portal's "Unpaid Leave (Legal)" admin tab.
  async function loadUnpaidLegalRecords() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_unpaid_legal_v1").maybeSingle();
    if (res.error) { console.error("loadUnpaidLegalRecords:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveUnpaidLegalRecords(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_unpaid_legal_v1", value: records || [] });
    if (res.error) { console.error("saveUnpaidLegalRecords:", res.error); throw res.error; }
    return records;
  }

  // ---------- Compliance actions (boa_compliance_actions_v1) ----------
  // Sidecar tracking per-staff compliance follow-ups. Shape:
  //   { [ec]: { workPermitRequestedAt, workPermitRequestedBy,
  //             workPermitDeadline, workPermitNotes, clearedAt, clearedBy } }
  // Stored on app_state so we don't need a schema migration.
  async function loadComplianceActions() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_compliance_actions_v1").maybeSingle();
    if (res.error) { console.error("loadComplianceActions:", res.error); return {}; }
    var v = res.data && res.data.value;
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  }
  async function saveComplianceActions(map) {
    var res = await sb.from("app_state").upsert({ key: "boa_compliance_actions_v1", value: map || {} });
    if (res.error) { console.error("saveComplianceActions:", res.error); throw res.error; }
    return map;
  }

  // ---------- Tech day-loans (boa_tech_loans_v1) ----------
  // One-day cross-branch borrowing of a nail tech. Stored as a JSON array on
  // app_state so we don't need a schema migration. Each record is:
  //   { _id, ec, name, date, fromBranch, toBranch, note, createdBy, createdAt }
  // Uniqueness on (ec, date) is enforced by the caller (save replaces the
  // existing row for that pair). Read by both the HR portal "Today's
  // Movements" tab and the check-in kiosk to adapt its check-in gate.
  async function loadTechLoans() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_tech_loans_v1").maybeSingle();
    if (res.error) { console.error("loadTechLoans:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveTechLoans(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_tech_loans_v1", value: records || [] });
    if (res.error) { console.error("saveTechLoans:", res.error); throw res.error; }
    return records;
  }

  // ---------- Manager day-loans (boa_mgr_loans_v1) ----------
  // Mirror of the tech loan model for managers — one record per
  // (manager, day) cross-store assignment. Same shape as tech loans
  // so the kiosk and reports can reuse the same lookup pattern.
  async function loadMgrLoans() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_mgr_loans_v1").maybeSingle();
    if (res.error) { console.error("loadMgrLoans:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveMgrLoans(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_mgr_loans_v1", value: records || [] });
    if (res.error) { console.error("saveMgrLoans:", res.error); throw res.error; }
    return records;
  }

  // ---------- Manager custom shift hours (boa_mgr_times_v1) ----------
  // Per-manager, per-day manual overrides of the computed shift hours,
  // set from the Manager Coverage cell editor (e.g. when one manager has
  // to open early or stay to close because cover fell short). Keyed by
  // employee code then ISO date — both globally unique — so a single
  // store covers every branch/cycle and the kiosk can layer it on top of
  // the schedule grid. Shape: { [ec]: { "YYYY-MM-DD": "HH:MM - HH:MM" } }.
  async function loadMgrTimes() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_mgr_times_v1").maybeSingle();
    if (res.error) { console.error("loadMgrTimes:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  async function saveMgrTimes(map) {
    var res = await sb.from("app_state").upsert({ key: "boa_mgr_times_v1", value: map || {} });
    if (res.error) { console.error("saveMgrTimes:", res.error); throw res.error; }
    return map || {};
  }

  // Abscond / absence-warning follow-ups. When HR actions a flagged person on
  // the dashboard ("marked done" + a note of what was done) we store it here so
  // the warning clears — until the person misses again AFTER the actioned date.
  // Shape: { [ec]: { throughYmd, note, by, at } }.
  async function loadAbscondActions() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_abscond_actions_v1").maybeSingle();
    if (res.error) { console.error("loadAbscondActions:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  async function saveAbscondActions(map) {
    var res = await sb.from("app_state").upsert({ key: "boa_abscond_actions_v1", value: map || {} });
    if (res.error) { console.error("saveAbscondActions:", res.error); throw res.error; }
    return map || {};
  }

  // ---------- Daily tasks (boa_daily_tasks_v1) ----------
  // Per-user to-do items assigned by an admin. Records:
  //   { _id, title, description, assigneePin, date (YYYY-MM-DD),
  //     createdBy, createdAt, doneAt?, doneBy? }
  // The HR portal dashboard reads only TODAY's tasks for the signed-in
  // user; the admin "Daily Tasks" tab edits the whole list.
  async function loadDailyTasks() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_daily_tasks_v1").maybeSingle();
    if (res.error) { console.error("loadDailyTasks:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveDailyTasks(records) {
    var res = await sb.from("app_state").upsert({ key: "boa_daily_tasks_v1", value: records || [] });
    if (res.error) { console.error("saveDailyTasks:", res.error); throw res.error; }
    return records;
  }

  // ---------- Fresha trial access config (boa_fresha_access_v1) ----------
  // Who is responsible for opening trial techs on Fresha, and who can see
  // the trial Fresha reminders on the dashboard. Shape:
  //   { openerPins: ["3030","4040"], viewerRoles: ["national ops","regional ops"], viewerPins: [] }
  // Empty/missing falls back to a sensible default in the app.
  async function loadFreshaAccess() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_fresha_access_v1").maybeSingle();
    if (res.error) { console.error("loadFreshaAccess:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  async function saveFreshaAccess(config) {
    var res = await sb.from("app_state").upsert({ key: "boa_fresha_access_v1", value: config || {} });
    if (res.error) { console.error("saveFreshaAccess:", res.error); throw res.error; }
    return config || {};
  }

  // ---------- Overtime recording access (boa_overtime_access_v1) ----------
  // Who is allowed to RECORD overtime from the HR portal. Shape:
  //   { roles: ["national"], pins: ["1234"] }
  // Owners always have access regardless. Empty/missing → app default.
  async function loadOvertimeAccess() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_overtime_access_v1").maybeSingle();
    if (res.error) { console.error("loadOvertimeAccess:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  async function saveOvertimeAccess(config) {
    var res = await sb.from("app_state").upsert({ key: "boa_overtime_access_v1", value: config || {} });
    if (res.error) { console.error("saveOvertimeAccess:", res.error); throw res.error; }
    return config || {};
  }

  // ---------- Cash-up review access (boa_cashup_review_access_v1) ----------
  // Who is allowed to review ("tick off") a store's daily cash-up. Shape:
  //   { roles: ["regional"], pins: ["1234"] }
  // Owners always have access regardless. Empty/missing → app default.
  async function loadCashupReviewAccess() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_cashup_review_access_v1").maybeSingle();
    if (res.error) { console.error("loadCashupReviewAccess:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  async function saveCashupReviewAccess(config) {
    var res = await sb.from("app_state").upsert({ key: "boa_cashup_review_access_v1", value: config || {} });
    if (res.error) { console.error("saveCashupReviewAccess:", res.error); throw res.error; }
    return config || {};
  }

  // ---------- Leave workflow access (operational + payroll gates) ----------
  // Who may clear the operational gate (boa_leave_ops_access_v1) and who may
  // do the leave-balance / payroll gate (boa_leave_payroll_access_v1). Shape:
  //   { roles: ["regional"], pins: ["1234"] }
  // Owners always have access regardless. Empty/missing → app default.
  async function loadLeaveOpsAccess() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_leave_ops_access_v1").maybeSingle();
    if (res.error) { console.error("loadLeaveOpsAccess:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  async function saveLeaveOpsAccess(config) {
    var res = await sb.from("app_state").upsert({ key: "boa_leave_ops_access_v1", value: config || {} });
    if (res.error) { console.error("saveLeaveOpsAccess:", res.error); throw res.error; }
    return config || {};
  }
  async function loadLeavePayrollAccess() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_leave_payroll_access_v1").maybeSingle();
    if (res.error) { console.error("loadLeavePayrollAccess:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  async function saveLeavePayrollAccess(config) {
    var res = await sb.from("app_state").upsert({ key: "boa_leave_payroll_access_v1", value: config || {} });
    if (res.error) { console.error("saveLeavePayrollAccess:", res.error); throw res.error; }
    return config || {};
  }

  // ---------- Leave balances (Payroll → Leave Balances tab) ----------
  // The payroll-supplied annual-leave balance per employee, plus any manual
  // add/remove-day adjustments, kept as one JSON blob in app_state. Shape:
  //   { asOf: "YYYY-MM-DD", entries: { <ec>: { ec, rawEc, name, opening,
  //     adjustments: [{ id, days, reason, by, ts }] } }, updatedBy, updatedAt }
  async function loadLeaveBalances() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_leave_balances_v1").maybeSingle();
    if (res.error) { console.error("loadLeaveBalances:", res.error); return null; }
    return (res.data && res.data.value) || null;
  }
  async function saveLeaveBalances(data) {
    var res = await sb.from("app_state").upsert({ key: "boa_leave_balances_v1", value: data || {} });
    if (res.error) { console.error("saveLeaveBalances:", res.error); throw res.error; }
    return data || {};
  }
  // Who may see / edit the Leave Balances tab. Defaults to empty → owners only.
  async function loadLeaveBalancesAccess() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_leave_balances_access_v1").maybeSingle();
    if (res.error) { console.error("loadLeaveBalancesAccess:", res.error); return {}; }
    return (res.data && res.data.value) || {};
  }
  async function saveLeaveBalancesAccess(config) {
    var res = await sb.from("app_state").upsert({ key: "boa_leave_balances_access_v1", value: config || {} });
    if (res.error) { console.error("saveLeaveBalancesAccess:", res.error); throw res.error; }
    return config || {};
  }
  // Family Responsibility Leave usage. Shape: { asOf, entries: { normEc: { used, cycleStart } } }.
  async function loadFRL() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_frl_v1").maybeSingle();
    if (res.error) { console.error("loadFRL:", res.error); return null; }
    return (res.data && res.data.value) || null;
  }
  async function saveFRL(data) {
    var res = await sb.from("app_state").upsert({ key: "boa_frl_v1", value: data || {} });
    if (res.error) { console.error("saveFRL:", res.error); throw res.error; }
    return data || {};
  }

  // ---------- Attendance grid (boa_att_<branch>_<ym>) ----------
  // Same key the check-in kiosk app writes to. Status codes include:
  //   on, late, off, ext, sick_n, sick, frl, al, ph, mat, no, unpaid,
  //   deduct:<hours>, trial, term, swap_o, swap_i. A "~" prefix marks
  //   a value mirrored from the schedule but not yet confirmed.
  async function loadAttendance(branch, ym) {
    var res = await sb.from("app_state").select("value").eq("key", "boa_att_" + branch + "_" + ym).maybeSingle();
    if (res.error) { console.error("loadAttendance:", res.error); return null; }
    return (res.data && res.data.value) || null;
  }
  async function saveAttendance(branch, ym, grid, extras) {
    // Preserve sidecar fields (freshaCoverage, freshaWorked, …) that callers
    // didn't pass explicitly — saveAttendance is invoked from many paths
    // (single-cell edit, kiosk import, Fresha CSV) and we don't want one
    // path to clobber the others' metadata.
    var key = "boa_att_" + branch + "_" + ym;
    var prior = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
    var priorVal = (prior.data && prior.data.value) || {};
    var v = Object.assign({}, priorVal, { grid: grid || {}, branch: branch, ym: ym, savedAt: new Date().toISOString() });
    if (extras && typeof extras === "object") {
      Object.keys(extras).forEach(function (k) { v[k] = extras[k]; });
    }
    var res = await sb.from("app_state").upsert({ key: key, value: v });
    if (res.error) throw res.error;
    return v;
  }

  // Single-cell / single-review writes from the attendance sheet. Reads the
  // freshest stored record and merges ONLY the given cells into it, so an
  // edit made from a tab whose in-memory grid is stale can never wipe other
  // days / people saved since that tab loaded. (Saving the whole in-memory
  // grid on every cell edit is exactly how manually added cells kept
  // "vanishing the next day": another open session's whole-grid save
  // overwrote them.) Patches look like { ec: { dayKey: value } }; a null /
  // empty value clears the entry. overridePatch maintains adminOverrides —
  // per-cell { status, by, at } records of manual portal edits, which the
  // attendance sheet treats as the final truth for display + payroll.
  async function updateAttendanceCells(branch, ym, cellPatch, reviewPatch, overridePatch) {
    var key = "boa_att_" + branch + "_" + ym;
    var prior = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
    if (prior.error) throw prior.error;
    var v = (prior.data && prior.data.value) || {};
    var grid = Object.assign({}, v.grid || {});
    if (cellPatch) {
      Object.keys(cellPatch).forEach(function (ec) {
        var row = Object.assign({}, grid[ec] || {});
        Object.keys(cellPatch[ec] || {}).forEach(function (d) {
          var val = cellPatch[ec][d];
          if (val === null || val === undefined || val === "") delete row[d];
          else row[d] = val;
        });
        if (Object.keys(row).length) grid[ec] = row; else delete grid[ec];
      });
    }
    var rw = Object.assign({}, v.reviewedWarnings || {});
    if (reviewPatch) {
      Object.keys(reviewPatch).forEach(function (ec) {
        var row = Object.assign({}, rw[ec] || {});
        Object.keys(reviewPatch[ec] || {}).forEach(function (d) {
          var rec = reviewPatch[ec][d];
          if (rec == null) delete row[d];
          else row[d] = rec;
        });
        if (Object.keys(row).length) rw[ec] = row; else delete rw[ec];
      });
    }
    var ov = Object.assign({}, v.adminOverrides || {});
    if (overridePatch) {
      Object.keys(overridePatch).forEach(function (ec) {
        var row = Object.assign({}, ov[ec] || {});
        Object.keys(overridePatch[ec] || {}).forEach(function (d) {
          var rec = overridePatch[ec][d];
          if (rec == null) delete row[d];
          else row[d] = rec;
        });
        if (Object.keys(row).length) ov[ec] = row; else delete ov[ec];
      });
    }
    var next = Object.assign({}, v, { grid: grid, reviewedWarnings: rw, adminOverrides: ov, branch: branch, ym: ym, savedAt: new Date().toISOString() });
    var res = await sb.from("app_state").upsert({ key: key, value: next });
    if (res.error) throw res.error;
    return next;
  }

  // ---------- Practice-tour completions (boa_tour_done_v1) ----------
  // Written by the kiosk when a manager finishes the check-in practice tour
  // (kiosk/manager-app.js). Shape: { entries: [{ name, branch, at }] }.
  async function loadTourCompletions() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_tour_done_v1").maybeSingle();
    if (res.error) { console.error("loadTourCompletions:", res.error); return { entries: [] }; }
    return (res.data && res.data.value) || { entries: [] };
  }

  // Persist the attendance sheet's own warning tally ({ total, reviewed, open })
  // so the Payroll Progress roll-up can show the SAME numbers the sheet shows.
  // The roll-up otherwise re-derives the count from the raw saved grid and
  // drifts from the sheet's resolved view (getStatus/schedHint overlays,
  // auto-fill, reviews), which is what made e.g. Sea Point read 31 when the
  // sheet showed 7. We only annotate an EXISTING attendance record — never
  // create an empty one — and merge so no sidecar field is clobbered.
  async function saveAttWarningCounts(branch, ym, counts) {
    // The tally lives under its OWN key, never on the boa_att row. This
    // publisher fires automatically whenever the sheet's count changes, and
    // its old read-modify-write of the whole attendance row raced the cell /
    // review saves happening on the same render: the tally's write landed
    // last carrying the PRE-edit row, silently wiping the admin's fresh edit
    // or review checkmark.
    var key = "boa_attwarn_" + branch + "_" + ym;
    var res = await sb.from("app_state").upsert({ key: key, value: counts || null });
    if (res.error) throw res.error;
    return counts;
  }
  async function loadAttWarningCounts(branch, ym) {
    var res = await sb.from("app_state").select("value").eq("key", "boa_attwarn_" + branch + "_" + ym).maybeSingle();
    if (res.error) { console.error("loadAttWarningCounts:", res.error); return null; }
    return (res.data && res.data.value) || null;
  }

  // ---------- Attendance undo (boa_attundo_<branch>_<ym>) ----------
  // A single persisted "previous state" snapshot per branch + cycle so the
  // Attendance sheet's Undo survives a page reload and works across users —
  // e.g. someone can roll back the last change even if an admin made it in a
  // different session. The portal writes the pre-action grid here whenever it
  // takes an undo snapshot; Undo restores it (and re-points it at the next
  // older snapshot, or clears it).
  function attUndoKey(branch, ym) { return "boa_attundo_" + branch + "_" + ym; }
  async function saveAttendanceUndo(branch, ym, snap) {
    var res = await sb.from("app_state").upsert({ key: attUndoKey(branch, ym), value: snap || {} });
    if (res.error) throw res.error;
    return snap;
  }
  async function loadAttendanceUndo(branch, ym) {
    var res = await sb.from("app_state").select("value").eq("key", attUndoKey(branch, ym)).maybeSingle();
    if (res.error) { console.error("loadAttendanceUndo:", res.error); return null; }
    var v = res.data && res.data.value;
    return (v && v.grid) ? v : null;
  }
  async function clearAttendanceUndo(branch, ym) {
    var res = await sb.from("app_state").delete().eq("key", attUndoKey(branch, ym));
    if (res.error) console.warn("clearAttendanceUndo:", res.error);
  }

  // ACTIVITY_LIMIT entries. Each entry:
  //   { id, when (ISO), who, role, action, target, details }
  var ACTIVITY_KEY = "boa_activity_log_v1";
  var ACTIVITY_LIMIT = 1000;
  async function loadActivity() {
    var res = await sb.from("app_state").select("value").eq("key", ACTIVITY_KEY).maybeSingle();
    if (res.error) { console.error("loadActivity:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function appendActivity(entry) {
    if (!entry || !entry.action) return null;
    var existing = await loadActivity();
    var rec = {
      id: "act_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      when: new Date().toISOString(),
      who: entry.who || "Unknown",
      role: entry.role || "",
      category: entry.category || "",
      action: entry.action || "",
      target: entry.target || "",
      details: entry.details || ""
    };
    var next = [rec].concat(existing).slice(0, ACTIVITY_LIMIT);
    var res = await sb.from("app_state").upsert({ key: ACTIVITY_KEY, value: next });
    if (res.error) { console.error("appendActivity:", res.error); return null; }
    return rec;
  }

  // ---------- Maternity CRUD ----------
  async function saveMat(m) {
    var row = matToRow(m);
    // Accept either `id` or `_id` — rowToMat exposes both and some app
    // code paths only carry `_id`. Without this fallback an existing-
    // record update would silently degrade to an INSERT and either
    // duplicate the row or trip a unique constraint.
    var existingId = (m && (m.id != null ? m.id : m._id));
    // Decorate any thrown error with the request payload + a mode tag so
    // the UI alert is actually useful instead of an opaque 'Could not save'.
    function decorate(err, mode) {
      try {
        var msg = (err && (err.message || err.hint || err.details))
          || (err && JSON.stringify(err))
          || "unknown error";
        var e = new Error("[mat " + mode + "] " + msg + (err && err.code ? " (code " + err.code + ")" : ""));
        e.cause = err;
        e._payload = row;
        e._id = existingId;
        return e;
      } catch (_) { return err; }
    }
    if (existingId != null) {
      // .maybeSingle() instead of .single() — if RLS lets the UPDATE
      // through but blocks the SELECT-after-update we still don't want
      // the call to look like a failure. Reconstruct the saved object
      // from the input row when no row comes back.
      var u = await sb.from("maternity").update(row).eq("id", existingId).select().maybeSingle();
      if (u.error) { console.error("[BOA DB] saveMat update:", u.error, "payload:", row, "id:", existingId); throw decorate(u.error, "update"); }
      return rowToMat(u.data || Object.assign({ id: existingId }, row));
    }
    var i = await sb.from("maternity").insert(row).select().maybeSingle();
    if (i.error) { console.error("[BOA DB] saveMat insert:", i.error, "payload:", row); throw decorate(i.error, "insert"); }
    return rowToMat(i.data || row);
  }
  async function deleteMat(id) {
    var r = await sb.from("maternity").delete().eq("id", id);
    if (r.error) throw r.error;
  }

  // ---- Vouchers + Fresha gift-card transaction balances ----
  var _GC_CHUNK = 500;   // upsert batch size for transactions

  function _upperCode(s) { return String(s == null ? "" : s).trim().toUpperCase(); }
  function _money(s) { var n = parseFloat(String(s == null ? "" : s).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }

  // Parse Fresha "M/D/YYYY H:MM:SS" (US month/day order) → ISO string, or null.
  function _parseFreshaDate(s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return null;
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) { var d0 = new Date(s); return isNaN(d0.getTime()) ? null : d0.toISOString(); }
    var d = new Date(+m[3], (+m[1]) - 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Bulk-insert Shopify→Fresha vouchers (entered via the HR-portal Voucher
  // Entry login). Each input row is { last4, fresha_code, amount, order_number,
  // expiry_date }. last4 is normalised to the last 4 alphanumerics, uppercased,
  // to match how the kiosk lookup keys on it. fresha_code is uppercased so it
  // joins cleanly to gift_card_transactions.gift_card. Rows missing a required
  // field (last4 / fresha_code / amount / order_number) are dropped; expiry optional.
  async function bulkInsertVouchers(rows) {
    var clean = (rows || []).map(function (r) {
      r = r || {};
      return {
        last4:        String(r.last4 || "").replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase(),
        fresha_code:  _upperCode(r.fresha_code),
        amount:       String(r.amount || "").trim(),
        order_number: String(r.order_number || "").trim(),
        expiry_date:  String(r.expiry_date || "").trim() || null
      };
    }).filter(function (r) {
      return r.last4 && r.fresha_code && r.amount && r.order_number;
    });
    if (!clean.length) throw new Error("No complete voucher rows to save.");
    var res = await sb.from("vouchers").insert(clean).select();
    if (res.error) throw res.error;
    // Backfill balances for the just-entered codes from any existing transactions.
    try {
      await recomputeVoucherBalancesForCodes(clean.map(function (r) { return r.fresha_code; }));
    } catch (e) { console.warn("[BOA DB] voucher balance backfill after insert failed:", e); }
    return res.data || [];
  }

  // Import Fresha "Gift Card Transactions". `rows` are objects with keys
  // { id, gift_card, payment_date, location, amount, txn_type }. Upserts in
  // chunks keyed on `id`, so re-uploading the same/extended report only adds
  // new rows. Returns { saved, codes: [distinct uppercased codes seen] }.
  async function importGiftCardTransactions(rows, onProgress) {
    var clean = (rows || []).map(function (r) {
      r = r || {};
      return {
        id:              String(r.id || "").trim(),
        gift_card:       _upperCode(r.gift_card),
        payment_date:    _parseFreshaDate(r.payment_date),
        location:        String(r.location || "").trim() || null,
        amount:          (r.amount === "" || r.amount == null) ? null : _money(r.amount),
        txn_type:        String(r.txn_type || "").trim() || null,
        client_name:     String(r.client_name || "").trim() || null,
        appointment_ref: String(r.appointment_ref || "").trim() || null
      };
    }).filter(function (r) { return r.id && r.gift_card; });
    if (!clean.length) throw new Error("No transactions found in the file.");

    var codeSet = {};
    clean.forEach(function (r) { codeSet[r.gift_card] = true; });

    var saved = 0;
    for (var i = 0; i < clean.length; i += _GC_CHUNK) {
      var slice = clean.slice(i, i + _GC_CHUNK);
      var res = await sb.from("gift_card_transactions").upsert(slice, { onConflict: "id" });
      if (res.error) throw res.error;
      saved += slice.length;
      if (typeof onProgress === "function") onProgress(saved, clean.length);
    }
    return { saved: saved, codes: Object.keys(codeSet) };
  }

  // Recompute the rollup (used_total / balance / txn_count / last_used_at / txns)
  // for the given fresha codes. Done server-side in a single Postgres statement
  // via the `recompute_voucher_balances` RPC, so it's fast and finishes on
  // Supabase even if the browser/laptop sleeps. Returns { vouchers: rowsUpdated }.
  async function recomputeVoucherBalancesForCodes(codes, onProgress) {
    var seen = {}, list = [];
    (codes || []).forEach(function (c) { var u = _upperCode(c); if (u && !seen[u]) { seen[u] = true; list.push(u); } });
    if (!list.length) return { vouchers: 0 };
    if (typeof onProgress === "function") onProgress(0, 0);
    var res = await sb.rpc("recompute_voucher_balances", { p_codes: list });
    if (res.error) throw res.error;
    return { vouchers: (typeof res.data === "number") ? res.data : 0 };
  }

  // Recompute balances for EVERY voucher (admin "recompute all"). Same RPC with
  // no code filter — Postgres rebuilds all rollups in one pass.
  async function recomputeAllVoucherBalances(onProgress) {
    if (typeof onProgress === "function") onProgress(0, 0);
    var res = await sb.rpc("recompute_voucher_balances", { p_codes: null });
    if (res.error) throw res.error;
    return { vouchers: (typeof res.data === "number") ? res.data : 0 };
  }

  // Summary for the admin panel: total transactions + latest payment date.
  async function giftCardTxnStats() {
    var c = await sb.from("gift_card_transactions").select("id", { count: "exact", head: true });
    if (c.error) throw c.error;
    var last = await sb.from("gift_card_transactions").select("payment_date").order("payment_date", { ascending: false }).limit(1);
    if (last.error) throw last.error;
    return { count: c.count || 0, lastPaymentDate: (last.data && last.data[0] && last.data[0].payment_date) || null };
  }

  window.BOA_DB = {
    isReady:       true,
    sb:            sb,
    loadAll:       loadAll,
    loadConsolidatedStaff: loadConsolidatedStaff,
    saveStaff:     saveStaff,    deleteStaff:   deleteStaff,
    saveManager:   saveManager,  deleteManager: deleteManager,
    saveMat:       saveMat,      deleteMat:     deleteMat,

    // Vouchers (Shopify→Fresha lookup table; entered via Voucher Entry login)
    bulkInsertVouchers: bulkInsertVouchers,
    importGiftCardTransactions: importGiftCardTransactions,
    recomputeVoucherBalancesForCodes: recomputeVoucherBalancesForCodes,
    recomputeAllVoucherBalances: recomputeAllVoucherBalances,
    giftCardTxnStats: giftCardTxnStats,

    // Schedules
    loadSchedule: loadSchedule,
    saveSchedule: saveSchedule,
    loadScheduleHistory: loadScheduleHistory,
    loadApprovedSchedules: loadApprovedSchedules,
    saveApprovedSchedule: saveApprovedSchedule,
    deleteApprovedSchedule: deleteApprovedSchedule,
    deleteSchedule: deleteSchedule,
    listDeletedSchedules: listDeletedSchedules,
    restoreSchedule: restoreSchedule,
    purgeDeletedSchedule: purgeDeletedSchedule,
    loadMgrRequests: loadMgrRequests,
    saveMgrRequests: saveMgrRequests,
    loadTechRequests: loadTechRequests,
    saveTechRequests: saveTechRequests,
    listRequestKeys: listRequestKeys,
    probeRequestTables: probeRequestTables,
    loadByKey: loadByKey,
    currentSchedYm: currentSchedYm,
    currentAttYm: currentAttYm,
    periodDays: periodDays,
    periodLabel: periodLabel,
    shiftYm: shiftYm,

    // HR Tasks
    loadHRTasks: loadHRTasks,
    saveHRTasks: saveHRTasks,

    // Onboarding, Trial Period & Off-boarding
    loadOnboarding: loadOnboarding,
    saveOnboarding: saveOnboarding,
    loadTrialPeriod: loadTrialPeriod,
    saveTrialPeriod: saveTrialPeriod,
    loadOffboarding: loadOffboarding,
    saveOffboarding: saveOffboarding,
    loadSmTrial:   loadSmTrial,
    saveSmTrial:   saveSmTrial,

    // Attendance
    loadAttendance: loadAttendance,
    saveAttendance: saveAttendance,
    updateAttendanceCells: updateAttendanceCells,
    loadTourCompletions: loadTourCompletions,
    saveAttWarningCounts: saveAttWarningCounts,
    loadAttWarningCounts: loadAttWarningCounts,
    saveAttendanceUndo: saveAttendanceUndo,
    loadAttendanceUndo: loadAttendanceUndo,
    clearAttendanceUndo: clearAttendanceUndo,

    // Leave Planner
    loadLeaveRecords: loadLeaveRecords,
    saveLeaveRecords: saveLeaveRecords,

    // Manager personal PINs
    loadManagerPins: loadManagerPins,
    saveManagerPins: saveManagerPins,

    // Cash-ups (from the kiosk)
    listRecentCashups: listRecentCashups,
    listCashupsForDate: listCashupsForDate,
    addCashupManual: addCashupManual,
    reopenCashup: reopenCashup,
    deleteCashup: deleteCashup,
    reviewCashup: reviewCashup,
    unreviewCashup: unreviewCashup,
    loadManagerDayStatuses: loadManagerDayStatuses,
    saveManagerDayStatus: saveManagerDayStatus,
    deleteManagerDayStatus: deleteManagerDayStatus,

    // Manager clock-ins viewer
    listRecentManagerClockins: listRecentManagerClockins,
    recordManualManagerClockin: recordManualManagerClockin,
    listRecentTechClockins: listRecentTechClockins,
    listRecentAttendanceCheckins: listRecentAttendanceCheckins,
    listRecentKioskCheckins: listRecentKioskCheckins,
    addManualKioskCheckin: addManualKioskCheckin,
    deleteClockin: deleteClockin,
    reopenDailyCheckin: reopenDailyCheckin,
    listStoreOpenings: listStoreOpenings,
    loadEarlyLeaves: loadEarlyLeaves,
    saveEarlyLeaves: saveEarlyLeaves,
    loadExtras: loadExtras,
    saveExtraDay: saveExtraDay,
    clearExtraDay: clearExtraDay,
    loadFreshaExtraOpenings: loadFreshaExtraOpenings,
    saveFreshaExtraOpenings: saveFreshaExtraOpenings,
    loadFreshaBlocks: loadFreshaBlocks,
    saveFreshaBlocks: saveFreshaBlocks,
    deleteEarlyLeaves: deleteEarlyLeaves,
    loadKioskProof: loadKioskProof,
    probeRecentClockinsRaw: probeRecentClockinsRaw,
    probeAttendanceGrid: probeAttendanceGrid,
    loadClockinMeta: loadClockinMeta,

    // Activity log
    loadActivity: loadActivity,
    appendActivity: appendActivity,

    // Custom locations (branches added after launch)
    loadCustomSalons: loadCustomSalons,
    saveCustomSalons: saveCustomSalons,

    // Kiosk PINs (manager-dashboard 4-digit PINs, keyed by branch name)
    loadKioskPins: loadKioskPins,
    saveKioskPins: saveKioskPins,

    // Unpaid legal-status leave
    loadTechLoans: loadTechLoans,
    saveTechLoans: saveTechLoans,
    loadMgrTimes: loadMgrTimes,
    saveMgrTimes: saveMgrTimes,
    loadAbscondActions: loadAbscondActions,
    saveAbscondActions: saveAbscondActions,
    loadMgrLoans: loadMgrLoans,
    saveMgrLoans: saveMgrLoans,
    loadDailyTasks: loadDailyTasks,
    saveDailyTasks: saveDailyTasks,
    loadFreshaAccess: loadFreshaAccess,
    saveFreshaAccess: saveFreshaAccess,
    loadOvertimeAccess: loadOvertimeAccess,
    saveOvertimeAccess: saveOvertimeAccess,
    loadCashupReviewAccess: loadCashupReviewAccess,
    saveCashupReviewAccess: saveCashupReviewAccess,
    loadLeaveOpsAccess: loadLeaveOpsAccess,
    saveLeaveOpsAccess: saveLeaveOpsAccess,
    loadLeavePayrollAccess: loadLeavePayrollAccess,
    saveLeavePayrollAccess: saveLeavePayrollAccess,
    loadLeaveBalances: loadLeaveBalances,
    saveLeaveBalances: saveLeaveBalances,
    loadLeaveBalancesAccess: loadLeaveBalancesAccess,
    saveLeaveBalancesAccess: saveLeaveBalancesAccess,
    loadFRL: loadFRL,
    saveFRL: saveFRL,
    migrateEmployeeCode: migrateEmployeeCode,
    loadComplianceActions: loadComplianceActions,
    saveComplianceActions: saveComplianceActions,
    loadUnpaidLegalRecords: loadUnpaidLegalRecords,
    saveUnpaidLegalRecords: saveUnpaidLegalRecords,
    loadKioskSecurityLogs: loadKioskSecurityLogs,
    saveKioskSecurityLogs: saveKioskSecurityLogs,
    saveKioskDevices: saveKioskDevices,

    // Manager overtime tracker (HR portal Payroll tab)
    loadOvertimeRequests: loadOvertimeRequests,
    saveOvertimeRequests: saveOvertimeRequests,

    // Witness reports — a clocking-out manager naming a colleague who
    // left early without clocking out. Submitted from the kiosk
    // (kiosk/data.js submitEarlyLeaveReport); the HR portal reads them
    // here to surface on the Manager Check-ins tab.
    loadEarlyLeaveReports: loadEarlyLeaveReports,

    // Staff incident reports (confidential; from /report.html). Read/updated
    // only via key-gated RPCs — see sql/incident_reports.sql.
    loadIncidentReports: loadIncidentReports,
    setIncidentStatus: setIncidentStatus,
    markIncidentReviewed: markIncidentReviewed,
    addIncidentNote: addIncidentNote,

    // Staff leave requests (from /leave.html) — same key-gated RPC pattern.
    loadLeaveRequests: loadLeaveRequests,
    setLeaveStatus: setLeaveStatus,
    markLeaveReviewed: markLeaveReviewed,
    addLeaveNote: addLeaveNote,
    deleteLeaveRequest: deleteLeaveRequest,
    setLeaveOps: setLeaveOps,
    setLeaveBalance: setLeaveBalance,
    loadExtraDayRequests: loadExtraDayRequests,
    setExtraDayStatus: setExtraDayStatus,
    deleteExtraDayRequest: deleteExtraDayRequest,

    // Kiosk device lock (Tier 3A) — server-validated enrolment RPCs
    createKioskEnrollment: createKioskEnrollment,
    listKioskDevices: listKioskDevices,
    revokeKioskDevice: revokeKioskDevice
  };

  // ── Overtime requests ────────────────────────────────────────────────
  // Single app_state row "boa_overtime_v1" holding the full list of
  // submitted overtime entries (newest last). Each entry:
  //   { id, ec, name, branch, date (YYYY-MM-DD), hours, reason,
  //     status: "pending"|"approved"|"rejected",
  //     submittedAt, submittedBy, decidedAt, decidedBy, decisionNote }
  // The HR portal Overtime tab groups by pay cycle (25 → 24) and offsets
  // approved hours against short hours pulled from the boa_early_*
  // sidecar to compute net payable overtime.
  async function loadOvertimeRequests() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_overtime_v1").maybeSingle();
    if (res.error) { console.error("loadOvertimeRequests:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveOvertimeRequests(list) {
    var res = await sb.from("app_state").upsert({ key: "boa_overtime_v1", value: Array.isArray(list) ? list : [] });
    if (res.error) { console.error("saveOvertimeRequests:", res.error); throw res.error; }
    return list;
  }
  async function loadEarlyLeaveReports() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_mgr_early_reports_v1").maybeSingle();
    if (res.error) { console.error("loadEarlyLeaveReports:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }

  // ── Staff incident reports ───────────────────────────────────────────
  // Confidential reports filed from /report.html. The table is unreadable
  // through the normal anon API; everything goes through SECURITY DEFINER
  // RPCs that require the HR access key. That key lives only in the HR
  // portal (window.BOA_INCIDENT_HR_KEY) — NOT in the kiosk — so a manager
  // holding the kiosk's anon key still can't read or alter these reports.
  function incidentKey() { return window.BOA_INCIDENT_HR_KEY || ""; }

  async function loadIncidentReports() {
    var res = await sb.rpc("list_incident_reports", { p_key: incidentKey() });
    if (res.error) { console.error("loadIncidentReports:", res.error); return []; }
    return Array.isArray(res.data) ? res.data : [];
  }
  async function setIncidentStatus(id, status, note, actor) {
    var res = await sb.rpc("set_incident_status", {
      p_key: incidentKey(), p_id: id, p_status: status,
      p_note: note || "", p_actor: actor || ""
    });
    if (res.error) { console.error("setIncidentStatus:", res.error); throw res.error; }
    return true;
  }
  async function markIncidentReviewed(id) {
    var res = await sb.rpc("mark_incident_reviewed", { p_key: incidentKey(), p_id: id });
    if (res.error) { console.error("markIncidentReviewed:", res.error); throw res.error; }
    return true;
  }
  async function addIncidentNote(id, note, author) {
    var res = await sb.rpc("add_incident_note", { p_key: incidentKey(), p_id: id, p_note: note, p_author: author || "" });
    if (res.error) { console.error("addIncidentNote:", res.error); throw res.error; }
    return true;
  }

  // ── Staff leave requests ─────────────────────────────────────────────
  // Same HR key as incidents (sql/leave_requests.sql reuses incident_hr_key).
  async function loadLeaveRequests() {
    var res = await sb.rpc("list_leave_requests", { p_key: incidentKey() });
    if (res.error) { console.error("loadLeaveRequests:", res.error); return []; }
    return Array.isArray(res.data) ? res.data : [];
  }
  async function setLeaveStatus(id, status, note, actor) {
    var res = await sb.rpc("set_leave_status", {
      p_key: incidentKey(), p_id: id, p_status: status, p_note: note || "", p_actor: actor || ""
    });
    if (res.error) { console.error("setLeaveStatus:", res.error); throw res.error; }
    return true;
  }
  async function markLeaveReviewed(id) {
    var res = await sb.rpc("mark_leave_reviewed", { p_key: incidentKey(), p_id: id });
    if (res.error) { console.error("markLeaveReviewed:", res.error); throw res.error; }
    return true;
  }
  async function addLeaveNote(id, note, author) {
    var res = await sb.rpc("add_leave_note", { p_key: incidentKey(), p_id: id, p_note: note, p_author: author || "" });
    if (res.error) { console.error("addLeaveNote:", res.error); throw res.error; }
    return true;
  }
  async function deleteLeaveRequest(id) {
    var res = await sb.rpc("delete_leave_request", { p_key: incidentKey(), p_id: id });
    if (res.error) { console.error("deleteLeaveRequest:", res.error); throw res.error; }
    return true;
  }
  // Operational gate — tick off (or undo) that the request is operationally
  // clear (within the store's on-leave limits). See sql/leave_requests.sql.
  async function setLeaveOps(id, cleared, actor) {
    var res = await sb.rpc("set_leave_ops", { p_key: incidentKey(), p_id: id, p_clear: !!cleared, p_actor: actor || "" });
    if (res.error) { console.error("setLeaveOps:", res.error); throw res.error; }
    return true;
  }
  // Leave-balance gate — record the Sage balance (days available) and tick it
  // off, or undo. Pass ok=false to clear the check.
  async function setLeaveBalance(id, ok, days, actor) {
    var res = await sb.rpc("set_leave_balance", {
      p_key: incidentKey(), p_id: id, p_ok: !!ok,
      p_days: (days === "" || days == null) ? null : Number(days),
      p_actor: actor || ""
    });
    if (res.error) { console.error("setLeaveBalance:", res.error); throw res.error; }
    return true;
  }

  // ── Extra-day availability requests (sql/extra_day_requests.sql) ─────────
  async function loadExtraDayRequests() {
    var res = await sb.rpc("list_extra_day_requests", { p_key: incidentKey() });
    if (res.error) { console.error("loadExtraDayRequests:", res.error); return []; }
    return Array.isArray(res.data) ? res.data : [];
  }
  async function setExtraDayStatus(id, status, note, actor) {
    var res = await sb.rpc("set_extra_day_status", {
      p_key: incidentKey(), p_id: id, p_status: status, p_note: note || "", p_actor: actor || ""
    });
    if (res.error) { console.error("setExtraDayStatus:", res.error); throw res.error; }
    return true;
  }
  async function deleteExtraDayRequest(id) {
    var res = await sb.rpc("delete_extra_day_request", { p_key: incidentKey(), p_id: id });
    if (res.error) { console.error("deleteExtraDayRequest:", res.error); throw res.error; }
    return true;
  }

  // ── Custom locations ─────────────────────────────────────────────────
  // Persists branches added via the Locations tab. Stored as a single
  // app_state row under "boa_custom_salons" holding the whole list
  // (newest last). The app merges this list into the built-in SALONS
  // array on boot so every screen that iterates SALONS picks them up.
  async function loadCustomSalons() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_custom_salons").maybeSingle();
    if (res.error) { console.error("loadCustomSalons:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveCustomSalons(list) {
    var res = await sb.from("app_state").upsert({ key: "boa_custom_salons", value: list });
    if (res.error) { console.error("saveCustomSalons:", res.error); throw res.error; }
    return list;
  }

  // ── Kiosk manager PINs ───────────────────────────────────────────────
  // Map of { branchName: "4-digit" }. The kiosk's config.js fetches this
  // row on boot and uses it to override the hard-coded fallback PIN for
  // the resolved branch. HR portal admins reset PINs via the Kiosk PINs
  // tab — saves write the full updated map back atomically.
  async function loadKioskPins() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_kiosk_pins_v1").maybeSingle();
    if (res.error) { console.error("loadKioskPins:", res.error); return {}; }
    var v = res.data && res.data.value;
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  }
  async function saveKioskPins(map) {
    var res = await sb.from("app_state").upsert({ key: "boa_kiosk_pins_v1", value: map || {} });
    if (res.error) { console.error("saveKioskPins:", res.error); throw res.error; }
    return map;
  }

  // ── Kiosk Security Logs ──────────────────────────────────────────────
  async function loadKioskSecurityLogs() {
    var res = await sb.from("app_state").select("value").eq("key", "boa_kiosk_security_logs_v1").maybeSingle();
    if (res.error) { console.error("loadKioskSecurityLogs:", res.error); return []; }
    var v = res.data && res.data.value;
    return Array.isArray(v) ? v : [];
  }
  async function saveKioskSecurityLogs(logs) {
    var res = await sb.from("app_state").upsert({ key: "boa_kiosk_security_logs_v1", value: logs || [] });
    if (res.error) { console.error("saveKioskSecurityLogs:", res.error); throw res.error; }
    return logs;
  }

  // ── Kiosk Devices ────────────────────────────────────────────────────
  async function saveKioskDevices(map) {
    var res = await sb.from("app_state").upsert({ key: "boa_kiosk_devices_v1", value: map || {} });
    if (res.error) { console.error("saveKioskDevices:", res.error); throw res.error; }
    return map;
  }

  // ── Kiosk device lock (Tier 3A) — server-validated enrolment ──────────
  // Mint a 6-digit enrolment code for a branch (redeemed once on the iPad).
  async function createKioskEnrollment(branch) {
    var res = await sb.rpc("create_kiosk_enrollment", { p_branch: branch });
    if (res.error) { console.error("createKioskEnrollment:", res.error); throw res.error; }
    return res.data; // the code string
  }
  // List active/enrolled devices (no token returned).
  async function listKioskDevices() {
    var res = await sb.rpc("list_kiosk_devices");
    if (res.error) { console.error("listKioskDevices:", res.error); throw res.error; }
    return res.data || [];
  }
  // Revoke a device → forces re-enrolment on its next load.
  async function revokeKioskDevice(id) {
    var res = await sb.rpc("revoke_kiosk_device", { p_id: id });
    if (res.error) { console.error("revokeKioskDevice:", res.error); throw res.error; }
    return true;
  }
})();
