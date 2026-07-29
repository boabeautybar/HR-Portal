# Attendance −1h deductions — retroactive WM/WL re-labelling

**Date:** 2026-07-28 (structural fix landed 2026-07-29) · **Status:** structural freeze IMPLEMENTED at the publish path; immediate per-day pins + payroll reversal still to action
**Trigger:** B780M (Lindelwa Mkhize, Ballito AM) querying −1h deductions on 29 Jun, 1 Jul, 9 Jul.
**Scope:** manager early-leave deductions on the Attendance sheet at the six split-shift stores.

---

## 1 · Verdict

**Her claim is correct — at least for 29 June, provably from the clock data.** The −1h is charged
against a shift she was **never on**. The manager shift labels WM/WL are re-derived, not stored, and
they were re-labelled on a re-publish **after she had already worked and clocked the day** — so the
deduction is measured against the wrong shift end.

This is not a data-entry error and not her leaving early. It is the last unbaked payroll re-deriver
(`§1.1a`, explicitly deferred in `schedule-consistency-plan.md`).

---

## 2 · The 29 June proof

Ballito AM hours (`shift-rules.js:94-96`, SM present): **WE 08:00–17:00 · WM 09:00–18:00 · WL 10:00–19:00.**

| Manager | Current label | That end | Actual clock | Actually worked |
|---|---|---|---|---|
| Kiveshni **B779M** | WM (09:00–18:00) | 18:00 | **OUT 19:07** | a **WL** (closed the store) |
| Lindelwa **B780M** | WL (10:00–19:00) | 19:00 | **IN 08:49 · OUT 18:09** | a **WM** (mid shift) |

The two AMs' WM/WL are **swapped** versus what they physically worked:

- An 08:49 clock-**in** is 71 min *before* a 10:00 WL start — nobody opens 71 min early. It fits WM.
- Judged against WL's 19:00 end, her 18:09 out is 51 min short → rounds to **−1h**
  (`_mgrEarlyHoursFor`, `app.jsx:32059-32062`).
- Judged against WM's 18:00 end (what she worked), 18:09 is a 9-min overrun → **no deduction**.
- Kiveshni's 19:07 out is the corroboration: **she** was the genuine WL that day.

1 July and 9 July can't be verdicted from screenshots — they need the clock-outs + version history
(§5). Her current My BOA showing WL for 1 Jul is **not** evidence of what she worked: My BOA has no
auto-refresh and renders the *latest* re-derived labels, not what she saw the morning of the shift.

---

## 3 · Mechanism (confirmed in code)

Three facts compose the bug:

1. **Labels are re-derived, not stored.** `applyBallitoShifts` (`app.jsx:2120`) assigns WM to the AM
   with the lowest **cycle-cumulative** `_middleCount`, tie-broken by EC ascending (B779M wins ties).
   That counter depends on **every prior day in the cycle**.
2. **Every publish re-derives the whole cycle, including elapsed days.** `saveMgrFinalVersion`
   deep-copies the entire grid and runs `_applyBranchShiftRules` over all `result.dates`
   (`app.jsx:37672-37683`); each working cell is reset to `W` and re-assigned (`app.jsx:2028-2029`).
   There is **no calendar-today guard** — only day-of-*week*. So any change at or before a past day
   (an OFF/REQ/leave/extra-day edit, a `regenerateOneMgr` that moves another row's off-days, a
   roster add/remove) shifts the counter trajectory and **flips a later, already-worked day's WM↔WL**
   for any **unpinned** cell. Pinned cells survive (`_applyShiftPins`, `app.jsx:36886-36900`).
3. **The deduction reads the *current* label.** The Attendance sheet loads `published[0]`
   (`_loadMgrSchedResolved`, `app.jsx:20198-20202`) and `_mgrEarlyHoursFor` derives the end from
   `attSched[ec][d]` via `shiftTimes` (`app.jsx:32045,32056`). When the label flipped WM→WL
   retroactively, the dock is against the new (wrong) 19:00 end.

Net: **the schedule you worked is not the schedule you're paid against**, whenever the cycle was
re-published after the day and your cell wasn't pinned.

---

## 4 · Is anything stored? (remediation-shaping)

**No — for salon managers the deduction is purely render-time.** `_mgrEarlyHoursFor` has no write
path; it only reads clock-outs + the current label (`app.jsx:32034-32063`). Correcting the label (or
re-publishing correctly) **self-corrects** the attendance cell, the totals, the single-store CSV and
the all-stores CSV on next render. No sidecar to scrub.

Two caveats:

- **Clock-out look-back window** (`mgrClockinDays`, ~31 days, `app.jsx:32066`): once a day ages out of
  the window, `outTs` is absent → the live path can't re-derive and falls back to `attEarly`, which is
  empty for managers → the deduction shows **0** (blank, not wrong). Today is 2026-07-28, so 29 Jun is
  ~29 days back — **still inside the window, correctable now**, but not for much longer.
