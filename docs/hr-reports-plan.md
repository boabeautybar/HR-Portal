# HR Reports Tab — Plan

A new top-level **HR Reports** tab (Insights group) with two sub-tabs — **HR Outlook** and
**H&S Reports** — surfacing patterns of performance for stores, managers and nail techs.
Every report is a **table + a chart**. This document is the plan only: what each report shows,
exactly which stored data feeds it, how each number is computed, what the chart looks like,
and the open decisions. **No code in this document.**

> Rollout: ① this plan → ② a visual mock-up artifact → ③ implementation.
> **All three are done — see §G for what shipped, what changed along the way, and what is
> still outstanding.**

---

## A · Verified ground truth (what data actually exists)

Everything below was verified by code reads on 2026-08-21. Anything we could *not* verify is
in §E as a decision, not assumed.

| # | Fact | Where |
|---|------|-------|
| A1 | **Manager / Head Office / CC&S check-ins are timestamped** rows in the `clockins` table `{staff_id, branch, type: in\|out\|out_auto, ts}` ([data.js:1430](../data.js#L1430)). Reads must page past PostgREST's 1000-row cap via `_allClockinsSince` ([data.js:1427](../data.js#L1427)). `branch` is the **kiosk's** branch, not the person's. | data.js |
| A2 | **Nail techs have no clock timestamp.** Tech attendance is a status grid `boa_att_<branch>_<ym>` `{grid: {ec: {day: status}}}` ([data.js:2493](../data.js#L2493)) plus the kiosk audit log `boa_kiosk_log_<branch>_<ym>` (append-only, oldest-first, entries `{ec, ymd, status, note, ts}`, [kiosk/data.js:942](../kiosk/data.js#L942)). Tech lateness is therefore a **count of `late` cells**, never minutes. | both |
| A3 | Status vocabulary is the `STAT` registry ([app.jsx:36974](../app.jsx#L36974)): `on, late, off, sick_n` (sick **with** note, paid), `sick` (sick **no** note, unpaid), `no` (no-show), `absent, frl, al, el, ph, mat, ext, trial, …`. A `~` prefix means "mirrored from schedule, unconfirmed" and must be stripped before counting ([app.jsx:23377](../app.jsx#L23377)). | app.jsx |
| A4 | **A lateness engine already exists for office staff**: `officeHoursFindings()` ([app.jsx:14222](../app.jsx#L14222)) — pure function, computes `lateMin` = clock-in minute − scheduled start from `parseShiftRange(shiftTimes(...))`, kinds `late_ok / short / early_out / absent / no_out / pending`, with payroll-fix overlay `boa_office_hours_fixes_v1`. | app.jsx |
| A5 | **An absence-pattern engine already exists**: `loadAttendanceReports(rangeKey)` ([app.jsx:22927](../app.jsx#L22927)) builds per-person `{late, sickNote, sickNoNote, noShow, absent, frl, unpaid, missed, worked, byDow[7]}` and already emits pattern flags **`Monday-heavy`, `Friday-heavy`, `Weekend-heavy`, `Month-end cluster`, `Frequent no-note sick`**, plus `concerning` and `attendanceRate` ([app.jsx:23053](../app.jsx#L23053)). It powers the `payrollReports` tab. | app.jsx |
| A6 | **Incident reports** are a real Supabase table `incident_reports` behind key-gated RPCs ([sql/incident_reports.sql:33](../sql/incident_reports.sql#L33), loader [data.js:3210](../data.js#L3210)): `{ref_code, store, category, incident_date, urgent, about_management, status, internal_notes[], resolution, tagged_ecs[]}`. Categories: `Safety / Harassment / Management / StaffConduct / Customer / Theft / Stock / Hygiene / Other` ([app.jsx:12447](../app.jsx#L12447)). **`tagged_ecs` already links incidents to employees.** There is **no severity field** — only the `urgent` boolean. | sql, app.jsx |
| A7 | Leave-expiry radar **auto-files into the same `incident_reports` table**; those rows are identified by `isLeaveExpiryReport(r)` (`reporter_name === "HubOS auto"` + description prefix, [app.jsx:12470](../app.jsx#L12470)) and must be **excluded** from every incident report here. | app.jsx |
| A8 | **There is no company-wide disciplinary register.** Warnings exist only inside SM-trial records (`boa_sm_trial_v1 → rec.warnings[]` verbal/written/final, [app.jsx:971](../app.jsx#L971)); confirmed in [docs/sm-trial-reclassification-plan.md](sm-trial-reclassification-plan.md) §42. | docs, app.jsx |
| A9 | **Leave**: `boa_leave_v1` records must be read via `canonicalLeaveType(rec)` ([app.jsx:12975](../app.jsx#L12975)) — the `type` field is a frozen literal `"Annual leave"`; the truth is `leaveType`. Sick = `canonicalLeaveType === "Sick"`; bargaining-council staff (`staff.bargaining_council`) have sick paid by the HCSBC fund, not us ([app.jsx:13160](../app.jsx#L13160)). | app.jsx |
| A10 | **Compliance**: `staff.permit ∈ {sa_citizen, work_permit, asylum, verified_dha, z_na}` + `permit_expiry` ([data.js:118](../data.js#L118)). Non-compliant = `z_na ∪ unset` ([app.jsx:31928](../app.jsx#L31928)). The compliance tab's expiring panel already bands `permit ∈ {work_permit, asylum}` by days-out ≤ 90 ([app.jsx:32239](../app.jsx#L32239)). VFS applications overlay via `boa_compliance_actions_v1` and deliberately never clear risk ([app.jsx:3329](../app.jsx#L3329)). **There is no `nationality` column on staff** — foreign-national status is inferred from `permit !== "sa_citizen"`. | app.jsx |
| A11 | **"At risk of being let go"** already has a concrete escalation store: `boa_unpaid_legal_v1` `{ec, status: on_leave\|returned\|terminated, hearingDate}` ([data.js:2071](../data.js#L2071)). `status === "on_leave"` removes the person from active headcount → their seat is an open vacancy immediately. | data.js |
| A12 | **Recruitment need is already computed**: `salonData` memo ([app.jsx:26339](../app.jsx#L26339)) → `active` excludes on-mat / unpaid-legal / shadows / offboarded; `goal = targetCapacity ?? capacity` (auto = stations × 1.2); `recruitFuture` memo ([app.jsx:26442](../app.jsx#L26442)) → per-branch `{filledNow, filledFut, needNow, need, arriving, leaving, goal}` with transfer settlement and trial seats counted. The Locations/Recruitment panels render from these. | app.jsx |
| A13 | **Maternity** is a real table mapped by `rowToMat` ([data.js:268](../data.js#L268)); statuses `on_mat / dates_tbc / pregnant / returned / sick_leave` ([app.jsx:3374](../app.jsx#L3374)). Enrichment sets `onMat` and `pregnant` flags ([app.jsx:25521](../app.jsx#L25521)); records match **EC first, name fallback** (orphan records exist — [app.jsx:25481](../app.jsx#L25481)). | app.jsx |
| A14 | Leaver filtering is `isStillOnBooks(p, todayYmd)` ([app.jsx:3304](../app.jsx#L3304)) over **enriched** records; never filter the raw arrays. Branch resolution is `effBranch(p)` (transfer-aware). | app.jsx |
| A15 | **No chart library exists and none is wanted** — the house style is plain inline SVG compiled by Babel-standalone ([app.jsx:10552](../app.jsx#L10552)). A full set of violet `REPORT_VIZ` primitives already exists: stacked bars, dumbbell/dot plot, donut, sparkline, KPI/trend tiles ([app.jsx:18343-18720](../app.jsx#L18343)). | app.jsx |
| A16 | Pay cycle is **25th → 24th**. Attendance/kiosk keys use the **start-month** ym; schedules the **end-month** ym. Published schedule truth is `boa_schedapproved_<branch>_<ym>` **`value[0]` only**, with baked `hours` on `[0]` only ([data.js:434](../data.js#L434)). Never `toISOString()` for dates (SA = UTC+2). | data.js |

---

## B · Tab & UI architecture

### B1 · Registration (four places, one component)

New tab id **`hrReports`** — a self-contained `HRReportsTab` component in the
`StoreReportsTab` style ([app.jsx:18721](../app.jsx#L18721)), *not* an IIFE inside `App`:

1. `SETTINGS_TABS` — `{ t: "hrReports", l: "HR Reports", cat: "Insights", icon: "📈" }` ([app.jsx:10775](../app.jsx#L10775) area). The `t` key is persisted in user records — final once shipped.
2. `NAV_TAB_TO_CATEGORY` — `hrReports: "Insights"` ([app.jsx:21886](../app.jsx#L21886)).
3. Insights nav group items ([app.jsx:27617](../app.jsx#L27617)).
4. Render block next to [app.jsx:44305](../app.jsx#L44305), with the 🔒 category-gate twin from [app.jsx:40211](../app.jsx#L40211).

Permissions come free: the existing `hideTabs`/`hideCategories`/`readOnlyTabs` matrix applies,
and `ccOnly` (Ferouza) is automatically excluded since `CC_ONLY_TABS` is an allow-list.

### B2 · Sub-tabs

`hrSubTab ∈ {"outlook", "hs"}` using the **Scheduling segmented pill bar** pattern
([app.jsx:30241](../app.jsx#L30241)) — two `flex:1` pills in the pink trough. Within each
sub-tab, reports stack as cards (chart on top, table below, per report), with a shared
header row holding:

- **Range control** — 30/60/90-day pills as in Store Reports ([app.jsx:19174](../app.jsx#L19174)); recruitment forecast uses its own fixed 30/60/90 horizon columns instead.
- **Branch scope** — reuse `renderScopeBar()` ([app.jsx:21306](../app.jsx#L21306)) plus a branch `<select>` (Staffing-report style, [app.jsx:40217](../app.jsx#L40217)).
- **Role filter** — All / Managers / Nail techs / Office pills (only on the behaviour reports).
- ↻ Refresh button.

### B3 · Charts

Hand-rolled inline SVG, violet `REPORT_VIZ` palette, reusing/extending the existing
primitives (stacked bars `ReportLostByStore`-style, donut, dot plot, sparkline, KPI tiles).
One new primitive is needed: a **day-of-week / day-of-cycle heat strip** (a single-row
7-cell + 31-cell colour band) for the pattern reports — small, same SVG idiom, `<title>`
tooltips (single text node only, [app.jsx:18464](../app.jsx#L18464)).

### B4 · Data loading

Same discipline as Store Reports / Staffing:

- Per-tab `[hrData, setHrData]` state + effect gated on `tab === "hrReports"`, **content-signature dependency** ([app.jsx:25552](../app.jsx#L25552) `WHY THE SIGNATURE DEP`), sig-compare on set, 140 ms debounce.
- Heavy computation in **pure functions** (the `officeHoursFindings` model): all inputs passed in, so the artifact mock-up, the tab, and any future dashboard alert compute one answer.
- Company-wide grid reads (`boa_att_*`, `boa_kiosk_log_*`) chunk `.in()` at ~200 keys ([data.js:1569](../data.js#L1569)); `clockins` reads page via `_allClockinsSince`.
- Everything in this tab is **read-only** over existing stores. New keys (all optional, §E): `boa_hs_class_v1`, `boa_hr_watch_v1`.

---

## C · Sub-tab 1: HR Outlook

### C1 · Recruitment forecast (compliance-aware, 30/60/90)

*The Locations recruitment panel answers "who is short today". This report answers "who will
be short when peak season hits", by layering predictable departures on top of it.*

**Not a statistical model.** The "prediction" is a deterministic projection from known,
dated facts — permit expiries, unpaid-legal escalations, notice periods, maternity starts —
which is defensible and explainable per person. (A trend-based attrition rate can be added
later as a v2 line; flagged in §E5.)

**Inputs** (all existing): `recruitFuture` per-branch numbers (A12) · permit + `permitExpiry`
(A10) · `boa_unpaid_legal_v1` (A11) · future `leftDate` (notice) · maternity `pregnant` with
`matStart` set (A13) · VFS overlay `boa_compliance_actions_v1` (context column only — a
lodged VFS never reduces the risk count, A10).

**Per store, per horizon H ∈ {30, 60, 90}:**

```
baseNeed(H=now)   = needNow                            (from recruitFuture)
permitLoss(H)     = count active, permit ∈ {work_permit, asylum},
                    0 ≤ daysTo(permitExpiry) ≤ H
zNaRisk           = count active, permit ∈ {z_na, unset}     (undated → shown at every horizon, styled differently)
legalRisk         = count on unpaid-legal, status = on_leave (already out of headcount — context row, not double-counted)
noticeLoss(H)     = count active with future leftDate ≤ today+H
matLoss(H)        = count pregnant with matStart ≤ today+H
projectedNeed(H)  = needNow + permitLoss(H) + noticeLoss(H) + matLoss(H)
focusTotal(H)     = projectedNeed(H) + zNaRisk               ("recruitment focus" headline)
```

Departure sets are unioned per person (one person, one worst reason) so nobody is counted
twice. Everything filters through `isStillOnBooks` + `effBranch` (A14).

**Table** — one row per store, sorted by `focusTotal(90)` desc: Store · Goal · Active now ·
Need now · +30 / +60 / +90 projected losses (each cell expandable to the named people +
reason + date) · Z/NA undated risk · VFS in flight · **Focus total (90)** · urgency pill
(reusing the `preopen/critical/high/low/full` vocabulary, A12).

**Chart** — horizontal **stacked bar per store**: base need-now segment + permit-loss +
notice + maternity segments per horizon (30/60/90 toggle switches the stack), Z/NA as a
hatched cap segment. KPI row above: company `focusTotal` at 30/60/90 + count of stores that
flip from "full" to "understaffed" within 90 days (*the peak-season early warning*).

### C2 · Lateness patterns (managers + nail techs)

**Two data classes merged into one report** (A1/A2):

- **Timestamped** (managers, HO, CC&S): reuse `officeHoursFindings` mechanics — `lateMin` vs scheduled start from published-`hours[0]` → `boa_mgr_times_v1` → `shiftTimes()` precedence (A16). Grace: reuse `OFFICE_LATE_LOG_MIN = 10` for "counts as late".
- **Status-only** (nail techs): a "late event" = a confirmed (non-`~`) `late` cell in `boa_att_*`, cross-checked against `boa_kiosk_log_*`.

**Per person over the selected range:**

```
lateCount, lateRate = lateCount / scheduledDays
avgLateMin          (timestamped population only; "—" for techs)
recency             = days since last late  → "active" (≤14d) / "cooling" (≤45d) / "historic"
streak / trend      = sparkline of late events per week
patternFlags        = byDow[7] + day-of-cycle buckets:
                        Weekend-heavy (Sat/Sun share > 50%)
                        Payday cluster (events in the 25th–31st window > 40%)   ← pay cycle turns on the 25th (A16)
                        Monday-heavy / Friday-heavy       (reuse A5 thresholds)
                        Public-holiday adjacency          (needs an SA holiday list — §E3)
linkedIncidents     = incident_reports where person ∈ tagged_ecs AND category ∈
                      {StaffConduct, Management} AND incident_date within ±2 days of a late event
                      (leave-expiry rows excluded per A7)
```

**Filters**: branch · manager/tech/office · min events threshold.

**Table** — one row per person, sorted by lateRate desc: Name · EC · Branch · Role ·
Late count / scheduled days · Rate · Avg min late (or —) · Last late · Recency badge ·
Pattern flags (chips) · Linked incidents (count, click → refs).

**Charts** — ① **dot plot** of people (x = late rate, dot size = event count, colour =
role) in the `ReportTechMgrGap` dumbbell idiom; ② per selected person (row click): the
**day-of-week + day-of-cycle heat strips** (B3) + weekly sparkline.

### C3 · Missed days & sick days

Same skeleton, filters and layout as C2 — different event sets, so they ship as **two
side-by-side event-type toggles within one report card** ("Late" is C2; "Missed" and "Sick"
here):

- **Missed** = `no` (no-show) + `absent` cells, minus days covered by an approved planner record (`canonicalLeaveType`, A9) — the exclusion logic already exists in `loadAttendanceReports` (A5).
- **Sick** = `sick_n` vs `sick` **kept as separate columns** — no-note sick is the abuse signal (A3) and already has a `Frequent no-note sick` flag (A5). Planner `Sick` records and `list_called_in_today`-style `leave_requests` merge in for office staff who have no attendance grid. Bargaining-council staff get a ⚕ badge (sick paid by HCSBC fund, not us — A9).

Add `sickBridging` pattern flag: sick day adjacent to a scheduled off-day or weekend
(long-weekend construction). Incident linkage identical to C2.

**Implementation note:** ~90 % of C2+C3 is `loadAttendanceReports` (A5). Plan is to **lift
its `classify()`/`finish()` core into a shared pure function** used by both `payrollReports`
and this tab, extended with: manager `clockins`-based lateness minutes, day-of-cycle
buckets, recency, and incident linkage — rather than writing a second engine that drifts.

**Charts** — donut of absence-type mix (reuse `ReportLostDonut`) + the same dot plot /
heat-strip pair as C2.

### C4 · Store incident & conduct performance (+ watch list)

**Inputs**: `incident_reports` (A6) excluding leave-expiry rows (A7) and — for the
store-performance view — optionally excluding the H&S categories that sub-tab 2 owns
(toggle, default: all categories shown here, H&S sub-tab is the deep-dive).

**Severity — decision needed (§E1).** There is no severity field; proposed **derived
tiering** until one exists: `urgent=true → High`; `category ∈ {Harassment, Theft, Safety} →
High`; `about_management=true → escalated badge`; `{StaffConduct, Customer, Stock} →
Medium`; rest → Low.

**Disciplinary actions — decision needed (§E2).** No register exists (A8). Proposed proxy
for v1: an incident is "actioned" when `status = resolved` **and** its `resolution` /
`internal_notes` text matches warning vocabulary (`verbal|written|final|warning|hearing|dismiss`),
plus SM-trial warnings from `boa_sm_trial_v1.warnings[]` for the managers it covers, plus
`boa_unpaid_legal_v1` hearings. Labelled clearly as "recorded outcomes", not a formal
disciplinary count, until §E2 is decided.

**Per store:** incident count · rate per active head (so big stores aren't automatically
"worst") · category mix · High-severity share · % about management · median days-to-resolve ·
open backlog · actioned count.

**Watch list (per person):** score over the trailing 6 months =
`2·taggedHighIncidents + 1·taggedOtherIncidents + warnings(A8 scope) + unpaidLegal(3) +
patternFlagCount(from C2/C3)`. Threshold ≥ 4 → listed, with the score breakdown shown
(never a bare number). Derived-only in v1 — no new store; an optional `boa_hr_watch_v1`
sidecar for HR acknowledgement/notes is §E4.

**Table** — per store as above; watch-list table beneath: Person · Branch · Role · Score
breakdown chips · Last event · Open items.

**Charts** — ① **stacked bar per store** by category (direct reuse of the
`ReportLostByStore` shape) with a per-head-rate toggle; ② donut of severity mix; ③ KPI row:
open backlog, median resolve days, High-severity count, watch-list size.

---

## D · Sub-tab 2: H&S Reports

### D1 · H&S incident classification

The incident form's categories (A6) don't separate the owner's three H&S families, so this
sub-tab introduces a **derived H&S type** on top of them:

| H&S type | Derivation |
|---|---|
| **Health** (person harmed/unwell — fainting, injury, burns) | category `Safety` + keyword match in `description` (faint, injur, burn, cut, blood, ill, collapse, ambulance, first aid…) |
| **Facilities** (broken pedi stations, taps, plumbing blockages, odours, electrical) | any category + keywords (broken, leak, blocked, plumbing, tap, pedi station, chair, smell, odour, electrical, aircon…) |
| **Hygiene** | category `Hygiene`, plus keyword fallback (dirty, mould, pest, cockroach, sanit…) |
| **Other H&S** | category `Safety` not matching Health/Facilities |

Keyword auto-classification is a heuristic, so: ① every classification is **overridable** via
a small sidecar `boa_hs_class_v1 = { [incidentId]: { hsType, by, at } }` (new key, additive,
nothing existing touched); ② unclassified `Safety` rows land in "Other H&S" rather than
disappearing. Long-term fix — an H&S sub-type field on the incident form — is §E1.

**Table** — incident-level: Ref · Date · Store · H&S type (editable chip) · Category ·
Urgent · Status · Days open · Description (truncated).

**Charts** — ① stacked bar per store by H&S type; ② monthly trend sparkline per type;
③ donut of type mix. KPI row: open H&S items, urgent open, oldest open (days).

### D2 · Facilities & hygiene repeat-offender view

A slice of D1 focused on the physical-store families: per store, **repeat-issue detection**
— same H&S type recurring ≥ 2× in 90 days (e.g. the same store logging plumbing blockages
monthly) → "chronic issue" flag with the incident refs. Table per store: open facilities
items · repeat flags · median days-to-resolve. Chart: dot plot of stores (x = facilities
incidents per 90d, colour = has-chronic-flag).

### D3 · Maternity in-store exposure

*"Pregnant employees currently in store that could cause issues"* — a live risk view, not an
incident view:

**Inputs**: maternity table via enrichment (A13) — `pregnant` (still working) is the primary
population; `on_mat/dates_tbc` shown as context (they're out of store); `returnDate` within
60 days as "returning soon" (existing metric, [app.jsx:26321](../app.jsx#L26321)).

**Table** — per person: Name · EC · Store · Status · `matStart` (expected start of leave,
blank = **dates TBC ⚠**) · weeks until leave · scheduled days/week (from published `[0]`
grid, A16) · any H&S incidents at that store while pregnant (join on store + date range from
D1) · notes.

**Chart** — timeline bars per person (today → matStart → matEnd → returnDate) in the
`ReportOpeningTimeline` HTML-range-bar idiom ([app.jsx:18560](../app.jsx#L18560)), grouped
by store; KPI row: pregnant in store now · dates-TBC count (chase list) · on leave ·
returning ≤ 60 days.

**Gotcha honoured**: EC-first-name-fallback matching (A13) — otherwise several people show
as active while on leave.

---

## E · Open decisions (owner input wanted — defaults chosen so nothing blocks)

| # | Decision | Default if unanswered |
|---|---|---|
| E1 | **Add `severity` + `hs_type` fields to the incident form/table?** Cleanest long-term; needs a small SQL migration + form change. | Ship v1 on derived severity (C4) + keyword H&S typing with `boa_hs_class_v1` overrides (D1). |
| E2 | **Create a real disciplinary register** (warning type, date, person, linked incident)? Would make C4's "disciplinary frequency" exact instead of a proxy, and A8 shows nothing exists today. | v1 uses the labelled proxy (resolution-text vocabulary + SM-trial warnings + unpaid-legal hearings). |
| E3 | **SA public-holiday list** — none exists in the codebase; the `ph` attendance status is hand-entered. Needed for the "late around public holidays" pattern. | Add a small hardcoded `SA_PUBLIC_HOLIDAYS` constant (annual maintenance), plus treat `ph`-marked days as holidays where present. |
| E4 | **Watch-list persistence** — derived-only, or add `boa_hr_watch_v1` for HR acknowledgements/notes/dismissals? | v1 derived-only; sidecar added only if HR asks to annotate. |
| E5 | **Recruitment forecast v2** — add a historical attrition rate (leavers per store per quarter from `leftDate`/`boa_offboard_v1`) on top of the deterministic projection? | Deferred; v1 stays fully explainable. |
| E6 | **Who sees the tab** — default Insights visibility (hideable per user), or restricted like Incidents (`canSeeIncidents`)? C2–C4 and the watch list are sensitive. | Gate the whole tab by `canSeeIncidents` since incident data flows through most reports. |

---

## F · Build order (for the later implementation phase)

Each step is independently shippable and read-only unless noted:

1. **Scaffold** — tab registration ×4, sub-tab pills, header controls, empty report cards.
2. **Shared engine extraction** — lift `loadAttendanceReports`' classify/finish core into a pure shared function; add manager clockins lateness + day-of-cycle buckets + recency (feeds C2, C3, and keeps `payrollReports` on one engine).
3. **C1 Recruitment forecast** (pure projection over existing memos — no new reads).
4. **C2 + C3 behaviour reports** (heat-strip primitive lands here).
5. **C4 incidents/watch list** (severity derivation + proxy labelling).
6. **D1–D3 H&S sub-tab** (only write in the project: optional `boa_hs_class_v1` upserts, additive).
7. Optional dashboard hook: one `dashAlert()` for "stores flipping understaffed ≤ 90 days" and one for "open urgent H&S items" ([app.jsx:28136](../app.jsx#L28136)).

Data-safety: the entire tab reads existing stores; the only new keys are `boa_hs_class_v1`
(D1 override sidecar) and — only if E4 says yes — `boa_hr_watch_v1`. No existing key or row
is modified.

---

## G · Implementation status (shipped 2026-08-21)

All seven reports are built and wired. `HRReportsTab` lives next to `StoreReportsTab` in
`app.jsx`, registered at the four required places (`SETTINGS_TABS`, `NAV_TAB_TO_CATEGORY`,
the Insights nav group, and the render block).

### What was built

| Report | State | Data it actually reads |
|---|---|---|
| C1 Recruitment forecast | ✅ | `salonData` + `recruitFuture` memos, `staff.permit`/`permit_expiry`, future `left_date`, maternity table, `boa_compliance_actions_v1` (VFS column). No new reads at all. |
| C2 Lateness | ✅ | Techs: `late` cells in `boa_att_*`. Managers + HO/CC&S: `clockins` vs the **published** scheduled start. |
| C3 Missed & sick | ✅ | `boa_att_*` via the shared classifier; manager absences from `manager_day_status`. |
| C4 Incidents + watch list | ✅ | `incident_reports` (leave-expiry rows excluded), `tagged_ecs`, `boa_unpaid_legal_v1`. |
| D1 H&S by type | ✅ | Derived H&S type + `boa_hs_class_v1` overrides (the tab's only write). |
| D2 Facilities chronic issues | ✅ | Same set, filtered to Facilities/Hygiene, ≥2 in window ⇒ chronic. |
| D3 Maternity in store | ✅ | `maternity` table, EC-first **with name fallback** (orphan records — §A13). |

### The one refactor, and the proof it was safe

Step 2 of §F is done: `blank` / `markPattern` / `classify` / `finish` were lifted out of
`loadAttendanceReports` to module scope (`attBlankRec`, `attMarkPattern`, `attClassify`,
`attFinish`). Both the payroll Attendance Report and HR Reports now call the *same four*, so
a new status code can never mean one thing on one tab and something else on the other.

Because that path is payroll-adjacent, the swap was verified by a **differential test**:
4 000 randomised person-histories across all 19 status codes, comparing the original inline
implementation against the shared one on every payroll-visible field. **Zero mismatches.**
The HR-only additions (`lateDow`, `lateCycle`, `lateMinSum`, `lastLateYmd`, `scheduled`) are
purely additive and ignored by the payroll report.

Also verified: the full `app.jsx` compiles under Babel; 40 unit tests over the new pure logic
(pay-cycle indexing, classifier, pattern flags, severity, H&S classification, the recruitment
projection incl. "one person contributes one reason"); and 25 render/interaction tests driving
the mounted component in jsdom — both sub-tabs, all filters and toggles, expanding a person
row, with no console errors.

### Decisions taken (against §E)

- **E1** → shipped on derived severity + keyword H&S typing with hand-overrides. A real
  `severity` / `hs_type` column on the incident form is still the better long-term answer.
- **E2** → shipped the labelled proxy. Every screen calls it **"recorded outcomes"**, never a
  disciplinary count, because no disciplinary register exists.
- **E6** → the whole tab is gated by `canSeeIncidents(currentUser)`, in the nav *and* at the
  render site. `ccOnly` (Ferouza) is excluded automatically by the existing allow-list.

### Still outstanding

- **E3 — public holidays: NOT implemented.** There is no SA holiday list in the codebase, so
  the "late around public holidays" pattern from §C2 is the one pattern flag missing. The
  other four (Weekend-heavy, Monday-heavy, Friday-heavy, Payday cluster) all ship.
- **Incident linkage is not date-windowed.** §C2 proposed linking conduct incidents within
  ±2 days of a late event; the build links *any* StaffConduct/Management incident tagged to
  that person, which is more useful for "this person is a problem" and less precise for
  "this incident is about that lateness". Revisit if it proves noisy.
- **E4** (watch-list persistence) and **E5** (attrition-rate v2) remain deferred as planned.
- **Nail-tech lateness has no minutes** and never will until techs clock a timestamp — the
  column shows "—" for them rather than guessing.

### Post-review fixes (same day, after the first look at real data)

- **Lateness rate was wrong, sometimes wildly** — the first build divided late events by
  `scheduled`, which only counts days carrying an *attendance status*. Managers record a status
  only when something goes wrong, so a manager with twelve late clock-ins and no recorded
  absences divided by 1 and reported **1200%**. Fixed by counting `lateJudged` — days with a
  known scheduled start *and* a clock-in, i.e. days we could actually judge. Nail techs, who
  have no timestamps, fall back to their recorded days; when neither is measurable the rate is
  `null` and the column shows "—" rather than inventing a number. Regression-tested, including
  that no rate can exceed 100%.
- **The two dot plots were unreadable** — eighty managers landed in one band with their name
  labels stacked on top of each other. Replaced with **ranked horizontal bars**: the fifteen
  worst by rate for lateness, all stores for facilities, each directly labelled on the left
  axis where nothing can collide. The chart says how many of how many it is showing, and the
  table underneath still carries everyone. `HrDotPlot` was deleted rather than left unused.
- **Tooltips are now styled and structured** — the native SVG `<title>` was slow, unstyled, and
  ran a list of names into one unreadable line. Replaced with one shared tooltip: an uppercase
  label, a bold lead figure, then one line per person. Marks keep an `aria-label`, so removing
  `<title>` costs nothing for screen readers.
- **Long people-tables scroll** — the lateness and missed/sick tables show about twenty rows in
  a fixed-height scroller with a sticky header, so one busy store can't push the reports below
  it off the page. (The sticky header's rule is an inset shadow, not a border — under
  `border-collapse` a border detaches from a sticky header and floats off as you scroll.)

### Unrelated finding worth acting on

The **existing** `LOST_KINDS` ramp on the Store Reports tab ([app.jsx:18358](../app.jsx#L18358))
fails a colour check: `sick #FCD34D` and `frl #F59E0B` sit ΔE 12.6 apart — below the 15 floor
at which people with *full* colour vision can reliably separate two categorical fills — and
both fall under 3:1 contrast on white. Those two bars are genuinely hard to tell apart today.
HR Reports uses a corrected, validated five-hue palette; Store Reports was left untouched
because it is out of scope for this change.
