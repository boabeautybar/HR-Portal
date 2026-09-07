# Schedule Consistency — Investigation & Plan of Action

**Date:** 2026-07-10 · **Status:** ✅ **COMPLETE — all phases built & merged to main (2026-07-13)**
**Scope:** the four schedule surfaces — HR portal (Scheduler + Manager Coverage + Attendance), Kiosk (staff + manager apps), My BOA — and why they keep disagreeing (payroll errors, missed days, staff disputes).

> **Completion log (2026-07-13):** Phase 0 → PR #548 · Phase 1.2/1.3 → PR #549 ·
> Phase 1.1/1.4 + Phase 2.1–2.3 + review fixes → PR (merged 2026-07-12/13) ·
> Phase 3.1 + Q4a/Q4b audit split → PR #19 (`ca41876`). Phase 3.2 SQL shipped and
> first full pass run 2026-07-13 (Q1/Q3/Q5 clean; Q4 → manager-leave overlay-by-design,
> verified on-surface). Both live cases (§2) closed.
>
> **Still open, by nature:**
> - **§8 verification matrix** — spot-verified (leave overlays, baked hours, publish diff);
>   full end-to-end pass happens naturally with the next cycle publish (~15th), which also
>   finishes the §9 baking rollout (every snapshot gains baked hours + role tags).
> - **3.3** Netlify UI: disable deploy previews for non-PR branches (one-time setting).
> - **3.4** review checklist — ongoing process per schedule PR.
> - **Deferred by choice:** 1.1a (Attendance manager path consuming baked snapshot hours
>   for early-leave deductions — last payroll-adjacent re-deriver); `saveSchedule`
>   console-warn (superseded by Q2 audit).
> - **Guardrail scripts:** `scripts/check-store-lists.js` + `scripts/check-shift-rules.js`
>   before deploys; invariant SQL after publish rounds.

---

## 1 · Executive summary

Every schedule bug of the last two months is one of **four recurring patterns**, and all four flow
from the same structural fact: **there is no single answer to "what is person X expected to do on
day Y."** Instead, that answer is assembled at render time, independently, on every surface, from
up to seven stores — and each surface reads a *different subset*, with *differently normalized*
lookups, on a *different refresh cadence*.

The fix is not another one-off patch. It is:

1. **One resolved truth** — bake everything (labels, pins, custom hours, leave/legal/maternity/loan
   overlays) into the published snapshot at publish time, so consumers render it verbatim instead
   of re-deriving.
2. **One write path** — every schedule mutation goes through a helper that patches draft **and**
   snapshot together (this already exists — `patchApprovedSnapshotGrid`, `app.jsx` — but is wired
   path-by-path, not enforced).
3. **Kill the duplicates** — the hour rules exist in 5+ hand-synced copies today.
4. **Guardrails** — invariant checks + a publish-time diff + a review checklist so regressions are
   caught before staff see them.

---

## 2 · The two live cases, fully traced

### Case A — Nicole (AM, Riverlands): hub says WM 09:00–18:00, kiosk & My BOA say 10:00–19:00

Verified mechanics:

- All four `shiftTimes` copies return **10:00–19:00** for (AM, `WM`, Riverlands, weekday) — they are
  in sync. **`WM` is not a defined Riverlands code in any copy**; it falls through to the closing
  default. (app.jsx:1935-1943, kiosk/staff-app.js:3884-3891, kiosk/manager-app.js:2701-2709,
  myboa/schedule.js:106-113.)
- The hub's **09:00–18:00** comes from the **custom-hours sidecar** `boa_mgr_times_v1`
  (shape `{ec: {"YYYY-MM-DD": "HH:MM - HH:MM"}}`), which Coverage overlays via `_effCustomTime`
  (app.jsx:37611, applied :38020-38021), OR from a `WE` cell (Riverlands WE = 09:00–18:00 for AM).
