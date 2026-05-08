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
  function rowToStaff(r) {
    return {
      _id:           r.id,
      id:            r.id,
      ec:            r.employee_code,
      name:          r.name           || "",
      branch:        r.branch         || "",
      contract:      r.contract       || null,
      permit:        r.permit         || null,
      notes:         r.notes          || "",
      isShadow:      !!r.is_shadow,
      transferring:  !!r.transferring,
      transferTo:    r.transfer_to    || null,
      transferDate:  r.transfer_date  || null,
      transferNote:  r.transfer_note  || null,
      leftDate:      r.left_date      || null,
      startDate:     r.start_date     || null,
      level:         r.level          || null
    };
  }
  function staffToRow(s) {
    return {
      employee_code: s.ec,
      name:          s.name || "",
      branch:        s.branch || "",
      contract:      s.contract || null,
      permit:        s.permit   || null,
      notes:         s.notes    || null,
      is_shadow:     !!s.isShadow,
      transferring:  !!s.transferring,
      transfer_to:   s.transferTo   || null,
      transfer_date: s.transferDate || null,
      transfer_note: s.transferNote || null,
      left_date:     s.leftDate || null,
      start_date:    s.startDate || null,
      level:         s.level || null,
      role_type:     "tech",
      active:        !s.leftDate
    };
  }

  function rowToManager(r) {
    return {
      _id:    r.id,
      id:     r.id,
      ec:     r.employee_code,
      name:   r.name   || "",
      branch: r.branch || "",
      role:   r.role   || "",
      notes:  r.notes  || "",
      transferring: !!r.transferring,
      transferTo:   r.transfer_to   || null,
      transferDate: r.transfer_date || null,
      transferNote: r.transfer_note || null,
      startDate:    r.start_date    || null
    };
  }
  function managerToRow(m) {
    return {
      employee_code: m.ec,
      name:          m.name || "",
      branch:        m.branch || "",
      role:          m.role || null,
      notes:         m.notes || null,
      transferring:  !!m.transferring,
      transfer_to:   m.transferTo   || null,
      transfer_date: m.transferDate || null,
      transfer_note: m.transferNote || null,
      start_date:    m.startDate || null,
      role_type:     "manager",
      active:        true
    };
  }

  function rowToMat(r) {
    return {
      _id:        r.id,
      id:         r.id,
      ec:         r.employee_code,
      name:       r.name || "",
      branch:     r.branch || "",
      matStatus:  r.mat_status,
      matStart:   r.mat_start   || null,
      matEnd:     r.mat_end     || null,
      returnDate: r.return_date || null,
      notes:      r.notes || ""
    };
  }
  function matToRow(m) {
    return {
      employee_code: m.ec,
      name:          m.name || "",
      branch:        m.branch || "",
      mat_status:    m.matStatus,
      mat_start:     m.matStart   || null,
      mat_end:       m.matEnd     || null,
      return_date:   m.returnDate || null,
      notes:         m.notes || null
    };
  }

  // ---------- Initial load ----------
  async function loadAll() {
    var [techs, mgrs, mat] = await Promise.all([
      sb.from("staff").select("*").eq("role_type", "tech").order("employee_code"),
      sb.from("staff").select("*").eq("role_type", "manager").order("employee_code"),
      sb.from("maternity").select("*")
    ]);
    if (techs.error) console.error("[BOA DB] staff:",     techs.error);
    if (mgrs.error)  console.error("[BOA DB] managers:",  mgrs.error);
    if (mat.error)   console.error("[BOA DB] maternity:", mat.error);
    return {
      staff:    (techs.data || []).map(rowToStaff),
      managers: (mgrs.data  || []).map(rowToManager),
      matRecs:  (mat.data   || []).map(rowToMat)
    };
  }

  // ---------- Staff CRUD ----------
  async function saveStaff(s) {
    var row = staffToRow(s);
    if (s.id) {
      var u = await sb.from("staff").update(row).eq("id", s.id).select().single();
      if (u.error) throw u.error;
      return rowToStaff(u.data);
    }
    var i = await sb.from("staff").insert(row).select().single();
    if (i.error) throw i.error;
    return rowToStaff(i.data);
  }
  async function deleteStaff(id) {
    var r = await sb.from("staff").delete().eq("id", id);
    if (r.error) throw r.error;
  }

  // ---------- Manager CRUD ----------
  async function saveManager(m) {
    var row = managerToRow(m);
    if (m.id) {
      var u = await sb.from("staff").update(row).eq("id", m.id).select().single();
      if (u.error) throw u.error;
      return rowToManager(u.data);
    }
    var i = await sb.from("staff").insert(row).select().single();
    if (i.error) throw i.error;
    return rowToManager(i.data);
  }
  async function deleteManager(id) {
    var r = await sb.from("staff").delete().eq("id", id);
    if (r.error) throw r.error;
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
  async function saveSchedule(branch, ym, grid, isManager) {
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
          grid:    priorVal.grid,
          branch:  priorVal.branch || branch,
          ym:      priorVal.ym || ym
        };
        var updated = [snapshot].concat(existing).slice(0, SCHED_HISTORY_LIMIT);
        await sb.from("app_state").upsert({ key: schedHistKey(branch, ym, isManager), value: updated });
      }
    } catch (snapErr) {
      // Don't block the save itself if history write fails
      console.warn("saveSchedule: history snapshot failed (continuing):", snapErr);
    }
    var v = { grid: grid, branch: branch, ym: ym, savedAt: new Date().toISOString() };
    var res = await sb.from("app_state").upsert({ key: schedKey(branch, ym, isManager), value: v });
    if (res.error) throw res.error;
    return v;
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
      id:        _trashId(),
      kind:      isManager ? "manager" : "tech",
      branch:    branch,
      ym:        ym,
      grid:      liveVal.grid,
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
    if (opts && opts.kind)   arr = arr.filter(function (e) { return e.kind === opts.kind; });
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
    var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var p = ym.split("-"), y = +p[0], m = +p[1];
    var sm = m === 1 ? 12 : m - 1, sy = m === 1 ? y - 1 : y;
    return months[sm-1] + " 25" + (sy !== y ? ", " + sy : "") + " — " + months[m-1] + " 24, " + y;
  }
  function shiftYm(ym, delta) {
    var p = ym.split("-"), y = +p[0], m = +p[1] + delta;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1)  { m += 12; y -= 1; }
    return y + "-" + String(m).padStart(2, "0");
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

  // ---------- Manager clock-ins viewer ----------
  // Recent manager clock-in rows (joined with staff name) for the HR
  // portal's spot-check viewer. Photo + GPS lives in app_state under
  // boa_mgrclockin_meta_<id> — fetch lazily per row.
  async function listRecentManagerClockins(daysBack) {
    var since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - (daysBack || 14));
    var res = await sb.from("clockins")
      .select("*, staff:staff_id ( id, name, employee_code, role_type, branch )")
      .gte("ts", since.toISOString())
      .order("ts", { ascending: false });
    if (res.error) { console.error("listRecentManagerClockins:", res.error); return []; }
    return (res.data || []).filter(function (r) { return r.staff && r.staff.role_type === "manager"; });
  }
  // Same as the manager viewer but filtered to nail-tech clock-ins. Used by
  // the Daily Check-ins tab and by the Attendance tab to overlay check-in
  // markers on the grid.
  async function listRecentTechClockins(daysBack) {
    var since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - (daysBack || 60));
    var res = await sb.from("clockins")
      .select("*, staff:staff_id ( id, name, employee_code, role_type, branch )")
      .gte("ts", since.toISOString())
      .order("ts", { ascending: false })
      .limit(5000);
    if (res.error) { console.error("listRecentTechClockins:", res.error); return []; }
    // Keep tech rows AND orphan rows (staff join failed) so the Daily Check-ins
    // tab can surface them as diagnostics. Only manager-tagged rows are dropped.
    return (res.data || []).filter(function (r) { return !r.staff || r.staff.role_type !== "manager"; });
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
    var v = { grid: grid || {}, branch: branch, ym: ym, savedAt: new Date().toISOString() };
    if (extras && typeof extras === "object") {
      Object.keys(extras).forEach(function (k) { v[k] = extras[k]; });
    }
    var res = await sb.from("app_state").upsert({ key: "boa_att_" + branch + "_" + ym, value: v });
    if (res.error) throw res.error;
    return v;
  }

  // ---------- Activity log (boa_activity_log_v1) ----------
  // Single row holding an array of recent actions (newest-first), capped at
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
      id:      "act_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      when:    new Date().toISOString(),
      who:     entry.who     || "Unknown",
      role:    entry.role    || "",
      action:  entry.action  || "",
      target:  entry.target  || "",
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
    if (m.id) {
      var u = await sb.from("maternity").update(row).eq("id", m.id).select().single();
      if (u.error) throw u.error;
      return rowToMat(u.data);
    }
    var i = await sb.from("maternity").insert(row).select().single();
    if (i.error) throw i.error;
    return rowToMat(i.data);
  }
  async function deleteMat(id) {
    var r = await sb.from("maternity").delete().eq("id", id);
    if (r.error) throw r.error;
  }

  window.BOA_DB = {
    isReady:       true,
    sb:            sb,
    loadAll:       loadAll,
    saveStaff:     saveStaff,    deleteStaff:   deleteStaff,
    saveManager:   saveManager,  deleteManager: deleteManager,
    saveMat:       saveMat,      deleteMat:     deleteMat,

    // Schedules
    loadSchedule:           loadSchedule,
    saveSchedule:           saveSchedule,
    loadScheduleHistory:    loadScheduleHistory,
    deleteSchedule:         deleteSchedule,
    listDeletedSchedules:   listDeletedSchedules,
    restoreSchedule:        restoreSchedule,
    purgeDeletedSchedule:   purgeDeletedSchedule,
    loadMgrRequests:        loadMgrRequests,
    saveMgrRequests:        saveMgrRequests,
    loadTechRequests:       loadTechRequests,
    saveTechRequests:       saveTechRequests,
    listRequestKeys:        listRequestKeys,
    probeRequestTables:     probeRequestTables,
    loadByKey:              loadByKey,
    currentSchedYm:         currentSchedYm,
    periodDays:             periodDays,
    periodLabel:            periodLabel,
    shiftYm:                shiftYm,

    // Onboarding & Off-boarding
    loadOnboarding:    loadOnboarding,
    saveOnboarding:    saveOnboarding,
    loadOffboarding:   loadOffboarding,
    saveOffboarding:   saveOffboarding,

    // Attendance
    loadAttendance:    loadAttendance,
    saveAttendance:    saveAttendance,

    // Leave Planner
    loadLeaveRecords:  loadLeaveRecords,
    saveLeaveRecords:  saveLeaveRecords,

    // Manager personal PINs
    loadManagerPins:   loadManagerPins,
    saveManagerPins:   saveManagerPins,

    // Manager clock-ins viewer
    listRecentManagerClockins: listRecentManagerClockins,
    listRecentTechClockins:    listRecentTechClockins,
    probeRecentClockinsRaw:    probeRecentClockinsRaw,
    probeAttendanceGrid:       probeAttendanceGrid,
    loadClockinMeta:           loadClockinMeta,

    // Activity log
    loadActivity:    loadActivity,
    appendActivity:  appendActivity
  };
})();
