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

// ── 4. Balance staleness clock ────────────────────────────────────────────────
// balanceStaleness rides the accrual clock: 1 credited cycle since the anchor =
// 1 payroll run has closed since payroll exported, so a fresher report exists.
// Getting this wrong either nags every day or never nags at all.
console.log("4. Balance staleness");
const staleCode = [extract("accrualCyclesEarned", "function"), extract("balanceStaleness", "function")].join("\n");
const sbox = {};
new Function("exports", staleCode + "\nexports.balanceStaleness = balanceStaleness;")(sbox);
const { balanceStaleness } = sbox;
const staleCases = [
  // anchor,        today,        cyclesBehind, why
  ["2026-06-25", "2026-07-16", 0, "current anchor, before this month's 25th → fresh"],
  ["2026-06-25", "2026-07-24", 0, "day before the run closes → still fresh"],
  ["2026-06-25", "2026-07-25", 1, "the 25th run closes → one behind, nag"],
  ["2026-06-25", "2026-08-25", 2, "two runs closed → two behind"],
  ["2026-06-25", "2026-06-25", 0, "same day → fresh"],
  ["2026-06-25", "2026-05-01", 0, "anchor in the future → never negative"]
];
staleCases.forEach(([asOf, today, want, why]) => {
  const got = balanceStaleness(asOf, today);
  if (got.cyclesBehind !== want) fail("staleness(" + asOf + " → " + today + ") = " + got.cyclesBehind + ", expected " + want + " (" + why + ")");
  if (got.stale !== (want > 0)) fail("staleness(" + asOf + " → " + today + ").stale = " + got.stale + ", expected " + (want > 0));
});
const noAnchor = balanceStaleness(null, "2026-07-16");
if (noAnchor.stale) fail("staleness(null) must not nag when there's no anchor at all");
if (!failures) console.log("  ✓ " + (staleCases.length + 1) + " staleness cases correct (nags the day a run closes, never before)");

// ── 5. Anniversary accrual clock ──────────────────────────────────────────────
// Accrual now rides each person's start-date anniversary (1.25 on the monthly
// anniversary of their start), not the 25th payroll cycle. Month-end starts must
// clamp; credits on/before the start date or the anchor must not count.
console.log("5. Anniversary accrual");
function extractScalar(name) {
  const m = src.match(new RegExp("(?:^|\\n)const " + name + " = ([^;]+);"));
  if (!m) { console.error("FAIL: could not find scalar const " + name + " in app.jsx"); process.exit(1); }
  return "const " + name + " = " + m[1].trim() + ";";
}
// Brace-balancing extractor — handles single-line functions (normYmd, ymdStr…)
// that the newline-anchored `extract` above swallows past.
function grabFn(name) {
  const start = src.search(new RegExp("(?:^|\\n)function " + name + "\\("));
  if (start === -1) { console.error("FAIL: could not find function " + name + " in app.jsx"); process.exit(1); }
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i).replace(/^\n/, "");
}
const accrualCode = [
  grabFn("normYmd"),
  grabFn("ymdStr"),
  grabFn("anniversaryCreditDates"),
  grabFn("anniversariesBetween"),
  extractScalar("LEAVE_ACCRUAL_PER_CYCLE"),
  grabFn("accruedLeaveFor")
].join("\n");
const abox = {};
new Function("exports", accrualCode +
  "\nexports.anniversariesBetween = anniversariesBetween;" +
  "\nexports.anniversaryCreditDates = anniversaryCreditDates;" +
  "\nexports.accruedLeaveFor = accruedLeaveFor;")(abox);
const { anniversariesBetween, anniversaryCreditDates, accruedLeaveFor } = abox;
const accCases = [
  // start,        from(anchor),  to,            credits, why
  ["2026-01-10", "2026-06-25", "2026-07-31", 1, "one clean anniversary (Jul 10); Jun 10 predates the anchor"],
  ["2026-01-10", "2026-06-25", "2026-07-09", 0, "day before the Jul 10 credit → nothing yet"],
  ["2026-01-10", "2026-06-25", "2026-07-10", 1, "credit lands exactly on the anniversary"],
  ["2026-01-31", "2026-06-25", "2026-08-15", 2, "month-end start clamps: Jun 30 + Jul 31 (Aug 31 > Aug 15)"],
  ["2026-07-01", "2026-06-25", "2026-08-15", 1, "first credit is one month AFTER start (Aug 1), not on the start day (Jul 1)"],
  ["2024-02-29", "2026-01-01", "2026-03-01", 2, "leap-day start: Jan 29 + Feb 28 (clamped)"],
  ["2026-01-10", "2026-07-25", "2026-06-25", 0, "to before from → never negative"],
  ["", "2026-06-25", "2026-07-31", 0, "no start date → 0 (caller falls back to the cycle model)"]
];
accCases.forEach(([start, from, to, want, why]) => {
  const got = anniversariesBetween(start, from, to);
  if (got !== want) fail("anniversariesBetween(" + start + ", " + from + " → " + to + ") = " + got + ", expected " + want + " (" + why + ")");
  const days = accruedLeaveFor(start, from, to);
  if (Math.abs(days - want * 1.25) > 1e-9) fail("accruedLeaveFor(" + start + ") = " + days + ", expected " + (want * 1.25));
});
// The credit-date list must agree with the count and be the dates we display.
const dates = anniversaryCreditDates("2026-01-31", "2026-06-25", "2026-08-15");
if (JSON.stringify(dates) !== JSON.stringify(["2026-06-30", "2026-07-31"])) fail("anniversaryCreditDates clamp wrong: " + JSON.stringify(dates));
if (!failures) console.log("  ✓ " + accCases.length + " accrual cases correct (month-end clamps, first credit after start, anchor excluded)");

