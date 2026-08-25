#!/usr/bin/env node
/* Invariant check: the three shift-rules.js mirror copies are byte-identical.
 *
 * The portal, kiosk, and My BOA deploy as SEPARATE Netlify sites whose
 * publish roots are the repo root, kiosk/, and myboa/ — a page cannot load
 * a script from above its site root, so shift-rules.js is mirrored into
 * each site. This gate makes any drift loud: edit one copy, copy it over
 * the other two, and this passes again.
 *
 * Run:  node scripts/check-shift-rules.js   (exit 0 = in sync, 1 = drift)
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const COPIES = [
  "shift-rules.js",
  path.join("kiosk", "shift-rules.js"),
  path.join("myboa", "shift-rules.js"),
];

// Same deal for the incident taxonomy: the portal and the My BOA report form
// are separate sites that must agree on what a category means, so the file is
// mirrored and drift is a build failure rather than a mystery in the reports.
const TAXONOMY_COPIES = [
  "incident-taxonomy.js",
  path.join("myboa", "incident-taxonomy.js"),
];

let failed = false;

const bufs = COPIES.map((rel) => {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.error("✗ missing mirror: " + rel);
    failed = true;
    return null;
  }
  return fs.readFileSync(p);
});

if (!failed) {
  const canonical = bufs[0];
  for (let i = 1; i < COPIES.length; i++) {
    if (!canonical.equals(bufs[i])) {
      console.error("✗ " + COPIES[i] + " differs from " + COPIES[0]);
      // Point at the first differing line to make the fix obvious.
      const a = canonical.toString("utf8").split("\n");
      const b = bufs[i].toString("utf8").split("\n");
      for (let ln = 0; ln < Math.max(a.length, b.length); ln++) {
        if (a[ln] !== b[ln]) {
          console.error("  first difference at line " + (ln + 1) + ":");
          console.error("    " + COPIES[0] + ": " + (a[ln] === undefined ? "<EOF>" : a[ln]));
          console.error("    " + COPIES[i] + ": " + (b[ln] === undefined ? "<EOF>" : b[ln]));
          break;
        }
      }
      failed = true;
    }
  }
}

if (failed) {
  console.error("\nFix: pick the intended version and copy it over the others, e.g.");
  console.error("  cp shift-rules.js kiosk/shift-rules.js && cp shift-rules.js myboa/shift-rules.js");
  process.exit(1);
}

console.log("✓ shift-rules mirrors in sync — " + COPIES.join(" == "));

// ---- incident-taxonomy mirrors --------------------------------------------
const taxBufs = TAXONOMY_COPIES.map((rel) => {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) { console.error("✗ missing mirror: " + rel); process.exit(1); }
  return fs.readFileSync(p);
});
for (let i = 1; i < TAXONOMY_COPIES.length; i++) {
  if (!taxBufs[0].equals(taxBufs[i])) {
    console.error("✗ " + TAXONOMY_COPIES[i] + " differs from " + TAXONOMY_COPIES[0]);
    console.error("\nFix:  cp incident-taxonomy.js myboa/incident-taxonomy.js");
    process.exit(1);
  }
}
console.log("✓ incident-taxonomy mirrors in sync — " + TAXONOMY_COPIES.join(" == "));
