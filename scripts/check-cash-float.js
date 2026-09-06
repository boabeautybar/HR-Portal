#!/usr/bin/env node
/* Invariant check for the cash float:
 *   1. cash-float.js and kiosk/cash-float.js are byte-identical mirrors.
 *   2. The ledger maths and the Fresha parser still behave, checked against
 *      real Fresha sales-summary exports.
 *
 * The sample exports are embedded below rather than shipped as .csv files:
 * .gitignore excludes *.csv because Fresha exports normally carry client PII.
 * These particular ones are daily AGGREGATES — item-type and payment-type
 * totals, no client names, IDs or transactions — so they are safe to keep here
 * and the check then works on a fresh clone. Real files dropped into
 * docs/fresha-samples/ (git-ignored, local only) are checked too when present.
 *
 * The portal and the kiosk deploy as SEPARATE Netlify sites whose publish
 * roots are the repo root and kiosk/, so a page cannot load a script from
 * above its own site root and the file has to be mirrored. This gate makes
 * drift loud: edit one copy, copy it over the other, and this passes again.
 *
 * Run:  node scripts/check-cash-float.js    (exit 0 = good, 1 = problem)
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const COPIES = ["cash-float.js", path.join("kiosk", "cash-float.js")];

let failed = false;
function fail(msg) { console.error("✗ " + msg); failed = true; }
function pass(msg) { console.log("✓ " + msg); }

/* ── 1. Mirrors ─────────────────────────────────────────────────────────── */
const bufs = COPIES.map((rel) => {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) { fail("missing mirror: " + rel); return null; }
  return fs.readFileSync(p);
});
if (bufs.every(Boolean)) {
  if (bufs.every((b) => b.equals(bufs[0]))) pass("cash-float.js mirrors are identical");
  else fail("cash-float.js copies have drifted — copy one over the other:\n  " + COPIES.join("\n  "));
}

/* ── 2. Behaviour ───────────────────────────────────────────────────────── */
const CF = require(path.join(root, "cash-float.js"));
const R = (n) => Math.round(n * 100) / 100;

function eq(label, got, want) {
  if (R(got) === R(want)) pass(label);
  else fail(label + " — got " + got + ", expected " + want);
}
function eq2(label, got, want) {
  if (got === want) pass(label);
  else fail(label + " — got " + JSON.stringify(got) + ", expected " + JSON.stringify(want));
}

/* Ledger: the worked example from docs/cash-float-plan.md. */
const cfg = {
  ceiling: 10000, matchTolerance: 1,
  stores: { Claremont: { openingBalance: 1000, startDate: "2026-09-01" } }
};
const cashups = [
  // Before the start date — must be ignored, not silently counted.
  { id: "c0", branch: "Claremont", date: "2026-08-30", cash: 999, cash_banked: false, amount_banked: 0, created_at: "t0" },
  { id: "c1", branch: "Claremont", date: "2026-09-02", cash: 500, cash_banked: true, amount_banked: 300, created_at: "t1", reviewed_at: "r1" },
  // Reopened/deleted — superseded, must not count.
  { id: "c2", branch: "Claremont", date: "2026-09-03", cash: 750, cash_banked: false, amount_banked: 0, created_at: "t2", archived_at: "x" },
  // Out of scope branch — must not appear at all.
  { id: "c3", branch: "Sea Point", date: "2026-09-02", cash: 400, cash_banked: false, amount_banked: 0, created_at: "t3" }
];
const movements = [
  { id: "m1", branch: "Claremont", date: "2026-09-03", kind: "deposit", amount: 200, created_at: "t4", source: "kiosk" },
  { id: "m2", branch: "Claremont", date: "2026-09-04", kind: "collection", amount: 400, created_at: "t5", recorded_by: "Jacques" },
  { id: "m3", branch: "Claremont", date: "2026-09-04", kind: "adjustment", amount: -50, note: "till short", created_at: "t6" },
  { id: "m4", branch: "Claremont", date: "2026-09-04", kind: "deposit", amount: 100, created_at: "t7", archived_at: "x" }
];
const led = CF.computeCashFloat(cfg, cashups, movements, ["Claremont"]);
const b = led.Claremont;
eq("ledger: opening 1000 +500 -300 -200 -400 -50 = 550", b.onHand, 550);
eq("ledger: cash in counted once", b.cashIn, 500);
eq("ledger: deposits = cash-up 300 + standalone 200", b.deposits, 500);
eq("ledger: collections", b.collections, 400);
eq("ledger: adjustments signed", b.adjustments, -50);
eq("ledger: headroom = ceiling - on hand", b.headroom, 9450);
eq("ledger: pre-start-date rows ignored", b.ignoredBeforeStart, 1);
if (!b.over) pass("ledger: 550 is under the ceiling"); else fail("ledger: 550 flagged over ceiling");
if (Object.keys(led).length === 1) pass("ledger: out-of-scope branch excluded");
else fail("ledger: out-of-scope branch leaked in: " + Object.keys(led).join(", "));
// Unreviewed counts movements + cash-up deposits awaiting sign-off, never cash-in.
eq("ledger: unreviewed movements", b.unreviewed, 3);
// Running balance must be in event order, not input order.
const bal = b.rows.map((r) => R(r.balance)).join(",");
if (bal === "1500,1200,1000,600,550") pass("ledger: running balance in event order");
else fail("ledger: running balance was " + bal);