// ── 6. Leave-expiry cycles ────────────────────────────────────────────────────
// Every completed employment year forfeits its leave 6 months after it ends.
// Only completed cycles whose deadline is still ahead are surfaced; RED ≤3 months.
console.log("6. Leave-expiry cycles");
const expiryCode = [
  grabFn("normYmd"),
  grabFn("ymdStr"),
  grabFn("monthsBetween"),
  grabFn("addMonthsYmd"),
  extractScalar("LEAVE_EXPIRY_MONTHS"),
  grabFn("annualLeaveCycles")
].join("\n");
const ebox = {};
new Function("exports", expiryCode +
  "\nexports.annualLeaveCycles = annualLeaveCycles;" +
  "\nexports.addMonthsYmd = addMonthsYmd;")(ebox);
const { annualLeaveCycles, addMonthsYmd } = ebox;
// start 2024-03-10, today 2026-07-17: year-1 (ends 2025-03-09) already forfeited
// (deadline 2025-09-09 < today); year-2 ends 2026-03-09, deadline 2026-09-09.
const cyc = annualLeaveCycles("2024-03-10", "2026-07-17");
if (cyc.length !== 1) fail("annualLeaveCycles: expected 1 live cycle, got " + cyc.length + " → " + JSON.stringify(cyc));
else {
  const c = cyc[0];
  if (c.cycleStart !== "2025-03-10" || c.cycleEnd !== "2026-03-09" || c.deadline !== "2026-09-09")
    fail("annualLeaveCycles cycle wrong: " + JSON.stringify(c) + " (expected 2025-03-10 → 2026-03-09, deadline 2026-09-09)");
}
// RED boundary: red = deadline <= today + 3 months. deadline 2026-09-09 → red from 2026-06-09.
const RED = 3;
const redAt = (today) => "2026-09-09" <= addMonthsYmd(today, RED);
if (redAt("2026-06-08")) fail("expiry RED fired one day early (2026-06-08 should still be amber)");
if (!redAt("2026-06-09")) fail("expiry RED should fire on 2026-06-09 (exactly 3 months before the deadline)");
// A brand-new employee has no completed cycle yet → nothing to expire.
if (annualLeaveCycles("2026-05-01", "2026-07-17").length !== 0) fail("annualLeaveCycles: a <1-year employee should have no expiring cycle");
// No start date → no cycles.
if (annualLeaveCycles("", "2026-07-17").length !== 0) fail("annualLeaveCycles(\"\") should be empty");
if (!failures) console.log("  ✓ cycle window, 6-month deadline, and ≤3-month RED boundary all correct");

// ── 7. Leave-expiry AT-RISK decomposition ──────────────────────────────────────
// A single uploaded balance carries no per-year breakdown, so days-at-risk is
// split oldest-taken-first: the days you still hold are your NEWEST accrual, so
// strip the current-year accrual and cap at one full year (15). This stops a
// lump-sum opening from being dumped whole onto the nearest deadline. The credit
// landing ON the anniversary belongs to the year just completed (annivClose).
console.log("7. Leave-expiry at-risk decomposition");
const riskPreamble =
  'const lbNormEc = (ec) => String(ec == null ? "" : ec).toUpperCase().replace(/[^A-Z0-9]/g, "");\n' +
  'const isManagerEc = (ec) => /M$/i.test(String(ec || "").replace(/[^A-Za-z0-9]/g, ""));\n' +
  'const findLeavePerson = (ec, enriched, managers) => (enriched || []).concat(managers || []).find(p => p && lbNormEc(p.ec) === lbNormEc(ec)) || null;\n' +
  'const canonicalLeaveType = (rec) => rec ? (rec.leaveType || (rec.emergency ? "Unpaid" : "Annual")) : "Annual";\n' +
  'const isPaidAnnualRec = (lv) => !!lv && canonicalLeaveType(lv) === "Annual" && !lv.emergency;\n' +
  'const leaveDayBreakdown = (s, e) => { const d = Math.round((new Date(e+"T00:00:00") - new Date(s+"T00:00:00"))/86400000)+1; return { real: Math.max(0,d), cal: Math.max(0,d) }; };\n';
