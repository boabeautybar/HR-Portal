#!/usr/bin/env node
// ── Call Centre & Sales classifier drift check ──────────────────────────────
// The CC&S classifier (who counts as Call Centre & Sales: employee code ends
// "-CC" OR role is MCC / CC / SALES) is hardcoded in FIVE bundles that ship
// together but can't share one function at runtime (three deploy roots + a
// Node one-shot):
//   • app.jsx                          isCallCentreStaff   — portal
//   • kiosk/data.js                    _staffIsCcSales     — kiosk key routing
//   • kiosk/staff-app.js               _hoIsCcSales        — kiosk dept views
//   • myboa/cycle.js                   isCcSales           — My BOA store map
//   • scripts/split-call-centre-sales.js  isCcSales        — migration
// Invariant: every copy must test the -CC code suffix AND all three roles
// (MCC, CC, SALES). If one copy drifts, a person classifies CC&S on one
// surface and Head Office on another — their attendance/schedule then splits
// across two store keys and the portal shows blank.
// Run after changing the rule anywhere:  node scripts/check-cc-classifier.js
// Exits non-zero on any drift so it can gate a deploy (precedent:
// scripts/check-shift-rules.js / check-store-lists.js).
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const SITES = [
  { file: "app.jsx", fn: "isCallCentreStaff" },
  { file: "kiosk/data.js", fn: "_staffIsCcSales" },
  { file: "kiosk/staff-app.js", fn: "_hoIsCcSales" },
  { file: "myboa/cycle.js", fn: "isCcSales" },
  { file: "scripts/split-call-centre-sales.js", fn: "isCcSales" }
];

// The rule every copy must encode.
const MUST_MATCH = [
  // A -CC suffix test: /-CC$/ regex or endsWith("-CC").
  { name: "-CC suffix test", re: /(-CC\$|endsWith\(\s*["']-CC["']\s*\))/ },
  { name: 'role "MCC"', re: /["']MCC["']/ },
  { name: 'role "SALES"', re: /["']SALES["']/ },
  { name: 'role "CC"', re: /[=(\s]\s*["']CC["']/ }           // bare "CC" comparison (not the -CC literal)
];

function extractFunction(src, fnName, file) {
  // Find `function <name>(` and slice to its balanced closing brace.
  const decl = src.indexOf("function " + fnName + "(");
  if (decl === -1) {
    console.error("✗ " + file + ": function " + fnName + " not found (renamed? update SITES in this checker)");
    process.exit(2);
  }
  const open = src.indexOf("{", decl);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(decl, i + 1); }
  }
  console.error("✗ " + file + ": could not balance braces for " + fnName);
  process.exit(2);
}

let drift = 0;
for (const site of SITES) {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, site.file), "utf8"); }
  catch (e) { console.error("✗ cannot read " + site.file + ": " + e.message); process.exit(2); }
  const body = extractFunction(src, site.fn, site.file);
  const missing = MUST_MATCH.filter(rule => !rule.re.test(body)).map(rule => rule.name);
  if (missing.length) {
    console.error("✗ " + site.file + " :: " + site.fn + " — missing " + missing.join(", "));
    drift++;
  }
}

if (drift) {
  console.error("\n✗ CC&S classifier drift in " + drift + " file(s) — the copies no longer encode the same rule.");
  process.exit(1);
}
console.log("✓ CC&S classifier consistent — all " + SITES.length + " copies test the -CC suffix + roles MCC/CC/SALES");
