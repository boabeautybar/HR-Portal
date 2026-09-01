# Portal Permissions — Audit & Rework Plan

**Status: DRAFT for review** · 2026-09-01
Scope: the HR portal's 4-digit-PIN logins (`app.jsx`). Kiosk/My BOA PINs are a different population and are deliberately out of scope.

> Line numbers are as of today's working tree and will drift — every claim is keyed to a **symbol name** first; `grep -n "<symbol>" app.jsx` will always find it.

---

## 1. Executive summary

**The problem.** What looks like one permission system is actually **ten parallel ones** that grew independently: the Settings per-tab checkbox grid, free-text role-string gates, hardcoded PIN sets, `{roles, pins}` access-list configs, bespoke hand-rolled matchers, whole-account flags, magic typed action PINs, data-presence pseudo-gates, a partial DB write-guard, and a single-shared-key RLS layer. They disagree constantly:

- The Settings grid is **silently trumped on 15+ tabs** — the owner can tick "Called in Sick" for a user and nothing happens. That exact bug forced the `CALLED_IN_SICK_PINS` hardcode for Rochelle (3030), whose own comment says *"Remove once the permission model is reworked to make the Settings toggle authoritative."*
- **Read-only mode guards 21 of ~110 write methods.** A view-only user can delete a staff member via reverse-onboarding — and it half-applies (staff row deleted, EC retired, onboarding record left behind).
- **Compliance/immigration data leaks around its own gate**: the code claims "no back door" but the staff modals render an editable `CompliancePicker` ungated, and the Locations tab shows every person's DHA/permit status.
- **Two Settings panels are dead**: the Fresha trial-access panel saves config nothing reads; the off-boarding access list has a save function that is never called, so the list is only editable via raw Supabase.

**The fix.** One capability resolver — `can(user, capability)` over a central registry — that every enforcement point (nav, tab body, tab-switch, data loader, buttons) derives from, so the layers can't drift. The Settings grid becomes genuinely authoritative under a **three-tier model** (normal / list / locked — see §4.2), so a tick always does something and sensitive gates can't be mis-clicked open. Delivered in **five independently shippable phases**, the first of which is pure bug fixes with no model change.

---

## 2. The ten permission systems (inventory)

### 2.1 The per-tab grid (the thing Settings actually edits)
- `SETTINGS_TABS` (~10920): 53 keys incl. 8 `dash*` dashboard pseudo-tabs, grouped by `SETTINGS_CATS`.
- `userToPerms` (~10998) derives a `{visible, editable}` matrix: `visible = (!hideCats || showTabs) && !hideTabs`, `editable = visible && !readOnlyTabs`.
- `permsToUser` (~11023) packs the matrix back into `hideTabs`/`readOnlyTabs` — **and wipes `hideCategories` to `[]`** on every non-ccOnly save (see defect D).
- Stored on the user record (`boa_app_users_v1` in `app_state`): `hideCategories`, `hideTabs`, `showTabs`, `readOnlyTabs`.
- Nav filter (~30400): `ccOnly ? CC_ONLY_TABS : (forceShow || (!hideTabs && (!hideCats || showTabs)))`. It is a **post-hoc filter over an already-built array** — any item a hardcoded gate excluded upstream is unrecoverable by any tick.

### 2.2 Free-text role-string gates (override the grid)
- `canSeeIncidents` (~11073): `isOwner || "master admin" || includes("hr") || includes("human res") || includes("national") || isRomRole` — gates incidents, extraDayRequests, hrReports, several dashboard cards, and data loads.
- `canSeeCompliance` (~11110): word-boundary `\bhr\b` (the one place the substring bug was fixed) + recruit/payroll/dev/national.
- `isRomRole` (~11065): exact-match `"regional ops manager" | "regional operations manager" | "rom"` — `"Regional Manager"` fails.
- `canRecruitInterviews` / `canTrainInterviews` (~11196/11201), `_isOwnerOrMaster` (~11191, lowercased+trimmed).
- **8 inline case-sensitive `role === "Master Admin"` literals** (hrLibrary, storeHours, bonusConfig, voucherAdmin nav+body) — inconsistent with `_isOwnerOrMaster`.
- **~7 inline `.includes("national")` checks** (unpublished-sched scan, dashEdRequests, dashNews, Admin nav group, storeAllocation) — two different variants ("national" vs "national ops").
- `canEvaluate`/`canDecide` (~37923, SM Trials): inline re-implementations of `canSeeIncidents` that will drift.

