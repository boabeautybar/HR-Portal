#!/usr/bin/env node
// ── Move a Head Office exception's data OUT of the CC&S store keys ───────────
// When a -CC employee code is put on the Head Office allow-list
// (CC_HO_EXCEPTION_ECS), the classifiers stop routing them to Call Centre &
// Sales — but any schedule / attendance they already accrued still sits under
// the CC&S store keys. This script relocates that per-person data onto the
// matching Head Office keys so their history follows them.
//
// SAFETY CONTRACT:
//   • Touches ONE employee code only (default B477-CC — Jae Lee Naidoo). No
//     other person's data is read-modified.
//   • Moves only DRAFT schedule grids (boa_sched_*) and attendance grids
//     (boa_att_*): the plain { grid, names } values. PUBLISHED snapshot arrays
//     (boa_schedapproved_* / boa_schedhist_*) are LEFT UNTOUCHED — they
//     regenerate when you re-publish the Head Office schedule, and the person is
//     already off the CC&S roster so their stale snapshot entry never renders.
//   • Prefer-existing: if the Head Office key already carries this person (e.g.
//     they're already on the HO draft for a month), the HO cells win and only
//     the CC duplicate is removed. Nothing they have under HO is overwritten.
//   • Idempotent: a second run finds nothing left under CC and does nothing.
//   • DRY RUN BY DEFAULT. Pass --apply to actually write.
//
// USAGE (run AFTER the exception code is deployed):
//   node scripts/move-office-exception-to-ho.js <supabase_key>            # preview
//   node scripts/move-office-exception-to-ho.js <supabase_key> --apply    # write
//   node scripts/move-office-exception-to-ho.js <supabase_key> --ec B477-CC --apply
//
// THEN, in the portal: open the Head Office schedule for each affected month
// and click Publish, so the published (staff-facing) snapshot regenerates with
// this person under Head Office.
"use strict";

const SUPABASE_URL = "https://kcinqpwkwpzbosxtkwyl.supabase.co";
const HEAD_OFFICE = "Head Office";
const CALL_CENTRE = "Call Centre & Sales";

const KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.argv.find(a => a.startsWith("eyJ"));
const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;
const _ecArgIdx = process.argv.indexOf("--ec");
const EC = String((_ecArgIdx > -1 && process.argv[_ecArgIdx + 1]) || "B477-CC").trim().toUpperCase();

if (!KEY) {
  console.error("❌ Missing Supabase key.");
  console.error("   Usage:  node scripts/move-office-exception-to-ho.js <supabase_key> [--apply] [--ec B477-CC]");
  process.exit(1);
}

const HEADERS = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const REST = SUPABASE_URL + "/rest/v1";

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
  const rows = await sbGet("/app_state?select=key&key=like." + encodeURIComponent(pattern));
  return rows.map(r => r.key);
}
async function upsertAppState(key, value) {
  if (DRY_RUN) { console.log("      [dry-run] would write " + key); return; }
  const res = await fetch(REST + "/app_state", {
    method: "POST",
    headers: Object.assign({}, HEADERS, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ key, value })
  });
  if (!res.ok) throw new Error("UPSERT " + key + " → " + res.status + " " + (await res.text()));
}

function hoKeyFor(ccKey) { return ccKey.split("_" + CALL_CENTRE + "_").join("_" + HEAD_OFFICE + "_"); }
// Case-tolerant lookup of an EC inside a { ec: value } map — returns the actual
// stored key (which may differ in case) or null.
function findEcKey(map, ec) {
  if (!map || typeof map !== "object") return null;
  const want = ec.toUpperCase();
  return Object.keys(map).find(k => String(k).trim().toUpperCase() === want) || null;
}

let moved = 0, skippedHo = 0, cleared = 0, snapshotsLeft = 0;

