#!/usr/bin/env node
// ── One-time Call Centre & Sales split migration ────────────────────────────
// Copies the Call Centre & Sales people OUT of the shared "Head Office"
// app_state keys and into their own "Call Centre & Sales" store keys, so the
// portal's new CC&S surfaces (schedule / attendance / requests) read live data
// from the moment the split ships.
//
// SAFETY CONTRACT (matches docs/head-office-kiosk-plan.md §B):
//   • ADDITIVE ONLY. Existing "Head Office" rows/keys are READ, never written,
//     deleted, or modified. Nothing in Supabase is destroyed.
//   • Idempotent. A marker key (boa_cc_split_done_v1) short-circuits a re-run,
//     and every target CC&S key is skipped if it already exists — so a second
//     run can never clobber edits the owner made after the split.
//   • The published-snapshot version-array shape (live = [0]) is preserved.
//
// WHO IS CC&S: a staff row with branch "Head Office" whose employee_code ends
// in "-CC" OR whose role is MCC / CC / SALES (same rule as the HR portal's
// isCallCentreStaff and the kiosk's _hoIsCcSales).
//
// USAGE (run ONCE, in the same window the code deploys):
//   node scripts/split-call-centre-sales.js <supabase_key>
//   # or:  SUPABASE_KEY=<key> node scripts/split-call-centre-sales.js
// The anon key is sufficient (app_state is written by the apps with it); a
// service_role key also works. Pass --dry-run to preview without writing.
"use strict";

const SUPABASE_URL = "https://kcinqpwkwpzbosxtkwyl.supabase.co";
const HEAD_OFFICE = "Head Office";
const CALL_CENTRE = "Call Centre & Sales";
const MARKER_KEY = "boa_cc_split_done_v1";

const KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.argv.find(a => a.startsWith("eyJ"));
const DRY_RUN = process.argv.includes("--dry-run");

if (!KEY) {
  console.error("❌ Missing Supabase key.");
  console.error("   Usage:  node scripts/split-call-centre-sales.js <supabase_key> [--dry-run]");
  console.error("   or:     SUPABASE_KEY=<key> node scripts/split-call-centre-sales.js");
  process.exit(1);
}

const HEADERS = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const REST = SUPABASE_URL + "/rest/v1";

function isCcSales(row) {
  const ec = String((row && row.employee_code) || "").trim().toUpperCase();
  const role = String((row && row.role) || "").trim().toUpperCase();
  return /-CC$/.test(ec) || role === "MCC" || role === "CC" || role === "SALES";
}

// ── Supabase REST helpers ───────────────────────────────────────────────────
async function sbGet(pathAndQuery) {
  const res = await fetch(REST + pathAndQuery, { headers: HEADERS });
  if (!res.ok) throw new Error("GET " + pathAndQuery + " → " + res.status + " " + (await res.text()));
  return res.json();
}
async function getAppState(key) {
  const rows = await sbGet("/app_state?select=key,value&key=eq." + encodeURIComponent(key));
  return rows.length ? rows[0].value : undefined;
}
async function listKeysLike(pattern) {
  // pattern uses SQL LIKE (%). Returns array of key strings.
  const rows = await sbGet("/app_state?select=key&key=like." + encodeURIComponent(pattern));
  return rows.map(r => r.key);
}
async function upsertAppState(key, value) {
  if (DRY_RUN) { console.log("   [dry-run] would write " + key); return; }
  const res = await fetch(REST + "/app_state", {
    method: "POST",
    headers: Object.assign({}, HEADERS, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ key, value })
  });
  if (!res.ok) throw new Error("UPSERT " + key + " → " + res.status + " " + (await res.text()));
}

// Rewrite an app_state key name from the HO store to the CC store.
function ccKeyFor(hoKey) { return hoKey.split("_" + HEAD_OFFICE + "_").join("_" + CALL_CENTRE + "_"); }

// Keep only the entries of a { ec: … } map whose EC is in `ecSet`.
function filterByEc(map, ecSet) {
  const out = {};
  Object.keys(map || {}).forEach(ec => { if (ecSet.has(String(ec).trim().toUpperCase())) out[ec] = map[ec]; });
  return out;
}

let created = 0, skipped = 0;
async function writeIfAbsent(ccKey, value, whatWasCopied) {
  const existing = await getAppState(ccKey);
  if (existing !== undefined) {
    console.log("   ↷ skip (already exists): " + ccKey);
    skipped++;
    return;
  }
  await upsertAppState(ccKey, value);
  console.log("   ✓ " + ccKey + "  (" + whatWasCopied + ")");
  created++;
}

