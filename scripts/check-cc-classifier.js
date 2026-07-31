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

// ── CC_ROLES dropdown vocabulary must equal the classifier's role set ───────
// app.jsx's Office Staff modal builds its Call Centre & Sales role dropdown
// from `CC_ROLES`, and `isCcRole` derives from it — but the five classifier
// copies above hand-list the same keys. A key added to CC_ROLES alone would
// pass every function-body check while the dropdown offers a role the
// classifiers file under Head Office (roster/attendance/store keys disagree
// with the badge). Pin the array's keys to the canonical set so adding a role
// fails HERE, forcing all five copies (and this canonical list) to move
// together.
const CANONICAL_CC_ROLES = ["MCC", "CC", "SALES"];
{
  const src = fs.readFileSync(path.join(ROOT, "app.jsx"), "utf8");
  const start = src.indexOf("const CC_ROLES = [");
  if (start === -1) {
    console.error("✗ app.jsx: CC_ROLES array not found (renamed? update this checker)");
    process.exit(2);
  }
  const end = src.indexOf("];", start);
  const literal = src.slice(start, end);
  const keys = [...literal.matchAll(/key:\s*["']([^"']+)["']/g)].map(m => m[1]);
  const extra = keys.filter(k => !CANONICAL_CC_ROLES.includes(k));
  const missing = CANONICAL_CC_ROLES.filter(k => !keys.includes(k));
  if (extra.length || missing.length) {
    if (extra.length) console.error("✗ app.jsx :: CC_ROLES has keys the classifiers don't know: " + extra.join(", ") + " — add them to all " + SITES.length + " classifier copies AND to CANONICAL_CC_ROLES in this checker.");
    if (missing.length) console.error("✗ app.jsx :: CC_ROLES is missing canonical keys: " + missing.join(", "));
    drift++;
  }
}

// ── Head Office exception set must be identical AND consulted ────────────────
// Each classifier short-circuits to Head Office for codes on an explicit allow-
// list (CC_HO_EXCEPTION_ECS) — the escape hatch for a -CC code that belongs to
// Head Office (e.g. Jae Lee Naidoo, B477-CC / EPA). If one copy's set drifts, or
// a copy defines the set but forgets to consult it, that person classifies Head
// Office on one surface and CC&S on another — the exact split this checker
// exists to prevent. So: every copy must define the SAME set, and its classifier
// body must actually call CC_HO_EXCEPTION_ECS.has(...).
{
  const SET_RE = /CC_HO_EXCEPTION_ECS\s*=\s*new Set\(\s*(\[[^\]]*\])\s*\)/;
  const norm = (arr) => JSON.stringify([...arr].map(s => String(s).trim().toUpperCase()).sort());
  let canonical = null, canonicalFile = null;
  for (const site of SITES) {
    const src = fs.readFileSync(path.join(ROOT, site.file), "utf8");
    const m = src.match(SET_RE);
    if (!m) { console.error("✗ " + site.file + " :: CC_HO_EXCEPTION_ECS set not found — every classifier copy must define it"); drift++; continue; }
    let ecs;
    try { ecs = JSON.parse(m[1]); } catch (_) { console.error("✗ " + site.file + " :: CC_HO_EXCEPTION_ECS is not a parseable array literal"); drift++; continue; }
    const key = norm(ecs);
    if (canonical === null) { canonical = key; canonicalFile = site.file; }
    else if (key !== canonical) { console.error("✗ " + site.file + " :: CC_HO_EXCEPTION_ECS " + key + " ≠ " + canonicalFile + " " + canonical); drift++; }
    const body = extractFunction(src, site.fn, site.file);
    if (!/CC_HO_EXCEPTION_ECS\s*\.\s*has\s*\(/.test(body)) { console.error("✗ " + site.file + " :: " + site.fn + " defines CC_HO_EXCEPTION_ECS but never consults it"); drift++; }
  }
}

if (drift) {
  console.error("\n✗ CC&S classifier drift in " + drift + " place(s) — the copies no longer encode the same rule.");
  process.exit(1);
}
console.log("✓ CC&S classifier consistent — all " + SITES.length + " copies test the -CC suffix + roles MCC/CC/SALES, share the same Head Office exception set, and the CC_ROLES dropdown matches");
