# Leave — parked work (waiting on Sage-consultant data or a per-type report)

**Status: ⏸ PARKED (2026-07-17).** Split out of `docs/leave-sage-plan.md` so that doc
stays focused on what's live — **annual leave**. Everything here is real, scoped work; it's
just blocked on information we don't have yet. Each item lists what unblocks it.

The hub runs **hub-anchored** on the 2026-06-25 balance upload (`boa_leave_openings_v1`,
493 employees). Annual leave is accurate today; the items below extend to the other leave
types and to pushing data back into Sage.

---

## Phase 0 — Discovery with the Sage consultant  · unblocks everything below

Checklist to take to the payroll consultant / Sage Business Partner. Highest value first:
**0.4 (a sample balance report)** and **0.2 (the EC mapping)**.

- [ ] **0.1 Company number(s)** — the 3-digit Sage company code(s) (N3). If salons/HO span
      multiple Sage companies, which employees sit where?
- [ ] **0.2 Employee codes** — are Sage employee codes identical to portal ECs (`B379`,
      `B379-M`, `B412-CC`)? Sage's field is AN8. If they differ, get a full code-list export →
      becomes the `ecMap`. Note the dash variance (`B013-M` vs `B013M`) — which form does Sage hold?
- [ ] **0.3 Leave types + lines** — which leave types are configured (A/F/S/M + custom letters,
      esp. an *unpaid* type), which **leave lines** (01–30) each maps to, valid **reason codes** (AN4).
- [ ] **0.4 The balance report** — which report he exports for balances: name, format, columns
      (needs employee code, leave type, cycle start/end, balance/entitlement/taken). **Get one real
      sample file** — the Phase-2.1 parser is written against it.
- [ ] **0.5 Batch layout verification** — Payroll → Batch Transactions → Batch Layout; confirm the
      leave layout matches the Phase-4 table (Sage's PDF has a suspected typo on the From-Date column
      boundary: widths say 23–30, doc prints "23 37"). Is there a **test/dummy company** for dry-runs?
- [ ] **0.6 HCSBC in Sage** — native bargaining-council module, or consultant-modeled deductions?
      How is Sick-Pay-Fund sick leave recorded (own leave type? which letter)?
- [ ] **0.7 Leave cycle anchors** — does the annual-leave cycle run on engagement anniversary or a
      company-wide date? (The hub currently uses each person's `start_date` anniversary — the BCEA
      default — for both accrual and expiry; 0.7 confirms or corrects that.)
- [ ] **0.8 Any programmatic access** — ODBC, report scheduler, or API on our licence? (Expected: no.)

---

## Phase 1.3 — My BOA canonical request types  · unblocks: nothing (buildable, low priority)

My BOA leave/absence forms submit **Annual/Sick/Family/Maternity/Unpaid** instead of
Annual/Sick/Absent. `leave_requests.leave_type` already accepts them (no SQL change); the
canonical layer (`canonicalFromRequest`) already normalises them. Parked only because annual
is the live path and the request forms work today. Portal side already writes `leaveType`
canonically via the approval wizard.

## Phase 2.1 / 2.2 — Per-type balances & council sick model  · unblocks on 0.4 (+ 0.6)

- **2.1 Per-type balance store** `boa_leave_balances_v2`: `{asOf, source, uploadedBy, entries:{ec:
  {annual, sick, family, maternity, cycleStart, cycleEnd}}}`. Needs a **per-leave-type Sage report
  sample (0.4)** to write the parser against. Keep the v1 read path until migrated; keep the manual
  adjustments layer. Each upload also emits a **reconciliation diff** (Sage's figure vs the hub's
  computed figure at the same asOf).
- **2.2 Council-aware sick model** — `sickModelFor(person)` already returns the right rulebook
  (HCSBC **66 days / 3-year** Sick Pay Fund, 33+33, for members; BCEA **30 / 36 months** otherwise).
  Wiring it to real per-type balances needs 2.1's store; until then sick counts are hub-estimated
  from attendance history and under-count anyone whose sick predates the attendance rollout.

## Phase 4 — Sage batch export file (the "push")  · unblocks on 0.1 / 0.2 / 0.3 / 0.5

