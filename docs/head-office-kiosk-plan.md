# Head Office Check-in Kiosk — Execution Plan (with /goal conditions)

Companion to [head-office-kiosk-blueprint.md](head-office-kiosk-blueprint.md). This is the
**how-and-in-what-order** plan: phased, each phase with a copy-pasteable `/goal` condition,
grounded only in **verified** facts (live read-only Supabase probes + code reads on
2026-07-06), with an explicit data-safety contract so existing Supabase data cannot be
affected. **No code in this document.**

> **How to run this plan:** see **§F · Operating model (10-80-10)** — which model runs each
> phase, the exact `/goal` command to paste, stop rules/budgets, and the shared progress file
> ([head-office-kiosk-progress.md](head-office-kiosk-progress.md)) every session must update.

---

## A · Verified ground truth (no imagined scenarios)

Every claim below was checked directly; anything we could not verify is listed in §E as a
decision/unknown, not assumed.

| # | Fact | Verified where |
|---|------|----------------|
| A1 | `role_type` in the live `staff` table is exactly `tech` (416) and `manager` (81). No other values exist. | live probe |
| A2 | **Zero** staff rows have `branch = "Head Office"`; **zero** `app_state` keys contain `Head Office` or start `boa_ho_`. All proposed keys/rows are collision-free. | live probe |
| A3 | Non-salon branches already exist and are tolerated: `Mushroom Farm` (19), `Verdi` (16), `Mushroom` (1). Precedent: a branch outside `SALONS` breaks nothing; those staff fall into the orphan bucket ([app.jsx:24869](../app.jsx#L24869)). | live probe |
| A4 | **Tech/manager split:** techs are *everyone with `role_type !== "manager"`* — including null/unknown ([data.js:223-226](../data.js#L223)). A new `head_office` role_type therefore lands in the **tech population** unless the loader is changed. The blueprint's "keeps them out of both automatically" is **wrong**; §C Phase 3 fixes it. | data.js:225 |
| **A4b** | **⛔ CORRECTION (2026-07-06, after seeing real §E codes):** `role_type` is **not honoured from storage** — `getRoleType` ([data.js:20](../data.js#L20)) **derives it from the EC suffix on every load** and has no `head_office` case: `…M`→`manager`, `-CC`→`call_centre`, `-T`/other→`tech`. Storing `role_type='head_office'` **does nothing**. The owner's real codes (12×`-M`, 7×`-CC`, 1×`-T`) therefore mis-classify. **Fix must precede the seed:** a **branch-based override** (`branch==='Head Office'` ⇒ `head_office`) at `getRoleType` + `isManagerEc` ([app.jsx:10913](../app.jsx#L10913)) + `isManagerRow` ([kiosk/data.js:42](../kiosk/data.js#L42)). **Reorders the plan: classification (old Phase 3) becomes Phase 1a, before any data.** | data.js:20, app.jsx:10913 |
| **A4c** | **⛔ CORRECTION:** the `role` column is the **shift role (SM/SSM/AM)**, consumed directly by scheduling (app.jsx:1641/10684/19786…). It is **not** a free-text job-title field. Department/job-title (SC/CC/MC/…) needs a **different home** (new column or an app_state sidecar), NOT `role`. Supersedes the blueprint's "reuse `staff.role`". | app.jsx:1641 |
| A5 | **Clock-in photo storage:** the manager flow inserts a minimal `clockins` row `{staff_id, branch, type}` and stores the selfie + GPS in a **separate `app_state` sidecar key** `boa_mgrclockin_meta_<clockinId>` ([kiosk/data.js:1939-1971](../kiosk/data.js#L1939)). There is no photo column on `clockins`. One clock-in per person per day is enforced by a dup-guard. | kiosk/data.js |
| A6 | PIN gate: `role = "staff"` iff PIN equals `cfg.staffPin`, `"manager"` iff `cfg.managerPin` ([kiosk/pin-gate.js:165-166](../kiosk/pin-gate.js#L165)); branch registry `BRANCHES` supplies the per-branch manager PIN ([kiosk/config.js:26-59](../kiosk/config.js#L26)). Session role in sessionStorage `boa_checkin_role_v1`. | pin-gate.js |
| A7 | Attendance grid keys are branch-generic: `boa_att_<branch()>_<startYm>` ([kiosk/data.js:692-703](../kiosk/data.js#L692)); sidecars `boa_swaps_/boa_extras_/boa_absences_/boa_dly_/boa_proof_` all derive from `branch()` the same way. "Head Office" works with zero changes. | kiosk/data.js |
| A8 | Off-day requests are whole-array upserts per key: `boa_tech_requests_v1` / `boa_mgr_requests_v1` ([data.js:633-658](../data.js#L633), [kiosk/data.js:1504-1556](../kiosk/data.js#L1504)). A **new** key isolates HO fully. | both |
| A9 | Extra days: offers `boa_mgr_ed_offers_v1`, claims `boa_mgr_ed_requests_v1`; kiosk claim card [kiosk/manager-app.js:714-773](../kiosk/manager-app.js#L714); portal engine `edComputeEligible`/`edApplyToSchedule` requires an **O/R cell on the person's published home grid** and currently draws candidates from `enrichedManagers` only ([app.jsx:15895-15932](../app.jsx#L15895)). | app.jsx |
| A10 | Called-in-sick: My BOA `submit_leave_request` RPC (insert-only, [myboa/absence.js:165](../myboa/absence.js#L165)) → `leave_requests` → portal board `calledInSickWindow(leaveRequests)` ([app.jsx:10998](../app.jsx#L10998)); manager vs tech routing split at [app.jsx:13732](../app.jsx#L13732); kiosk banner via `list_called_in_today` RPC (branch-scoped). | all three |
| A11 | My BOA `STORES` arrays are hardcoded in **five** files: `leave.js`, `absence.js`, `extra.js`, `schedule.js`, `report.js` (not 4 as previously noted). | grep myboa/ |
| A12 | Kiosk manager detection also matches an EC **"-M" suffix heuristic**, not only `role_type` ([kiosk/data.js:38-44](../kiosk/data.js#L38)); portal `getRoleType` similarly derives from EC. HO employee codes must avoid manager-suffix shapes. | kiosk/data.js |

## B · Data-safety contract (nothing existing is touched)

Every write in this project is one of the three classes below. **No existing app_state key is
modified, no existing staff/clockins row is updated or deleted.** All writes happen only in
their named phase; Phases 0–2 are reversible by plain deletion.

| Class | Writes | Rollback |
|---|---|---|
| **New rows** in existing tables | `staff` inserts (HO people); `clockins` inserts (HO clock-ins, at go-live only); `leave_requests` inserts (only via the existing insert-only RPC, and only when an HO person actually uses My BOA) | delete the inserted rows (identifiable: `branch = 'Head Office'` / HO staff_ids) |
| **New app_state keys** | `boa_ho_routing_v1`, `boa_ho_requests_v1`, `boa_sched_Head Office_<ym>`, `boa_schedapproved_Head Office_<ym>`, `boa_att_Head Office_<ym>` (+ HO-branch sidecars per A7), `boa_mgrclockin_meta_<newClockinId>` | delete the keys; no other reader references them (verified A2) |
| **Append to a shared key** — the only shared-state writes, both opt-in and last | `boa_mgr_ed_offers_v1` / `boa_mgr_ed_requests_v1` (only if Phase 5 ships): HO records are *appended* by the same array-upsert helpers already used by every kiosk | filter HO records back out of the array (records carry branch/EC) |

Guard rails while building: all reads during development use the **anon key, read-only**;
no writes to production Supabase happen before the phase that owns them is approved for
go-live; nothing is committed without an explicit ask (standing rule).

## C · Phases with /goal conditions

Each phase ends green only when its `/goal` condition is objectively true. Run them in order —
each phase's precondition is the previous phase's goal.

### Phase 0 — Decisions & data design (no writes at all)
**/goal:** "Produce a signed-off HO data sheet: the list of HO staff (names, departments,
chosen employee codes using a non-manager-suffix convention per A12), the HO kiosk PIN, the
approver user for each department (CC/Sales → Call Centre Manager user, Admin/Marketing →
Payroll Officer user, as portal `appUsers` entries), and HO working-hours/schedule shape —
without writing to Supabase or modifying any file except new docs."
- Inputs: §E decisions from the owner.
- Verification: the sheet exists; a read-only probe re-confirms zero collisions (A2).

### Phase 1 — Seed HO data (writes: new rows/keys only)
**/goal:** "All HO staff exist in `staff` with `branch='Head Office'`, `role_type='head_office'`,
department in `role`; `boa_ho_routing_v1` exists and maps every department to a real portal
user id; a first HO schedule grid `boa_sched_Head Office_<ym>` AND its published snapshot
`boa_schedapproved_Head Office_<ym>` (version array, live = `[0]`) exist for the current
cycle — verified by read-only queries — and no pre-existing row or key was modified (row/key
counts outside the new ones unchanged)."
- Order matters: staff rows first (ECs are referenced by every later key), then routing, then
  schedule + snapshot (the ED engine and the kiosk roster both need the **published** snapshot, A9).
- Rollback: delete the inserted rows/keys (§B).

### Phase 2 — Kiosk registry + PIN gate (code, no data writes)
**/goal:** "Entering the HO PIN on a kiosk configured for 'Head Office' authenticates into the
STAFF app (role `staff`), the salon kiosks' PIN behaviour is byte-for-byte unchanged
(staff PIN → staff, branch PIN → manager everywhere else), and `node --check` passes on
kiosk/config.js + kiosk/pin-gate.js."
- Files: `kiosk/config.js` (new `BRANCHES` entry + `headOffice: true` flag), `kiosk/pin-gate.js`
  (flag-gated role mapping, per A6).
- Verification: manual PIN test on an HO-configured device AND a salon device; regression =
  unchanged behaviour at one salon kiosk.

### Phase 3 — Portal population split (code; the A4 correction)
**/goal:** "HO staff (`role_type='head_office'`) appear in a new `hoStaff` portal population
and appear in NEITHER `enriched` (techs) nor `managers`; every existing tech/manager count on
Attendance, Scheduling, Coverage, Recruiting is identical before/after (spot-check two salons);
Babel transform of app.jsx passes."
- Files: `data.js` (split at 223-226 gains a third arm), `app.jsx` (load `hoStaff` alongside
  `setManagers`).
- This phase MUST precede any portal HO surface — otherwise HO staff pollute tech features (A4).

### Phase 4 — Kiosk HO experience (code + go-live writes by usage)
**/goal:** "On the HO kiosk: menu shows exactly Home/Schedule/Today/Staff (+ logout); landing
shows exactly Clock-in and Request-off cards; the Today roster lists exactly the HO staff whose
published-snapshot `[0]` cell is a working code; a clock-in is IMPOSSIBLE without a captured
photo and produces exactly one `clockins` row + one `boa_mgrclockin_meta_<id>` sidecar + a
day-status in `boa_att_Head Office_<ym>`; a request-off lands in `boa_ho_requests_v1` and
nothing is written to `boa_tech_requests_v1`/`boa_mgr_requests_v1`; salon kiosks unchanged."
- Files: `kiosk/staff-app.js` (flag-gated landing/menu; clock-in view mirroring `renderDay` +
  the manager photo flow per A5), `kiosk/data.js` (HO request key helpers).
- Verification: one full HO clock-in on a test person seeded in Phase 1, then read-only queries
  proving exactly the three expected writes and zero others.

### Phase 5 — Portal HO surfaces + routing (code)
**/goal:** "Attendance has a 'Head Office' branch view showing the Phase-4 test check-in; a
'Head office check ins' tab shows the same event WITH its photo (read from the
`boa_mgrclockin_meta_*` sidecar, A5); the Leave Planner has a Head Office tab; an HO My BOA
sick call routes to the HO tab (not Manager Check-ins, [app.jsx:13732](../app.jsx#L13732));
an HO request in `boa_ho_requests_v1` is visible/actionable ONLY by its mapped approver from
`boa_ho_routing_v1` (owner override intact); if extra-days-for-CC ships, only `role='CC'`
staff see the claim card and `edComputeEligible` accepts them ([app.jsx:15895](../app.jsx#L15895));
Manager Coverage / Fresha / Cash-ups still show NO 'Head Office'; Babel passes."
- Files: `app.jsx` (tab registry + `hoCheckins` clone of mgrclockins, Attendance opt-in, Leave
  Planner HO tab + department clash rule, routing arm, requests board), `data.js` (HO request
  loaders per A8).
- **My BOA:** add "Head Office" to the `STORES` array in all **five** files (A11).

### Phase 6 — Regression & sign-off
**/goal:** "A full regression pass is documented: one salon kiosk (staff check-in, manager
clock-in, schedule view), Manager Coverage, Attendance for one salon, My BOA for one salon
person — all byte-identical behaviour; every HO write from Phases 4-5 is enumerated in a
read-only audit query and matches §B exactly; the branch is committed only after explicit
approval."

## D · Order-of-operations rationale (why this sequence)

1. **Phase 1 before 2/4:** the kiosk roster reads the published snapshot; without seeded staff
   + snapshot the HO kiosk shows an empty list and nothing is testable end-to-end.
2. **Phase 3 before 5:** the A4 loader fact means portal surfaces built first would render HO
   staff as techs — the exact class of "phantom person" bug this codebase has bitten on before
   (guest/transfer/loan incidents).
3. **Shared-key appends last (Phase 5 ED opt-in):** every earlier phase is deletion-reversible;
   the only append-to-shared-state write ships last and only if wanted.

## E · Decisions required before Phase 1 (owner input — do not assume)

1. HO staff list + departments (CC / SALES / ADMIN / MKT) and their **employee-code convention**
   (must not end in manager-suffix shapes, A12 — propose `H###`).
2. The HO kiosk **PIN** (registry currently ends at 0024).
3. The two approver **portal users** (exact `appUsers` entries) for the routing map.
4. HO **schedule shape**: same 25th→24th cycle assumed (all grid keys derive from it, A7);
   working days/hours per department (drives the seeded grid + snapshot).
5. Whether **geo enforcement** stays off for HO (all salons currently `enforceGeo: false`).
6. Whether Phase 5's **extra-days-for-CC** ships in v1 (it is the only shared-key write).
7. What "Mushroom Farm" / "Verdi" staff are (A3) — not blockers, but the same orphan-branch
   pattern; worth confirming they shouldn't join this model later.

---

## F · Operating model (10-80-10)

How to execute this plan token-efficiently: **Fable plans and reviews; a cheaper model does
the grunt work.** Fable owns the two 10%s (this plan = the first; Phase 6 sign-off + the
per-phase review gates = the last); Opus owns the 80% (the code/data execution inside each
phase). Two mechanics notes for this harness: `/loop` without an interval **self-paces**
(no `--interval/--expires` flags needed), and `/goal` sets a stop-hook that blocks the session
from finishing until the condition objectively holds — which is why every card below has a
measurable end state, an explicit scope, and a hard stop rule (per-run budget + attempt cap),
so a goal can *fail loudly* instead of grinding tokens.

### F.0 Session rules (apply to every run)

- **Memory file:** every session reads
  [head-office-kiosk-progress.md](head-office-kiosk-progress.md) at start and appends an
  entry at end (phase, what changed, verifier results, blockers). That file — not chat
  history — is the cross-session state.
- **Briefing:** each session reads THIS doc's §A facts + §B contract + its own phase card
  only. Don't re-derive the research; it's already verified.
- **Model/effort:** run execution sessions on **Opus** (switch with `/model`), default
  effort — escalate to Fable only at the marked review gates. Verify-style checks (babel,
  `node --check`, read-only audits) belong in the execution session, not a Fable pass.
- **Caps:** each card has a budget + attempt cap. On hitting either: STOP, log
  `BLOCKED: <reason>` to the progress file, end the session. Never push past a cap "to
  finish". Monitor with `/usage`.
- **Standing constraints (always in the `without` clause):** no writes to existing Supabase
  rows/keys (§B), no commits/pushes unless explicitly asked, secrets never in the repo.

### F.1 Phase run cards

| Phase | Runs on | Review gate |
|---|---|---|
| 0 Decisions | Owner + Fable (this chat) | — (human sign-off) |
| 1 Seed HO data | **Opus** | Fable checks the read-only audit vs §B |
| 2 Kiosk PIN gate | **Opus** | none (small; verifier is manual PIN test) |
| 3 Loader split | **Opus** | **Fable `/code-review`** (hot path, A4) |
| 4 Kiosk HO experience | **Opus** | Fable `/code-review` + `/verify` drive-through |
| 5 Portal surfaces | **Opus** | **Fable `/code-review`** (app.jsx blast radius) |
| 6 Regression & sign-off | **Fable** (final 10%) | — (it IS the review) |

**Phase 1 — paste into an Opus session:**
```
/goal "Seed the Head Office data per docs/head-office-kiosk-plan.md Phase 1: insert the
signed-off HO staff rows, create boa_ho_routing_v1, and create the HO schedule grid +
published snapshot for the current cycle; finish with a read-only audit query proving the
new rows/keys exist AND that no pre-existing row or app_state key changed" without
"modifying any existing Supabase row or key, writing any repo code, exceeding $5, or more
than 3 write attempts per item — on cap, log BLOCKED to docs/head-office-kiosk-progress.md
and stop"
```

**Phase 2 — Opus:**
```
/goal "Implement Phase 2 of docs/head-office-kiosk-plan.md: Head Office entry in
kiosk/config.js BRANCHES with headOffice flag, and flag-gated role mapping in
kiosk/pin-gate.js so the HO PIN auths role=staff; node --check passes on both files and a
grep proves salon PIN behaviour is untouched" without "touching any file other than
kiosk/config.js and kiosk/pin-gate.js, committing, exceeding $5, or 10 iterations"
```

**Phase 3 — Opus, then Fable review:**
```
/goal "Implement Phase 3 of docs/head-office-kiosk-plan.md: three-way role_type split in
data.js (~223-226) + hoStaff population in app.jsx, per verified fact A4; Babel transform
of app.jsx passes and a before/after count of techs+managers at two salons is identical,
logged to docs/head-office-kiosk-progress.md" without "changing any behaviour for
role_type tech or manager, touching files other than data.js and app.jsx, committing,
exceeding $8, or 10 iterations"
```

**Phase 4 — Opus, then Fable review + verify:**
```
/goal "Implement Phase 4 of docs/head-office-kiosk-plan.md: HO kiosk landing/menu
(Home/Schedule/Today/Staff; only Clock-in and Request-off cards), photo-mandatory clock-in
mirroring the manager flow (A5: clockins row + boa_mgrclockin_meta_<id> sidecar +
boa_att_Head Office_<ym> status), and request-off writing ONLY to boa_ho_requests_v1;
node --check passes on kiosk/staff-app.js and kiosk/data.js and the Phase-4 verification
checklist in the plan is executed and logged" without "altering salon-kiosk behaviour,
writing to boa_tech_requests_v1 or boa_mgr_requests_v1, committing, exceeding $15, or 15
iterations"
```

**Phase 5 — Opus, then Fable review:**
```
/goal "Implement Phase 5 of docs/head-office-kiosk-plan.md: Attendance Head Office view,
hoCheckins photo tab (reads boa_mgrclockin_meta_* per A5), Leave Planner HO tab,
called-in-sick HO routing arm, routing-filtered HO requests board, and Head Office added
to all five My BOA STORES arrays (A11); Babel passes and the Phase-5 goal checklist is
logged to the progress file" without "rendering Head Office in Manager Coverage, Fresha,
or Cash-ups, modifying existing Supabase data, committing, exceeding $15, or 15 iterations"
```

**Phase 6 — Fable (this chat):** run the §C Phase-6 regression pass + `/code-review` of the
full branch diff against this plan; on green, ask the owner for the commit.

### F.2 What was adopted vs corrected from the 10-80-10 guide

- **Adopted:** plan/execute/review model split; goal conditions = end state + scope + stop
  rule; memory/progress file; short briefings (phase cards, not the whole doc); effort
  starts medium, escalate only on real quality misses; hard caps before every run.
- **Corrected for this harness:** `/loop` self-paces without interval flags (no
  `--interval 30m --expires 8h` syntax); `/goal` is a blocking stop-hook, not a grader —
  which is why failure stops ("log BLOCKED and stop") are written into every card; and
  phase-sized `/goal` runs beat one mega-loop here because each phase gates on human
  approval (§B data safety) before the next may start.
