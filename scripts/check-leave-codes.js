#!/usr/bin/env node
// Guards the canonical leave-code layer in app.jsx (docs/leave-sage-plan.md §1).
//
// Two things must hold, or leave silently lands in the wrong bucket:
//
//  1. EQUIVALENCE — isPaidAnnualRec() must agree with the predicate it replaced
//     (`type === "Annual leave" && !emergency`) on every record shape written
//     before the canonical field existed. Disagree and a live balance moves:
//     someone's annual days change without anyone taking leave.
//
//  2. MAPPING — the canonical table stays self-consistent, and no leave type
//     ships to Sage under a guessed letter.
//
// Run: node scripts/check-leave-codes.js
// Optional: pass a boa_leave_v1 export (JSON) to replay real records through
// both predicates:  node scripts/check-leave-codes.js ./leave-recs.json

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "app.jsx");
const src = fs.readFileSync(SRC, "utf8");

// Pull the functions under test straight out of app.jsx — no copies to drift.
function extract(name, kind) {
  const re = new RegExp("(?:^|\\n)(?:const " + name + " = \\{[\\s\\S]*?\\n\\};|function " + name + "\\([\\s\\S]*?\\n\\})", "m");
  const m = src.match(re);
  if (!m) { console.error("FAIL: could not find " + kind + " " + name + " in app.jsx"); process.exit(1); }
  return m[0];
}
const code = [
  extract("LEAVE_CODES", "table"),
  extract("plannerTypeCompat", "function"),
  extract("canonicalLeaveType", "function"),
  extract("canonicalFromRequest", "function"),
  extract("isPaidAnnualRec", "function")
].join("\n");
const sandbox = {};
new Function("exports", code + "\nexports.LEAVE_CODES = LEAVE_CODES;" +
  "\nexports.plannerTypeCompat = plannerTypeCompat;" +
  "\nexports.canonicalLeaveType = canonicalLeaveType;" +
  "\nexports.canonicalFromRequest = canonicalFromRequest;" +
  "\nexports.isPaidAnnualRec = isPaidAnnualRec;")(sandbox);
const { LEAVE_CODES, plannerTypeCompat, canonicalLeaveType, canonicalFromRequest, isPaidAnnualRec } = sandbox;

let failures = 0;
const fail = (msg) => { console.error("  ✗ " + msg); failures++; };

// ── 1. Equivalence on legacy record shapes ────────────────────────────────────
// The predicate as it stood before the canonical layer.
const oldPredicate = (lv) => !!lv && lv.type === "Annual leave" && !lv.emergency;

// Every record shape the planner has ever written (all 244 live records are one
// of the first two), plus the shapes the new write paths produce.
const fixtures = [
  { name: "legacy annual", rec: { type: "Annual leave", emergency: false }, expectOldNew: "same" },
  { name: "legacy emergency (unpaid)", rec: { type: "Annual leave", emergency: true }, expectOldNew: "same" },
  { name: "legacy annual, emergency absent", rec: { type: "Annual leave" }, expectOldNew: "same" },
  { name: "new annual (canonical)", rec: { type: "Annual leave", leaveType: "Annual", emergency: false }, expectOldNew: "same" },
  { name: "new unpaid split portion", rec: { type: "Annual leave", leaveType: "Unpaid", emergency: true }, expectOldNew: "same" },
  // These are the whole point: type is frozen at "Annual leave", so the OLD
  // predicate says "yes, charge annual days" — the new one must say no.
  { name: "new family responsibility", rec: { type: "Annual leave", leaveType: "Family", emergency: false }, expectOldNew: "differ", expectNew: false },
  { name: "new maternity", rec: { type: "Annual leave", leaveType: "Maternity", emergency: false }, expectOldNew: "differ", expectNew: false },
  { name: "new sick", rec: { type: "Annual leave", leaveType: "Sick", emergency: false }, expectOldNew: "differ", expectNew: false },
  { name: "new unpaid (not emergency-flagged)", rec: { type: "Annual leave", leaveType: "Unpaid", emergency: false }, expectOldNew: "differ", expectNew: false }
];

console.log("1. Predicate equivalence on legacy shapes");
fixtures.forEach(f => {
  const o = oldPredicate(f.rec), n = isPaidAnnualRec(f.rec);
  if (f.expectOldNew === "same" && o !== n) fail(f.name + ": old=" + o + " new=" + n + " — a live balance would move");
  if (f.expectOldNew === "differ") {
    if (o === n) fail(f.name + ": expected the new predicate to correct the old one, both said " + o);
    else if (n !== f.expectNew) fail(f.name + ": new predicate returned " + n + ", expected " + f.expectNew);
  }
});
if (!failures) console.log("  ✓ " + fixtures.length + " record shapes agree where they must, differ only where the old predicate was wrong");

