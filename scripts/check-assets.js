#!/usr/bin/env node
/* Invariant check for the asset register (assets.js).
 *
 * Asserts the rules in docs/assets-plan.md §4.3 against synthetic histories:
 *   1. an asset holds at most one open allocation, and the projection's
 *      holder equals it;
 *   2. disposal is terminal — status Disposed, holder cleared, further
 *      actions refused;
 *   3. a transfer moves the branch and keeps the status;
 *   4. IDs are IT-0001-style, zero-padded, and a gap is never reused;
 *   5. straight-line book value;
 *   6. the dashboard summary adds up;
 *   7. the bulk-upload parser flags repeated codes for review.
 *
 * There is no test framework in this repo; this is the whole gate.
 * Run:  node scripts/check-assets.js    (exit 0 = good, 1 = problem)
 */
"use strict";

const path = require("path");
const A = require(path.join(__dirname, "..", "assets.js"));

let failed = false;
function fail(msg) { console.error("✗ " + msg); failed = true; }
function pass(msg) { console.log("✓ " + msg); }
function eq(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass(label);
  else fail(label + " — got " + JSON.stringify(got) + ", expected " + JSON.stringify(want));
}
function ok(label, cond) { if (cond) pass(label); else fail(label); }

/* ── 4. IDs ─────────────────────────────────────────────────────────────── */
eq("first ID", A.nextId("IT", []), "IT-0001");
eq("next after gap (0002 archived, still counted)", A.nextId("IT", ["IT-0001", "IT-0003"]), "IT-0004");
eq("ignores other prefixes", A.nextId("FA", ["IT-0009", "FA-0002"]), "FA-0003");
eq("beyond 9999 keeps counting", A.nextId("MOV", ["MOV-9999", "MOV-10000"]), "MOV-10001");
eq("register of id", A.registerOfId("se-0007"), "SE");
eq("unknown prefix", A.registerOfId("XX-0007"), null);

/* ── Dates ──────────────────────────────────────────────────────────────── */
eq("dd/mm/yyyy", A.toYmd("15/01/2026"), "2026-01-15");
eq("d mmm yyyy", A.toYmd("5 Sep 2026"), "2026-09-05");
eq("impossible day rejected", A.toYmd("31/31/2026"), null);
eq("30 Feb rejected", A.toYmd("2026-02-30"), null);
eq("excel serial (46107 = 26 Mar 2026)", A.toYmd(46107), "2026-03-26");
eq("months between (day aware)", A.monthsBetween("2026-01-15", "2026-04-14"), 2);
eq("months between (same day)", A.monthsBetween("2026-01-15", "2026-04-15"), 3);

/* ── Fixture ────────────────────────────────────────────────────────────── */
const asset = { id: "u1", asset_id: "IT-0001", register: "IT", category: "Laptop", branch: "Head Office",
  status: "In Storage", condition: "New", purchase_cost: 12000, purchase_date: "2026-01-01" };
const al1 = { id: "a1", allocation_no: "AL-0001", asset_id: "u1", ec: "H001", employee_name: "Ann", date_issued: "2026-02-01", condition_issued: "New", created_at: "2026-02-01T09:00:00Z" };
const mov1 = { id: "e1", event_no: "MOV-0001", asset_id: "u1", kind: "transfer", date: "2026-03-01", from_branch: "Head Office", to_branch: "Sea Point", created_at: "2026-03-01T09:00:00Z" };

/* ── 1. allocation → holder, status Assigned ────────────────────────────── */
let p = A.project(asset, [], [al1]);
eq("allocated: holder", [p.assigned_ec, p.assigned_name, p.date_issued, p.status], ["H001", "Ann", "2026-02-01", "Assigned"]);
ok("allocated: open_alloc is AL-0001", p.open_alloc && p.open_alloc.allocation_no === "AL-0001");
ok("allocate again refused", !A.canAct(p, "allocate").ok);
ok("return allowed", A.canAct(p, "return").ok);

/* ── 3. transfer keeps status, moves branch ─────────────────────────────── */
p = A.project(asset, [mov1], [al1]);
eq("transfer: branch + status", [p.branch, p.status, p.assigned_ec], ["Sea Point", "Assigned", "H001"]);

/* return closes it */
const al1Closed = Object.assign({}, al1, { date_returned: "2026-04-01", condition_returned: "Good", returned_to: "Storage" });
p = A.project(asset, [mov1], [al1Closed]);
eq("returned: cleared, In Storage, condition", [p.assigned_ec, p.status, p.condition, p.branch], [null, "In Storage", "Good", "Storage"]);
ok("return refused when nothing open", !A.canAct(p, "return").ok);

