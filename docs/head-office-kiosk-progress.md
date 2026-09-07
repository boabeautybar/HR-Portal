# Head Office Kiosk — Progress Log (loop memory file)

Cross-session state for the plan in [head-office-kiosk-plan.md](head-office-kiosk-plan.md).
**Every session: read this at start, append an entry at end.** Entries are append-only —
never rewrite history. Format:

```
## <date> · Phase <n> · <model> · <status: DONE | PARTIAL | BLOCKED>
- What changed (files / keys / rows):
- Verifier results (babel / node --check / audit queries):
- Spend + iterations used vs cap:
- Blockers / handoff notes for the next session:
```

---

## Phase status board

| Phase | Status | Gate |
|---|---|---|
| 0 Decisions & data sheet | ⏳ awaiting owner (§E decisions 1-7) | human sign-off |
| 1a Classification foundation | **code + review-fixes done (uncommitted)** | ✅ Fable /code-review passed |
| 1b Seed HO data | deferred to after code deploys | Fable audit review |
| 2 Kiosk PIN gate | **code + review-fixes done (uncommitted)** | ✅ Fable /code-review passed; manual PIN test post-deploy |
| 3 Loader split | **code + review-fixes done (uncommitted)** | ✅ Fable /code-review passed |
| 4 Kiosk HO experience | **code + review-fixes done (uncommitted)** | ✅ Fable /code-review (8 findings, all fixed) |
| 5 Portal surfaces | **code + review-fixes done (uncommitted)** | ✅ Fable /code-review (8 findings, all fixed) |
| 6 Regression & sign-off | **code audits done (uncommitted)** | ⏳ owner: commit → deploy → seed |

---

## 2026-07-08 · Phase 6 (regression + invariant audit) · Opus · DONE (uncommitted)
Blast-radius regression + invariant SQL. No Supabase writes; seed still deferred to post-deploy.
- **Blast-radius regression audit (agent, read-only): PASS — zero leaks.** Two-layer guarantee
  proven against live app.jsx/data.js: (1) data.js loadAll carves HO out of staff/managers/enriched
  by branch (lines 248-250), so every enriched/managers consumer is HO-free by construction;
  (2) "Head Office" is NOT in SALONS (app.jsx:1835-1853, 17 salons), so every SALONS.* /
  scopedBranches / scopedSalonNames list is HO-free. All 7 salon-only surfaces CLEAN: Manager
  Coverage (scopedBranches=SALONS.filter), Fresha To-Do (enriched+managers props, no hoStaff),
  Cash-ups (SALONS scope), Recruitment (SALONS×enriched), Store Hours (SALONS-internal + shiftTimes
  is a pure fn), Store Openings (SALONS), dashboard aggregates (SALONS.map). All 15 hoStaff refs
  classified = 3 infra + exactly the 5 intended consumers (scheduling headoffice sub-tab, attendance
  arm, leave-planner branch, hoCheckins tab, called-in-sick isHo), each UI entry gated on
  hoStaff.length>0 → provable no-op on salon-only data. Payroll surfaces (Leave Balances/FRL/
  overtime/reports) exclude HO safely (known-deferred, crash-safe). Trial "head-office training day"
  attendance daytype is pre-existing & unrelated to the hoStaff population.
- **Invariant SQL authored: sql/head_office_invariants.sql** (READ-ONLY, owner-run in Supabase SQL
  editor AFTER the Phase-1b seed). 3 must-be-zero audits: (1) HO branch row with role_type !=
  head_office (Coverage/mgr-schedule pollution — the keystone myboa-raw-role_type invariant);
  (2) drifted HO branch string (branch normalises to "head office" but != exact "Head Office" →
  invisible to kiosk `.eq("branch",…)` + HO scheduler/leave; ships a commented remediation UPDATE);
  (3) stray head_office role_type outside HO. Plus info query 4 = HO roster by department (verify
  boa_ho_routing_v1 coverage). Cross-population EC uniqueness stays in staff_employee_code_unique.sql.