async function main() {
  console.log("── Call Centre & Sales split migration " + (DRY_RUN ? "(DRY RUN) " : "") + "──");

  // 0. Idempotency guard.
  const marker = await getAppState(MARKER_KEY);
  if (marker) {
    console.log("✅ Already migrated (marker " + MARKER_KEY + " present, at " + (marker.at || "?") + "). Nothing to do.");
    return;
  }

  // 1. Who is CC&S?
  const staff = await sbGet("/staff?select=employee_code,name,branch,role&branch=eq." + encodeURIComponent(HEAD_OFFICE));
  const ccStaff = staff.filter(isCcSales);
  const ecSet = new Set(ccStaff.map(s => String(s.employee_code).trim().toUpperCase()));
  console.log("Found " + ccStaff.length + " Call Centre & Sales people of " + staff.length + " at Head Office:");
  ccStaff.forEach(s => console.log("   · " + s.employee_code + "  " + s.name + "  (" + (s.role || "?") + ")"));
  if (ecSet.size === 0) { console.log("Nothing to migrate."); return; }

  // 2. Schedule DRAFT grids: boa_sched_Head Office_<ym>  →  CC key, filtered.
  const draftKeys = await listKeysLike("boa\\_sched\\_" + HEAD_OFFICE + "\\_%");
  for (const k of draftKeys) {
    const val = await getAppState(k);
    if (!val || !val.grid) continue;
    const grid = filterByEc(val.grid, ecSet);
    if (Object.keys(grid).length === 0) continue;
    const copy = Object.assign({}, val, { grid, branch: CALL_CENTRE });
    await writeIfAbsent(ccKeyFor(k), copy, Object.keys(grid).length + " row(s)");
  }

  // 3. Schedule PUBLISHED snapshots: version array, newest-first (live = [0]).
  //    Filter EACH version's grid; preserve the array shape + metadata.
  const apprKeys = await listKeysLike("boa\\_schedapproved\\_" + HEAD_OFFICE + "\\_%");
  for (const k of apprKeys) {
    const arr = await getAppState(k);
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const versions = arr.map(v => {
      if (!v || !v.grid) return v;
      const nv = Object.assign({}, v, { grid: filterByEc(v.grid, ecSet), branch: CALL_CENTRE });
      if (v.hours) nv.hours = filterByEc(v.hours, ecSet);
      return nv;
    });
    // Only worth writing if the live version actually has CC people.
    if (!versions[0] || !versions[0].grid || Object.keys(versions[0].grid).length === 0) continue;
    await writeIfAbsent(ccKeyFor(k), versions, versions.length + " version(s), live=" + Object.keys(versions[0].grid).length + " row(s)");
  }

  // 4. Attendance grids + undo-snapshot sidecar: copy CC ECs' cells. Both
  //    shapes carry an ec-keyed `grid` ({ grid: { ec: {...} }, … }); the undo
  //    value is { grid, meta, label, ts }. boa_attwarn_ is deliberately NOT
  //    copied — its value is an aggregate tally {total, reviewed, open, at}
  //    (not ec-keyed, nothing to filter) and the CC&S attendance sheet
  //    re-derives and re-saves it on first render.
  for (const prefix of ["boa\\_att\\_", "boa\\_attundo\\_"]) {
    const keys = await listKeysLike(prefix + HEAD_OFFICE + "\\_%");
    for (const k of keys) {
      const val = await getAppState(k);
      if (!val || !val.grid || typeof val.grid !== "object") continue;
      const grid = filterByEc(val.grid, ecSet);
      if (Object.keys(grid).length === 0) continue;
      await writeIfAbsent(ccKeyFor(k), Object.assign({}, val, { grid, branch: CALL_CENTRE }), Object.keys(grid).length + " row(s)");
    }
  }

  // 5. Off-day requests: copy CC-EC records boa_ho_requests_v1 → boa_cc_requests_v1,
  //    rewriting branch to the CC store (like steps 2-4) — the portal's CC&S
  //    scheduler filters requests by r.branch === "Call Centre & Sales", so a
  //    record left saying "Head Office" would never render/stamp there. Merge
  //    (don't clobber) so a request the kiosk already wrote to the CC key
  //    survives; de-dup by id.
  const hoReqs = await getAppState("boa_ho_requests_v1");
  if (Array.isArray(hoReqs)) {
    const ccFromHo = hoReqs
      .filter(r => r && r.ec && ecSet.has(String(r.ec).trim().toUpperCase()))
      .map(r => Object.assign({}, r, { branch: CALL_CENTRE }));
    if (ccFromHo.length) {
      const existingCc = (await getAppState("boa_cc_requests_v1")) || [];
      const seen = new Set((Array.isArray(existingCc) ? existingCc : []).map(r => r && r.id).filter(Boolean));
      const merged = (Array.isArray(existingCc) ? existingCc.slice() : []).concat(ccFromHo.filter(r => !seen.has(r.id)));
      if (DRY_RUN) console.log("   [dry-run] would write boa_cc_requests_v1 (" + merged.length + " record(s))");
      else { await upsertAppState("boa_cc_requests_v1", merged); console.log("   ✓ boa_cc_requests_v1  (" + ccFromHo.length + " copied, " + merged.length + " total)"); created++; }
    }
  }

  // 6. Marker. (No timestamp API in scripts is fine — this is a plain Node run.)
  if (!DRY_RUN) {
    await upsertAppState(MARKER_KEY, { at: new Date().toISOString(), by: "scripts/split-call-centre-sales.js", ccEcs: Array.from(ecSet) });
    console.log("✓ wrote marker " + MARKER_KEY);
  }

  console.log("── Done. " + created + " new key(s) written, " + skipped + " skipped (already existed). " + (DRY_RUN ? "(DRY RUN — nothing was written)" : "") + " ──");
  console.log("Existing Head Office keys were READ ONLY and are unchanged.");
}

main().catch(e => { console.error("❌ Migration failed:", e.message); process.exit(1); });