- Kiosk and My BOA **do** read `boa_mgr_times_v1` (kiosk/manager-app.js:2100-2114,
  kiosk/staff-app.js:1213/1374, myboa/schedule.js:835/480-482) — custom wins **when the lookup
  matches**. So the failure is one of:
  1. **EC-key mismatch**: the store is keyed by the EC exactly as Coverage saved it. The kiosk
     matches raw + trimmed only (manager-app.js:2102, staff-app.js:1374); only My BOA is
     case-tolerant (schedule.js:870-874). One case/whitespace difference → override silently
     dropped → `shiftTimes(WM)` fallback = 10:00–19:00. **Exactly the reported strings.**
  2. **Draft-vs-published skew**: Coverage renders the **draft** grid (see §4) plus draft custom
     hours; staff surfaces render **published[0]**. A custom time "applied to live" but a cell
     changed since last publish → the two halves disagree until re-publish.
  3. **Stale My BOA**: My BOA has **no auto-refresh** and caches each cycle in memory
     (schedule.js:656-662); staff must manually reload. Kiosks self-refresh (~6 min,
     kiosk/auto-refresh.js).
- Also: the schedule label itself is **re-derived** — the auto-labeller resets working cells to `W`
  and re-assigns WE/WM/WL/WB (app.jsx:2000 `applyMgrShiftSplit`), then pins
  (`boa_mgr_shift_pins_v1`) overlay, and the result is **baked only at publish**
  (app.jsx:34486-34492). Pins saved after publish are patched into the snapshot on Save
  (app.jsx:34396-34438) but are a **no-op if the cycle was never published** (app.jsx:34416).

### Case B — Kimberley (B535, Sea Point): on Unpaid Leave (Legal), still shows ABSENT on Nail Tech Check-ins

Exact path (traced, app.jsx `tab === "checkins"` ~35881):

1. Unpaid-legal leave lives ONLY in `boa_unpaid_legal_v1` — it is **never written into the schedule
   grid** (documented at app.jsx:28925-28931). Her grid still shows a working cell.
2. The kiosk therefore lists her on the manager's daily check-in; the manager submits
   `status:"absent"` into the kiosk log (`boa_kiosk_log_<branch>_<ym>`).
3. The Nail Tech Check-ins tab renders kiosk-log rows **verbatim**: `STATUS_BADGE`
   (app.jsx:36185-36202) has no `absent` key, so it falls back to uppercasing the raw status →
   "ABSENT" (app.jsx:36206). The tab **never consults `boa_unpaid_legal_v1`** — it bypasses
   `enriched` (uses raw `staffByEc`, app.jsx:35905-35907) and `absent`/`no` aren't in its
   `NONWORK` hide-set (app.jsx:36033-36038).
4. The **Attendance sheet gets this right** — it date-range-checks `_onUnpaidLegal`
   (app.jsx:28932-28942). The Check-ins tab simply lacks the same guard.

This is a **recurrence** of commit `e99bc56` (unpaid-legal overlay added to portal/attendance/
My BOA/kiosk grids — but never to the Check-ins tab, and never at the *source*, the kiosk roster
that asked the manager to tag her in the first place).

---

## 3 · The architecture, as it actually is

### 3.1 Stores (all Supabase `app_state` unless noted)

| Store | What it holds | Written by |
|---|---|---|
| `boa_sched_<br>_<ym>` / `boa_mgrsched_<br>_<ym>` | DRAFT grid (tech END-month ym / mgr START-month ym; tech cells keyed by day-of-month, mgr by full date) | Scheduler save + ~6 side-effect paths |
| `boa_schedapproved_*` / `boa_mgrschedapproved_*` | PUBLISHED snapshot — version array **newest-first**, `[0]` = live; labels+pins baked at publish; **no custom hours inside** | Publish (+ `patchApprovedSnapshotGrid` side-effect patches) |
| `boa_mgr_times_v1` | Per-day CUSTOM hours `{ec: {ymd: "HH:MM - HH:MM"}}` — global, one key for all branches/cycles | Coverage cell editor "Apply to live" |
| `boa_mgr_shift_pins_v1` | Per-cell pinned WE/WM/WL/WB `{ec: {ymd: code}}` | Scheduler save |
| `boa_leave_v1` | Leave planner records | Leave flows |
| `boa_unpaid_legal_v1` | Unpaid Leave (Legal) ranges | Unpaid Legal tab |
| `maternity` (table) | ML ranges | Maternity tab |
| `boa_mgr_loans_v1` / `boa_tech_loans_v1` | Day-loan records (durable truth; grid `loan_out` cell is a hint) | Coverage/ED flows |
| `boa_att_<br>_<ym>` | Attendance day statuses | Kiosk + portal |
| `boa_kiosk_log_<br>_<ym>` | Manager's daily kiosk submission (per-tech statuses) | Kiosk |
| `clockins` (table) | Clock-in/out events (+ selfie/GPS meta sidecars) | Kiosk + manual portal entries |

