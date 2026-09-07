# Architectural Blueprint: Head Office Check-in Kiosk

**Read-only analysis — no code written or modified.** Maps the exact legacy files, DOM elements,
storage keys, and state mutations needed to add a Head Office (HO) check-in kiosk + portal
integration to the vanilla-JS production app.

## Context

Store staff clock in via the branch kiosk and appear on the Attendance sheet, Check-ins tabs,
and Leave Planner. **Head Office staff (Call Centre, Sales, Admin, Marketing) have none of
this** — no kiosk, no attendance surface, no photo-verified clock-in, and no approval routing.
This blueprint adds a Head Office kiosk mirroring the *manager* check-in pattern (PIN + selfie)
with a restricted menu, and integrates HO into the operations dashboard, without disturbing the
17-salon model.

## 0 · The one architectural decision that shapes everything

`SALONS` ([app.jsx:1835](app.jsx#L1835)) is the canonical *salon* list, iterated by ~every
store-shaped feature (Attendance branch pickers, Manager Coverage, Leave Planner clash rule,
Fresha, Cash-ups, capacity/recruiting). Staff whose `branch` is not in SALONS already fall into
an "orphan bucket" rendered last ([app.jsx:24869](app.jsx#L24869) — "e.g. 'Regional' managers,
Head Office").

**Recommendation: do NOT add Head Office to `SALONS`.** Adding it (even flagged, like Betty's
`lowDemand`/`closedDow`) leaks HO into every `SALONS.map(...)` — coverage grids, Fresha to-dos,
cash-ups — each needing a defensive exclusion. Instead:

- Define one constant near SALONS: `const HEAD_OFFICE = "Head Office";`
- **Opt HO in explicitly** at each surface that must know it (Attendance branch list, Leave
  Planner tabs, the new check-ins tab), rather than opting it out of ~15 surfaces.
- Precedent: the kiosk already treats its branch registry (`BRANCHES` in
  [kiosk/config.js:37](kiosk/config.js#L37)) as independent of SALONS.

A department field is also needed: `staff.notes`-adjacent columns exist, but routing needs a
first-class value. Reuse the existing `staff.role` column for HO staff (values: `"CC"` Call
Centre, `"SALES"`, `"ADMIN"`, `"MKT"`) with `role_type: "head_office"` — the staff table
already carries both columns (probed live: `role`, `role_type` exist).

## 1 · Data & Routing

### 1.1 Staff records
- **Table:** `staff` (Supabase). Mutation: HO people get `branch = "Head Office"`,
  `role_type = "head_office"`, `role = "CC" | "SALES" | "ADMIN" | "MKT"`.
- `kiosk/data.js listStaff()` already filters by `branch()` — an HO kiosk config makes it
  return exactly HO staff with zero changes.
- Portal loaders split staff into `enriched` (techs) + `managers` by `role_type`; a third
  `role_type` value keeps HO staff **out of both** salon populations automatically — they must
  be loaded into a new `hoStaff` state in `App` (mirror the `managers` load in the same effect
  that calls `setManagers`, [app.jsx:18847](app.jsx#L18847) region).

### 1.2 Approval routing map
- **New app_state key:** `boa_ho_routing_v1` = `{ "CC": "<userId>", "SALES": "<userId>",
  "ADMIN": "<userId>", "MKT": "<userId>" }` mapping department → approving portal user
  (Call Centre Manager for CC/SALES; Payroll Officer for ADMIN/MKT).
- Managed under the existing Settings → permissions pattern (the grant-list UI at
  [app.jsx:9296](app.jsx#L9296) is the model — same blurb/grant component).
- Enforced at two consumption points:
  1. **Day-off requests** — HO requests (see 2.4) render on the requests board only for the
     mapped approver (`currentUser.id === routing[dept]`, owners always see all — same
     pattern as `readOnlyTabs` gating at [app.jsx:8598](app.jsx#L8598)).
  2. **Leave requests** — My BOA leave flows through the two-step board
     (operational check + payroll officer inbox, [app.jsx:13026](app.jsx#L13026)). For HO:
     the *operational check* is assigned to the mapped approver instead of store ops; the
     payroll-officer balance step ([app.jsx:13847](app.jsx#L13847)) is unchanged.

## 2 · Kiosk (tablet, single PIN)

### 2.1 Registry + PIN — `kiosk/config.js`
- Add to `BRANCHES` ([kiosk/config.js:37-59](kiosk/config.js#L37)):
  `{ name: "Head Office", pin: "0025", geo: {...}, radiusMeters: 1000, enforceGeo: false }`.
- **Single-PIN requirement:** the existing gate ([kiosk/pin-gate.js](kiosk/pin-gate.js)) knows
  two PINs — global `staffPin` and per-branch manager `pin` — and fires
  `app:authed {role: "staff"|"manager"}` (sessionStorage `boa_checkin_role_v1`; rate-limit
  `boa_pin_fail_v1`). For HO, the branch `pin` should auth into the **HO staff app** (role
  `"staff"` at branch "Head Office"): add a config flag `headOffice: true` on the registry
  entry; `pin-gate.js` maps a correct branch-PIN entry to role `"staff"` when the flag is set
  (instead of `"manager"`). No second PIN surface appears because HO has no manager dashboard.
- Reuse the existing PIN DOM unchanged: `#pin-overlay`, `.pin-card`, `#pin-brand`,
  `#pin-error`, `#kiosk-enrol-device` ([kiosk/index.html:40-52](kiosk/index.html#L40)).

### 2.2 Home screen + restricted menu — `kiosk/staff-app.js`
- Boot path: `document.addEventListener("app:authed", …)` → `boot()` builds the header into
  `#app-root`; `renderLanding()` ([kiosk/staff-app.js:115](kiosk/staff-app.js#L115)) builds the
  tile grid.
- **Header buttons** (`.gp-btn`, `data-action` = `home | news | schedule | offreq | logout`,
  plus `#gp-menu-toggle`): for HO mode, render only **Home / Schedule / Today / Staff** (+
  logout). "Today" = the daily check-in view (`renderCheckin`/`renderDay`); "Staff" = the
  roster list (today's scheduled HO staff — same data as check-in, read-only).
- **Tiles** (`.tile-grid` in `renderLanding`): HO shows exactly two cards —
  - `#tile-checkin` → "Clock-in" (see 2.3)
  - `#tile-offreq` → "Request off" (see 2.4)
  - Omit `#tile-cashup` (no cash-ups at HO) and keep `#tile-schedule` reachable from the
    header only, per the menu restriction.
- Mechanism: gate on `cfg.headOffice` (from the registry entry) inside `boot()`/
  `renderLanding()` — same pattern as the existing `cfg._picker` early-exits
  ([kiosk/staff-app.js:8](kiosk/staff-app.js#L8)).

### 2.3 Clock-in with mandatory photo — mirror the **manager** check-in
- **Model to mirror:** manager clock-in = PIN + selfie: `capturePhoto(name)`
  ([kiosk/manager-app.js:1704](kiosk/manager-app.js#L1704)) → `window.BOA_CAMERA.capture(...)`
  (shared camera helper: live preview or system camera) → `meta.photoDataUrl`
  ([kiosk/manager-app.js:2296-2298](kiosk/manager-app.js#L2296)) → insert into the
  **`clockins` table** with the photo ([kiosk/data.js:1943-1957](kiosk/data.js#L1943), incl.
  same-direction duplicate guard).
- **Daily list of scheduled staff:** mirror `renderDay`'s scheduled-roster construction
  ([kiosk/staff-app.js:1363+](kiosk/staff-app.js#L1363)): `#dly-list` rows (`.dly-row` with
  `data-ec`, `data-id`, `data-name`), status badge `#dly-status-badge`, header `#dly-head`.
  Crucially, per the manager-kiosk precedent (commit `d9f6db6`), the roster reads the
  **PUBLISHED snapshot** `[0]`, not the draft.
- **Schedule source:** give HO a tech-style grid — live `boa_sched_Head Office_<endYm>` +
  published `boa_schedapproved_Head Office_<endYm>` (version array, newest-first, live = `[0]`
  — see `approvedKey` convention, [myboa/schedule.js:614](myboa/schedule.js#L614)). The kiosk's
  attendance-grid key helper already derives `boa_att_<branch>_<ym>` from the configured
  branch ([kiosk/data.js:692-703](kiosk/data.js#L692)) — works for "Head Office" unmodified.
- **Mutations per clock-in:** (1) `clockins` insert `{staff_id, branch: "Head Office",
  type: "in", ts, meta: {photo: dataUrl}}`; (2) day-status write into
  `boa_att_Head Office_<ym>` (the same grid the portal Attendance sheet reads). Photo is
  **mandatory**: the confirm button stays disabled until `capturePhoto` resolves non-null
  (manager flow treats null as cancel — HO flow must block instead).

### 2.4 Request-off card
- Reuse the staff flow verbatim: `renderOffRequests` ([kiosk/staff-app.js:244](kiosk/staff-app.js#L244)),
  writing via the shared helpers `_loadRequestsAt`/`_saveRequestsAt`
  ([kiosk/data.js:1540-1556](kiosk/data.js#L1540)). **New key** `boa_ho_requests_v1` (same
  record shape as `boa_tech_requests_v1`) so HO requests don't leak into salon schedule
  generation; the portal requests board reads this key and applies the §1.2 routing filter.

### 2.5 Extra days for Call Centre staff
- Offers live in `boa_mgr_ed_offers_v1`, claims in `boa_mgr_ed_requests_v1`
  ([kiosk/data.js:1563-1597](kiosk/data.js#L1563)); the claim UI is the manager-kiosk card
  ([kiosk/manager-app.js:714-773](kiosk/manager-app.js#L714)); portal publishes/approves via
  `edPublishOffer` / `edComputeEligible` / `edApplyToSchedule`
  ([app.jsx:15907-16024](app.jsx#L15907)).
- For HO: surface the same claim card on the HO kiosk **only for `role === "CC"`** staff.
  `edComputeEligible` requires an O/R cell on the person's **published home grid** — satisfied
  once HO has the published snapshot from §2.3. Eligibility must widen from
  `enrichedManagers` to include `hoStaff` with role CC (one filter change in
  `edManagersOn`, [app.jsx:15895](app.jsx#L15895)).

## 3 · Operations Dashboard (portal, `app.jsx`)

### 3.1 Attendance sheet under "Head Office"
- The Attendance tab's branch picker + population: `attStaff` is built from
  `enriched`/`managers` filtered by `attBranch` ([app.jsx:28438-28443](app.jsx#L28438)).
  Changes: add `"Head Office"` to the branch options (explicit opt-in, not via SALONS) and a
  third `attStaff` source mapping `hoStaff` (role label = their department). The grid data
  path is already branch-generic: `boa_att_Head Office_<ym>` + `checkInsByBranch` keyed by
  branch — kiosk writes from §2.3 appear without further plumbing.

### 3.2 New "Head office check ins" tab (photo verification)
- **Model to clone:** the Manager Check-ins tab — registry entry
  `{ t: "mgrclockins", l: "Manager Check-ins", cat: "Operations", icon: "🕐" }`
  ([app.jsx:8745](app.jsx#L8745)); state `mgrClockinRows` ([app.jsx:16896](app.jsx#L16896));
  load effect gated on tab ∈ {dashboard, mgrclockins, attendance, mgrCoverage}
  ([app.jsx:19123](app.jsx#L19123)); manual clock-in modal ([app.jsx:16932](app.jsx#L16932));
  photos come from the `clockins` rows' meta.
- New entries: tab `{ t: "hoCheckins", l: "Head office check ins", cat: "Operations" }`,
  category mapping at [app.jsx:16877](app.jsx#L16877), state `hoClockinRows` filtered to
  `branch === "Head Office"`, and a render block cloned from mgrclockins showing name /
  time / **photo thumbnail** / absent-tagging (reuse `_ABS_STYLE` reason codes +
  `manager_day_status`-style tagging, [kiosk/data.js:1875](kiosk/data.js#L1875)).

### 3.3 Leave Planner "Head Office" tab
- Tab: `{ t: "leave", … }` ([app.jsx:8746](app.jsx#L8746)). The planner groups by branch and
  applies the operational clash rule "1 manager / branch off at a time"
  ([app.jsx:10660-10672](app.jsx#L10660)). Changes: add a dedicated **Head Office** branch tab
  (explicit, alongside the SALONS-derived tabs); the clash verdict for HO should key on
  *department* (e.g. max 1 CC person off) rather than the salon manager rule — a small branch
  in the clash function gated on `branch === HEAD_OFFICE`.
- `addToLeavePlanner` ([app.jsx:10824](app.jsx#L10824)) is EC-matched, branch-agnostic —
  approved HO leave lands on the planner without change once the HO tab renders it.

### 3.4 "Called in sick" routing
- My BOA absence flow: [myboa/absence.js](myboa/absence.js) → `submit_leave_request` RPC
  ([myboa/absence.js:165](myboa/absence.js#L165)) → `leave_requests` table → portal board
  `calledInSickWindow(leaveRequests)` ([app.jsx:10998](app.jsx#L10998), board at
  [app.jsx:12299](app.jsx#L12299)). Kiosk shows today's list via RPC `list_called_in_today`
  ([kiosk/data.js:322-327](kiosk/data.js#L322)) — already branch-scoped, so the HO kiosk's
  `#sick-today-slot` banner works as-is.
- Routing split today: managers → Manager Check-ins tab, techs → Called-in-Sick tab
  ([app.jsx:13732](app.jsx#L13732)). Add a third arm: `role_type === "head_office"` →
  the new **Head office check ins** tab (action text mirrors [app.jsx:12414](app.jsx#L12414)).
- My BOA store pickers are **hardcoded 4×** (STORES arrays — see memory
  `adding-a-store-hardcoded-lists`): "Head Office" must be hand-added to each My BOA page's
  list so HO staff can find themselves in absence/leave/schedule flows.

## 4 · What must NOT see Head Office (blast-radius guard)

Because HO is *not* in SALONS, these stay clean automatically — verify, don't modify:
Manager Coverage (`scopedBranches` from SALONS, [app.jsx:36883](app.jsx#L36883)), Fresha
to-dos, Cash-ups, capacity/recruiting (`applyDefaultRecruitTarget`), store-hours banners
(`shiftTimes` is salon-keyed — HO hours come from its own schedule grid + custom times, never
`shiftTimes`). The orphan-bucket rendering at [app.jsx:24869](app.jsx#L24869) already displays
HO staff in the compliance directory.

## 5 · Rollout order

1. Data: staff rows (`branch`/`role_type`/`role`), `boa_ho_routing_v1`, HO schedule grid +
   first published snapshot.
2. Kiosk: config registry entry (+`headOffice` flag in pin-gate), HO landing/menu, clock-in
   w/ mandatory photo, request-off (new key), CC extra-day card.
3. Portal: Attendance opt-in, `hoCheckins` tab, Leave Planner HO tab, called-in-sick routing
   arm, requests-board routing filter.
4. My BOA: add "Head Office" to the hardcoded STORES arrays.

## 6 · Verification

- **Kiosk:** enter HO PIN → staff app boots restricted (Home/Schedule/Today/Staff; only
  Clock-in + Request-off cards); clock-in blocks without a photo; confirm a `clockins` row
  with photo meta + a `boa_att_Head Office_<ym>` status appears (read-only Supabase query).
- **Portal:** Attendance → Head Office shows the same day-status; "Head office check ins"
  shows the photo; Leave Planner HO tab lists approved leave; a My BOA sick call from an HO
  person routes to the HO tab, not Manager Check-ins.
- **Routing:** a CC request is visible/actionable only by the Call Centre Manager user; an
  ADMIN request only by the Payroll Officer (owner override intact).
- **Regression:** Manager Coverage, Fresha, Cash-ups show no "Head Office" store; salon
  kiosks unaffected (`node --check` kiosk JS, Babel transform of `app.jsx`).