/* Over-ceiling. */
const over = CF.computeCashFloat(
  { ceiling: 10000, stores: { Claremont: { openingBalance: 9900, startDate: "2026-09-01" } } },
  [{ id: "c9", branch: "Claremont", date: "2026-09-02", cash: 200, created_at: "t" }], [], ["Claremont"]
);
if (over.Claremont.over && R(over.Claremont.headroom) === -100) pass("ledger: over-ceiling flagged with negative headroom");
else fail("ledger: over-ceiling not flagged (" + JSON.stringify(over.Claremont) + ")");

/* An unconfigured store reports nothing rather than a wrong zero. */
const un = CF.computeCashFloat({}, cashups, movements, ["Claremont"]);
if (!un.Claremont.configured && un.Claremont.rows.length === 0) pass("ledger: unconfigured store stays blank");
else fail("ledger: unconfigured store produced a balance");

/* Fresha samples — three real Finance summary exports, 25 Aug to 5 Sep 2026.
   Sea Point and Green Point each have a cash day; Cobble Walk has the
   narrowest column layout (no Cash column at all), which is what proves the
   parser reads by column NAME rather than position. */
const SAMPLES = {
  "Sea Point_2026-09-06.csv": [
    "\"Date\",\"Gross sales\",\"Discounts\",\"Refunds / Returns\",\"Net sales\",\"Taxes\",\"Total sales\",\"Gift card sales\",\"Service charges\",\"Tips\",\"Net other sales\",\"Tax on other sales\",\"Total other sales\",\"Total sales + other sales\",\"Sales paid in period\",\"Unpaid sales in period\",\"Card\",\"Cash\",\"SHOPIFY\",\"Total payments\",\"Payments for sales in period\",\"Payments for sales in previous periods\",\"Prepayments\",\"Prepayment redemption\",\"Gift card redemption\",\"Total redemptions\",\"Redemptions for sales in period\",\"Redemptions for sales in previous periods\"",
    "\"05 Sep 2026\",\"23629.43\",\"-1852.15\",\"0\",\"21777.28\",\"3157.72\",\"24935\",\"0\",\"0\",\"1326.25\",\"1326.25\",\"0\",\"1326.25\",\"26261.25\",\"26261.25\",\"0\",\"26046.25\",\"0\",\"0\",\"26046.25\",\"26046.25\",\"0\",\"0\",\"0\",\"215\",\"215\",\"215\",\"0\"",
    "\"04 Sep 2026\",\"17714.87\",\"-748.68\",\"0\",\"16966.19\",\"2502.81\",\"19469\",\"300\",\"0\",\"1047.5\",\"1347.5\",\"0\",\"1347.5\",\"20816.5\",\"20816.5\",\"0\",\"20686.5\",\"0\",\"0\",\"20686.5\",\"20686.5\",\"0\",\"0\",\"0\",\"130\",\"130\",\"130\",\"0\"",
    "\"03 Sep 2026\",\"8470.27\",\"-443.5\",\"0\",\"8026.77\",\"1083.23\",\"9110\",\"0\",\"0\",\"211.5\",\"211.5\",\"0\",\"211.5\",\"9321.5\",\"9321.5\",\"0\",\"8346.5\",\"0\",\"0\",\"8346.5\",\"8346.5\",\"0\",\"0\",\"0\",\"975\",\"975\",\"975\",\"0\"",
    "\"02 Sep 2026\",\"15906.82\",\"-347.83\",\"0\",\"15558.99\",\"2246.01\",\"17805\",\"1845\",\"0\",\"804.5\",\"2649.5\",\"0\",\"2649.5\",\"20454.5\",\"20454.5\",\"0\",\"18884.5\",\"295\",\"0\",\"19179.5\",\"19179.5\",\"0\",\"0\",\"0\",\"1275\",\"1275\",\"1275\",\"0\"",
    "\"01 Sep 2026\",\"17813.11\",\"-1091.32\",\"0\",\"16721.79\",\"2508.21\",\"19230\",\"1000\",\"0\",\"513.5\",\"1513.5\",\"0\",\"1513.5\",\"20743.5\",\"20743.5\",\"0\",\"20393.5\",\"0\",\"0\",\"20393.5\",\"20393.5\",\"0\",\"0\",\"0\",\"350\",\"350\",\"350\",\"0\"",
    "\"31 Aug 2026\",\"9487\",\"-160.87\",\"0\",\"9326.13\",\"1398.87\",\"10725\",\"0\",\"0\",\"369.5\",\"369.5\",\"0\",\"369.5\",\"11094.5\",\"11094.5\",\"0\",\"10394.5\",\"0\",\"0\",\"10394.5\",\"10394.5\",\"0\",\"0\",\"0\",\"700\",\"700\",\"700\",\"0\"",
    "\"30 Aug 2026\",\"13369.63\",\"-1147.84\",\"0\",\"12221.79\",\"1833.21\",\"14055\",\"0\",\"0\",\"270\",\"270\",\"0\",\"270\",\"14325\",\"14325\",\"0\",\"13325\",\"0\",\"0\",\"13325\",\"13325\",\"0\",\"0\",\"0\",\"1000\",\"1000\",\"1000\",\"0\"",
    "\"29 Aug 2026\",\"21945.34\",\"-1395.65\",\"0\",\"20549.69\",\"2893.31\",\"23443\",\"250\",\"0\",\"858\",\"1108\",\"0\",\"1108\",\"24551\",\"24551\",\"0\",\"22663\",\"0\",\"250\",\"22913\",\"22913\",\"0\",\"0\",\"0\",\"1638\",\"1638\",\"1638\",\"0\"",
    "\"28 Aug 2026\",\"19337.28\",\"-1503.6\",\"0\",\"17833.68\",\"2559.82\",\"20393.5\",\"400\",\"0\",\"996.06\",\"1396.06\",\"0\",\"1396.06\",\"21789.56\",\"21789.56\",\"0\",\"21244.56\",\"0\",\"0\",\"21244.56\",\"21244.56\",\"0\",\"0\",\"0\",\"545\",\"545\",\"545\",\"0\"",
    "\"27 Aug 2026\",\"15867.72\",\"-873.91\",\"0\",\"14993.81\",\"2191.19\",\"17185\",\"1150\",\"0\",\"598.25\",\"1748.25\",\"0\",\"1748.25\",\"18933.25\",\"18933.25\",\"0\",\"18933.25\",\"0\",\"0\",\"18933.25\",\"18933.25\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"26 Aug 2026\",\"14782.48\",\"-395.65\",\"0\",\"14386.83\",\"2133.17\",\"16520\",\"250\",\"0\",\"468\",\"718\",\"0\",\"718\",\"17238\",\"17238\",\"0\",\"16418\",\"0\",\"0\",\"16418\",\"16418\",\"0\",\"0\",\"0\",\"820\",\"820\",\"820\",\"0\"",
    "\"25 Aug 2026\",\"6953.53\",\"-369.96\",\"0\",\"6583.57\",\"961.43\",\"7545\",\"0\",\"0\",\"305\",\"305\",\"0\",\"305\",\"7850\",\"7850\",\"0\",\"7850\",\"0\",\"0\",\"7850\",\"7850\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\""
  ].join("\n"),
  "Green Point_2026-09-06.csv": [
    "\"Date\",\"Gross sales\",\"Discounts\",\"Refunds / Returns\",\"Net sales\",\"Taxes\",\"Total sales\",\"Gift card sales\",\"Service charges\",\"Tips\",\"Net other sales\",\"Tax on other sales\",\"Total other sales\",\"Total sales + other sales\",\"Sales paid in period\",\"Unpaid sales in period\",\"Card\",\"Cash\",\"Yoco Payment Link\",\"Total payments\",\"Payments for sales in period\",\"Payments for sales in previous periods\",\"Prepayments\",\"Prepayment redemption\",\"Gift card redemption\",\"Total redemptions\",\"Redemptions for sales in period\",\"Redemptions for sales in previous periods\"",
    "\"05 Sep 2026\",\"11408.73\",\"-356.51\",\"0\",\"11052.22\",\"1657.78\",\"12710\",\"500\",\"0\",\"178.5\",\"678.5\",\"0\",\"678.5\",\"13388.5\",\"13388.5\",\"0\",\"12488.5\",\"0\",\"0\",\"12488.5\",\"12488.5\",\"0\",\"0\",\"0\",\"900\",\"900\",\"900\",\"0\"",
    "\"04 Sep 2026\",\"15730.44\",\"-1495.66\",\"0\",\"14234.78\",\"2135.22\",\"16370\",\"0\",\"0\",\"776\",\"776\",\"0\",\"776\",\"17146\",\"17146\",\"0\",\"16851\",\"0\",\"0\",\"16851\",\"16851\",\"0\",\"0\",\"0\",\"295\",\"295\",\"295\",\"0\"",
    "\"03 Sep 2026\",\"8434.79\",\"-130.43\",\"0\",\"8304.36\",\"1245.64\",\"9550\",\"0\",\"0\",\"714.25\",\"714.25\",\"0\",\"714.25\",\"10264.25\",\"10264.25\",\"0\",\"10264.25\",\"0\",\"0\",\"10264.25\",\"10264.25\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"02 Sep 2026\",\"10517.43\",\"-634.78\",\"0\",\"9882.65\",\"1482.35\",\"11365\",\"1000\",\"0\",\"399.75\",\"1399.75\",\"0\",\"1399.75\",\"12764.75\",\"12764.75\",\"0\",\"12264.75\",\"0\",\"0\",\"12264.75\",\"12264.75\",\"0\",\"0\",\"0\",\"500\",\"500\",\"500\",\"0\"",
    "\"01 Sep 2026\",\"12282.64\",\"-178.26\",\"0\",\"12104.38\",\"1815.62\",\"13920\",\"0\",\"0\",\"403.25\",\"403.25\",\"0\",\"403.25\",\"14323.25\",\"14323.25\",\"0\",\"14323.25\",\"0\",\"0\",\"14323.25\",\"14323.25\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"31 Aug 2026\",\"8817.46\",\"-173.92\",\"0\",\"8643.54\",\"1296.46\",\"9940\",\"295\",\"0\",\"489.5\",\"784.5\",\"0\",\"784.5\",\"10724.5\",\"10724.5\",\"0\",\"9944.5\",\"0\",\"0\",\"9944.5\",\"9944.5\",\"0\",\"0\",\"0\",\"780\",\"780\",\"780\",\"0\"",
    "\"30 Aug 2026\",\"10143.53\",\"-765.22\",\"0\",\"9378.31\",\"1406.69\",\"10785\",\"0\",\"0\",\"385\",\"385\",\"0\",\"385\",\"11170\",\"11170\",\"0\",\"11170\",\"0\",\"0\",\"11170\",\"11170\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"29 Aug 2026\",\"11552.21\",\"-578.26\",\"0\",\"10973.95\",\"1646.05\",\"12620\",\"50\",\"0\",\"595\",\"645\",\"0\",\"645\",\"13265\",\"13265\",\"0\",\"13265\",\"0\",\"0\",\"13265\",\"13265\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"28 Aug 2026\",\"15426.18\",\"-1306.07\",\"0\",\"14120.11\",\"2117.89\",\"16238\",\"50\",\"0\",\"204\",\"254\",\"0\",\"254\",\"16492\",\"16492\",\"0\",\"15012\",\"840\",\"640\",\"16492\",\"16492\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"27 Aug 2026\",\"16207.04\",\"-386.07\",\"0\",\"15820.97\",\"2373.03\",\"18194\",\"0\",\"0\",\"914.8\",\"914.8\",\"0\",\"914.8\",\"19108.8\",\"19108.8\",\"0\",\"19108.8\",\"0\",\"0\",\"19108.8\",\"19108.8\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"26 Aug 2026\",\"13121.78\",\"-678.27\",\"0\",\"12443.51\",\"1866.49\",\"14310\",\"300\",\"0\",\"366.25\",\"666.25\",\"0\",\"666.25\",\"14976.25\",\"14976.25\",\"0\",\"14281.25\",\"695\",\"0\",\"14976.25\",\"14976.25\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"25 Aug 2026\",\"10326.19\",\"-400.01\",\"0\",\"9926.18\",\"1488.82\",\"11415\",\"0\",\"0\",\"220.5\",\"220.5\",\"0\",\"220.5\",\"11635.5\",\"11635.5\",\"0\",\"11635.5\",\"0\",\"0\",\"11635.5\",\"11635.5\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\""
  ].join("\n"),
  "Cobble Walk_2026-09-06.csv": [
    "\"Date\",\"Gross sales\",\"Discounts\",\"Refunds / Returns\",\"Net sales\",\"Taxes\",\"Total sales\",\"Gift card sales\",\"Service charges\",\"Tips\",\"Net other sales\",\"Tax on other sales\",\"Total other sales\",\"Total sales + other sales\",\"Sales paid in period\",\"Unpaid sales in period\",\"Card\",\"Total payments\",\"Payments for sales in period\",\"Payments for sales in previous periods\",\"Prepayments\",\"Prepayment redemption\",\"Gift card redemption\",\"Total redemptions\",\"Redemptions for sales in period\",\"Redemptions for sales in previous periods\"",
    "\"05 Sep 2026\",\"11432.24\",\"-573.92\",\"0\",\"10858.32\",\"1628.68\",\"12487\",\"595\",\"0\",\"80\",\"675\",\"0\",\"675\",\"13162\",\"13162\",\"0\",\"11872\",\"11872\",\"11872\",\"0\",\"0\",\"0\",\"1290\",\"1290\",\"1290\",\"0\"",
    "\"04 Sep 2026\",\"14717.44\",\"-1107.38\",\"0\",\"13610.06\",\"2041.44\",\"15651.5\",\"4205\",\"0\",\"680\",\"4885\",\"0\",\"4885\",\"20536.5\",\"20536.5\",\"0\",\"20146.5\",\"20146.5\",\"20146.5\",\"0\",\"0\",\"0\",\"390\",\"390\",\"390\",\"0\"",
    "\"03 Sep 2026\",\"8007.88\",\"-372.63\",\"0\",\"7635.25\",\"1145.25\",\"8780.5\",\"0\",\"0\",\"130\",\"130\",\"0\",\"130\",\"8910.5\",\"8910.5\",\"0\",\"8385.5\",\"8385.5\",\"8385.5\",\"0\",\"0\",\"0\",\"525\",\"525\",\"525\",\"0\"",
    "\"02 Sep 2026\",\"6187\",\"-182.61\",\"0\",\"6004.39\",\"900.61\",\"6905\",\"415\",\"0\",\"170\",\"585\",\"0\",\"585\",\"7490\",\"7490\",\"0\",\"7490\",\"7490\",\"7490\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"01 Sep 2026\",\"4439.16\",\"-313.06\",\"0\",\"4126.1\",\"618.9\",\"4745\",\"270\",\"0\",\"160\",\"430\",\"0\",\"430\",\"5175\",\"5175\",\"0\",\"5175\",\"5175\",\"5175\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"31 Aug 2026\",\"6430.46\",\"-334.79\",\"0\",\"6095.67\",\"914.33\",\"7010\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"7010\",\"7010\",\"0\",\"5673.5\",\"5673.5\",\"5673.5\",\"0\",\"0\",\"0\",\"1336.5\",\"1336.5\",\"1336.5\",\"0\"",
    "\"30 Aug 2026\",\"3573.9\",\"-296.96\",\"0\",\"3276.94\",\"491.56\",\"3768.5\",\"195\",\"0\",\"39\",\"234\",\"0\",\"234\",\"4002.5\",\"4002.5\",\"0\",\"4002.5\",\"4002.5\",\"4002.5\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"",
    "\"29 Aug 2026\",\"14547.94\",\"-388.27\",\"0\",\"14159.67\",\"2123.83\",\"16283.5\",\"530\",\"0\",\"60\",\"590\",\"0\",\"590\",\"16873.5\",\"16873.5\",\"0\",\"16373.5\",\"16373.5\",\"16373.5\",\"0\",\"0\",\"0\",\"500\",\"500\",\"500\",\"0\"",
    "\"28 Aug 2026\",\"11926.13\",\"-439.12\",\"0\",\"11487.01\",\"1722.99\",\"13210\",\"0\",\"0\",\"137\",\"137\",\"0\",\"137\",\"13347\",\"13347\",\"0\",\"13002\",\"13002\",\"13002\",\"0\",\"0\",\"0\",\"345\",\"345\",\"345\",\"0\"",
    "\"27 Aug 2026\",\"8864.38\",\"-1004.79\",\"0\",\"7859.59\",\"1178.91\",\"9038.5\",\"345\",\"0\",\"179\",\"524\",\"0\",\"524\",\"9562.5\",\"9562.5\",\"0\",\"8537.5\",\"8537.5\",\"8537.5\",\"0\",\"0\",\"0\",\"1025\",\"1025\",\"1025\",\"0\"",
    "\"26 Aug 2026\",\"8413.08\",\"-482.61\",\"0\",\"7930.47\",\"1189.53\",\"9120\",\"720\",\"0\",\"80\",\"800\",\"0\",\"800\",\"9920\",\"9920\",\"0\",\"9310\",\"9310\",\"9310\",\"0\",\"0\",\"0\",\"610\",\"610\",\"610\",\"0\"",
    "\"25 Aug 2026\",\"6343.31\",\"-43.49\",\"0\",\"6299.82\",\"905.18\",\"7205\",\"855\",\"0\",\"96.5\",\"951.5\",\"0\",\"951.5\",\"8156.5\",\"8156.5\",\"0\",\"7871.5\",\"7871.5\",\"7871.5\",\"0\",\"0\",\"0\",\"285\",\"285\",\"285\",\"0\""
  ].join("\n"),
};