### 3.2 Who reads what — the asymmetry matrix (the heart of the problem)

| Input | Portal Coverage | Portal Attendance | Portal Check-ins tabs | Kiosk staff grid | Kiosk mgr card | My BOA |
|---|---|---|---|---|---|---|
| Grid source | **DRAFT** (published only as fallback, app.jsx:37211/19414) | draft + published pin-merge (app.jsx:18156-18169) | kiosk log / clockins (no grid) | **published[0]** (staff-app:1333) | **published[0]** (manager-app:1927-1936) | **published[0]** (schedule.js:621-664) |
| Custom hours | ✅ (+draft overlay) | ✅ :28847 | — | ✅ raw/trim EC only | ✅ raw/trim EC only | ✅ case-tolerant |
| Pins | ✅ re-applied live | via snapshot merge | — | baked in snapshot | baked in snapshot | baked in snapshot |
| Leave planner | ✅ | ✅ | ❌ (Nail Tech Check-ins) | ✅ | ✅ (as gate) | ❌ |
| Unpaid legal (EL) | ❌ | ✅ :28932-28942 | ❌ ← **Case B** | ✅ | ❌ | ✅ |
| Maternity (ML) | grid cell only | ✅ | ❌ | ✅ | ❌ | ✅ |
| Loans | ✅ | — | — | ❌ | ❌ | ✅ |
| Refresh | live React | live React | live React | ~6 min auto | ~6 min auto | **manual reload only** |

Every ❌ above is a latent incident of the same family as Cases A and B.

### 3.3 Hand-synced duplicates (drift surfaces)

- **`shiftTimes` ×4**: app.jsx:1898, kiosk/staff-app.js:3857, kiosk/manager-app.js:2678,
  myboa/schedule.js:86. Values identical today **except kiosk/manager-app.js is missing the entire
  Head Office block** (a real, current divergence).
- **Hours as prose ×3+**: kiosk staff hours banner (staff-app:3939-3976), portal JSX legends
  (app.jsx:34950-34998 and 6837-6852), My BOA's separate `TECH_TIMES`/`NORMAL_TECH` tables
  (schedule.js:202-212). None generated from `shiftTimes`.
- **Cycle helper (25th→24th, day>24 → next ym)**: 4+ inline copies in app.jsx alone + myboa:46-57.
- **Split-shift store sets, work-code sets**: 2–3 copies each (in sync today).
- **Branch lists**: `SALONS` (app.jsx, WC-only) vs myboa `STORES` vs kiosk `BRANCHES` — divergent
  scope, hand-edited on every store addition (known trap).
- **HO branch detection**: 3 implementations + 1 missing (manager-app).

---

## 4 · Why it keeps happening — incident history (from git)

Ten core incidents, four patterns:

| # | Pattern | Incidents (commits) | Count |
|---|---|---|---|
| 1 | **Consumer didn't render `published[0]` verbatim** (read draft, re-derived over the snapshot, or missed an overlay) | `d9f6db6`, `c4483f5`, `0253708`, `81692b4`/`0ac5ceb` + overlay gaps `dfe7416`, `e99bc56`, `0fb6c61` | **7** |
| 2 | **Producer write reached only one store** (draft patched, snapshot not) | `b5da00c` (pins), `ae13551`/`6d3d99d` (leave/ED/loan/onboard side-effects) | 3 |
| 3 | **Two coupled stores drifted** (grid cell vs durable record; branch-string drift) | `ec55083` (loans), `b6dcec7`/`a518dfd` (transfers) | 3 |
| 4 | **Regenerate clobbered a durable record** (pins, approved extra days) | `cf3aac6`, `90531fd`/`2ea054d` | 2 |

Notable: `c4483f5` was a direct **payroll** bug (early-leave docked against the draft's shift
end); Case B is a recurrence of the `e99bc56` family; Coverage **still** reads the draft — the
same read that caused #2 and #3 — it just hasn't burned us visibly there yet because Coverage is
an owner-facing view.

---

## 5 · Goals (what "fixed" means)

