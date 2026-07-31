# Manager auto-outs stamped with the wrong branch (cross-kiosk)

**Date:** 2026-07-29 · **Status:** investigation complete; fix planned, not yet applied
**Trigger:** Manager Check-ins showing AUTO-OUT cards under a store's group whose branch label is a
*different* store (e.g. a "Durbanville" auto-out inside the Sea Point group), plus duplicate auto-outs.
**Scope:** the kiosk manager auto-clock-out routine and the clock-in `branch` it writes.

---

## 1 · Verdict

**The auto-out records carry the wrong branch, and some managers get duplicates.** Two bugs compound:

1. **Every kiosk runs a *global* auto-out sweep** over all branches' manager clock-ins, so a kiosk at
   store A auto-clocks-out managers who worked at stores B, C, …
2. **The auto-out is stamped with the kiosk device's own branch**, not the manager's — so store A's
   sweep writes store-A-branch auto-outs for B's and C's managers.

Because the Check-ins tab **groups by the manager's home branch** but **labels each card with the
record's branch**, the mismatch is visible: a foreign-branch auto-out lands under the correct home
group but reads as the wrong store. This is not display-only — the auto-out timestamp is the clock-OUT
the attendance early-leave deduction reads, so a bogus 18:30 stamp pollutes payroll data.

---

## 2 · What the screenshot shows

Under **Sea Point · 5 clock-ins**: `Michelle Nandi Pamla (B995M) · Durbanville · AUTO-OUT · 18:30`.
Under **Bree · 9 clock-ins**: `Chante Harrison (B798M)` with **two** auto-outs — one `Sea Point`, one
`Durbanville` — plus `Suaad Parenzee (B818M) · Durbanville · AUTO-OUT`. Every auto-out is 28 Jul 18:30,
no photo, "Forgot to clock out". `Durbanville` recurs for managers of *three* different stores.

- **Grouping** is by the manager's home branch: `_mgrBranchOf = (r) => (r.staff && r.staff.branch) || r.branch`
  (`app.jsx:40485`). Michelle *is* a Sea Point manager → she's grouped under Sea Point. Correct.
- **The card sub-label** shows the *record's* branch first: `{ec} · {r.branch || r.staff.branch}`
  (`app.jsx:41060`). Her auto-out's `r.branch` is "Durbanville" → shown as Durbanville. Wrong.

For a normal clock-in `r.branch === r.staff.branch`, so the two always agreed and nobody noticed.

---

## 3 · Mechanism (confirmed in code)

**a. The sweep is global.** Opening the Manager Clock-in screen runs `ensureAutoOuts(recent, …)`
(`kiosk/manager-app.js:2080`) where `recent = listRecentManagerClockins(2)` — a `clockins` query with
**no branch filter** (`kiosk/data.js:2110-2113`; only an optional `mgrIds` filter, not passed here). So
`recent` is every branch's manager clock-ins for the last 2 days. The sweep creates an auto-out for
**any** manager whose latest row that day is an unclosed "in" (`kiosk/manager-app.js:1793-1837`),
regardless of which store they belong to.

**b. The record gets the kiosk's branch.** The write is
`addManagerClockinWithMeta(last.staff_id, "out_auto", { tsOverride: endIso, flags:["auto_clockout"] })`
(`kiosk/manager-app.js:1832`) — **no branch passed**. Inside, every clock row is built as
`{ staff_id, branch: branch(), type }` (`kiosk/data.js:2144`), and `branch()` returns
`cfg.branchName` — the physical kiosk device's store (`kiosk/data.js:71`). An existing comment already
flags this: *"addManagerClockinWithMeta hardcodes `branch: branch()`"* (`data.js:1393`). So the
Durbanville kiosk's auto-out for a Sea Point manager is saved `branch: "Durbanville"`.

Net: **any kiosk that anyone opens auto-clocks-out every still-open manager across the whole company,
stamping them all with that kiosk's store.**

---

## 4 · Why 18:30, and why duplicates

- **All at 18:30.** Auto-outing an *out-of-branch* manager, the kiosk can't resolve that manager's
  shift end — `mgrByEc` and `schedByEcYmd` only hold *this* kiosk's branch (`kiosk/manager-app.js:2040-2072`).
  So `schedEnd` is null and it falls back to the **legacy 18:30 hard cutoff** (`:1822-1826`). Every
  foreign auto-out is therefore stamped 18:30, not the manager's real scheduled end.
- **Duplicates** (Chante: Sea Point + Durbanville). The de-dup only skips a manager whose latest row is
  *already* `out_auto` (`:1797`). Multiple kiosks load `recent` independently and near-simultaneously;
  each still sees the manager as "in" and each writes its own auto-out at its own branch. A cross-kiosk
  **race with no coordination**. The same race explains a stray auto-out for a manager who *did* clock
  out manually (Michelle): a second kiosk read `recent` before her manual "out" was visible.

---

## 5 · Impact