const EXPECT = {
  // cash = the store's total over the 12 days; cashDay/onThatDay = one specific day.
  "Sea Point": { days: 12, cash: 295, cashDay: "2026-09-02", onThatDay: 295, card: 8346.5, cardDay: "2026-09-03", tips: 211.5 },
  "Green Point": { days: 12, cash: 1535, cashDay: "2026-08-28", onThatDay: 840 },
  "Cobble Walk": { days: 12, cash: 0 }
};

Object.keys(SAMPLES).forEach((fileName) => {
  const branch = CF.freshaBranchFromFilename(fileName);
  const want = EXPECT[branch];
  if (!want) { fail("sample " + fileName + " -> unexpected store " + branch); return; }
  const res = CF.parseFreshaFile(SAMPLES[fileName]);
  if (!res.ok) { fail("fresha: " + branch + " — " + res.error); return; }
  if (res.kind !== "finance") { fail("fresha: " + branch + " detected as " + res.kind + ", expected finance"); return; }
  if (res.warnings.length) { fail("fresha: " + branch + " warned: " + res.warnings.join(" | ")); return; }
  eq("fresha: " + branch + " has " + want.days + " days", res.rows.length, want.days);
  eq("fresha: " + branch + " total cash", res.rows.reduce((a, r) => a + r.cash, 0), want.cash);

  // Fresha's own arithmetic must hold on every single day.
  let idOk = true, netOk = true;
  res.rows.forEach((r) => {
    if (R(r.total_payments + r.total_redemptions) !== R(r.total)) idOk = false;
    if (R(r.total - r.tips) !== R(r.net_collected)) netOk = false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) idOk = false;
  });
  if (idOk) pass("fresha: " + branch + " payments + redemptions = money in, on all " + res.rows.length + " days");
  else fail("fresha: " + branch + " broke the payments/redemptions identity");
  if (netOk) pass("fresha: " + branch + " net collected = money in - tips");
  else fail("fresha: " + branch + " net-collected maths wrong");

  if (want.cashDay) {
    const d = res.rows.find((r) => r.date === want.cashDay);
    if (d && R(d.cash) === want.onThatDay) pass("fresha: " + branch + " cash of " + want.onThatDay + " landed on " + want.cashDay);
    else fail("fresha: " + branch + " expected " + want.onThatDay + " cash on " + want.cashDay + ", got " + (d && d.cash));
  }
  if (want.cardDay) {
    const d = res.rows.find((r) => r.date === want.cardDay);
    eq("fresha: " + branch + " card on " + want.cardDay, d && d.card, want.card);
    eq("fresha: " + branch + " tips on " + want.cardDay, d && d.tips, want.tips);
  }
});