- **Overtime tab** reads the stored `boa_early_<branch>_<ym>` sidecar (`app.jsx:35462-35488`), which is
  empty for salon managers (nothing writes it), so it isn't the source of the −1h and doesn't need
  scrubbing. The −1h lives on the **Attendance** sheet (live).

---

## 5 · The payroll corrections table (pinpoints ALL affected AMs, all days)

Every AM at the six split-shift stores (**Sandown, Table Bay, Riverlands, Ballito, Mall of the South,
Fourways**) is exposed on any unpinned day the cycle was re-published after being worked. To find them
all — not just B780M or the three complaint dates — audit **clock-out vs the current label** for every
manager working-day in the cycle. This catches every wrong deduction *regardless of version-history
retention*, because the clock-out is ground truth for which shift was actually worked.

**Two-step pipeline (validated against the 29 June case):**

1. Run **`docs/relabel-audit-dump.sql`** in the Supabase SQL editor (read-only). It emits one row per
   manager working-day at the split stores this cycle: `branch, ec, name, role, ymd, label, custom,
   clock_in, clock_out`. Export the grid as **CSV**.
2. Feed the CSV to the auditor: **`node docs/relabel-audit.js <dump.csv>`**. It loads the authoritative
   `shift-rules.js` (no re-implementation of the hour rules) and, per row, replays the exact deduction
   (`_mgrEarlyHoursFor`, `app.jsx:32059`) then classifies:
   - **WRONG DEDUCTION — relabel `X→Y`**: the clock-out completed an *earlier* valid shift `Y`; the
     current label `X` over-charges. Correction = pin `Y`, deduction → 0.
   - **GENUINE EARLY LEAVE — deduction stands (review)**: clock-out is before *every* valid shift end.
   - **CUSTOM HOURS / ok / mislabel-no-$-impact**: no correction needed.

   Running it with no argument replays the built-in validation set (the real 29 Jun B780M/B779M rows +
   synthetic edges) and asserts the classifier — a self-test before you trust a real run.

The **payroll-officer table** is the "WRONG DEDUCTION" section of that output — columns: Branch ·
Manager · EC · Date · In · Out · Docked now · Should be · Was labelled · Correct · Verdict, plus a
total "hours wrongly docked (reversible)". Hand that to payroll as the record of corrections.

Caveats the auditor already handles or flags: custom hours (`boa_mgr_times_v1`) are treated as stable
(never a relabel); a blank `role` in the dump is flagged (hours need SM vs AM); SM-trial AMs (measured
as SM in `_mgrEarlyHoursFor`) aren't known to the SQL — verify any AM whose store opener label looks
off. Loan-out days are excluded (the manager clocked at another store).

## 5a · Forensic root-cause dater (optional) — version timeline

`§5` says *who* to correct; this says *when and why* it flipped — for the note to payroll on root cause.
The snapshot keeps up to 25 timestamped versions (`data.js:434-458`, `savedAt` = publish time), so the
flip is datable. A cell reading WM in an earlier version and WL in the live one **is** the retroactive
flip.

```sql
with snap as (
  select value from app_state
  where key = 'boa_mgrschedapproved_Ballito_2026-06'          -- cycle 25 Jun→24 Jul
),
ver as (
  select ord,
         elem->>'savedAt' as published_at,
         coalesce(elem->>'approvedBy', elem->>'savedBy', elem->>'madeBy') as by_whom,
         elem->'grid' as grid
  from snap, lateral jsonb_array_elements(value) with ordinality as t(elem, ord)
)
select v.ord as ver_idx,                          -- 1 = live (newest)
       v.published_at, v.by_whom, gk.key as ec_key,
       gk.value->>'2026-06-29' as "29 Jun",
       gk.value->>'2026-07-01' as "01 Jul",
       gk.value->>'2026-07-09' as "09 Jul"
from ver v, lateral jsonb_each(v.grid) as gk(key, value)
where upper(regexp_replace(gk.key, '[^A-Za-z0-9]', '', 'g')) in ('B779M','B780M')
order by v.published_at nulls last, ec_key;
```

Look for a version `published_at` ~15 Jul whose labels differ from the version before it (the
consistency-baking re-publish hypothesis, §6). Swap the key/ECs/dates to date any other flag from §5.

---

## 6 · Did our recent work cause this?

**No — the fragility predates all of it.** Our commits this period (loan-vs-transfer, not-onboarding,
office staff) don't touch the labeller and don't re-publish manager schedules.

But the bug only *fires* when the cycle is re-published mid-month, and the consistency rollout is the
most likely trigger: the plan notes baking "finishes with the next cycle publish (~15th)" — a publish
around **15 Jul would have re-derived every store's 25 Jun–14 Jul labels**, which brackets both 29 Jun
and 1 Jul. **D1's `published_at` timeline will confirm or refute this**: look for a version saved
~15 Jul whose labels differ from the version live before it. I'm stating this as the hypothesis to
test, not a conclusion.

---

## 7 · Remediation