- Verifiers: node --check ×11 (app.jsx via esbuild JSX transform) all green.
- **HANDOFF — remaining work is OWNER-GATED (assistant will not do these):**
  1. Review + commit + push feat/head-office-kiosk (branch off main; 12 files + docs/ + 2 sql/).
  2. Deploy so app.jsx + data.js + kiosk + myboa ship together (avoids the version-skew the
     requestStore="ho" fix guards against, and lets loadHoRequests/listRecentHoClockins resolve).
  3. Run sql/staff_employee_code_unique.sql (pre-flight must be zero first) + Phase-1b seed
     (HO staff rows: branch EXACTLY "Head Office", role=department CC/SALES/ADMIN/MKT/OH,
     role_type head_office; published boa_schedapproved_Head Office_<ym> [0] with cells in
     W/WE/WL/WB/WM/E so the kiosk roster is non-empty; boa_ho_routing_v1 = {CC: <Feroza id>, …}).
  4. Run sql/head_office_invariants.sql — all 3 must return zero.
  5. Determine Feroza's portal permissions (unblocks the boa_ho_routing_v1 approver FILTER, the one
     deferred Phase-5 surface).
- Backlog (non-blocking, from the two review gates): per-department HO leave clash; HO in payroll
  surfaces (Leave Balances/FRL/overtime/reports read enriched/managers only); shared stores module
  (myboa STORES ×5 + kiosk config hand-sync); mgrclockins/hoCheckins helper dedup; pin-gate
  effRole() ×3; kiosk HO roster query fan-out (~9/paint) + full-repaint-per-clock-in; onboarding
  setHoStaff-on-hire (surfaces appear only after reload — intentional, commented).

## 2026-07-08 · Phase 5 REVIEW GATE + FIXES · Fable /code-review · 8 findings, ALL fixed
8 finder angles (~36 candidates) → dedup → verify (5 multi-angle corroborated, 2 grep-confirmed,
1 verifier-agent CONFIRMED both mechanisms). All 8 CONFIRMED, all fixed (uncommitted):
1. **_saveReqs version-skew wipe** — function-ref prop `saveRequestsFn={window.BOA_DB.saveHoRequests}`
   is undefined on a stale-cached data.js → silently fell back to saveTechRequests → one HO request
   edit REPLACES all of boa_tech_requests_v1. Fixed: prop is now `requestStore="ho"` resolved BY
   NAME at call time; missing saver throws ("refresh the page") into the existing try/catch alert.
2. **listRecentHoClockins never exported** (hoCheckins tab DOA). Fixed: added to BOA_DB export.
3. **Leave Planner HO was display-only** — addLeave/persistLeaves/storeLeave/annualCount/cap-loop
   + 2 JSX hint lookups all resolved via (isTechMode ? enriched : managers)+ROLE_GUARD. Fixed: all
   now use the block's sourceArr/passesRole; persistLeaves `known` + computeLeaveDays include
   hoStaff; passesRole for HO checks `active !== false && !_hasLeft(ec)` (leaver exclusion — hoStaff
   loads unfiltered).
4. **Auto-fill garbage at HO** (station capacity 0 → everyone off). Fixed: ✨ Auto-fill hidden when
   branch===HEAD_OFFICE (syncStaff row-fill is weekly-rule-based, left enabled).
5+6. **Clock-in viewer routing** — tech viewer leaked head_office rows (double-surface in Nail Tech
   Check-ins + leave-reconcile clockSet pollution); HO viewer keyed on stored role_type, missing
   legacy HO rows (role_type manager/tech pre-classification) and routing -M ones to Manager
   Check-ins. Fixed: shared `_isHoClockin(r)` = staff branch tolerant-match; HO viewer includes by
   branch, manager+tech viewers exclude by branch. Attendance HO ✓ overlay re-wired: checkInsByBranch
   now merges hoClockinRows under the canonical HEAD_OFFICE key (its attendance-arm loader, formerly
   dead I/O, is now the live source).
7. **Tolerant-vs-strict branch drift** — hoStaff membership was tolerant but every consumer strict
   (drifted "head office " row = person invisible everywhere). Fixed at the root: canonBranch() in
   data.js normalizes to "Head Office" in rowToStaff/rowToManager (read path); called-in-sick isHo
   now uses isHeadOfficeBranch(r.store). ⚠ Kiosk-side `.eq("branch","Head Office")` queries still
   need canonical DB strings — Phase 6 audit must assert no drifted branch values in staff rows.