// "05 Sep 2026" must never round-trip through a Date and shift a day.
eq2("fresha: date parsing", CF.freshaYmd("05 Sep 2026"), "2026-09-05");
eq2("fresha: date parsing (single digit)", CF.freshaYmd("5 Sep 2026"), "2026-09-05");
eq2("fresha: date parsing (ISO passthrough)", CF.freshaYmd("2026-09-05"), "2026-09-05");
eq2("fresha: unreadable date rejected", CF.freshaYmd("Total"), "");

// A payment type Fresha has never sent before must land in "other", loudly.
(() => {
  const rows = SAMPLES["Sea Point_2026-09-06.csv"].split("\n");
  const head = rows[0].replace('"SHOPIFY"', '"SnapScan"');
  const patched = [head].concat(rows.slice(1)).join("\n");
  const res = CF.parseFreshaFile(patched);
  if (res.ok && res.warnings.some((w) => /SnapScan/.test(w))) pass("fresha: an unknown payment type is flagged, not swallowed");
  else fail("fresha: unknown payment type went unreported");
})();

// The older per-day sales summary still parses, and says it needs a date.
(() => {
  const legacy = [
    '"Item Type","Sales Qty","Refund Qty","Gross Total"',
    '"Services","110","0","21425.50"',
    '"Gift cards","5","0","4012.50"',
    '"Total Sales","120","0","25718.00"',
    '""',
    '"Payment Type","Payments collected","Refunds paid"',
    '"Card","23947.00","0.00"',
    '"Gift card redemptions","1420.00","0.00"',
    '"Yoco Payment Link","1317.50","0.00"',
    '"Cash","0.00","0.00"',
    '"Payments collected","26684.50","0.00"',
    '"Of which tips","966.50","0.00"'
  ].join("\n");
  const res = CF.parseFreshaFile(legacy);
  if (!res.ok) { fail("legacy sales summary no longer parses: " + res.error); return; }
  if (res.kind !== "sales" || !res.needsDate) { fail("legacy sales summary should report kind 'sales' and needsDate"); return; }
  const r = res.rows[0];
  const ok = R(r.card) === 23947 && R(r.gift_card) === 1420 && R(r.yoco_link) === 1317.5
    && R(r.total) === 26684.5 && R(r.tips) === 966.5 && R(r.net_collected) === R(r.total_sales);
  if (ok) pass("legacy sales summary still parses and needs a trading day");
  else fail("legacy sales summary parsed wrong -> " + JSON.stringify(r));
})();

