#!/usr/bin/env node
// Relabel / early-leave audit — payroll corrections table.
// Uses the AUTHORITATIVE shift-rules.js (no reimplementation) to decide, per
// manager clock-out, whether the −hours currently docked is a REAL early leave
// or an artefact of a WM/WL label that flipped after the shift was worked.
//
//   node relabel-audit.js            # runs the built-in validation set
//   node relabel-audit.js dump.csv   # processes a real Supabase dump
//
// Dump CSV columns (header row required, any order):
//   branch, ec, name, role, ymd, label, custom, clock_in, clock_out
//   - label     : the CURRENT published[0] code (WE/WM/WL/WB)
//   - custom    : "HH:MM - HH:MM" from boa_mgr_times_v1 for that ec+ymd, or blank
//   - clock_in  : local "HH:MM" (earliest IN) or blank
//   - clock_out : local "HH:MM" (latest OUT) or blank
const fs = require("fs");
const path = require("path");

// ── Load the real shift-rules.js by shimming `window` ───────────────────────
function loadShiftRules() {
  const candidates = [
    path.resolve(__dirname, "../../../../../..", "Documents/Web Development Projects/Antigravity/HR-Portal-Employee-Data-Library/shift-rules.js"),
    "/Users/curtleykennedy/Documents/Web Development Projects/Antigravity/HR-Portal-Employee-Data-Library/shift-rules.js",
  ];
  const file = candidates.find(f => { try { return fs.existsSync(f); } catch { return false; } });
  if (!file) throw new Error("shift-rules.js not found");
  const src = fs.readFileSync(file, "utf8");
  const sandbox = { window: {} };
  new Function("window", src)(sandbox.window);
  if (!sandbox.window.BOA_SHIFT || !sandbox.window.BOA_SHIFT.times) throw new Error("BOA_SHIFT.times missing");
  return sandbox.window.BOA_SHIFT;
}
const BOA_SHIFT = loadShiftRules();
const SPLIT = BOA_SHIFT.SPLIT_SHIFT_STORES;
const CODES = ["WE", "WM", "WL", "WB"];
const GRACE = 20;                       // _MGR_EARLY_GRACE_MIN (app.jsx:32033)

const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim()); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const endMin = (range) => { const m = /-\s*(\d{1,2}:\d{2})\s*$/.exec(String(range || "")); return m ? toMin(m[1]) : null; };
const startMin = (range) => { const m = /^\s*(\d{1,2}:\d{2})/.exec(String(range || "")); return m ? toMin(m[1]) : null; };
const fmtMin = (mn) => mn == null ? "?" : String(Math.floor(mn / 60)).padStart(2, "0") + ":" + String(mn % 60).padStart(2, "0");

// Deduction exactly as _mgrEarlyHoursFor (app.jsx:32059-32062).
function dock(schedEndMin, outMin) {
  if (schedEndMin == null || outMin == null) return 0;
  const shortMin = schedEndMin - outMin;
  if (shortMin <= GRACE) return 0;
  return Math.min(12, Math.round((shortMin / 60) * 2) / 2);
}

// dow from "YYYY-MM-DD" (0=Sun..6=Sat), UTC-safe (date-only).
function dowOf(ymd) { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }

// Distinct shift windows for a store/role/dow, as {code,start,end}. First code
// that produces a given window keeps the name (any is a valid pin target).
function candidates(role, branch, dow) {
  const seen = {}, out = [];
  for (const c of CODES) {
    const rng = BOA_SHIFT.times(role, c, branch, dow);
    const s = startMin(rng), e = endMin(rng);
    if (s == null || e == null) continue;
    const k = s + "-" + e;
    if (!seen[k]) { seen[k] = true; out.push({ code: c, start: s, end: e }); }
  }
  return out;
}
const START_MARGIN = 20;   // worked shift must be ≥20 min closer to the clock-IN than the label is
const START_MAXGAP = 90;   // clock-IN further than this from every start → irregular, don't infer