const riskCode = [
  grabFn("normYmd"), grabFn("ymdStr"), grabFn("ymdAddDays"), grabFn("monthsBetween"), grabFn("addMonthsYmd"),
  grabFn("anniversaryCreditDates"), grabFn("anniversariesBetween"), extractScalar("LEAVE_ACCRUAL_PER_CYCLE"),
  grabFn("accruedLeaveFor"), extractScalar("LEAVE_EXPIRY_MONTHS"), extractScalar("LEAVE_EXPIRY_RED_MONTHS"),
  grabFn("annualLeaveCycles"), grabFn("annualBalanceFor"), grabFn("leaveExpiryForPerson")
].join("\n");
const rbox = {};
new Function("exports", riskPreamble + riskCode + "\nexports.leaveExpiryForPerson = leaveExpiryForPerson;")(rbox);
const { leaveExpiryForPerson } = rbox;
const mkDeps = (ec, start, opening, today, recs) => ({
  leaveBalances: { asOf: "2026-06-25", entries: { [ec]: { ec, opening, adjustments: [] } } },
  leaveRecs: recs || [], enriched: [{ ec, name: ec, branch: "Bree", startDate: start }],
  managers: [], schedCache: {}, ymdToSchedYm: (y) => y.slice(0, 7), today
});
const riskNear = (got, want, why) => { if (got == null || Math.abs(got - want) > 1e-6) fail("at-risk " + why + ": expected " + want + ", got " + got); };
// Fazlin's live case: start 2023-05-15, opening 10.25 as of 2026-06-25, today
// 2026-07-29. Her 15 Jun 2026 credit is NEXT year's → 10.25 − 1.25 = 9.0.
riskNear((leaveExpiryForPerson("B147M", mkDeps("B147M", "2023-05-15", 10.25, "2026-07-29")) || {}).totalAtRisk, 9.0, "pre-anchor (Fazlin) strips one current-year credit");
// Pre-anchor, 3 current-year credits baked in: opening 10 − 3.75 = 6.25.
riskNear((leaveExpiryForPerson("B100", mkDeps("B100", "2024-03-10", 10, "2026-07-17")) || {}).totalAtRisk, 6.25, "pre-anchor strips 3 current-year credits");
// Booking 6 days in the redemption window draws the 6.25 down to 0.25.
riskNear((leaveExpiryForPerson("B100", mkDeps("B100", "2024-03-10", 10, "2026-07-17", [{ ec: "B100", startDate: "2026-08-01", endDate: "2026-08-06", type: "Annual leave", leaveType: "Annual" }])) || {}).totalAtRisk, 0.25, "window booking rescues at-risk days");
// Post-anchor person: opening 8 + the closing anniversary credit = 9.25.
riskNear((leaveExpiryForPerson("B300", mkDeps("B300", "2025-07-01", 8, "2026-07-29")) || {}).totalAtRisk, 9.25, "post-anchor includes the closing anniversary credit");
// Hoarder: capped at one full year = 15 (not the whole 30).
riskNear((leaveExpiryForPerson("B400", mkDeps("B400", "2020-05-15", 30, "2026-07-29")) || {}).totalAtRisk, 15, "hoarder capped at one full year");
// <1-year employee: nothing to expire.
if (leaveExpiryForPerson("B200", mkDeps("B200", "2026-05-01", 2, "2026-07-17")) !== null) fail("at-risk: <1-year employee should have no expiring leave");
// Per-entry asOf WINS over a drifted sheet field: same as Fazlin but the sheet
// field is wrongly set to today (2026-07-29) while her entry is pinned to the
// real 2026-06-25 upload → still 9.0, not the 7.75 the drifted field would give.
const pinnedDeps = mkDeps("B147M", "2023-05-15", 10.25, "2026-07-29");
pinnedDeps.leaveBalances.asOf = "2026-07-29";                      // drifted field
pinnedDeps.leaveBalances.entries.B147M.asOf = "2026-06-25";        // pinned upload date
riskNear((leaveExpiryForPerson("B147M", pinnedDeps) || {}).totalAtRisk, 9.0, "entry.asOf overrides a drifted sheet field");
if (!failures) console.log("  ✓ 7 at-risk cases correct (oldest-taken-first split, anniversary boundary, one-year cap, booking rescue, per-entry anchor)");

// ── Report ────────────────────────────────────────────────────────────────────
const unconfirmed = Object.keys(LEAVE_CODES).filter(k => LEAVE_CODES[k].sage === "?");
if (unconfirmed.length) {
  console.log("\nℹ " + unconfirmed.length + " type(s) still awaiting a Sage letter from the payroll consultant: " +
    unconfirmed.join(", ") + "\n  (docs/leave-sage-plan.md Phase 0.3 — the Sage export must refuse these rows.)");
}
if (failures) { console.error("\n✗ " + failures + " check(s) failed."); process.exit(1); }
console.log("\n✓ Leave-code checks passed.");