// Real exports dropped into the (git-ignored) samples folder get checked too.
const sampleDir = path.join(root, "docs", "fresha-samples");
if (fs.existsSync(sampleDir)) {
  const local = fs.readdirSync(sampleDir).filter((f) => f.endsWith(".csv"));
  let days = 0, bad = 0, cash = 0;
  local.forEach((f) => {
    const res = CF.parseFreshaFile(fs.readFileSync(path.join(sampleDir, f), "utf8"));
    if (!res.ok || res.warnings.length) { bad++; console.error("    " + f + ": " + (res.error || res.warnings.join(" | "))); return; }
    days += res.rows.length;
    res.rows.forEach((r) => {
      cash += r.cash;
      if (R(r.total_payments + r.total_redemptions) !== R(r.total)) bad++;
    });
  });
  if (local.length && !bad) pass("fresha (local files): " + local.length + " exports, " + days + " store-days, R" + R(cash) + " cash, no warnings");
  else if (bad) fail("fresha (local files): " + bad + " problem(s)");
}

/* A file that is not a sales summary must be rejected, not half-parsed. */
const bad = CF.parseFreshaSummary("Payment date,Location,Amount\n2/10/2024,BOA Rondebosch,180\n");
if (!bad.ok) pass("fresha: a non-summary CSV is rejected with an explanation");
else fail("fresha: a non-summary CSV was accepted");