- **Display / trust** (the reported symptom): confusing wrong-branch cards + duplicate AUTO-OUTs.
- **Payroll clock-out data** (ties into the shift-relabel work, `docs/attendance-shift-relabel-investigation.md`):
  the auto-out **timestamp is the manager's clock-OUT** that `_mgrEarlyHoursFor` reads. A foreign kiosk
  stamps **18:30 (a guess)** instead of the real scheduled end. Attendance takes the *latest* out
  timestamp, so a correct home auto-out usually wins — but where a manager's real end is *before* 18:30
  (e.g. WE 17:00), a stray 18:30 auto-out makes them look like they stayed later (masking a real early
  leave / overstating hours); and if only the foreign 18:30 record exists, the clock-out time is just
  wrong.
- **Per-branch counts / scanners** that key on `r.branch` mis-attribute these to the wrong store.

---

## 6 · Remediation

### Recommended — kiosk-scoped fix (two changes)
The correct branch for an auto-out is **the branch of the clock-IN it is closing** (`last.branch`) — the
store the manager actually worked that day (this also handles a loaned manager, whose "in" was stamped
at the destination store), never the kiosk device's branch.

1. **Scope the sweep to own-branch clock-ins.** In `ensureAutoOuts`, only auto-out an open "in" whose
   branch is *this* kiosk's branch (`last.branch === branch()`). Then exactly one kiosk — the one where
   the manager clocked in — closes each open shift. This removes cross-branch processing, the 18:30
   fallback (the owning kiosk *has* the schedule → stamps the real scheduled end), and the duplicate
   race, in one move.
2. **Stamp the in-record's branch on the auto-out.** Give `addManagerClockinWithMeta` a branch override
   (used only by the auto-out path; normal clock-ins keep `branch()` since the manager is physically
   there) so the record carries `last.branch`. Belt-and-suspenders even after (1).

**Coverage is preserved.** The sweep already fires for *past* days (`isPast`, `:1828`) over a 2-day
window, so a forgotten clock-out that isn't closed the same evening is closed **the next morning by the
store's own kiosk** — correct branch, correct scheduled end. This is at least as good as today, where
the "coverage" is a foreign kiosk closing them at a wrong branch/time.

*Residual to verify during implementation:* a manager **loaned in** to a store (home elsewhere) has
their "in" at that store, so its kiosk correctly owns the auto-out — but `mgrByEc`/`schedByEcYmd` may
not carry the loaned-in manager's role+schedule, so their end could still fall back to 18:30. The kiosk
already loads the cross-store "expected managers" list; extend `mgrByEc` to include loaned-in managers
so their end resolves too.

### Alternative — single server-side cron (noted, not chosen now)
Move auto-out to one authority (a Supabase edge function / pg_cron) that stamps each open shift's
in-branch and scheduled end. Ends multi-kiosk races permanently and guarantees end-of-day coverage even
if a store's kiosk is never opened. **Not chosen for the first fix** because the end-time resolution
(shift-rules, published snapshots, custom hours, SM-trial role) lives in client JS today; re-implementing
it server-side is a large lift and needs infra the store setup may not have. Revisit if real EOD-coverage
gaps appear after the kiosk-scoped fix.

### Cleanup of the strays already written
The bad records (e.g. 28 Jul foreign-branch / duplicate auto-outs) exist in `clockins`. A reviewed
Supabase cleanup should **delete each `out_auto` whose `branch` does not match the branch of that
manager's "in" for the same day**, keeping the correct-branch out (manual or home auto-out). Safe by
construction: if deleting a stray leaves a manager with no clock-out, the next own-branch sweep
re-creates a correct one. Owner-only per-row Delete already exists on the tab for one-offs
(`app.jsx:41064-41077`); a scripted pass is worth it for the backlog. Draft the SQL, review the SELECT
of what it would delete before running the DELETE.

---

## 7 · Decision

**Go with the kiosk-scoped fix** (§6 recommended): scope the sweep to `last.branch === branch()` and
stamp the in-record's branch, plus a reviewed cleanup of existing strays. Lowest-risk, uses logic that
already lives on the kiosk, and fixes all three symptoms (wrong branch, 18:30, duplicates) at once. Keep
the server-cron on the shelf as future hardening.

---

## 8 · B782M / 22 Jul — the auto-out RUNAWAY (a second, distinct bug) · fix landed 2026-07-30

While cleaning §6's strays, one manager stood apart: **B782M (Robin Lee Pharo), 22 Jul — ~88 `out_auto`
rows, all at 06:00, spanning every branch** (vs the normal one-per-kiosk 18:30 strays). Two things
compound:

1. **A before-in end time (the trigger).** `_scheduledEndDate` builds the end on the shift day and takes
   the range's trailing time (`kiosk/manager-app.js:1733-1747`); the legacy fallback is a hard 18:30. So
   **06:00 can only come from a resolved range ending "06:00"** — and since it's one manager on one day
   (not store-wide), it's a bad per-day **custom time** (`boa_mgr_times_v1[B782M]["2026-07-22"]`, e.g. an
   end typo'd to 06:00 / an overnight "… - 06:00"). `setHours(6,0)` lands the auto-out at 06:00 that
   morning — **before** the clock-in.
2. **A ts-order de-dup (the amplifier).** The old "already closed?" test keyed on the *latest-by-ts* row
   being an "in". With the auto-out at 06:00 and the clock-in later, the **"in" stays latest**, the skip
   never fires, and every sweep (× every kiosk under the old global scan) re-creates the auto-out — a
   runaway. It stopped only when 22 Jul aged out of the 2-day window.

**Payroll tail:** all of B782M's 22-Jul outs precede the clock-in, so `_mgrEarlyHoursFor` computes a
capped **phantom −12h** early-leave for that day (previous cycle). Removing the junk (leaving the "in")
→ no out → paid full scheduled day (correct).

**The §6 kiosk-scope fix only half-covers this** — it stops the ×every-kiosk fan-out, but the same-kiosk
runaway remains whenever an end resolves before the in. So two more guards were added to `ensureAutoOuts`
(commit 2026-07-30), validated by a 10/10 old-vs-new sweep simulation:

- **Existence-based de-dup** — skip if the day already has ANY `out`/`out_auto`, regardless of ts order
  (one clock-in per day is enforced, so existence is the correct test). Order-independent → immune to a
  before-in stamp.
- **Before-in skip** — never write an auto-out whose resolved end is at/before the clock-in
  (`new Date(endIso) <= new Date(last.ts)`); the shift data is wrong, so skip rather than fabricate a
  clock-out-before-clock-in.

**Cleanup:** `docs/cleanup-autoout-before-in.sql` — detection (any `out_auto` before the same-day first
"in"), preview, delete, plus inspect/clear of the bad 22-Jul custom time. The before-in signature is
precise (a clock-out can't precede its clock-in), so it cleans B782M/22-Jul and any other latent case.
Previous-cycle reach is intended and was cleared with payroll (it removes the phantom −12h).

---

## 9 · Policy change — managers are no longer auto-clocked-out (2026-07-31)

After the cross-branch (§1-7) and runaway (§8) fixes, the auto-out itself was retired
for managers. The reason is a payroll-integrity one that neither fix addressed:

**Auto-out MASKS an early leaver.** A manager who leaves early and doesn't clock out
was auto-stamped at their *scheduled end*, so the day looked full and the attendance
early-leave deduction (`_mgrEarlyHoursFor`) never fired. Manager pay is driven by the
published schedule label, not the clock-out — `_mgrEarlyHoursFor` only ever *subtracts*
and returns **0 when there's no clock-out** (app.jsx). So:

- **Genuine forget** → removing auto-out costs nothing: no out → no deduction → still
  paid the full scheduled day.
- **Left early, skipped clock-out** → auto-out used to pay them full silently; now the
  missing clock-out is *visible* for review, and the actual docking happens when a
  reviewer stamps the real leave time.

**What shipped:**
1. **Kiosk** — `ensureAutoOuts` early-returns `{}` (no `out_auto` writes). The
   schedule-aware sweep + all §1-8 guards are kept but unreachable → one-line revert.
   (Staff are never auto-clocked-out, so this is manager-only by nature.)
2. **Dashboard alert** — the `mgrEarlyAlert` memo now also returns `noClockOut`:
   managers who clocked IN on a scheduled work day (open pay cycle, elapsed days) but
   never clocked OUT, excluding loaned-out days. Rendered as a sibling rose card
   ("🕐 Manager didn't clock out — review"), same National-Ops/payroll audience
   (`canSeeMgrHours`). Self-clears when the shift is closed.
3. **Manual close** — each alert row has a **Clock out** button opening the manager
   manual-clock modal in a new `mode:"out"`. It writes a real `out` via
   `recordManualManagerClockin`, defaulting the time to the manager's scheduled end
   (one tap = a genuine forget, paid full) but **editable** — an earlier time makes the
   early-leave logic dock the correct hours. Tagged `recordedBy` for audit.

Net: a forgotten shift is a human decision at the real time, and an early leaver can no
longer hide behind the auto-out. Validated: app.jsx transpiles (esbuild), the
no-clock-out partition passes 10/10 (`scratchpad/noclockout-test.js`).

---

*Sources (live-tree trace): `ensureAutoOuts` + legacy cutoff + de-dup (kiosk/manager-app.js:1776-1841),
auto-out write (kiosk/manager-app.js:1832), branch hardcode (kiosk/data.js:2144 + branch() :71),
unfiltered load (kiosk/data.js:2105-2118), grouping vs label (app.jsx:40485 / 41060), prior comment
(data.js:1393); B782M runaway: end resolution (kiosk/manager-app.js:1733-1747), ts-order de-dup (:1801-1806).*