function processRow(r) {
  const branch = r.branch, role = r.role || "AM", ymd = r.ymd, label = String(r.label || "").toUpperCase();
  const dow = dowOf(ymd);
  const outMin = toMin(r.clock_out);
  const inMin = toMin(r.clock_in);
  const out = { ...r, dow, _in: inMin, _out: outMin };

  if (!CODES.includes(label)) { out.verdict = "not a split working code"; out.dock_now = 0; return out; }

  // Current label's end (custom hours override and are STABLE — never a relabel).
  const custom = String(r.custom || "").trim();
  const curEnd = custom ? endMin(custom) : endMin(BOA_SHIFT.times(role, label, branch, dow));
  out.end_now = curEnd;
  out.dock_now = outMin == null ? null : dock(curEnd, outMin);

  if (outMin == null) { out.verdict = "NO CLOCK-OUT — unverifiable"; out.correct_label = label; out.dock_fixed = null; return out; }
  if (custom) { out.correct_label = label; out.dock_fixed = out.dock_now; out.verdict = out.dock_now > 0 ? "CUSTOM HOURS — genuine short (stable)" : "CUSTOM HOURS — ok"; return out; }

  // Identify the shift the manager actually WORKED from the clock-IN (which
  // shift they showed up for) — start times are distinct; a clock-OUT can be a
  // real early leave and mustn't, by itself, re-attribute the shift. Only
  // override the label when the clock-in is CLEARLY (≥START_MARGIN) closer to a
  // different shift's start — otherwise trust the label (conservative: never
  // reverse a deduction without clear evidence).
  const cand = candidates(role, branch, dow);
  const byCode = {}; cand.forEach(c => { byCode[c.code] = c; });
  const labelCand = byCode[label] || cand.find(c => c.end === curEnd) || null;
  let worked = labelCand;
  if (inMin != null && cand.length > 1) {
    const nearest = cand.slice().sort((a, b) => Math.abs(inMin - a.start) - Math.abs(inMin - b.start))[0];
    const nearestGap = Math.abs(inMin - nearest.start);
    const labelGap = labelCand ? Math.abs(inMin - labelCand.start) : Infinity;
    if (nearestGap <= START_MAXGAP && nearest.code !== (labelCand && labelCand.code) && labelGap - nearestGap >= START_MARGIN) {
      worked = nearest;                     // clock-in clearly points at a different shift
    } else if (!labelCand && nearestGap <= START_MAXGAP) {
      worked = nearest;
    }
  }
  out._worked = worked ? worked.code : null;

  if (!worked) { out.correct_label = label; out.dock_fixed = out.dock_now; out.verdict = out.dock_now > 0 ? "IRREGULAR clock-in — review" : "ok"; return out; }

  out.dock_fixed = dock(worked.end, outMin);
  out.correct_label = worked.code;

  if (worked.code === label) {
    out.verdict = out.dock_now > 0 ? "GENUINE EARLY LEAVE — deduction stands (review)" : "ok";
  } else if (out.dock_now > 0 && out.dock_fixed < out.dock_now) {
    out.verdict = "WRONG DEDUCTION — relabel " + label + "→" + worked.code;
  } else if (out.dock_now === 0) {
    out.verdict = "mislabel, no $ impact (worked " + worked.code + ")";
  } else {
    out.verdict = "mislabel — review (dock unchanged)";
  }
  return out;
}

function report(rows) {
  const res = rows.map(processRow);
  const corrections = res.filter(r => r.verdict && r.verdict.startsWith("WRONG DEDUCTION"));
  const genuine = res.filter(r => r.verdict && r.verdict.startsWith("GENUINE"));
  const swaps = res.filter(r => r.verdict && r.verdict.startsWith("mislabel"));

  const H = ["Branch", "Manager", "EC", "Date", "In", "Out", "Docked (now)", "Should be", "Was labelled", "Correct", "Verdict"];
  const line = (r) => [r.branch, r.name || "", r.ec, r.ymd, r.clock_in || "—", r.clock_out || "—",
    r.dock_now == null ? "?" : ("−" + r.dock_now + "h"), r.dock_fixed == null ? "?" : ("−" + r.dock_fixed + "h"),
    r.label, r.correct_label || r.label, r.verdict].join(" | ");
  console.log("\n### Payroll corrections — WRONG deductions to reverse (" + corrections.length + ")\n");
  console.log("| " + H.join(" | ") + " |");
  console.log("|" + H.map(() => "---").join("|") + "|");
  corrections.forEach(r => console.log("| " + line(r) + " |"));
  if (genuine.length) {
    console.log("\n### Genuine early leaves — deduction stands, for review (" + genuine.length + ")\n");
    console.log("| " + H.join(" | ") + " |");
    console.log("|" + H.map(() => "---").join("|") + "|");
    genuine.forEach(r => console.log("| " + line(r) + " |"));
  }
  if (swaps.length) console.log("\n### Mislabels with no payroll impact (context only): " + swaps.length);
  console.log("\nTotal hours wrongly docked (reversible): " +
    corrections.reduce((s, r) => s + (r.dock_now - r.dock_fixed), 0) + "h across " + corrections.length + " day(s).");
  return res;
}