/* Branch resolution: exact, alias, and the ambiguous case that must not guess. */
const SALONS = ["Sea Point", "Claremont", "Winelands", "Cobble Walk", "Green Point", "Betty"];
eq2("resolve: exact name", CF.resolveFreshaBranch("Claremont", SALONS, {}), "Claremont");
eq2("resolve: Fresha prefix stripped", CF.resolveFreshaBranch("BOA Beauty Bar Sea Point", SALONS, {}), "Sea Point");
eq2("resolve: saved alias", CF.resolveFreshaBranch("Cobble Walk Durbanville", SALONS, { "cobble walk durbanville": "Cobble Walk" }), "Cobble Walk");
eq2("resolve: unknown stays unknown", CF.resolveFreshaBranch("Somewhere Else", SALONS, {}), "");
// Fresha writes "East Gate", the portal calls it "Eastgate" — a spacing
// difference should not need a hand-typed alias.
eq2("resolve: spacing difference (East Gate / Eastgate)",
  CF.resolveFreshaBranch("East Gate", ["Eastgate", "Cape Gate", "Sea Point"], {}), "Eastgate");
eq2("resolve: spacing match does not confuse Cape Gate",
  CF.resolveFreshaBranch("cape gate", ["Eastgate", "Cape Gate", "Sea Point"], {}), "Cape Gate");