// Replay real records if an export was supplied.
const dump = process.argv[2];
if (dump && fs.existsSync(dump)) {
  const raw = JSON.parse(fs.readFileSync(dump, "utf8"));
  // Accept any of: a raw record array, the app_state value (per-EC lists), or a
  // Supabase REST response ([{ value: … }]) — an unrecognised envelope must fail
  // loudly, not silently replay zero records and call that a pass.
  let v = raw;
  if (Array.isArray(v) && v.length && v[0] && v[0].value !== undefined && v[0].startDate === undefined) v = v[0].value;
  else if (!Array.isArray(v) && v && v.value !== undefined) v = v.value;
  let recs = [];
  if (Array.isArray(v)) recs = v;
  else Object.keys(v || {}).forEach(k => { if (Array.isArray(v[k])) recs = recs.concat(v[k]); });
  recs = recs.filter(r => r && (r.startDate || r.endDate || r.type || r.leaveType));
  if (!recs.length) { fail("replay: no leave records found in " + dump + " — check the file shape"); }
  let mismatches = 0;
  recs.forEach(r => { if (oldPredicate(r) !== isPaidAnnualRec(r)) mismatches++; });
  if (mismatches) fail("replayed " + recs.length + " live records → " + mismatches + " changed answer (expected 0)");
  else console.log("  ✓ replayed " + recs.length + " live records → 0 changed answers");
}

// ── 2. Canonical table consistency ────────────────────────────────────────────
console.log("2. Canonical table");
const VALID_GRID = ["L", "ML", "X"];
Object.keys(LEAVE_CODES).forEach(k => {
  const c = LEAVE_CODES[k];
  if (!c.label) fail(k + ": missing label");
  if (!c.sage) fail(k + ": missing sage letter (use \"?\" when unconfirmed)");
  if (c.sage !== "?" && !/^[A-Za-z]$/.test(c.sage)) fail(k + ": sage letter must be one letter or \"?\", got " + JSON.stringify(c.sage));
  if (VALID_GRID.indexOf(c.grid) === -1) fail(k + ": grid cell " + JSON.stringify(c.grid) + " is not one of " + VALID_GRID.join("/"));
  if (typeof c.paid !== "boolean") fail(k + ": paid must be a boolean");
  if (canonicalLeaveType({ leaveType: k }) !== k) fail(k + ": canonicalLeaveType does not round-trip");
  if (canonicalFromRequest(k) !== k) fail(k + ": canonicalFromRequest does not round-trip");
});
// A Sage letter must not be claimed by two types — leave would post to the wrong bucket.
const byLetter = {};
Object.keys(LEAVE_CODES).forEach(k => {
  const s = LEAVE_CODES[k].sage;
  if (s === "?") return;
  if (byLetter[s]) fail("Sage letter " + s + " claimed by both " + byLetter[s] + " and " + k);
  byLetter[s] = k;
});
// type is frozen: every canonical type must still write the legacy literal.
Object.keys(LEAVE_CODES).forEach(k => {
  if (plannerTypeCompat(k) !== "Annual leave") fail(k + ": plannerTypeCompat must stay \"Annual leave\" until kiosk/data.js:541,607 + My BOA read canonicalLeaveType");
});
if (!failures) console.log("  ✓ " + Object.keys(LEAVE_CODES).length + " types: letters unique, grid cells valid, round-trip clean, type stays frozen");

// ── 3. Request vocabulary ─────────────────────────────────────────────────────
console.log("3. Request → canonical");
const reqCases = [
  ["Annual", "Annual"], ["Sick", "Sick"], ["Absent", "Absent"], ["Family", "Family"],
  ["Unpaid", "Unpaid"], ["Maternity", "Maternity"],
  ["annual leave", "Annual"], ["Family responsibility", "Family"], ["  Sick  ", "Sick"],
  ["", "Other"], [null, "Other"], [undefined, "Other"], ["Sabbatical", "Other"]
];
reqCases.forEach(([input, want]) => {
  const got = canonicalFromRequest(input);
  if (got !== want) fail("canonicalFromRequest(" + JSON.stringify(input) + ") = " + got + ", expected " + want);
});
// Legacy planner records with no canonical field must still resolve.
const legacyCases = [
  [{ type: "Annual leave" }, "Annual"],
  [{ type: "Annual leave", emergency: true }, "Unpaid"],
  [{ type: "Maternity leave" }, "Maternity"],
  [{}, "Annual"], [null, "Annual"]
];
legacyCases.forEach(([rec, want]) => {
  const got = canonicalLeaveType(rec);
  if (got !== want) fail("canonicalLeaveType(" + JSON.stringify(rec) + ") = " + got + ", expected " + want);
});
if (!failures) console.log("  ✓ " + (reqCases.length + legacyCases.length) + " vocabulary cases map correctly");

// ── Report ────────────────────────────────────────────────────────────────────
const unconfirmed = Object.keys(LEAVE_CODES).filter(k => LEAVE_CODES[k].sage === "?");
if (unconfirmed.length) {
  console.log("\nℹ " + unconfirmed.length + " type(s) still awaiting a Sage letter from the payroll consultant: " +
    unconfirmed.join(", ") + "\n  (docs/leave-sage-plan.md Phase 0.3 — the Sage export must refuse these rows.)");
}
if (failures) { console.error("\n✗ " + failures + " check(s) failed."); process.exit(1); }
console.log("\n✓ Leave-code checks passed.");