// ── Validation set — the 29 June case + synthetic edge cases ────────────────
const VALIDATION = [
  // Real case (Ballito, Mon 29 Jun 2026). B780M docked against WL; clock-in 08:49 → worked WM.
  { branch: "Ballito", ec: "B780M", name: "Lindelwa Mkhize", role: "AM", ymd: "2026-06-29", label: "WL", custom: "", clock_in: "08:49", clock_out: "18:09" },
  // B779M labelled WM, clocked in 09:55 (→WL) and closed 19:07 — overran, mislabel only, no $.
  { branch: "Ballito", ec: "B779M", name: "Kiveshni Govender", role: "AM", ymd: "2026-06-29", label: "WM", custom: "", clock_in: "09:55", clock_out: "19:07" },
  // Borderline: labelled WM, clock-in 08:53 CONFIRMS WM, left 17:39 = 21min early → GENUINE 0.5h
  // (the clock-out alone would have wrongly "relabelled" this to WE and zeroed it).
  { branch: "Sandown", ec: "B354M", name: "Thina Mathupha", role: "AM", ymd: "2026-06-30", label: "WM", custom: "", clock_in: "08:53", clock_out: "17:39" },
  // Synthetic: genuine early leave — WL, in 10:00 confirms WL, out 15:30 before any end.
  { branch: "Ballito", ec: "B999M", name: "Test Genuine", role: "AM", ymd: "2026-06-29", label: "WL", custom: "", clock_in: "10:00", clock_out: "15:30" },
  // Synthetic: custom hours 10:00-16:00, out 16:05 → ok, stable (no relabel).
  { branch: "Ballito", ec: "B998M", name: "Test Custom", role: "AM", ymd: "2026-06-29", label: "WL", custom: "10:00 - 16:00", clock_in: "10:00", clock_out: "16:05" },
  // Synthetic: SM labelled WE (08:00-17:00), out 17:03 → ok.
  { branch: "Ballito", ec: "B785M", name: "Bongiwe Nxumalo", role: "SM", ymd: "2026-06-29", label: "WE", custom: "", clock_in: "08:01", clock_out: "17:03" },
];

function parseCsv(txt) {
  const lines = txt.split(/\r?\n/).filter(l => l.trim());
  const head = lines[0].split(",").map(s => s.trim().toLowerCase());
  return lines.slice(1).map(l => {
    // naive CSV (no embedded commas in these columns)
    const cells = l.split(",");
    const o = {}; head.forEach((h, i) => o[h] = (cells[i] || "").trim());
    return o;
  });
}

const arg = process.argv[2];
if (arg) {
  const rows = parseCsv(fs.readFileSync(arg, "utf8"));
  console.log("Processing " + rows.length + " rows from " + arg);
  report(rows);
} else {
  console.log("VALIDATION RUN (built-in 29 June case + synthetic edges)");
  const res = report(VALIDATION);
  // Assertions
  const byEc = {}; res.forEach(r => byEc[r.ec] = r);
  const check = (ec, field, want) => {
    const got = byEc[ec][field];
    console.log((JSON.stringify(got) === JSON.stringify(want) ? "  ok  " : "FAIL ") + ec + "." + field + " = " + JSON.stringify(got) + (JSON.stringify(got) === JSON.stringify(want) ? "" : " (want " + JSON.stringify(want) + ")"));
  };
  console.log("\nAssertions:");
  check("B780M", "dock_now", 1);            // docked −1h now
  check("B780M", "dock_fixed", 0);          // should be 0
  check("B780M", "correct_label", "WM");    // relabel to WM
  check("B780M", "verdict", "WRONG DEDUCTION — relabel WL→WM");
  check("B779M", "dock_now", 0);            // overran, never docked
  check("B779M", "correct_label", "WL");    // clock-in 09:55 → worked WL
  check("B354M", "dock_now", 0.5);          // WM 18:00 − 17:39 = 21min → 0.5h
  check("B354M", "correct_label", "WM");    // clock-in CONFIRMS WM (not relabelled)
  check("B354M", "verdict", "GENUINE EARLY LEAVE — deduction stands (review)");
  check("B999M", "dock_now", 3.5);          // WL 19:00 − 15:30 = 210min = 3.5h
  check("B999M", "verdict", "GENUINE EARLY LEAVE — deduction stands (review)");
  check("B998M", "dock_now", 0);            // custom 16:00 vs out 16:05
  check("B785M", "dock_now", 0);            // SM WE met
}