1. **G1 — One truth:** any person/day has exactly one resolved answer (code + hours + status), and
   all four surfaces render *that*, not their own derivation.
2. **G2 — Payroll-safe:** the hours payroll deducts against are byte-identical to the hours the
   staff member saw on kiosk/My BOA that morning.
3. **G3 — No stale staff view:** a publish reaches every staff surface within minutes without a
   manual reload.
4. **G4 — Excluded means excluded:** anyone on unpaid-legal / maternity / leave never appears as
   absent/no-show on ANY surface (kiosk roster included — fix at the source, not per-view).
5. **G5 — Regressions can't ship silently:** duplicate rule-tables are eliminated or mechanically
   checked; every schedule PR passes a consistency checklist.

---

## 6 · Plan of action

### Phase 0 — Stop the bleeding (small, surgical; 1 short session)

| # | Fix | Where | Closes |
|---|---|---|---|
| 0.1 | Nail Tech Check-ins: drop/relabel rows where `_onUnpaidLegal(ec, day)` (mirror app.jsx:28938-28942); also overlay leave + maternity | app.jsx checkins tab | **Case B**, G4 |
| 0.2 | Kiosk daily roster: exclude unpaid-legal/maternity/leave people from the manager's tag list (so "absent" is never submitted for them) | kiosk staff/manager roster build | G4 at the source |
| 0.3 | Normalize the EC key for `boa_mgr_times_v1` (and pins) at **write** (`trim().toUpperCase()`) and make all readers case-tolerant like My BOA | data.js write + 3 readers | **Case A** mechanism 1 |
| 0.4 | Decide Riverlands `WM`: either define its hours in the rules or stop the labeller/pins producing WM for Riverlands | shiftTimes ×4 + labeller | Case A fallback story |
| 0.5 | Add the missing Head Office block to kiosk/manager-app.js `shiftTimes` (or better: 1.3 below) | kiosk/manager-app.js:2678 | real divergence |
| 0.6 | My BOA: add the same auto-refresh pattern the kiosk uses (ETag poll + reload-on-wake + cycle-cache bust) | myboa/ | G3 |

