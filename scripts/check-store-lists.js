#!/usr/bin/env node
// ── Store-list drift check (Phase 2.3) ──────────────────────────────────────
// The store name-list is hardcoded in three bundles that ship together but can't
// share one array at runtime (each carries per-store config the others don't):
//   • myboa/stores.js        window.BOA_STORES  — the My BOA registry (names)
//   • kiosk/config.js        BRANCHES           — names + PIN + geo
//   • app.jsx                SALONS             — WC seed only (+ capacity/region);
//                                                 the portal auto-detects the rest
//                                                 from the DB, so SALONS is a SUBSET
// Invariants:
//   1. BOA_STORES  ==  BRANCHES names           (same set, else a store is missing
//      from a My BOA picker or the kiosk roster)
//   2. SALONS      ⊆   BOA_STORES               (every seeded salon is a known store)
// Run after opening/renaming/closing a store:  node scripts/check-store-lists.js
// Exits non-zero on any drift so it can gate a deploy.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
  catch (e) { console.error("✗ cannot read " + rel + ": " + e.message); process.exit(2); }
}

// Grab the [...] block that follows `marker`, balancing brackets so nested
// objects/arrays don't end it early.
function sliceArray(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) { console.error("✗ marker not found: " + marker); process.exit(2); }
  const open = text.indexOf("[", i);
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    const ch = text[j];
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) return text.slice(open, j + 1); }
  }
  console.error("✗ unterminated array after: " + marker);
  process.exit(2);
}

// Object-array (kiosk BRANCHES / portal SALONS): pull every name: "..."
function names(block) { return (block.match(/name:\s*"([^"]+)"/g) || []).map(s => s.replace(/name:\s*"/, "").replace(/"$/, "")); }
// String-array (BOA_STORES): pull every "..."
function strings(block) { return (block.match(/"([^"]+)"/g) || []).map(s => s.slice(1, -1)); }

const boaStores = strings(sliceArray(read("myboa/stores.js"), "window.BOA_STORES ="));
const branches  = names(sliceArray(read("kiosk/config.js"), "BRANCHES = ["));
const salons    = names(sliceArray(read("app.jsx"), "SALONS = ["));

const setBoa = new Set(boaStores), setBr = new Set(branches), setSal = new Set(salons);
const diff = (a, b) => [...a].filter(x => !b.has(x));

let ok = true;
function report(label, missing) {
  if (missing.length) { ok = false; console.error("✗ " + label + ": " + missing.join(", ")); }
}

// 1. BOA_STORES == BRANCHES (both directions)
report("in kiosk BRANCHES but NOT My BOA stores.js", diff(setBr, setBoa));
report("in My BOA stores.js but NOT kiosk BRANCHES", diff(setBoa, setBr));
// 2. SALONS ⊆ BOA_STORES
report("in portal SALONS but NOT My BOA stores.js", diff(setSal, setBoa));

// Duplicate guard within BOA_STORES
const dupes = boaStores.filter((x, i) => boaStores.indexOf(x) !== i);
if (dupes.length) { ok = false; console.error("✗ duplicate in BOA_STORES: " + [...new Set(dupes)].join(", ")); }

if (ok) {
  console.log("✓ store lists consistent — BOA_STORES(" + boaStores.length + ") == BRANCHES(" + branches.length + "); SALONS(" + salons.length + ") ⊆ BOA_STORES");
  process.exit(0);
}
console.error("\nStore lists have drifted — reconcile the files above.");
process.exit(1);