// Betty trades as "buiten" (Buitengracht) in Fresha — nothing in the name
// hints at it, so it can only ever come from a saved alias.
eq2("resolve: Betty is \"buiten\" in Fresha", CF.resolveFreshaBranch("buiten", SALONS, { buiten: "Betty" }), "Betty");
eq2("resolve: Betty is not guessed without the alias", CF.resolveFreshaBranch("buiten", SALONS, {}), "");

/* Fresha still emits a row for a day the store was closed, with every figure
   zero. Betty (closed Sundays and Mondays) is the reason this matters: those
   rows must parse as a real zero day, not be mistaken for missing data. */
(() => {
  const closed = [
    '"Date","Gross sales","Discounts","Refunds / Returns","Net sales","Taxes","Total sales",'
      + '"Gift card sales","Service charges","Tips","Net other sales","Tax on other sales",'
      + '"Total other sales","Total sales + other sales","Sales paid in period","Unpaid sales in period",'
      + '"Card","Total payments","Payments for sales in period","Payments for sales in previous periods",'
      + '"Prepayments","Prepayment redemption","Gift card redemption","Total redemptions",'
      + '"Redemptions for sales in period","Redemptions for sales in previous periods"',
    '"30 Aug 2026","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0"',
    '"29 Aug 2026","3869.57","0","0","3869.57","580.43","4450","0","0","0","0","0","0","4450","4450","0","4450","4450","4450","0","0","0","0","0","0","0"'
  ].join("\n");
  const res = CF.parseFreshaFile(closed);
  if (!res.ok) { fail("closed-day file did not parse: " + res.error); return; }
  if (res.warnings.length) { fail("closed-day file warned: " + res.warnings.join(" | ")); return; }
  const zero = res.rows.find((r) => r.date === "2026-08-30");
  const open = res.rows.find((r) => r.date === "2026-08-29");
  if (zero && R(zero.total) === 0 && open && R(open.total) === 4450) pass("fresha: a closed day parses as a real zero, next to a trading day");
  else fail("fresha: closed-day handling wrong -> " + JSON.stringify({ zero: zero && zero.total, open: open && open.total }));
})();