> **Implementation log — Phase 1.2 + 1.3 (2026-07-10, branch `fix/schedule-consistency-phase1`)**
> Done, all in `app.jsx`, parse-clean (esbuild):
> - **1.3 — the one genuine STRAY write fixed.** The audit found exactly one: Manager
>   Coverage "Apply to live" (`_applyDraft`) wrote the whole merged grid to the DRAFT but
>   only mirrored *loan* cells to the published snapshot — a plain shift-swap / off-day change
>   never reached staff on a published cycle. Now every applied full-date cell is mirrored via
>   `patchApprovedSnapshotGrid` (one load+save per branch/ym; loan cells still re-asserted
>   precisely by the existing loan loop). The other two draft-only writes (tech Save, mgr Save
>   Draft) are *intentional* staging per the 10750-10758 design note — left as-is.
> - **1.2 — draft-reader elimination.** The shared clockins effect now also loads the published
>   snapshot into `mgrApprovedFallbackCache`, and the three **no-show scanners** (dashboard
>   "reasons to add", mgrclockins no-show banner, kiosk scheduled-by-branch) flipped to
>   **published-first, draft-fallback** through ONE shared accessor (`mgrPublishedFirstGrid`) so a
>   no-show is judged against what staff SAW. **Design refinement from code review:** Manager
>   Coverage's *display* was left on the DRAFT — it is an editing surface, and rendering published
>   while editing draft created a view↔write divergence (Apply could silently clobber an unpublished
>   draft edit) and a stale-cache class of bug. Coverage now shows the draft you're building; the
>   "Unpublished changes" badge flags when it ≠ the published snapshot; staff-facing truth is
>   enforced by the scanners + the real staff surfaces. Never-published (or empty) snapshots fall
>   back to the draft; EC rows are matched tolerantly (legacy dash/space keys).
>
> - **Code-review hardening (same session, folded in):** `mgrApprovedFallbackCache` is now
>   refreshed in place after Coverage "Apply to live" AND after a hub publish (the loader effects
>   skip already-cached keys, so a mid-session publish otherwise left scanners/badge on the old
>   snapshot); the snapshot mirror matches rows via `_normGridKey` (no duplicate legacy-EC rows,
>   canonical uppercase key on write); the badge buckets ECs by `_normGridKey` (no phantom drift);
>   the audit SQL got a full-date filter on Q2 (dom-key false drift), `to_date` + regex guards on
>   Q4/Q5 (one malformed hand-edited date no longer aborts the query), and a `both_cycles` intersect
>   replacing the quadratic EXISTS pair.
> - **Badge shipped.** Coverage header shows "⚠ Unpublished changes · N" when a scoped branch's
>   saved draft diverges from its published snapshot (WE/WM/WL/WB normalised to W so label-baking
>   isn't a false positive).
> - **Deferred, on purpose:** the `saveSchedule` console-warn (§1.3 "consider") — threading an
>   opt-out flag through ~14 call sites in the #1 hotspot is high-risk / low-value; divergence
>   detection belongs in the §3.2 invariant audit instead (draft vs published[0] drift). And the
>   baking work (1.1 / 1.4) stays for a single-cycle trial per §9.

### Phase 1 — One resolved truth (the structural fix; 1–2 sessions)

- **1.1 Bake hours into the snapshot.** At publish, resolve each working cell to
  `{code, hours}` (custom > pins > rules) and store it in the snapshot version. Consumers render
  the baked hours; `boa_mgr_times_v1` remains the editing UI's store but stops being a
  render-time dependency on staff surfaces. Custom-hour changes after publish go through the
  same snapshot-patch helper as pins (`patchApprovedSnapshotGrid`), so "Apply to live" means
  what it says.
- **1.2 Make Coverage read `published[0]`** (with a visible "unpublished changes" diff badge when
  draft ≠ published, instead of silently rendering the draft). Same for the two no-show scanners
  (`mgrClockinSchedCache` → published-first). This removes the last draft-reading consumers —
  the pattern behind 7 of 10 incidents.
- **1.3 One write helper.** All schedule mutations (leave, ED, loans, transfers, onboarding,
  pins, custom hours) must go through the existing dual-write helpers
  (`patchApprovedSnapshotGrid/Row`) — grep-audit every `saveSchedule(` call site and route
  strays. Consider making `saveSchedule` itself warn (console) when a published snapshot exists
  for the cycle and no snapshot patch followed.
- **1.4 Baked overlay statuses.** Publish-time resolution should also stamp non-work truth the
  grid already models (L / EL / ML) from their stores, so staff surfaces don't need to overlay
  at all for *published* cycles. (Loans stay a live overlay — they're inherently post-publish —
  but then EVERY surface must read the loan record, per `ec55083`: add the kiosk.)

### Phase 2 — Kill the duplicates (1 session)

- **2.1 Hours rules as data.** Extract the branch-hour rules into ONE data table (a JS module or
  an `app_state` key, e.g. `boa_shift_rules_v1`) consumed by all four `shiftTimes` bodies —
  ideally one shared function file served to portal + kiosk + myboa (they're all plain script
  tags; a single `shared/shift-rules.js` is feasible). Banners/legends generate from the same
  table.
- **2.2 One cycle helper, one key builder** per bundle, no inline re-implementations (grep
  `> 24` / `>= 25` and `boa_sched`/`approved_` string builds).
- **2.3 Store lists**: single registry (kiosk `BRANCHES` is closest to authoritative) + generate
  or invariant-check the My BOA `STORES` arrays and portal additions against it.

### Phase 3 — Guardrails (ongoing)

- **3.1 Publish-time diff modal** — ✅ **shipped 2026-07-13.** Before "Save Final" (both the
  tech scheduler and the manager schedule tab), a review dialog lists per-person what staff
  will SEE change — cell code + baked hours per day — vs the live `published[0]`, with
  added/removed people flagged and a first-publish summary when no snapshot exists.
  Implementation: module-level `computePublishDiff` + `showPublishDiffDialog` (plain-DOM
  promise modal, app.jsx ~10797) awaited by both Save Final handlers; manager baking hoisted
  before the prompts so the diff compares the exact baked grid+hours. Fails OPEN on any
  preview error (a broken guardrail must never block a publish). The cross-branch "Publish
  current cycle" engine already had its own review modal. Diff engine covered by 9 fixture
  tests (first-publish, hours-only change, EC-tolerance, add/remove, dom-key sort, blanks).
- **3.2 Invariant audit** — ✅ **shipped as `sql/schedule_consistency_invariants.sql`**;
  first full pass run in the Supabase SQL editor 2026-07-13: Q1/Q3/Q5 clean, Q4 returned
  only manager-leave rows → **Q4 split into Q4a (EL/ML, still zero-expectation) and Q4b
  (manager leave, informational — overlay-by-design since manager leave is never stamped
  into grids; verified on-surface for Kuils River B272M + Table Bay B621M)**. Five read-only
  queries, one per incident family: Q1 override EC-key hygiene (Case A), Q2 draft↔published[0]
  drift (the badge's DB twin — this is where the deferred `saveSchedule` warn lives instead),
  Q3 `loan_out` without a loan record (ec55083), Q4 working published cell in an EL/ML/leave
  range (G4), Q5 kiosk `absent/no` in an EL/ML/leave range (Case B / Kimberley). Original spec:
  - every EC in `boa_mgr_times_v1` / pins exists in staff, normalized;
  - draft vs published[0] cell drift per open cycle (list, don't fail);
  - any `loan_out` cell without a loan record;
  - anyone with a working published cell inside an EL/ML/leave range;
  - kiosk-log `absent`/`no` rows inside EL/ML/leave ranges (Case B detector).
- **3.3 Deploy discipline**: app.jsx + data.js + kiosk/* + myboa/* ship together (version-skew
  already bit once — HO progress doc finding #1). Netlify: stop letting deploy previews pile up
  unaccepted — production deploys only from merged `main` (current backlog of "Pending Review"
  previews on branch pushes is noise; consider disabling previews for non-PR branches).
- **3.4 Review checklist** (below) applied to every schedule-touching PR.

---

## 7 · Code-review checklist for schedule changes (apply to every PR)

1. Does any new reader consume `boa_(mgr)sched_*` (draft)? → must justify; default is
   `…approved_*[0]`.
2. Does any new writer mutate a grid without the snapshot-patch helper? → reject.
3. Does it derive hours anywhere except the shared rules (+ baked snapshot)? → reject.
4. Any new per-person overlay store → list ALL surfaces that render person-days; wire or
   explicitly waive each (the §3.2 matrix is the checklist).
5. EC used as a map key → normalized `trim().toUpperCase()` at write AND read.
6. Cycle math → uses the shared helper, not inline `>24`.
7. New store/branch → registry + STORES arrays + BRANCHES + shift rules all updated (memory:
   `adding-a-store-hardcoded-lists`).
8. Staff-visible change → verified on all four surfaces before merge (screenshot each).

---

## 8 · Verification matrix (acceptance for Phases 0–1)

| Scenario | Portal Coverage | Attendance | Kiosk | My BOA |
|---|---|---|---|---|
| Custom hours set + applied, cycle published | ★ custom time | deduction vs custom end | same custom time | same custom time |
| Pin set AFTER publish | pinned code | pinned code | pinned code (snapshot patched) | pinned code |
| Person on unpaid legal | EL cell | excluded from deductions | **not on tag roster** | EL shown |
| Leave approved mid-cycle | L cell | L | L (no absent tag possible) | L |
| Loan day | AWAY→store | — | loaned-in shows at host | away + host shown |
| Re-publish while staff page open | n/a | n/a | ≤6 min auto | ≤ minutes (new auto-refresh) |
| Draft edited, NOT republished | "unpublished changes" badge | unchanged (published) | unchanged | unchanged |

---

## 9 · Suggested order & sizing

1. **Phase 0** now (one sitting; 0.1–0.3 are the two live complaints + payroll-adjacent).
2. **Phase 1.2 + 1.3** next (draft-reader elimination + write audit) — highest incident coverage.
3. **Phase 1.1/1.4** (baking) — the deep fix; do behind a single-cycle trial (publish one branch's
   next cycle baked, verify matrix, then roll out).
4. **Phase 2** opportunistically after Phase 1 (baking removes most render-time dependence on the
   duplicated rules, making consolidation safe).
5. **Phase 3** alongside everything (3.1 lands with 1.1; 3.2 is a standalone SQL/diagnostic).

*Sources: 5 parallel code tracers over the live working tree (write paths, kiosk/My BOA read
paths, Coverage/Attendance/check-ins, shiftTimes divergence audit, git incident mining). All
file:line references verified against the current code at commit `a807317`.*