### Immediate (this pay period — no code)
For **every "WRONG DEDUCTION" row** the §5 audit produces, **pin the `Correct` label** (Manager
Coverage cell editor → set WE/WM/WL; pins are `boa_mgr_shift_pins_v1`). Pins survive re-derivation
(`app.jsx:36886-36900`) and the deduction **self-corrects on next Attendance render** (§4) — no data
scrub. Confirmed first case: **B780M 29 Jun → WM** (and B779M's WM→WL is the harmless mirror). Do it
while the days are still inside the ~31-day clock-out window (§4), then re-open the Attendance sheet to
confirm the −hours cleared. The audit's total "hours wrongly docked" is the figure to reconcile with
payroll.

### Early-warning — dashboard "Manager hours docked" alert · ✅ IMPLEMENTED 2026-07-29
A National-Ops + payroll dashboard card (just below "Office hours need a look") that scans **every
elapsed day of the open pay cycle** across all stores for any SM/AM docked minus hours, and classifies
each from the **clock-in**: a **mislabel** (charged against a shift the clock-in shows they never
worked → fixable by pinning the shown `correctedCode`) vs a **genuine early leave** (deduction stands)
vs **unclear** (no clock-in). This is the June bug caught *live* instead of a cycle later. Self-clears
as each day is pinned/corrected (deduction → 0). Reuses the validated `docs/relabel-audit.js` thresholds
(START_MARGIN 20 / MAXGAP 90) in a shared module helper `classifyMgrEarly` (with `mgrShiftCandidates` /
`mgrEarlyLeaveHours`), plus a `mgrEarlyAlert` memo and a `canSeeMgrHours` gate. Reads the data the
dashboard already loads (`mgrClockinRows` + `mgrApprovedFallbackCache`); the loan/custom-times loader
was extended to also run on `tab === "dashboard"` so custom-hours days aren't over-reported and loan-out
days are excluded. Validated: 10/10 classifier asserts extracted live from `app.jsx` + full transpile.
Known minor: on first dashboard paint, custom-times load async, so a custom-hours row can flash for one
render before clearing; the scan is current-cycle only (the June cleanup is the separate corrections CSV);
today itself isn't scanned (fires next-day by design).

### Structural (prevent recurrence) — freeze elapsed days at publish · ✅ IMPLEMENTED 2026-07-29
In `saveMgrFinalVersion` the single `_applyBranchShiftRules(_approvedGrid, …)` call was split into
**derive → freeze → pins** (`app.jsx:37683-37733`):
1. `applyBranchShiftRules(...)` derives fresh WE/WM/WL across the whole cycle (unchanged);
2. an elapsed-day **freeze** IIFE loads the current `published[0]` once and, for every date **strictly
   before today** whose cell is still working, carries forward the concrete variant the last publish
   already committed — only today-onward is re-derived;
3. `_applyShiftPins(...)` runs LAST, so a deliberate pin still beats the freeze.

Because the baked hours (`_bakeSnapshotHours`) derive from the grid label, freezing the label freezes
the hours too — no separate hours carry-forward needed. The publish-diff dialog now also loads that
same prior snapshot, so elapsed days correctly show **no change**. First publish (no prior snapshot) is
a clean no-op. Validated: 13/13 freeze-logic assertions (incl. the real 29-Jun B780M/B779M restore) +
a full `@babel/standalone@7.24.8` react-preset transpile of `app.jsx`.

**Scope caveat (known, not yet closed):** the freeze is at the **persist** path only. Two ADMIN
*display* surfaces still re-derive past-day labels on render — the schedule editor tab
(`app.jsx:36910`, `37021`) and Manager Coverage's label cache `_buildCovLabels` (`app.jsx:41247`,
which reads the frozen `published[0]` via `readWithFallback` but then resets working cells to `W` and
re-derives). Payroll/My BOA/kiosk read the frozen archive + baked hours directly and are correct; only
these two internal grids can *visually* disagree with payroll on an unpinned past day. Closing it =
make those two paths read-through the frozen published variant for elapsed days (same pattern), or just
pin the affected days (a pin reconciles all surfaces at once).

Alternative (heavier, less complete): make `_mgrEarlyHoursFor` resolve the label from the snapshot
**version whose `savedAt` was in force at end-of-day** rather than `[0]`. More faithful to "what she
saw" but only fixes the deduction (not My BOA/kiosk), and old versions age out at the 25-version cap.

Closing `§1.1a` (baking the resolved manager hours the deduction reads, instead of re-deriving) is the
same fix from the payroll side and should land with the freeze.

---

*Sources: live-tree trace at working commit; `_mgrEarlyHoursFor` (app.jsx:32034), `applyBallitoShifts`
(app.jsx:2120), publish path (app.jsx:37672-37683), pin overlay (app.jsx:36886-36900), snapshot store
(data.js:434-461), attendance load (app.jsx:20198-20202). Clock data from the 29 Jun kiosk check-ins
screenshot. Deduction-persistence and publish-rebake paths each independently traced.*