async function moveGridKey(ccKey, ccVal) {
  const gridKey = findEcKey(ccVal.grid, EC);
  const nameKey = findEcKey(ccVal.names, EC);
  if (!gridKey && !nameKey) return;                    // this person isn't in this key

  const hoKey = hoKeyFor(ccKey);
  let hoVal = await getAppState(hoKey);
  const hoIsNew = hoVal === undefined;
  if (hoIsNew) hoVal = { grid: {}, names: {}, branch: HEAD_OFFICE, ym: ccVal.ym || null, savedAt: new Date().toISOString() };
  hoVal.grid = hoVal.grid || {};
  hoVal.names = hoVal.names || {};

  const hoHas = !!findEcKey(hoVal.grid, EC);
  let changedHo = false;
  if (!hoHas && gridKey) {
    hoVal.grid[gridKey] = ccVal.grid[gridKey];
    if (nameKey) hoVal.names[gridKey] = ccVal.names[nameKey];
    changedHo = true;
    console.log("   ✓ " + ccKey + "\n        → " + hoKey + (hoIsNew ? "  (created)" : "") + "  moved " + EC);
    moved++;
  } else if (hoHas) {
    console.log("   ↷ " + hoKey + " already has " + EC + " — keeping HO, clearing CC duplicate");
    skippedHo++;
  }

  // Remove the person from the CC key.
  const ccG = findEcKey(ccVal.grid, EC), ccN = findEcKey(ccVal.names, EC);
  let changedCc = false;
  if (ccG) { delete ccVal.grid[ccG]; changedCc = true; }
  if (ccN) { delete ccVal.names[ccN]; changedCc = true; }
  if (changedCc) cleared++;

  if (changedHo) await upsertAppState(hoKey, hoVal);
  if (changedCc) await upsertAppState(ccKey, ccVal);
}

async function main() {
  console.log("── Move Head Office exception " + EC + " off CC&S keys " + (DRY_RUN ? "(DRY RUN — pass --apply to write) " : "(APPLYING) ") + "──\n");

  // Confirm the person really is a Head Office row (guards against a typo'd EC).
  const staff = await sbGet("/staff?select=employee_code,name,role,branch&employee_code=eq." + encodeURIComponent(EC));
  if (!staff.length) { console.error("❌ No staff row for " + EC + " — check the code."); process.exit(1); }
  console.log("Person: " + staff[0].name + " · " + EC + " · role " + (staff[0].role || "?") + " · branch " + staff[0].branch + "\n");

  const affectedMonths = new Set();
  const ccKeys = await listKeysLike("%" + CALL_CENTRE + "%");
  for (const k of ccKeys) {
    const val = await getAppState(k);
    if (Array.isArray(val)) {
      // Published snapshot / history arrays — left untouched (regenerate on
      // re-publish). Just report if this person appears in one.
      if (JSON.stringify(val).toUpperCase().includes(EC)) {
        snapshotsLeft++;
        const m = k.match(/_(\d{4}-\d{2})$/); if (m) affectedMonths.add(m[1]);
        console.log("   • snapshot left as-is (regenerates on re-publish): " + k);
      }
      continue;
    }
    if (val && typeof val === "object" && (findEcKey(val.grid, EC) || findEcKey(val.names, EC))) {
      const m = k.match(/_(\d{4}-\d{2})$/); if (m && k.indexOf("boa_sched_") === 0) affectedMonths.add(m[1]);
      await moveGridKey(k, val);
    }
  }

  console.log("\n── Summary ──");
  console.log("   moved to Head Office: " + moved + " key(s)");
  console.log("   HO already had them (CC duplicate cleared): " + skippedHo);
  console.log("   CC entries removed:   " + cleared);
  console.log("   snapshots left as-is: " + snapshotsLeft);
  if (DRY_RUN) console.log("\n   DRY RUN — nothing was written. Re-run with --apply to commit.");
  else {
    const months = [...affectedMonths].sort();
    console.log("\n   ✅ Done. NEXT: in the portal, open the Head Office schedule for "
      + (months.length ? months.join(" and ") : "the affected month(s)")
      + " and click Publish, so the staff-facing published snapshot regenerates with " + EC + " under Head Office.");
  }
}

main().catch(e => { console.error("❌ " + (e && e.stack || e)); process.exit(1); });