/* Cash-up vs Fresha. */
const seaPoint = CF.parseFreshaFile(SAMPLES["Sea Point_2026-09-06.csv"]);
const fresha = seaPoint.rows.find((r) => r.date === "2026-09-02");   // the day Sea Point took R295 cash
// The cash-up a store SHOULD have submitted for that day, read gross of tips.
const grossCashupBase = {
  cash: fresha.cash, yoco: fresha.card, yoco_link: fresha.yoco_link,
  gift_card: fresha.gift_card, vouchers: fresha.gift_cards_sold, card_tips: fresha.tips
};
// The same day read NET of tips off the Yoco machine still reconciles.
const netCashup = Object.assign({}, grossCashupBase, { yoco: fresha.card - fresha.tips });
const mNet = CF.matchFreshaToCashup(netCashup, fresha, cfg);
if (mNet.status === "match") pass("match: Yoco read net of tips reconciles");
else fail("match: net-of-tips cash-up gave " + mNet.status + " — "
  + mNet.lines.filter((l) => !l.ok).map((l) => l.label + " " + l.delta).join(", "));
// So does one reading it gross.
const grossCashup = grossCashupBase;
if (CF.matchFreshaToCashup(grossCashup, fresha, cfg).status === "match") pass("match: Yoco read gross of tips reconciles");
else fail("match: gross-of-tips cash-up did not reconcile");
// Cash that Fresha saw but the store never declared is the case this exists for.
const cashOff = Object.assign({}, grossCashup, { cash: 0 });
const mCash = CF.matchFreshaToCashup(cashOff, fresha, cfg);
if (mCash.status === "cash" && R(mCash.cashDelta) === -295) pass("match: R295 of cash Fresha saw but the store didn't declare is flagged");
else fail("match: cash discrepancy not flagged (" + mCash.status + ", delta " + mCash.cashDelta + ")");
// 50c is inside the R1 tolerance.
if (CF.matchFreshaToCashup(Object.assign({}, grossCashup, { cash: fresha.cash + 0.5 }), fresha, cfg).status === "match")
  pass("match: 50c sits inside the R1 tolerance");
else fail("match: 50c broke the tolerance");
if (CF.matchFreshaToCashup(grossCashup, null, cfg).status === "none") pass("match: missing Fresha data says so");
else fail("match: missing Fresha data mishandled");

console.log(failed ? "\ncash-float check FAILED" : "\ncash-float check passed");
process.exit(failed ? 1 : 0);