/* repair round trip */
const rOut = { id: "e2", asset_id: "u1", kind: "repair_out", date: "2026-04-10", created_at: "2026-04-10T09:00:00Z" };
const rIn = { id: "e3", asset_id: "u1", kind: "repair_in", date: "2026-04-20", condition: "Excellent", created_at: "2026-04-20T09:00:00Z" };
p = A.project(asset, [mov1, rOut], [al1Closed]);
eq("repair out", p.status, "Under Repair");
p = A.project(asset, [mov1, rOut, rIn], [al1Closed]);
eq("repair in with no holder", [p.status, p.condition], ["In Storage", "Excellent"]);
const al2 = { id: "a2", allocation_no: "AL-0002", asset_id: "u1", ec: "H002", employee_name: "Bob", date_issued: "2026-04-05", created_at: "2026-04-05T09:00:00Z" };
p = A.project(asset, [mov1, rOut, rIn], [al1Closed, al2]);
eq("repair in with a holder → Assigned", [p.status, p.assigned_ec], ["Assigned", "H002"]);

/* ── 2. disposal terminal ───────────────────────────────────────────────── */
const disp = { id: "e4", event_no: "DISP-0001", asset_id: "u1", kind: "disposal", date: "2026-05-01", disposal_method: "Scrapped", created_at: "2026-05-01T09:00:00Z" };
p = A.project(asset, [mov1, rOut, rIn, disp], [al1Closed, al2]);
eq("disposed: status + holder cleared", [p.status, p.assigned_ec, p.disposed], ["Disposed", null, true]);
ok("disposed: allocate refused", !A.canAct(p, "allocate").ok);
ok("disposed: transfer refused", !A.canAct(p, "transfer").ok);
ok("disposed: undo allowed", A.canAct(p, "undo_disposal").ok);
/* archived disposal is ignored */
p = A.project(asset, [mov1, rOut, rIn, Object.assign({}, disp, { archived_at: "2026-05-02T00:00:00Z" })], [al1Closed, al2]);
eq("undo (archived disposal) restores", [p.status, p.assigned_ec], ["Assigned", "H002"]);

/* events for another asset are ignored */
p = A.project(asset, [Object.assign({}, disp, { asset_id: "u2" })], []);
eq("other asset's events ignored", [p.status, p.has_history], ["In Storage", false]);

/* ── 5. book value ──────────────────────────────────────────────────────── */
let bv = A.bookValue(asset, {}, "2027-01-01");
eq("book value after 12 of 36 months", bv.value, 8000);
bv = A.bookValue(asset, { usefulLifeMonths: { "IT:Laptop": 24 } }, "2027-01-01");
eq("per-category life override", bv.value, 6000);
bv = A.bookValue(asset, {}, "2030-01-01");
eq("fully depreciated floors at 0", bv.value, 0);
bv = A.bookValue(asset, {}, "2027-01-01", { disposed: true });
eq("disposed book value 0", bv.value, 0);
eq("no cost → no value", A.bookValue({ register: "FA" }, {}, "2027-01-01").value, null);

/* ── 6. summary ─────────────────────────────────────────────────────────── */
const assets = [
  Object.assign({}, asset, { status: "Assigned", assigned_ec: "H002", branch: "Sea Point" }),
  { id: "u2", asset_id: "FA-0001", register: "FA", branch: "Kloof", status: "In Storage", purchase_cost: 500, purchase_date: "2020-01-01" },
  { id: "u3", asset_id: "FA-0002", register: "FA", branch: "Kloof", status: "Disposed", purchase_cost: 900 },
  { id: "u4", asset_id: "VE-0001", register: "VE", branch: "Head Office", status: "Under Repair", details: { licence_disc_expiry: "2026-09-20" } },
  { id: "u5", asset_id: "IT-0002", register: "IT", status: "Lost", archived_at: "2026-01-01T00:00:00Z" }
];
const events = [mov1, rOut, { id: "e5", event_no: "DISP-0002", asset_id: "u3", kind: "disposal", date: "2026-08-15", disposal_method: "Sold", disposal_value: 150 },
  { id: "e6", asset_id: "u4", kind: "repair_out", date: "2026-07-01" }];
const allocs = [al1Closed, al2, { id: "a3", allocation_no: "AL-0003", asset_id: "u2", ec: "B999", employee_name: "Gone", date_issued: "2026-08-01", acknowledged: false }];
const S = A.summarise(assets, events, allocs, { today: "2026-09-07", leavers: { B999: { departed: true, leftDate: "2026-09-01" } } });
eq("totals: live assets excl. disposed", S.totals.assets, 3);
eq("totals: transfers/disposals", [S.totals.transfers, S.totals.disposals, S.totals.disposalValue], [1, 1, 150]);
eq("totals: open allocations", S.totals.openAllocations, 2);
eq("per register FA", [S.perRegister.FA.total, S.perRegister.FA.storage, S.perRegister.FA.disposed], [2, 1, 1]);
eq("archived asset excluded", S.perRegister.IT.total, 1);
eq("by branch excludes disposed", S.byBranch, { "Sea Point": 1, "Kloof": 1, "Head Office": 1 });
eq("leaver holding asset", S.attention.leavers.map(x => x.alloc.allocation_no), ["AL-0003"]);
eq("unacknowledged > 7d", S.attention.unacknowledged.map(x => x.alloc.allocation_no).sort(), ["AL-0002", "AL-0003"]);
eq("under repair > 30d", S.attention.underRepair.map(x => x.asset.asset_id), ["VE-0001"]);
eq("expiring within 60d", S.attention.expiring.map(x => x.what + " " + x.asset.asset_id), ["Licence disc VE-0001"]);
eq("12 monthly buckets ending this month", [S.monthly.length, S.monthly[11].ym, S.monthly[11].disposals], [12, "2026-09", 0]);
eq("disposal landed in August", S.monthly[10].disposals, 1);