### 2.3 Hardcoded PIN sets (no UI)
- `CALLED_IN_SICK_PINS = new Set(["3030"])` (~11094) — the Rochelle patch; tab granted, **dashboard cards still denied** (they check `canSeeIncidents`). PIN 5990 has the identical "Ops Admin" role and is not in the set.
- `SCHED_ALERT_PINS = new Set(["1993","2023","3030"])` (~26677) — declared **inside `App()`**, rebuilt every render; gates the upcoming-schedule scan + dashboard tile + Alerts rows. **The Owner is not in the set.**
- `OFFBOARD_DEFAULT_PINS` / `_PAYROLL_PINS` / `_SIGNOFF_PINS` (~11146-11162) — deliberate owner-exclusion (an owner not on the list doesn't get in).
- Migration literals `"3030"`/`"4040"` in AppGate — one-shot Settings-record mutations.

### 2.4 Access-list configs (`{roles:[], pins:[]}` via `accessAllows` ~11211)
`leaveOpsCfg`, `leavePayrollCfg`, `leaveBalancesCfg`, `officeStaffCfg`, `officeHoursCfg` — each with an `AccessPanel` in Settings. They gate tabs via `forceShow` nav items that **ignore `hideTabs` in both directions**. `accessAllows` role keys: `national` (matches "International"!), `regional`, `payroll` (matches "Finance"), `hr` (raw substring — matches "Chris…").

### 2.5 Bespoke configs with hand-rolled matchers
- `overtimeCfg` → `canRecordOvertime` (~43803): inline copy of `accessAllows` supporting only `national`/`regional` — silently drops `payroll`/`hr` and the pins path nuance.
- `cashupReviewCfg` → `canReviewCashups` (~50728): same flaw.
- `freshaCfg` (~25030): **completely dead.** Full Settings panel (opener PINs, viewer roles/pins, defaults `["3030","4040"]`), loaded, saved — **consumed by nothing**. The Fresha To-Do tab is gated purely by the normal grid; the "Fresha — due soon" dashboard card requires `canSeeIncidents`, which the default openers (3030/4040) fail.

### 2.6 Whole-account flags
- `isOwner` — near-god flag (bypasses `accessAllows`, most gates) but does **not** bypass `hideTabs`/`readOnlyTabs` in the nav filter, and does not bypass the offboard PIN list or `SCHED_ALERT_PINS`.
- `demo` — `installDemoMode()` no-ops persistence.
- `voucherEntryOnly` — replaces the whole App shell with `VoucherEntryApp`. **No Settings editor exists**; survives only via spread in `permsToUser`.
- `ccOnly` + `CC_ONLY_TABS` (~10994) — authoritative two-tab universe (comment says "six surfaces"; the set holds two — stale).
- `stores` — **only functional for `isRomRole`** (`_hasStoreScope` ~23953) despite being assignable to anyone; a *view filter* (three-state scope bar), not a boundary; **cannot be cleared** via `permsToUser` (only writes when non-empty).

### 2.7 Magic action PINs
`"2002"` typed at the moment of use for delete-location and attendance **Total Reset** — a shared secret cosplaying as auth; its own comment admits "not a security boundary."

### 2.8 Data-presence pseudo-gates
`hoStaff.length`, `ccStaff.length`, `officeTrialList.length` decide nav items and sub-tabs (hoCheckins, ccCheckins, officeTrials, scheduling/leave sub-tabs). Reads like permission to users; isn't one.

### 2.9 The read-only write-guard
`READ_ONLY_GUARDED_METHODS` (~134): an **allowlist of 21** of ~110 `BOA_DB` write methods, monkey-patched to alert+return-null when `window.__BOA_RO_ACTIVE`. The `readOnly` prop is threaded to exactly **2 of 53 tabs** (`storeAllocation`, `dailyTasks`) — neither of which is in anyone's `readOnlyTabs`. Plus ~11 raw `sb.from("app_state").upsert(...)` calls bypass `BOA_DB` entirely.

### 2.10 The server layer
RLS with a **single shared key** (see `sql/hr_trackers.sql`): the DB can tell "the portal" from "not the portal," never one portal user from another. Every rule in this document is client-side advisory. This is acceptable for a 10-user internal tool and is **not** a prerequisite to fix — real per-user server auth belongs to the Vite/TS migration (design the capability keys so they can compile to RLS policies later).

---

## 3. Ranked defect inventory

| # | Defect | Severity |
|---|--------|----------|
| A | Settings grid silently trumped on 15+ tabs | High — the headline disconnect |
| B | `forceShow` ignores `hideTabs` both directions (6 tabs) | High |
| C | Nav-hidden but body-unguarded (~27 tabs) + guard bypasses | High |
| D | `permsToUser` round-trip destroys stored state | High |
| E | Data doesn't load for visible surfaces | High |
| F | Read-only near-useless; partial destructive ops | High |
| G | Compliance/immigration data leaks around its gate | High (legal exposure) |
| H | Dead / missing Settings UIs | Medium |
| I | Role-string matching fragility | Medium |
| J | Dashboard gate chaos | Medium |
| K | Seed accounts undeletable | Medium |

**A. Grid trumped.** These tabs appear as tickable rows in `SETTINGS_TABS` while a hardcoded gate upstream decides the real answer, so ticks are silently inert: `incidents`, `extraDayRequests`, `hrReports` (`canSeeIncidents`); `compliance` (`canSeeCompliance`); `leaveRequests` (`canSeeLeaveRequests`); `leaveExpiry` (`canSeeLeaveExpiry`); `calledInSick` (`canSeeCalledInSick`); `offboard` (`canSeeOffboarding` + forceShow); `officeHours` (`canSeeOfficeHours` + forceShow); `officeStaff`/`officeTrials` (`canAddOfficeStaff` ∥ data-presence); `storeHours`, `bonusConfig`, `voucherAdmin` (owner/Master-Admin literals); `kioskPins`, `managerPins`, `storeAllocation` (owner/national/ROM). Acknowledged in-code at the `canSeeCalledInSick` comment.

**B. `forceShow`.** `offboard`, `officeHours`, `payrollInbox`, `leaveBalances`, `frl`, `bargainingCouncil` nav items set `forceShow: true`, which beats `hideTabs` in the nav filter — the visible tick for `offboard`/`officeHours` is a no-op in *both* directions.

**C. Body unguarded + bypasses.** Of ~70 `{tab === "…" &&` render sites, ~27 render on tab-key match alone (`staff`, `scheduling`, `locations`, `onboard`, `kioskPins`, `managerPins`, `cashups`, `attendance`†, …). `tryChangeTab` checks only `ccOnly` and `offboard` — never `hideTabs`/`hideCategories`. Six raw `setTab()` calls skip it entirely (maternity, staff, locations, onboard, incidents, attendance×2). The dashboard "All tools" quick-links (~32621) are **not filtered by the grid at all** — Rochelle (People+Insights hidden) gets working buttons into Onboarding, Maternity, Locations, Activity Log and Alerts. († `attendance`/`payrollReports`/`staffingReport` have `hideCategories` lock screens — killed by defect D.)

**D. Round-trip destruction.** Every non-ccOnly Settings save: (1) wipes `hideCategories` → the three Payroll lock screens go permanently dead; (2) rebuilds `hideTabs` from `SETTINGS_TABS` only → keys not in the grid (`mgrPlanner`) are dropped, so Manager Planner comes back and can never be re-hidden from the UI; (3) `stores` is only written when non-empty → a ROM's store scope can never be cleared.

**E. Data-load mismatches.** `_needRequests` (~26736) = `canSeeIncidents || canSeeFreshaTodo || canSeeCalledInSick` — it **omits** `accessAllows(leaveOpsCfg)`/`accessAllows(leavePayrollCfg)`, the very gates that reveal Leave Requests and the forceShow Payroll Inbox. A pure payroll-access grantee sees both tabs permanently empty (masked today only because most accounts also pass the unrelated Fresha To-Do branch). Also: leave-expiry incident **auto-filing** runs only for `canSeeIncidents` users — a payroll-only viewer of Leave Expiry Reports never generates them. `reloadCoreData` deps are `[currentUser]`, so it never re-runs when access configs arrive.

**F. Read-only holes.** Unguarded writes reachable from Farida's four `readOnlyTabs`: `saveCustomSalons` (add/edit/delete **branch**), `saveTechLoans`, `migrateEmployeeCode` (locations); **`deleteStaff`** + `saveRetiredEcs` + `saveProbation` (onboard — the reverse-onboarding path calls guarded `deleteManager` OR unguarded `deleteStaff`, then `saveRetiredEcs` regardless, while `saveOnboarding` is blocked → **partially-applied destructive operation**); `saveHrTrackerRecord`/`deleteHrTrackerRecord`/`setHrTrackerPayroll` (offboard); `saveByKey`/`saveApprovedSchedule` (recruitment's planner). Separately, role-agnostic: cash-up **Delete permanently** is gated only on `!_hasStoreScope` (any non-ROM with the tab can irreversibly delete a store's cash-up), **Reopen** is ungated, both escaping the cashup-review access list that gates mere tick-off.

**G. Compliance leaks.** `canSeeCompliance`'s comment claims it gates "BOTH the Compliance tab and the Compliance column … so there is no back door." Back doors: editable `CompliancePicker` rendered **ungated** in `StaffModal` (~4302), `ManagerModal` (~4563), `OfficeStaffModal` (~4856); `DhaBadge`/`VfsBadge`/permit icons on every Locations staff tile (~33701); "Z/NA (Risk)" and "No Contract" recruitment stat cards (the equivalent dashboard tile *is* gated).

**H. Dead / missing UIs.** `saveOffboardAccess` (~25146) is defined and **never called**; no panel exists despite two in-app comments promising one — the offboard PIN list is editable only by hand-editing `boa_offboard_access_v1` in Supabase. `freshaCfg` panel is fully inert (§2.5). No editor for `voucherEntryOnly` (the most privilege-reducing flag) or `showTabs`. `onUsersUpdate` omits `showTabs` from the live-session merge, so a change doesn't apply until reload.

**I. Role-string fragility.** `.includes("hr")` matches any role containing the letters (`"Chris…"`); `.includes("national")` matches `"International"`; `role === "Master Admin"` is exact-case at 8 sites while `_isOwnerOrMaster` lowercases — typing `"master admin"` grants some surfaces and not others.

**J. Dashboard chaos.** **11 alert cards have no Settings key at all** (offboardPayroll, sageReanchor, officeHours, mgrHoursDocked, mgrNoClockOut, leaveExpiry, unpublishedSched, freshaDue, probationEnding, trialHrActions, storeOpenings). `mgrSick`/`techSick` share one key (`dashCalledInSick`) AND require `canSeeIncidents` (so Rochelle got the tab but not the cards). `dashEdRequests`/`dashNews` toggles are inert for non-Owner/National; `dashHrActions` inert for ROMs. `trialAmCheckinAlert` is filed under "Home/Dashboard" but renders inside the Trial Period tab. The grid offers CAN-EDIT checkboxes for the 8 `dash*` keys and other read-only surfaces — writing them into `readOnlyTabs` where they can never match, silently inert.

**K. Undeletable seeds.** AppGate re-inserts any missing `STAFF_USERS` PIN on every boot; `PinLogin` and session-restore fall back to the seed map. Deleting PIN 1111/6666/etc. in Settings is undone on next load — and the deleted PIN still signs in meanwhile. No rate limiting; the full PIN map sits on `window.__BOA_APP_USERS`.

---

## 4. Recommended target model

### 4.1 One resolver, one registry

A single `can(user, capKey)` function over a central `CAPABILITIES` registry. Namespaces: `tab.*` (tabs), `dash.*` (dashboard cards), `act.*` (in-tab actions). Entry shape:

```js
const CAPABILITIES = {
  "tab.incidents":  { tier: "normal", surface: "tab", gridKey: "incidents",
                      audience: { roles: ["hr", "national_ops", "regional_ops", "master_admin"] } },
  "tab.compliance": { tier: "locked", surface: "tab", gridKey: "compliance",
                      audience: { roles: ["hr", "national_ops", "recruiter", "payroll", "dev", "master_admin"] } },
  "tab.payrollInbox": { tier: "list", surface: "tab", listRef: "leavePayrollCfg" },
  "act.offboard.signoff": { tier: "list", surface: "action",
                            listRef: "offboardCfg.signOffPins",
                            requires: "tab.offboard", ownerImplicit: false },
  // ...
};
```

Resolution order:
1. **Account-shape flags** (`voucherEntryOnly`, `ccOnly`, `demo`) short-circuit to the account's fixed universe — they define *which registry subset exists*, they aren't capabilities.
2. **Owner** → true, unless `ownerImplicit: false` (preserves the two deliberate owner-exclusions: the offboard list and sched alerts).
3. **Per-user override**: `hideTabs` (revoke — existing key) and `grantTabs` (grant — **new** key); behavior depends on tier.
4. **Default audience**: canonical role predicates, access-list refs, PIN lists.

### 4.2 Tiers — **revised after review**

The original three-tier model (normal / list / locked) held role and access-list grants as *ceilings* the grid could not raise. In use that turned out to be the wrong instinct: it recreated the original complaint one level up — an owner looking at a row they could not tick, needing a developer to change an access point. The owner's decision was: **roles and access lists are defaults, the grid overrides them in both directions.**

| Tier | Grid revokes? | Grid grants? | Members |
|---|---|---|---|
| **open** | ✅ | n/a (already visible) | 26 rows |
| **normal** | ✅ | ✅ via `grantTabs` | 19 rows — everything with a role or access-list default |
| **locked** | ✅ | ❌ | **`settings` only** |

**Why `settings` stays locked, and nothing else.** A grid that can hand out Settings is self-granting: whoever receives it can edit every record including the Owner's, re-grant it to themselves after it is taken away, and revoke the Owner. That is a privilege boundary, not a policy default. Every other restriction is a default worth overriding from the UI.

**`sensitive` replaces the rest of the locking.** Off-boarding, Compliance and Employee Files are flagged; the grid asks for confirmation before granting them and badges the row **SENSITIVE**. The risk a hard lock was really guarding against was never a considered decision to grant — it was a mis-click in a 60-row checkbox matrix. A confirm addresses that without a code round-trip.

**Account-shape flags stay absolute** and are deliberately not part of this: `ccOnly` (sees exactly the CC&S tabs), `voucherEntryOnly` (replaces the whole portal shell) and `demo` (persistence no-oped). Those define *which universe* an account is in rather than answering a per-tab question, so a grant cannot add to them and a hide cannot subtract.

### 4.3 Storage — additive, zero migration

Keep `hideTabs`/`readOnlyTabs` as revoke-lists (persisted everywhere; the code's own comments document why renaming keys is unsafe). Add **`grantTabs`**. Old records with no `grantTabs` resolve identically to today → rollout is zero-risk, and rolling back app.jsx never corrupts records. The editor becomes tri-state per surface — **Default / Always show / Hide** (+ Read-only) — and `permsToUser` packs *diffs from default* (fixing defect D as part of the rewrite: pass through unknown `hideTabs` keys, preserve `hideCategories`, always write `stores` including `[]`).

*Rejected:* full capability-list user records (big-bang migration, unreliable while defect K exists); reusing `showTabs` as the grant list (it has category-scoped semantics and no editor — keep read-compatible, deprecate).

### 4.4 Canonical roles

A `ROLES` registry with word-boundary matchers replaces the substring soup:

```js
const ROLES = [
  { id: "hr",           label: "HR",                   match: r => /\bhr\b|human\s*res/.test(r) },
  { id: "national_ops", label: "National Ops Manager", match: r => /\bnational\b/.test(r) },
  { id: "regional_ops", label: "Regional Ops Manager", match: r => /^regional (ops|operations) manager$|^rom$/.test(r) },
  { id: "master_admin", label: "Master Admin",         match: r => r === "master admin" },
  // payroll, recruiter, trainer, ops_admin, dev, ...
];
```

All matchers run on `lower().trim()` — fixes defect I structurally. Settings role field becomes a **dropdown** storing `roleId`, plus optional free-text `roleTitle` for display — decoupling "what shows on screen" from "what grants power." `roleIdOf(user)` prefers `roleId`, falls back to matching legacy free text; records self-heal on next save. `accessAllows`'s four role keys become `ROLES` lookups, which also fixes the two bespoke matchers (overtime, cashup) — they stop hand-rolling and call the shared resolver.

*Rejected:* hard validation rejecting unknown role strings (typo = lockout = support incident); role inheritance hierarchies (flat audiences are auditable at a glance; 10 users).

### 4.5 One ACL, four consumers

`const acl = useMemo(() => deriveAcl(currentUser, cfgs), [currentUser, cfgs])` → `{ visibleTabs: Set, readOnlyTabs: Set, can(capKey) }`. Consumers:

1. **Nav builder** — filters entirely from `acl.visibleTabs`. **`forceShow` is deleted**; access-list membership feeds the capability default instead, so those tabs appear via the same rule and become hideable.
2. **`tryChangeTab`** — gains `if (!acl.visibleTabs.has(t)) return;` as the single choke point. The 6 raw `setTab()` calls and the dashboard quick-links convert to `tryChangeTab`, and quick-link *rendering* filters by `acl.visibleTabs`.
3. **Tab bodies** — *not* 53 wrappers. One 5-line normalization effect (`if (!acl.visibleTabs.has(tab)) setTab("dashboard")`) plus one `<LockedTab/>` fallback closes all ~27 unguarded bodies and also self-heals stale tab state after a permission change.
4. **Data loading** — the tab registry gains `dataNeeds: [...]` per entry; `reloadCoreData` computes needs from `acl.visibleTabs` (granting a tab *is* granting its data — defect E becomes unrepresentable). Load in two waves: access configs first, then conditional loads, so config-dependent visibility is computed from real config.

`TAB_REGISTRY` supersedes `SETTINGS_TABS` as the single tab manifest (`{t, l, cat, icon, cap, dataNeeds, surface}`); `SETTINGS_TABS` becomes a derived view so the grid, nav, and guards can never disagree about what exists.

*Rejected:* per-body `<Guard>` wrappers (53 invasive edits in the repo's highest-churn file = highest regression risk); server-driven nav config (nothing needs runtime nav mutation).

### 4.6 Read-only: flip to wrap-all

Invert the guard: wrap **every** `BOA_DB` function except an explicit read allowlist (`^load|^get|^fetch` + named exemptions; keep `appendActivity` writable so read-only sessions still leave an audit trail). Fail-closed by construction — a future `saveX` added to data.js is guarded by default. Thread the `readOnly` prop only where affordance matters (attendance/payroll, cashups, scheduling — disable buttons instead of alert-after-click); everywhere else, alert-on-save stays. Destructive paths additionally get **pre-flight** `can("act.*")` checks *before* the first write so multi-write sequences (reverse-onboarding) can't half-apply.

### 4.7 Action-level capabilities

`act.offboard.signoff`, `act.interviews.recruit`, `act.interviews.train`, `act.smtrial.evaluate`, `act.smtrial.decide`, `act.cashups.review`, `act.cashups.delete`, `act.cashups.reopen`, `act.overtime.record`, `act.schedule.alerts` (ownerImplicit:false, replaces `SCHED_ALERT_PINS`), `act.attendance.totalReset` (locked), `act.locations.delete` (locked), `act.staff.delete` (locked). Each may declare `requires: "tab.X"` — the resolver ANDs the parent, mirroring the sound existing pattern in `canSignOffPayroll`. The duplicated `canEvaluate`/`canDecide` collapse into registry entries. **The magic "2002" PINs are removed** — replaced by locked capabilities plus a type-the-word confirm ("type RESET"): the capability check is the auth, the phrase keeps the fat-finger protection.

### 4.8 What NOT to do

- **No RBAC framework / policy engine** — no build step, no npm, 10 users. A ~200-line registry + resolver is the entire need.
- **No server-side per-user auth as a prerequisite.** With one shared RLS key and PIN login, "server enforcement" now is theater. Future work for the Vite/TS repo; design capability keys so they can compile to RLS policies later.
- **No per-field ACL system.** Compliance is the only column-level gate that exists — hardcode that one capability.
- **No renaming persisted keys** (`staff`, `hideTabs`, record shape) — in-code comments document why.
- **Don't fold kiosk/manager PINs in** — different population, different threat model.
- **No revoke-the-owner features** — owner-implicit-true (with the two documented exceptions) is right for a sole-proprietor tool.

---

## 5. Phased execution plan

Each phase ships and verifies alone. Order: stop the bleeding → invisible plumbing → the headline promise → payroll-adjacent writes → lockout-risk last.

**Status (branch `feat/permissions-hardening`, unpushed):** Phase 1 ✅ · Phase 4 ✅ + affordance pass ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 5 not started.
Phases 1 and 4 were taken out of order deliberately: 4's read-only flip is what makes the *existing* grid ticks mean anything, and it needed no model change, so it could ship while 2–3 were still on paper.

### Phase 1 — Pure bug fixes, no model change *(size M)* — ✅ SHIPPED
1. **Destructive-path guards (F):** pre-flight permission check on reverse-onboarding before any write; gate cash-up Delete/Reopen on the existing `cashupReviewCfg`; add the missed methods (`saveCustomSalons`, `saveTechLoans`, `deleteStaff`, `saveHrTrackerRecord`, `setHrTrackerPayroll`, `saveRetiredEcs`, `saveProbation`, `migrateEmployeeCode`, …) to `READ_ONLY_GUARDED_METHODS`.
2. **`permsToUser` round-trip (D):** preserve unknown `hideTabs` keys, preserve `hideCategories`, always write `stores` (incl. empty).
3. **Data loads (E):** `_needRequests` += `accessAllows(leaveOpsCfg) || accessAllows(leavePayrollCfg)`; two-wave load so configs exist before conditionals.
4. **Compliance leaks (G):** apply existing `canSeeCompliance` to the three modal `CompliancePicker`s, the Locations DHA badges, and the recruitment stat cards.
5. **Role strings (I):** word-boundary regexes in `canSeeIncidents`/`accessAllows`; route the 8 `role === "Master Admin"` literals through `_isOwnerOrMaster`.
6. **Dead code (H):** wire `saveOffboardAccess` into a real AccessPanel (ends the raw-Supabase editing); delete the inert `freshaCfg` panel.

*Payroll-adjacent in this phase: cash-ups, offboard sign-off — extra care + payroll export diff.*

### Phase 2 — Foundation, behavior-preserving *(size M)* — ✅ SHIPPED
`ROLES` (9 canonical roles, word-boundary matchers) + `CAPABILITIES` (16 entries) + `can(user, capKey, ctx)`. Every gate function is now a one-liner over `can()`; the four in-App IIFEs (`canEvaluate`, `canDecide`, `canRecordOvertime`, `canReviewCashups`) and nine inline national-ops tests are registry lookups. **Both magic PIN sets are gone from the code body** — `CALLED_IN_SICK_PINS` and `SCHED_ALERT_PINS` are now registry audiences, which is what lets Phase 3 delete the Rochelle patch by editing one entry.

**Verified: 69,106 comparisons, zero behaviour differences.** `scratchpad/aclgold.js` slices the pre-Phase-2 gates out of the git blob and the new registry out of the working tree, evaluates both, and diffs every answer across 974 synthetic users × every gate × 20 access configs. Neither side is hand-transcribed, so the harness cannot agree with itself by construction. It caught one real defect during the work: the canonical `payroll` role also matches *wages* and *finance* titles, so wiring `tab.compliance` to it would have opened permit and asylum status to a "Wages Clerk". That audience now uses a deliberately narrower `payroll_substr`.

`deriveAcl` was **not** built: it has no consumers until Phase 3 wires the nav, so shipping it now would be dead code. Account-shape flags (`ccOnly`, `demo`, `voucherEntryOnly`) also stay out of `can()` on purpose — they decide which registry *subset* applies rather than answering a capability question, and folding them in would have changed what the wrappers return, breaking the phase's one guarantee.

**Two live defect-I instances are now visible in one place** (`LEGACY_ROLE_MATCH`), preserved 1:1 rather than silently fixed:
- `tab.compliance` still matches `national` as a bare substring, and the SM-trial gates still use bare `hr` / `human res` against an *untrimmed* title.
- `"International Ops"` satisfies **both** national audiences — including Store Allocation and the PIN directories — because `"international ops"` contains `"national ops"`. The canonical `national_ops` role already rejects it; Phase 3 moves these audiences over. *Worth confirming no live record carries such a title before then.*

New console tool: `__BOA_ACL_AUDIT()` prints the effective capability matrix for the real roster (`__BOA_ACL_AUDIT("3030")` for one person).

### Phase 3 — Enforcement unification + grid authority *(size L — the big one)* — ✅ SHIPPED
`TAB_ACCESS` (52 entries) is now the single manifest of every tab's audience, and `deriveAcl` computes one answer that the nav filter, `tryChangeTab`, a new body-normalisation effect and the Settings grid all read. **52 nav keys ↔ 52 registry entries, zero conditional nav items left** — the builder supplies labels and badge counts, nothing else.

What actually changed for users:
- **The grid can grant (defect A).** New `grantTabs` key. Ticking Visible on a "normal"-tier tab the person wouldn't reach by default now records a real grant instead of removing a `hideTabs` entry that was never there. A V5 migration moves 3030's Called in Sick access from the hardcoded PIN into `grantTabs`.
- **`forceShow` is deleted (defect B).** Off-boarding, Office Hours, Payroll Inbox, Leave Balances, FRL and Bargaining Council can finally be hidden per user. *Deliberate carve-out:* an explicit per-tab hide revokes them, a whole-category hide does not (`ignoreCategoryHide`) — otherwise anyone on the leave-payroll access list who happens to have "Payroll" collapsed would have silently lost their inbox.
- **Bodies are guarded (defect C).** One normalisation effect bounces a user off any tab they can't see, closing all ~27 unguarded bodies at once instead of 27 edits in the repo's highest-churn file; every raw `setTab()` now routes through `tryChangeTab`, which is the single choke point.
- **The grid stopped lying.** Rows that can't be granted from Settings render disabled and badged **ACCESS LIST** or **ROLE-LOCKED**, with a tooltip pointing at where the grant actually lives. Granted rows are badged **GRANTED**.
- **Publish current cycle** (folded in): was `isOwner` inline on the Scheduling tab but owner-or-national on a dashboard card calling the same handler — two doors, two audiences, and the dashboard one bypassed view-only entirely, since read-only is scoped to the tab you're looking at. Now one capability plus a **pre-flight inside the handler**, so it holds whichever door was used.

Verified by `scratchpad/acltabs.js` — 47 assertions covering the intended changes and the invariants that must not move (owner reach, ccOnly absoluteness, `showTabs`, grant/revoke precedence, round-trip stability). Phase 2's golden master still reports zero capability differences.

**Dashboard cleanup (defect J), also done:** `DASH_CARDS` registers all 20 cards. Twelve had no Settings key at all — the grid listed eight rows for a surface that renders twenty things — so they could not be turned off for anyone. `dashAlert()` now applies the hide itself, which means a new card is toggleable the moment it is added rather than the moment someone remembers to add a row. `mgrSick`/`techSick` are separate keys (the legacy combined `dashCalledInSick` still hides both, for records that carry it), `trialAmCheckinAlert` moved to People since it renders in the Trial Period tab, and CAN EDIT is no longer offered on card rows — a card is shown or hidden, there is nothing on it to edit.

*Original scope:*
`TAB_REGISTRY`; nav, `tryChangeTab`, body-normalization effect + `LockedTab`, and registry-driven `dataNeeds` all reading from `acl`; delete `forceShow`; convert the 6 raw `setTab` calls + quick-links; tri-state grid editor writing `grantTabs`; **retire `CALLED_IN_SICK_PINS`** (Rochelle gets a `grantTabs` entry). Dashboard cleanup (J): registry `dash.*` keys for the 11 unkeyed cards, split `mgrSick`/`techSick`, re-home `trialAmCheckinAlert`, stop offering CAN-EDIT on read-only surfaces.

### Phase 4 — Read-only flip + action capabilities *(size M)* — ✅ SHIPPED (except `act.*` / "2002", which depend on Phase 2)
Wrap-all denylist DB guard (**102 methods guarded, up from 30**; 0 reads mis-guarded); the guard now **throws a tagged error instead of returning `null`**, so a blocked write can no longer be mistaken for a successful one — the old behaviour let execution continue past the refusal and produce a phantom branch plus a false "Added new location" audit entry. `boaSystemWrite()` exempts the portal's own background repairs (transfer auto-settle, leave-expiry auto-filing) so a view-only user sitting on a tab during a timed refresh isn't shown a dialog they didn't trigger. Settings editor for `voucherEntryOnly`.

**Affordance pass** — 37 controls across 12 surfaces now grey out with the reason in the tooltip rather than refusing after the fact: Schedule Transfer, Log borrow / Cancel loan, Apply to live, Publish an ED, Publish current cycle, the whole Leave Requests write surface (approve wizard, decline, notes, planner repair, reverse), the attendance toolbar **and the grid cells** (pre-flight before `pushUndo`, so no phantom undo entries), cash-up tick-off / reopen / delete, Add location, onboarding registration + reverse/remove, and off-boarding (off-board, quick-pick, undo, council de-registration). Recruitment reuses `InterviewsView`'s existing viewer-only path by folding read-only into `canRecruit`/`canTrain`. Helpers `roStyle`/`roTitle` are identity functions when unlocked, so nothing changes for anyone who can edit.

*`act.*` capabilities and "2002" removal remain deferred — both need the Phase 2 registry.*

*Payroll-adjacent: attendance Total Reset, sign-off — the before/after payroll export diff is still outstanding (the attendance classifier is shared with payroll).*

### Phase 5 — Seed & legacy retirement *(size S, lockout-risk, last)*
AppGate seeds only when the store key is truly missing (stop per-boot re-insertion — defect K); drop the `STAFF_USERS` login fallback once all live records are verified in Supabase; keep **one break-glass owner recovery path**; delete deprecated wrappers, the `showTabs` write path, and the migration PIN literals.

---

## 6. Verification strategy (no test suite exists)

- **Golden-master harness** — `window.__BOA_ACL_AUDIT()`: iterates all stored users × all capabilities, prints `old-gate vs can()`, throws on mismatch. Run in the console against prod data before/after deploy. **This is Phase 2's ship gate** — it turns a subjective refactor into a mechanical equivalence check.
- **"View as" simulator** (Phase 3+) — owner-only, `?simulate=1`: pick any user, `deriveAcl` runs for the impersonated record with read-only forced on and a banner. Cheap precisely because enforcement is centralized. Replaces borrow-a-PIN testing forever.
- **Manual matrix per phase** — minimum three accounts: 0864 (owner), 3030 (Rochelle — the known grid-vs-gate victim), one ROM with `stores`. Full 10-PIN sweep for Phase 3 only.
- **Read-only proof (Phase 4)** — as an RO user, attempt one write per guarded tab: expect the alert **and zero POSTs** in the Network panel.
- **Payroll safety (Phases 1 & 4)** — export the attendance/payroll report for the current period before and after deploy on identical data; the diff must be empty.
- **Rollback** — static-served site: keep the prior `app.jsx` deployable. Phase 3 writes only the additive `grantTabs` key, so rolling the file back never corrupts user records.

---

## 7. Appendix

### 7.1 Tab → gate cross-reference

**Fully Settings-driven today (tick works both ways) — 26:** staff, onboard, recruitment, trialPeriod, maternity, unpaidLegal, smTrial, scheduling, locations, checkins, mgrclockins, leave, freshaTodo, storeOpenings, movements, dailyTasks, mgrCoverage, cashups, attendance, payrollProgress, payrollReports, overtime, alerts, activity, storeReports, staffingReport.

**In the grid but overridden — 15+:**

| Tab | Overriding gate |
|---|---|
| offboard | `canSeeOffboarding` (PIN list) **+ forceShow** |
| officeStaff / officeTrials | `canAddOfficeStaff` ∥ data-presence |
| compliance | `canSeeCompliance` |
| incidents / extraDayRequests / hrReports | `canSeeIncidents` |
| leaveExpiry | `canSeeLeaveExpiry` |
| hoCheckins / ccCheckins | data-presence |
| leaveRequests | `canSeeLeaveRequests` |
| calledInSick | `canSeeCalledInSick` (+ PIN set) |
| storeHours / bonusConfig / voucherAdmin | owner/"Master Admin" literals (nav + body) |
| officeHours | `canSeeOfficeHours` **+ forceShow** |
| kioskPins / managerPins | owner/nationalOps/ROM |
| storeAllocation | owner/nationalOps |

**Live tabs with no grid entry — 8:** dashboard, settings (owner-only), hrLibrary (owner/Master-Admin), mgrPlanner (virtual), payrollInbox (forceShow + leavePayrollCfg — intentional per in-code comment), leaveBalances, frl, bargainingCouncil (all forceShow + leaveBalancesCfg, undocumented).

**Bodies rendering on tab-key match alone (no guard) — ~27:** staff, officeStaff, officeTrials, smTrial, trialPeriod, onboard, maternity, unpaidLegal, scheduling, locations, leave, storeOpenings, movements, mgrCoverage, cashups, checkins, mgrclockins, hoCheckins/ccCheckins, payrollProgress, overtime, storeReports, activity, dailyTasks, freshaTodo, alerts, recruitment, **kioskPins**, **managerPins** (the last two are nav-gated to owner/national/ROM but body-open to anyone who lands there).

### 7.2 Dashboard card → gate

| Card | Gate | Grid-controllable? |
|---|---|---|
| edOffers | owner/national **AND** !dashEdRequests | partial (role wins) |
| offboardPayroll | `isOffboardPayrollOfficer` (PIN) | no |
| sageReanchor | owner ∥ leaveBalancesCfg | list only |
| officeHours | `canSeeOfficeHours` | list only |
| mgrHoursDocked / mgrNoClockOut | `canSeeMgrHours` | no |
| leaveExpiry / freshaDue / trialHrActions | `canSeeIncidents` | no |
| unpublishedSched | owner/national | no |
| probationEnding | `canAddOfficeStaff` | list only |
| abscond | !dashAbscond | **yes** |
| mgrAbsences | !dashMgrAbsences | **yes** |
| mgrSick / techSick | !dashCalledInSick **AND** `canSeeIncidents` (shared key) | partial |
| storeOpenings | none | no |
| dailyUpdates | owner/national AND !dashNews | partial |
| securityAlerts | !dashSecurityAlerts | **yes** |
| hrActions | !_hasStoreScope AND !dashHrActions | partial |

Non-registry dashboard sections with no key at all: hero, TODAY stat tiles, Today's To-dos, Alerts-by-department, Schedule progress, Operations, Needs-attention, **All-tools quick-links** (the defect-C bypass).

### 7.3 Seeded users and what their fields actually do

| PIN | Name / Role | Fields | Reality check |
|---|---|---|---|
| 0864 | Theresa / Owner | `isOwner` | Bypasses most gates but **not** the offboard PIN list, `SCHED_ALERT_PINS`, or nav `hideTabs` |
| 1993 | Master / Master Admin | — | Role string is load-bearing at 8 case-sensitive sites |
| 2023 | Kelly / Ops Manager | hideCats: Payroll | Fails `canSeeIncidents` (in `SCHED_ALERT_PINS` though) |
| 6678 / 7890 / 5990 | Joy HR / Siphe Recruiter / Ops Admin | — | Joy passes `canSeeIncidents` via "hr"; 5990 has Rochelle's exact role but not her PIN grant |
| 3030 | Rochelle / Ops Admin | hideCats People+Insights, hideTabs locations+mgrPlanner, showTabs trialPeriod | The `CALLED_IN_SICK_PINS` case; gets the tab, not the dashboard cards |
| 4040 | Farida / Manager Trainer / LSM | readOnlyTabs ×4 | Read-only unenforced for the writes that matter (defect F) |
| 1111 | Demo | `demo` | Persistence no-oped |
| 6666 | Vouchers | `voucherEntryOnly` | No Settings editor for the flag |

All seeds are currently **undeletable** (defect K).

---

*Next step: Phase 5 — seed & legacy retirement (defect K). Lockout-risk, so last, and it needs the live records verified first.*

*Before the PR: the payroll export diff, a background-refresh soak on a view-only tab, and confirming `__BOA_ACL_AUDIT("3030")` shows the Called in Sick grant landed in her record — after which the fallback pin in `tab.calledInSick` can be deleted.*

*Delivery note: Phases 1 and 4 are accumulating as commits on `feat/permissions-hardening` and land as **one** PR to main, rather than a PR per phase, to keep hosting/deploy cost down.*