Pick a pay cycle → gather approved, **un-exported** `boa_leave_v1` records → generate Sage's
official **Leave Transaction Batch** file (`_triggerDownload`). The consultant imports it; Sage
matches on employee code and applies the days.

**File format** (Sage official — "SBCPP Leave Transaction Batch Layout",
customerzone.sagevip.co.za/doclib/General/SBCPP_LeaveTransactionBatchLayout.pdf): fixed-width,
**150 chars/record**, one transaction per line, `.TXT`/`.ASC`:

| Cols | Field | Format | Rule |
|---|---|---|---|
| 1 | `D` | A1 | details indicator |
| 2–4 | Company number | N3 | from `boa_sage_config_v1` |
| 5 | `@` | A1 | layout marker |
| 6 | Selector | N1 | 1 = by leave type |
| 7–14 | **Employee code** | AN8 | left-aligned, space-padded; via ecMap |
| 15 | Leave type | A1 | `A/F/S/M/a–z` from the canonical table |
| 16–17 | Leave line | N2 | 🔒 0.3 |
| 18 | Method | AN1 | 🔒 0.3 |
| 19–22 | Reason | AN4 | e.g. `ANN` |
| 23–30 | From date | N8 | `CCYYMMDD` (⚠ verify boundary, 0.5) |
| 31–38 | To date | N8 | `CCYYMMDD` |
| 39–47 | Total taken | N9 | implied 4 decimals, no separator: `000010000` = 1.0 |
| 48 | Sign | AN1 | `+` |
| 49 | Note received | AN1 | `Y`/`N` from sick-note metadata |
| 50–64 | Reference | AN15 | hub record `_id` short-ref (reconciliation key) |
| 65–84 | Doctor | AN20 | from sick request |
| 85–99 | Practice no | AN15 | from sick request |
| 100–149 | Comment | AN50 | branch + name |
| 150 | `Z` | A1 | terminator |

Build rules: all AN fields left-aligned space-padded; **≤500 rows per file** (chunk ourselves so
batch numbers stay predictable). Chargeable days are computed against the **published grid at
export time** (`leaveDayBreakdown`) — never the estimate stored at approval. Steps: 4.1 export
UI + generator · 4.2 stamp `sage:{exportedAt, batchRef}` on download (prevents double-export) ·
4.3 fixture test (exact column positions/padding) · 4.4 reconciliation view · 4.5 first run into
the Sage **test company**.

## Phase 6 — Bargaining council (HCSBC) data  · in-Sage details wait on 0.6

- **6.1** Promote membership: keep `staff.bargaining_council` boolean, add a sidecar (`boa_council_v1`
  or additive columns): `{member, memberNo, area}`.
- **6.2** Per-member Sick Pay Fund usage against the 66-day (33+33) 3-year cycle — feeds 2.2.
- **6.3** Maternity claims tracking (fund/UIF claim-form status).
- **6.4** Extend the council-statement parser (app.jsx) to store monthly contribution history.
- Rule sources: the **Area-specific HCSBC Main Collective Agreement** + **Sick Pay Fund Rules
  (wef 1 June 2023)** — hcsbc.co.za/downloads. Council rules override BCEA where they differ.

## Phase 7 — True API (parked)  · unblocks on 0.8, or a Sage 300 People migration

SBCPP has **no public REST API** (Sage SA KB; the developer.sage.com "Payroll API" is a UK/IE
product). Only revisit if 0.8 surfaces real access, or payroll migrates to **Sage 300 People**
(self-hosted REST, API-key auth, CSV-mapped imports). Placeholder: a `netlify/functions/sage.js`
proxy holding credentials in env vars, mirroring `netlify/functions/maps.js`. Until then, "push"
= the Phase-4 file.

---

## Verification when these un-park

| Phase | Verification |
|---|---|
| 2.1/2.2 | Upload a real per-type Sage report; hub balances for 3+ spot-check employees == the Sage screen, per leave type |
| 4 | Fixture test green; import the generated file into the Sage **test company**; consultant confirms transactions land on the right employees/types/dates; next month's reconciliation shows zero mismatches |
| 6 | Fund sick-usage for 2 known members matches council statements |