/* ── 7. bulk upload ─────────────────────────────────────────────────────── */
const ctx = {
  cfg: {}, register: "IT", branches: ["Head Office", "Sea Point", "Kloof"],
  people: { H001: { ec: "H001", name: "Ann" } },
  assets: assets, events: events, allocations: allocs
};
const t = A.templateRows("asset");
ok("template has headers + example", t.headers.length === A.IMPORT_SPECS.asset.columns.length && t.example.length === t.headers.length);
ok("template csv has two lines", A.templateCsv("asset").split("\r\n").filter(Boolean).length === 2);

const aoa = [
  t.headers,
  t.example,                                                                        // example row → skipped
  ["", "Laptop", "New MacBook", "Apple", "M3", "SER-1", "TAG-1", "15/01/2026", "R 25,000.00", "", "", "", "sea point", "IT", "H001", "", "New", "Assigned", ""],
  ["IT-0001", "Laptop", "Existing Dell", "", "", "", "", "", "", "", "", "", "Head Office", "", "", "", "Good", "In Use", ""],
  ["", "Laptop", "Dup serial", "", "", "ser-1", "", "", "", "", "", "", "Kloof", "", "", "", "", "", ""],
  ["", "Laptop", "Bad rows", "", "", "", "", "31/31/2026", "abc", "", "", "", "Nowhere", "", "Z999", "", "", "", ""],
  ["FA-0001", "Desk", "Wrong register", "", "", "", "", "", "", "", "", "", "Kloof", "", "", "", "", "", ""]
];
const imp = A.parseImport("asset", aoa, ctx);
eq("example row skipped, 5 rows kept", imp.rows.length, 5);
eq("no required header missing", imp.missing, []);
const r0 = imp.rows[0];
eq("row: parsed values", [r0.data.purchase_date, r0.data.purchase_cost, r0.data.branch, r0.data.assigned_ec, r0.data.register], ["2026-01-15", 25000, "Sea Point", "H001", "IT"]);
eq("row: no errors", r0.errors, []);
ok("row: warns about missing date issued", r0.warnings.some(w => /Date Issued/.test(w)));
ok("existing asset id → replace review", imp.rows[1].dup && imp.rows[1].dup.kind === "asset_id" && imp.rows[1].dup.existing.asset_id === "IT-0001");
ok("repeated serial within file → review", imp.rows[2].dup && imp.rows[2].dup.kind === "file");
ok("bad date / cost / branch / ec → errors", imp.rows[3].errors.length === 4);
ok("wrong register id → error", imp.rows[4].errors.some(e => /register/.test(e)));

const alAoa = [
  A.templateRows("allocation").headers,
  ["IT-0001", "H001", "2026-09-01", "Good", "yes", "2026-09-01", "", "", ""],
  ["XX-0001", "H001", "2026-09-01", "", "", "", "", "", ""]
];
const alImp = A.parseImport("allocation", alAoa, ctx);
ok("allocation on an already-allocated asset → review", alImp.rows[0].dup && alImp.rows[0].dup.kind === "open_alloc");
ok("unknown asset → error", alImp.rows[1].errors.some(e => /no asset/.test(e)));

const hm = A.matchHeaders("transfer", ["Asset ID", "Date", "To", "Reason", "Something else"]);
eq("header aliases + unknown", [hm.map.asset_id, hm.map.date, hm.map.to_branch, hm.unknown, hm.missing], [0, 1, 2, ["Something else"], []]);

/* ── cfg ────────────────────────────────────────────────────────────────── */
const cfg = A.normCfg({ conditions: ["New", "new ", "Used"], usefulLifeDefault: { IT: "48" } });
eq("cfg dedupes case-insensitively", cfg.conditions, ["New", "Used"]);
eq("cfg parses numbers", cfg.usefulLifeDefault.IT, 48);
eq("cfg keeps defaults elsewhere", cfg.usefulLifeDefault.VE, 60);

if (failed) { console.error("\nassets check FAILED"); process.exit(1); }
console.log("\nassets check passed");