8. **My BOA EC validation blocked dashed HO codes** — EC_RE /^[A-Z]\d+M?$/ + cleanEc STRIPPED
   dashes while lookup_my_leave / verifyEcBranch match the stored code verbatim (upper/trim only),
   so B412-CC could never identify. Fixed in leave/absence/extra: cleanEc preserves "-", EC_RE now
   /^[A-Z]\d+(-?(M|W|F|T|CC|C))?$/ (16-case matrix PASS: salon codes unchanged, dashed suffixes
   accepted, malformed rejected). Side benefit: legacy dashed manager codes (B941-M) become usable.
BONUS: myboa/report.js STORES was missing "Cobble Walk" (pre-existing — store opened 2026-07-01,
   its staff couldn't file incident reports). Added.
Also: dropped the redundant setHoRequestsTick bump after local saves (write-then-refetch race).
Deferred (flagged, not fixed): per-department HO leave clash; payroll surfaces (Leave Balances /
FRL / overtime / reports) don't read hoStaff yet; mgrclockins/hoCheckins date-helper duplication;
pin-gate coercion ×3 → one effRole(); kiosk HO roster ~9 queries/paint + full repaint per clock-in;
onboarding doesn't setHoStaff until reload (intentional, commented).
Verifiers: node --check ×8 green; esbuild(app.jsx) clean. **NEXT: Phase 6 regression + audit.**

## 2026-07-08 · Phase 5 (portal HO surfaces) · Opus · DONE (uncommitted)
Owner chose "build HO into the scheduler UI" (not seed-as-data) at the Phase-5 fork.
All surfaces gated on `hoStaff.length` / `branch === HEAD_OFFICE` → provable no-op on
current salon-only data. Files: app.jsx, data.js, myboa/{leave,absence,extra,schedule,report}.js.
- **HO scheduler** (fixes review #1 — kiosk roster was un-fillable): `Schedule` gains optional
  `branchList` prop (locks picker; defaults to SALONS names) + `saveRequestsFn` prop (defaults
  to saveTechRequests). New 3rd Scheduling sub-tab "🏢 Head Office" renders `<Schedule
  allStaff={hoStaff} branchList={[HEAD_OFFICE]} saveRequestsFn={saveHoRequests}>` → writes
  boa_sched_Head Office_* + published boa_schedapproved_Head Office_* [0] (what the kiosk reads).
  HO never enters SALONS. `salonForBranch` already falls back to {capacity:999} for non-salons.
- **hoRequests state + loader**: `loadHoRequests`/`saveHoRequests` added to data.js (+exported);
  portal `hoRequests` state loads on scheduling/leave tabs; fed to HO scheduler as the off-day
  overlay. (Fixes review #7 no-reader: boa_ho_requests_v1 now has a portal consumer.)
- **Attendance**: "Head Office" opts into the Store picker (hoStaff-gated); new attStaff arm
  sources hoStaff when attBranch===HEAD_OFFICE (role label = HO dept). Grid path already
  branch-generic → boa_att_Head Office_* + clockins render. (Fixes review #8 visibility.)
- **hoCheckins tab** (`{t:"hoCheckins",...}` after mgrclockins; NAV_TAB_TO_CATEGORY + Operations
  nav group, both hoStaff-gated): `listRecentHoClockins` (role_type head_office) in data.js;
  clockins select now also pulls staff.role (HO dept). State hoClockinRows/hoClockinMeta/
  hoClockinDay; two loaders (rows + per-day selfies via loadClockinMeta — same boa_mgrclockin_meta_
  sidecar the HO kiosk writes). Render = day-nav + selfie cards (name/dept/time/IN-OUT) + "not
  clocked in" roster from hoStaff.
- **Leave Planner**: "Head Office" in Store picker (hoStaff-gated); sources hoStaff on either
  sub-tab + bypasses salon ROLE_GUARD (`passesRole`); peopleType label HO-aware. ⚠ Per-department
  clash ("max 1 CC off") NOT done — HO uses the branch-wide 20% cap; the grid clash math is a
  single shared `ct vs maxLeave` and per-dept bucketing is a follow-up (risk to salon planner).
- **Called-in-sick routing**: 3rd guidance arm — `isHo` (HEAD_OFFICE_ECS or store===HEAD_OFFICE)
  → "check Head Office Check-ins tab" (techs still→Fresha, mgrs→Manager Check-ins).
- **My BOA**: "Head Office" appended to all 5 STORES arrays (leave/absence/extra/schedule/report).
- **DEFERRED**: boa_ho_routing_v1 department→approver *filter* (CC→Feroza, else→Justin) — blocked
  on Feroza's portal permissions (§Phase-0 note: "Permissions for her TBD at the end").
- Verifiers: node --check on data.js + 5 myboa + 3 kiosk all green; esbuild(app.jsx) clean
  (only the pre-existing kraaifontein dup-key warning). **NEXT: Fable /code-review of Phase 5.**

## 2026-07-08 · Phase 4 REVIEW GATE + FIXES · Fable /code-review (Opus finders) · 8 findings, ALL fixed
8 finder angles (4 died on a session limit, relaunched) → dedup → per-candidate verifiers. All 8
CONFIRMED against live source, all fixed (uncommitted):
1. HO schedule grid un-creatable → kiosk dead on arrival. **Fixed in Phase 5** (HO scheduler UI).
2. pin-gate: device-admin autoAuth + sessionStorage restore still booted the salon MANAGER
   dashboard at HO (only the PIN-entry arm was HO-aware). Fixed: both PIN-less paths coerce
   manager→staff when cfg.headOffice (kiosk/pin-gate.js).
3. `_paintHoClockList` fell back to `#ho-staff-list` → a post-selfie/async repaint injected live
   Clock In/Out buttons into the READ-ONLY Staff view. Fixed: explicit `listId` param, bail if gone.
4. `_hoTodayRoster` dropped anyone whose cell flipped to off mid-cycle → stranded clocked-in with
   no clock-out. Fixed: union open clock-ins (keyed off clockins, not attendance).
5. HO roster ignored leave/maternity + conflated "no schedule published" with "nobody today".
   Fixed: source `categorizeStaff().active` + two-state empty message.
6. Duplicate-EC (HO⇄salon) flipped isManagerEc portal-wide. Fixed: onboarding chokepoint dup
   guard vs committed salon+HO ECs (app.jsx submitOb). (2 sub-mechanisms REFUTED — no action.)
7. boa_ho_requests_v1 no reader + missing from rewriteEcList EC-rename. Fixed: rewriteEcList
   arm (data.js) now; portal reader landed in Phase 5.
8. HO clock-ins invisible in portal. Fixed in Phase 5 (Attendance arm + hoCheckins tab).
Also corrected the misleading "surfaces light up"/"portal reads this key" comments to say Phase 5.

## 2026-07-07 · Phases 2+3 (+1a fixes) REVIEW GATE · Fable /code-review · 5 findings (2 CONFIRMED)
8 finders + 2 verifiers (1 agent + 1 direct read). Verified findings, ranked:
1. **CONFIRMED** onboarding step 2b (tech schedule auto-sync, app.jsx:27474) not HO-gated —
   `isTech` + truthy-branch guards pass for an HO tech-position hire; on confirm it writes
   `boa_sched_Head Office_<ym>` + published snapshot row. `_hoHire` is const inside the EARLIER
   try block → out of scope here; gate must recompute `isHeadOfficeBranch(obForm.branch)`.
2. **CONFIRMED** onboarding step 2c (manager-coverage auto-gen, app.jsx:27551) same gap for
   SM/SSM/AM HO hires → manager grid + snapshot writes for branch "Head Office". Same fix.
3. **PLAUSIBLE** seed_consolidated.js:82 derives role_type by suffix only (verified by read:
   -M→manager, -CC→call_centre, no branch case) → if reused for Phase-1b seed, writes 12
   poisoned manager+HO rows. Fix: add isHeadOfficeBranch check to the script.
4. altitude: NO unique index on staff.employee_code anywhere in sql/ → ship an idempotent
   sql/*.sql (owner runs in Supabase SQL editor; pre-flight dup check REQUIRED — legacy
   trailing-space ECs + is_shadow rows may collide; consider partial index). Client guards
   stay as defense-in-depth. NOT executed by assistant (prod DDL).
5. cleanup: duplicated HEAD_OFFICE_ECS.add() in onboarding branches — hoist.
Design note (accepted, → Phase 4 card): keep role="staff"+cfg.headOffice, but Phase 4 must
branch ONCE at boot() into a dedicated HO render path (no per-function flag threading).
Clean angles: conventions, reuse, efficiency, removed-behavior (B verified dup-guard contract,
obList completeness, pin-gate salon safety + no stale-session risk, managerToRow one-way).

## 2026-07-08 · Phase 4 (kiosk HO experience) · Opus · DONE (uncommitted)
Branch-ONCE-at-boot() design honoured — no per-function flag threading.
- `kiosk/staff-app.js`:
  - `boot()` (~41): `if (cfg.headOffice) { bootHeadOffice(); return; }` — salon path untouched.
  - `bootHeadOffice()`: restricted header (Home · Schedule · Today · Staff · Log out); sets
    `_backHandler = renderHoLanding` so reused flows' Back never drops into the salon dashboard.
  - `renderHoLanding()`: exactly two tiles — Clock In + Request Off (reuses `renderOffRequests`).
  - Clock-in stack: `_loadHoSchedule` (published `getApprovedSchedule(ym,"tech")` [0] → draft
    fallback, per d9f6db6), `_hoTodayRoster` (active HO staff whose today cell isWorkingShift),
    `renderHoClockin`/`_paintHoClockList(interactive)`, `_doHoClock`. Photo is MANDATORY:
    `_hoSelfie` (BOA_CAMERA user-facing) → null aborts; only after a non-null dataUrl does
    `addManagerClockinWithMeta(id,type,{photoDataUrl})` run → clockins row + `boa_mgrclockin_meta_<id>`
    sidecar (A5). On clock-IN also `setAttendanceStatus(ymForDate,day,ec,"on")` → `boa_att_Head Office_*`
    + kiosk log. `renderHoStaffList()` = same roster read-only (Staff button).
  - Finding #7: folded the raw `/\dM$|^M\d/` copy in `shouldNagUnsubmittedCheckin` into the
    HO-aware `isManagerStaff({employee_code:ec})` — one predicate, salon result identical.
- `kiosk/data.js`: new `boa_ho_requests_v1` key + `_loadAllHoRequests`/`_saveAllHoRequests`;
  `addOffRequest`/`listOffRequests`/`deleteOffRequest` route to it when `isHeadOfficeBranch(branch())`
  — HO off-requests never touch `boa_tech_requests_v1`/`boa_mgr_requests_v1`.
- Verifiers: node --check on staff-app/data/config/pin-gate all green. All reused APP_DATA methods
  confirmed exported (listStaff branch-scoped, listTodayClockins, addManagerClockinWithMeta,
  setAttendanceStatus, getApprovedSchedule, ymForDate).
- Provable no-op today: with zero HO staff/schedule seeded the roster is empty ("No one scheduled")
  and no writes fire; salon kiosks byte-identical (boot branch gated on cfg.headOffice; nag
  predicate result unchanged for salon codes).
- **SEEDING DEPENDENCY (Phase 1b):** the HO published grid cells must use a code `isWorkingShift`
  accepts (W/WE/WL/WB/WM/E) or the Today roster stays empty. §E says M–F 08:00–16:00 → seed as "W".
- **NEXT: Fable /code-review of Phase 4**, then Phase 5 portal surfaces.

## 2026-07-08 · Phases 2+3 REVIEW FIXES APPLIED · Opus · DONE (uncommitted)
All 5 findings from the 07-07 gate resolved:
1. ✅ onboarding step 2b (app.jsx:27474) — added `!isHeadOfficeBranch(obForm.branch)` to the
   `isTech` schedule auto-sync guard (recomputed inline; `_hoHire` out of scope here).
2. ✅ onboarding step 2c (app.jsx:27551) — same guard added to the `isMgrPos` manager-coverage
   auto-gen. HO hire of any position now writes NO `boa_sched_Head Office_*` grid/snapshot.
3. ✅ seed_consolidated.js (~80) — branch guard added BEFORE the suffix ladder: branch
   "Head Office" ⇒ role_type "head_office" (wins over an -M code). node --check green.
4. ✅ sql/staff_employee_code_unique.sql authored — PRE-FLIGHT case-insensitive dup query +
   partial expression unique index on `upper(btrim(employee_code))`. NOT executed (owner-run
   prod DDL; must clear pre-flight first). Client dup guards remain as defense-in-depth.
5. ✅ HEAD_OFFICE_ECS.add() hoisted out of the two onboarding save branches (app.jsx:27405).
- Verifiers: node --check {seed_consolidated, data, kiosk/data, kiosk/pin-gate}.js all green;
  babel(app.jsx) green.
- **NEXT: Phase 4** — kiosk HO experience. Branch ONCE at boot() (design note above): restricted
  menu (Home/Schedule/Today/Staff), photo-MANDATORY clock-in (block on null, unlike mgr flow),
  request-off → `boa_ho_requests_v1`, patch kiosk isManagerRow regex copies. Then /code-review.

## 2026-07-07 · Phase 3 (portal hoStaff population) · Opus · DONE (uncommitted)
- `app.jsx`: new `const [hoStaff, setHoStaff] = useState([])` (15610) + `setHoStaff(d.hoStaff)` in
  loadAll's .then (18821), beside the HEAD_OFFICE_ECS rebuild. data.js split already done in 1a.
- HO is now a first-class portal population, separate from `staff`/`managers`/`enriched`
  (enriched derives from `staff`, which excludes HO → HO not in it). Value `hoStaff` unused until
  Phase 5 surfaces consume it. No-op on current data (d.hoStaff empty). babel(app.jsx) green.
- **NEXT: review gate before Phase 4** (covers Phases 2+3 — kiosk gate + hoStaff state; 1a
  already gated). Then Phase 4 kiosk HO UX.

## 2026-07-07 · Phase 2 (kiosk registry + PIN gate) · Opus · DONE (uncommitted)
- `kiosk/config.js`: BRANCHES gains `{ name:"Head Office", pin:"0025", …, headOffice:true }`
  (geo placeholder, enforceGeo:false — decision #5); APP_CONFIG propagates `headOffice`.
- `kiosk/pin-gate.js`: `managerPin` maps to role `cfg.headOffice ? "staff" : "manager"` → the HO
  PIN (0025) opens the STAFF app; no manager dashboard at HO.
- Salon regression: every salon entry has no `headOffice` key ⇒ `!!undefined === false` ⇒
  `managerPin` still → "manager", byte-identical. node --check on both files green.
- Note: "Head Office" now shows in the kiosk store-picker (intended — needed to configure an HO
  device). Manual PIN test deferred to post-deploy (verify-after-deploy).

## 2026-07-07 · Phase 1a REVIEW GATE · Fable /code-review · 8 findings (4 CONFIRMED fix-now)
8 finder angles + 3 verifier votes. Verified findings, ranked:
1. **CONFIRMED** dup-EC guard blind to HO (app.jsx:2962 scans `allStaff={staff}` only; NO
   unique constraint on employee_code in any sql/*.sql) → salon save can collide with an HO EC.
2. **CONFIRMED** next-EC generator blind to HO (app.jsx:26259 scans staff+managers+obList;
   minted EC never re-validated) → onboarding can mint an HO person's code.
3. **CONFIRMED** borrow-picker leak (kiosk/data.js:278 `!isManagerRow` only + staff-app:1192
   eligibility passes once boa_sched_Head Office_* exists) → ALL HO staff borrowable at salons.
4. **CONFIRMED** managerToRow writes `role_type: m.roleType || "manager"` (data.js:178) with NO
   branch derivation; trigger = onboarding form ALREADY offers branch "Head Office"
   (app.jsx:27713) with SM/SSM/AM position (27314) → saveManager (27380) writes the poisoned
   manager+HO row that breaks myboa's raw role_type reads. (Transfer-settle trigger REFUTED —
   TransferModal is SALONS-only.)
5. **PLAUSIBLE** HEAD_OFFICE_ECS staleness: same onboarding path (27380-81) inserts an HO
   manager-shaped record into state mid-session without updating the set → misclassified until
   reload. (Initial-load race REFUTED: set built before any setState; no pre-load caller.)
6. cleanup: "Head Office" literal ×5+ across 3 files, exact-match no trim (live data shows
   branch drift: "Mushroom" vs "Mushroom Farm") → HEAD_OFFICE const + isHeadOfficeBranch().
7. cleanup/PLAUSIBLE: unpatched manager-regex copies kiosk/staff-app.js:3648 (fallback), 3688
   (inline nag) — patch opportunistically in Phase 4.
8. altitude: myboa raw role_type reads (schedule.js:849/896; kiosk clockins joins) are safe IFF
   the DB invariant "HO row never role_type='manager'" holds → enforced by fix #4 + Phase 6
   audit assertion.
Angles clean: conventions, efficiency.

**FIXES APPLIED (Opus, 2026-07-07):** #1 dup-EC guard consults HEAD_OFFICE_ECS (app.jsx:2962);
#2 next-EC scan includes ...HEAD_OFFICE_ECS (26259); #3 listStaffAllBranches excludes HO
(kiosk/data.js); #4 managerToRow derives head_office from branch (data.js:178); #5 onboarding
registers HO hires in the set + keeps them out of salon state (app.jsx:27380); #6 shared
HEAD_OFFICE const + isHeadOfficeBranch() (trim+lowercase) across all 3 files. #7 (kiosk regex
copies) → Phase 4; #8 (myboa raw role_type reads) → invariant enforced by #4 + Phase 6 audit.
Diff now 74 insertions/3 files; babel(app.jsx)+node --check(data.js,kiosk/data.js) green; still a
provable no-op on current data.

## 2026-07-07 · Phase 1a (classification foundation) · Opus · DONE (uncommitted)
Branch `feat/head-office-kiosk` (off main). **No Supabase writes.** Changes (29 insertions/3 files):
- `data.js` `getRoleType(ec, existingRole, branch)` — `branch==='Head Office'` ⇒ `head_office`
  (before suffix checks); 3 call sites now pass branch.
- `data.js` `loadAll` split — techs & mgrs gain `&& branch !== 'Head Office'`; new `hoStaff`
  bucket (by branch); returned as `hoStaff`. **Kept raw-role_type split for non-HO** (didn't
  switch to getRoleType) to avoid reclassifying any legacy manager-stored-as-tech.
- `app.jsx` module-level `HEAD_OFFICE_ECS` set + `isManagerEc` consults it (flips all ~30
  EC-only call sites at once); populated in the `loadAll().then` from `d.hoStaff` before setState.
- `kiosk/data.js` `isManagerRow` — `branch==='Head Office'` ⇒ false (defensive).

**Safety:** provable no-op on current data — no row has branch 'Head Office' and the set is empty,
so getRoleType/split/isManagerEc/isManagerRow are byte-identical for salons. Verified: babel(app.jsx)
+ node --check(data.js, kiosk/data.js) all green.
**Next:** Fable /code-review gate on this hot-path change, then Phase 2 (kiosk PIN). hoStaff is
loaded but not yet in React state (that's Phase 3). Not committed (owner tests first).

## 2026-07-06 · Phase 1 blockers RESOLVED by owner (decisions locked)
- **B3 (code conflict):** owner swapped on the site — **B563-M = Nwabisa Tshayisa (Trainer)**,
  **B564-M = Nontethelelo Nxumalo (the SSM manager)**. B563-M now safe for the trainer.
- **B4 (routing):** simplified to **two routes** — `CC` (Call Centre) → **Feroza** (Call Centre
  Mgr); **everything else → Justin** (B473-M, Payroll Mgr). "SC" is renamed **OH = Office
  Hygienist**, also → Justin. Feroza = a portal user in `boa_app_users_v1` (created, no perms
  yet); routing map references her app-user id, not an EC. Permissions for her TBD at the end.
- **⚠ NEW HARD CONSTRAINT (owner):** *no Supabase addition may appear on the LIVE site until the
  code is committed + pushed; wants to test locally first.* But **live + local share ONE Supabase**
  (`kcinqpwkwpzbosxtkwyl`, hardcoded in every HTML) — so DATA can't be "staged" behind a push.
  **Revised sequence (honors it):** build ALL code first (invisible on live — zero HO staff exist,
  so deploying HO code changes nothing) → push/deploy → THEN seed prod (HO appears only post-push).
  Open question → local testing method (separate test DB vs verify-post-deploy). **Phase 1 seed
  is DEFERRED to after the code ships.** Mushroom Farm/Verdi parked until staff clock out (midday).

## 2026-07-06 · Phase 1 · Opus · BLOCKED
Attempted Phase 1 seed with the owner's §E data. **Zero Supabase writes performed** — halted at
the pre-write verification gate. Blockers (all code-verified, read-only):

- **B1 · role_type is DERIVED from the employee code at load, not stored.** `getRoleType`
  ([data.js:20](../data.js#L20)) recomputes role_type from the EC suffix every load and does
  **not** know `head_office`: `-M`/`…M` → `manager`, `-CC` → `call_centre`, `-T`/other →
  `tech`. So storing `role_type='head_office'` **will not stick**. The owner's 20 codes would
  load as: **12 managers** (all `-M`, incl. HR/Trainers/Marketing) → pollute Manager Coverage /
  Check-ins / mgr schedules; **7 `call_centre`**; **1 tech** (B667-T Fazlin) → lands in salon
  tech lists. `isManagerEc` ([app.jsx:10913](../app.jsx#L10913)) = `/M$/i` confirms the same.
- **B2 · `role` column = SHIFT role (SM/SSM/AM)**, not job title (app.jsx:1641/10684/19786…).
  Storing `role='MC'/'CC'` collides with scheduling. Job-title/department needs a different home.
- **B3 · CODE CONFLICT:** `B563-M` already exists as an **active SSM manager, "Nontethelelo
  Nxumalo", branch Fourways** — but the sheet assigns B563-M to "Nwabisa Tshayisa, Trainer".
  Inserting would duplicate/clobber a live record (§B violation). Owner must resolve (typo vs
  real conflict). Other 19 codes are new (safe to insert once classification is fixed).
- **B4 · Routing underspecified:** goal needs *every* department mapped; sheet has **10**
  departments (SC, REC, T, OA, MC, CC, HR, MCC, PM, EPA) — **SC has no legend definition** —
  but only 2 approvers named (Feroza B476-M = Call Centre Mgr; Justin B473-M = Payroll Mgr).
  Feroza has **no BOAOS portal user yet** ("would need a pin created") → no user id to map to.
- **B5 · `call_centre` role_type has a derivation but no consuming UI** — a code path exists,
  zero downstream handling.

**Consequence — plan phase order is wrong:** the classification/loader change (was Phase 3) MUST
land BEFORE any data seed (Phase 1), or the 20 real codes mis-classify the instant the portal
loads them. This is a **planning correction**, kicked back to Fable/owner — not an Opus execution
fix (don't invent a classification scheme in an execution session).

**Also raised by owner (decision #7):** Mushroom Farm + Verdi are real salons NOT in `SALONS`
([app.jsx:1835](../app.jsx#L1835)) — 36 staff currently orphaned. Owner: "fix before the salons
open." Separate real bug; add to the backlog.

- Spend/iterations: verification only, well under cap; no writes.
- Handoff: needs a Fable planning pass to redesign classification (recommend a **branch-based
  override**: `branch==='Head Office'` ⇒ `head_office`, overriding the suffix, at `getRoleType`
  + `isManagerEc`/`isManagerRow` call sites) and owner answers on B3 (B563-M) + B4 (routing for
  all 10 depts, SC definition, Feroza's portal account).

## 2026-07-06 · Phase 0 (setup) · Fable · PARTIAL
- What changed: blueprint (head-office-kiosk-blueprint.md), execution plan
  (head-office-kiosk-plan.md incl. §F operating model), this progress file created.
  No code, no Supabase writes.
- Verifier results: live read-only probes confirmed §A facts A1-A12 (zero HO collisions;
  role_type split gotcha A4; photo sidecar A5).
- Spend: within the analysis budget; no execution runs yet.
- Blockers: §E decisions 1-7 needed from the owner before Phase 1 may start.
