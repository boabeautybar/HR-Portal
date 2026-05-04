[API.md](https://github.com/user-attachments/files/27362881/API.md)
# BOA ERP — API Documentation

This document covers the data layer behind the BOA HR Portal, the Check-in App, and any future apps you build on top of the same Supabase backend.

**Document version:** v1.0 (May 2026, reflects code current as of HR Portal v2 / Check-in App v1)

---

## 1. Architecture Overview

```
┌─────────────────────────┐         ┌─────────────────────────┐
│    HR Portal v2         │         │    Check-in App         │
│  (managers, browser)    │         │  (kiosk, in-store)      │
│                         │         │                         │
│  window.BOA_DB.*        │         │  window.APP_DATA.*      │
└──────────┬──────────────┘         └──────────┬──────────────┘
           │                                    │
           │       supabase-js (anon key)       │
           └──────────────┬─────────────────────┘
                          │
                  ┌───────▼────────┐
                  │   Supabase     │
                  │   (Postgres)   │
                  └────────────────┘
```

Both apps talk to the same Supabase project. They share the same tables and key conventions.

**Project URL:** `https://kcinqpwkwpzbosxtkwyl.supabase.co`
**Public anon key:** stored in `index.html` as `window.BOA_SUPABASE_CONFIG.anonKey` (HR portal) or `window.APP_CONFIG.supabase.anonKey` (check-in)

> **Security note:** the anon key is exposed in the browser. All access control happens at the Supabase Row-Level-Security (RLS) layer. The current setup is permissive by design — anyone with the URL can read/write. Lock down with RLS policies before exposing publicly.

---

## 2. Database Tables

### 2.1 `staff` — Nail technicians + Store/Assistant managers

One row per employee (techs and managers share this table, distinguished by `role_type`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | Auto-generated |
| `employee_code` | text | EC code, e.g. `B028`, `B185M`, `M005` |
| `name` | text | Full name |
| `branch` | text | Salon name (e.g. "Sea Point") |
| `role_type` | text | `tech` or `manager` |
| `role` | text | `SM` (Store Manager), `AM` (Assistant Manager); null for techs |
| `level` | text | `One`, `Two`, `Three` (techs only) |
| `contract` | text | `Permanent`, `Fixed Term`, `3 Month`, `NO CONTRACT`, `2 Weeks`, `Induction` |
| `permit` | text | `sa_citizen`, `asylum`, `z_na`, etc. (compliance status) |
| `start_date` | date | First day of employment |
| `left_date` | date | Last day worked (null for active staff) |
| `is_shadow` | bool | True for pending incoming transfers (visible but not counted) |
| `transferring` | bool | True when an outgoing transfer is pending |
| `transfer_to` | text | Target branch for pending transfer |
| `transfer_date` | date | Effective date of pending transfer |
| `transfer_note` | text | Optional context |
| `notes` | text | Free-text |
| `active` | bool | Mirror of `!left_date` |

### 2.2 `maternity`

One row per pregnancy / maternity leave instance.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `employee_code` | text | FK by convention to `staff.employee_code` |
| `name` | text | Cached for convenience |
| `branch` | text | Cached for convenience |
| `mat_status` | text | `pregnant`, `on_mat`, `returned` |
| `mat_start` | date | Leave start (when on_mat) |
| `mat_end` | date | Expected leave end |
| `return_date` | date | Confirmed return-to-work date |
| `notes` | text | |

### 2.3 `clockins` (check-in app)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `staff_id` | uuid | FK to `staff.id` |
| `branch` | text | Branch where clock-in happened |
| `type` | text | `in` or `out` |
| `ts` | timestamptz | Server timestamp |

### 2.4 `cashups` (check-in app)

Daily cashup reconciliation submitted by store managers.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `branch` | text | |
| `date` | date | Trading day |
| `yoco` | numeric | Yoco card-machine takings (ZAR) |
| `cash` | numeric | Cash takings |
| `vouchers` | numeric | Voucher redemptions |
| `discounts` | numeric | Discounts applied |
| `notes` | text | |
| `signed_by` | text | Manager who submitted |
| `created_at` | timestamptz | |

### 2.5 `app_state` — Key-value JSON store

This is the most important table. **Most app data lives here**, keyed by descriptive strings. The `value` column is JSONB and holds the full payload.

| Column | Type | Notes |
|---|---|---|
| `key` | text (PK) | See [App-state key conventions](#3-app-state-key-conventions) |
| `value` | jsonb | Per-key shape — see below |

---

## 3. App-state key conventions

All multi-record / time-bound data lives under structured keys in `app_state`. Pattern: `boa_<category>_<scope>_<period>` or `boa_<category>_v<version>`.

| Key | Value shape | Used by |
|---|---|---|
| `boa_sched_<branch>_<ym>` | `{ grid, branch, ym, savedAt }` — tech schedule | HR portal |
| `boa_mgrsched_<branch>_<ym>` | Same shape — manager schedule | HR portal |
| `boa_schedhist_<branch>_<ym>` | Array of last 5 schedule snapshots | HR portal |
| `boa_mgrschedhist_<branch>_<ym>` | Same — manager history | HR portal |
| `boa_att_<branch>_<ym>` | `{ grid, branch, ym, savedAt }` — attendance | HR + Check-in |
| `boa_swaps_<branch>_<ym>` | Array of `{ id, dateA, dateB, oweEc, coverEc, ... }` | Check-in |
| `boa_extras_<branch>_<ym>` | `{ "<day>": { "<ec>": { approvedBy, approvedAt } } }` | Check-in |
| `boa_dly_<branch>_<ymd>` | Daily check-in record (full day's signoff) | Check-in |
| `boa_proof_<branch>_<ym>_<ec>_<day>` | `{ __raw: "data:image/jpeg;base64,..." }` — proof photo | HR + Check-in |
| `boa_offreq_<branch>_<ym>` | Day-off requests for the period | HR + Check-in |
| `boa_onboard_v1` | Array of onboarding records (all branches) | HR portal |
| `boa_offboard_v1` | Array of off-boarding records (all branches) | HR portal |

**Format conventions:**

- `<branch>` is the human-readable salon name as stored in `staff.branch` (e.g. `Sea Point`)
- `<ym>` is `YYYY-MM` of the END month of the payroll cycle. The cycle runs **25th of (M-1) → 24th of M**, so April 25 – May 24 is keyed as `2026-05`.
- `<ymd>` is `YYYY-MM-DD`
- `<ec>` is the employee code
- `<day>` (in keys like `boa_proof_*` and grid keys) is the **day-of-month** as a string ("1" through "31"), not a full date

---

## 4. Grid Data Shapes

### 4.1 Schedule grid

```jsonc
{
  "grid": {
    "B028": {  // employee code
      "25": "W",   // day-of-month → status code
      "26": "W",
      "27": "O",
      "28": "L",
      // ...
    },
    "B029": { ... }
  },
  "branch": "Bree",
  "ym": "2026-05",
  "savedAt": "2026-05-04T08:30:00Z"
}
```

**Schedule status codes:**

| Code | Meaning |
|---|---|
| `W` | Working |
| `WL` | Working Late (Table Bay only — late shift indicator) |
| `O` | Off (regular off-day) |
| `R` | Requested off-day (honored from the day-off request system) |
| `L` | Leave (annual / maternity / sick) |
| `E` | Extra day worked |
| `X` | Pre-start (onboarding) or post-leftDate (offboarding) — greys out |

### 4.2 Attendance grid

Same physical shape as schedule grid (`grid[ec][day] = code`), but uses a richer status vocabulary.

**Attendance status codes:**

| Code | Label | Category | Notes |
|---|---|---|---|
| `on` | On Time | work | Confirmed present |
| `late` | Late | work | |
| `off` | OFF | off | Confirmed off-day |
| `ext` | Extra Day | work | Paid at higher rate; requires manager approval (see `boa_extras_*`) |
| `sick_n` | Sick + note | paid | BCEA: 1 paid sick day per 26 worked in first 6 months |
| `sick` | Sick NO note | unpaid (counts as paid+unpaid for reporting) | |
| `frl` | FRL + proof | paid | BCEA: requires 4+ months tenure |
| `al` | Annual Leave | paid | |
| `ph` | Public Holiday | paid | Auto-suggested from SA Public Holidays Act |
| `mat` | Maternity | paid | |
| `no` | No-show | unpaid | |
| `unpaid` | Unpaid (other) | unpaid | |
| `deduct:<hours>` | Hours Deduction | unpaid_h | e.g. `deduct:1.5` = 1h30 unpaid |
| `trial` | Trial Day | work | |
| `term` | TERMINATED | none | Cascades from off-boarding leftDate |
| `swap_o` | Swap (owes) | swap | Took the day off, owes a return shift |
| `swap_i` | Swap (owed) | swap | Worked covering, will get a day off later |

**`~` prefix:** A leading tilde (e.g. `~on`) means the value was auto-mirrored from the schedule and is **not yet confirmed**. The HR portal renders these in faded italic. The check-in app strips the prefix on save.

### 4.3 Onboarding / Off-boarding records

```jsonc
// boa_onboard_v1 — array
[
  {
    "_id": 1735000000000,
    "name": "Aabidah Sulaiman",
    "ec": "B900",
    "branch": "Sea Point",
    "position": "Nail Tech",         // "Nail Tech" | "SM" | "AM" | "Other"
    "positionOther": "",             // when position === "Other"
    "startDate": "2026-04-21",
    "notes": "Transfer from JHB",
    "addedAt": "2026-04-15T09:00:00Z",
    "updatedAt": "2026-04-21T08:30:00Z"
  }
]

// boa_offboard_v1 — array
[
  {
    "ec": "B268",
    "name": "Zoey Adonis",
    "branch": "Sea Point",
    "leftDate": "2026-04-30",        // last day worked
    "reason": "Resigned",            // Resigned | Terminated | Mutual agreement | End of contract | Other
    "notes": "Moving to JHB\n[Auto-added from attendance: terminated from 2026-05-01]",
    "addedAt": "2026-05-01T10:15:00Z"
  }
]
```

### 4.4 Schedule version snapshot

```jsonc
// boa_schedhist_<branch>_<ym> — array, newest first, max 5
[
  {
    "savedAt": "2026-05-03T14:32:11Z",
    "grid":    { /* full prior grid */ },
    "branch":  "Sea Point",
    "ym":      "2026-05"
  }
]
```

---

## 5. JavaScript Client API

### 5.1 HR Portal — `window.BOA_DB`

Loaded by including `data.js`. All methods are async unless noted.

#### Bootstrapping

| Method | Returns | Description |
|---|---|---|
| `BOA_DB.isReady` | bool | True when Supabase config + library both available |
| `BOA_DB.sb` | client | Raw `supabase-js` client. Use for ad-hoc queries. |

#### Bulk read

```js
const { staff, managers, matRecs } = await BOA_DB.loadAll();
```

#### Staff CRUD

```js
await BOA_DB.saveStaff(s);                    // insert if !s.id, update if s.id; returns saved record
await BOA_DB.deleteStaff(id);                 // hard delete
```

**Staff record shape (camelCase, as returned by `loadAll().staff`):**
```js
{
  _id, id,                                    // both = uuid
  ec, name, branch,
  contract, permit, level,
  notes,
  isShadow, transferring,
  transferTo, transferDate, transferNote,
  startDate,                                  // date string
  leftDate                                    // date string or null
}
```

#### Manager CRUD

```js
await BOA_DB.saveManager(m);                  // same insert/update semantics as saveStaff
await BOA_DB.deleteManager(id);
```

#### Maternity CRUD

```js
await BOA_DB.saveMat(rec);
await BOA_DB.deleteMat(id);
```

#### Schedule

```js
const sched   = await BOA_DB.loadSchedule(branch, ym, isManager);  // {grid, branch, ym, savedAt}
const history = await BOA_DB.loadScheduleHistory(branch, ym, isManager);  // array of last 5 snapshots
const saved   = await BOA_DB.saveSchedule(branch, ym, grid, isManager);
//   ^^^ saveSchedule auto-snapshots the prior grid into history (capped at 5)

// Period helpers (synchronous):
BOA_DB.currentSchedYm();                      // "2026-05" — payroll cycle containing today
BOA_DB.periodDays("2026-05");                 // [{d, monthIdx, year, dow, isToday}, ...]
BOA_DB.periodLabel("2026-05");                // "April 25 — May 24, 2026"
BOA_DB.shiftYm("2026-05", -1);                // "2026-04"
```

#### Attendance

```js
const att = await BOA_DB.loadAttendance(branch, ym);   // null if no record yet
                                                       // else {grid, branch, ym, savedAt}
await BOA_DB.saveAttendance(branch, ym, grid);
```

#### Onboarding / Off-boarding

```js
const obList  = await BOA_DB.loadOnboarding();        // array
await BOA_DB.saveOnboarding(records);                 // overwrites entire list

const offList = await BOA_DB.loadOffboarding();
await BOA_DB.saveOffboarding(records);
```

### 5.2 Check-in App — `window.APP_DATA`

Loaded by including `js/data.js` in the check-in app. Branch is implicit (taken from `window.APP_CONFIG.branchName`).

#### Staff

```js
await APP_DATA.listStaff({ activeOnly: true });
await APP_DATA.addStaff(name, employeeCode);
await APP_DATA.updateStaff(id, patch);
await APP_DATA.deactivateStaff(id);
```

#### Clock-ins

```js
await APP_DATA.lastClockinToday(staffId);     // most recent today, or null
await APP_DATA.addClockin(staffId, "in");     // "in" or "out"
await APP_DATA.listTodayClockins();           // joined with staff names
```

#### Cashups

```js
await APP_DATA.todaysCashup();
await APP_DATA.addCashup({ yoco, cash, vouchers, discounts, notes, signedBy });
await APP_DATA.listRecentCashups(30);
```

#### Attendance

```js
await APP_DATA.getAttendance(ym);             // {grid, branch, ym}
await APP_DATA.setAttendanceStatus(ym, dayKey, ec, status);  // status null deletes the cell
```

#### Swaps

```js
await APP_DATA.getSwaps(ym);
await APP_DATA.recordSwap({
  dateA: "2026-05-08",                        // when the swap happens
  dateB: "2026-05-15",                        // when the cover gets a day off in return
  oweEc: "B028",  oweName: "Fatima",
  coverEc: "B029", coverName: "Brilliant"
});
// Writes attendance for both dates AND the swap registry.
```

#### Extra-day approvals

```js
await APP_DATA.recordExtraDay(ym, dayKey, ec, approvedBy);
// Sets attendance to "ext" + records {approvedBy, approvedAt} under boa_extras_*.
```

#### Proof images

```js
await APP_DATA.setProof(ym, ec, day, dataUrl);  // image as data URL
```

---

## 6. REST API Examples (curl)

For when you want to talk to Supabase directly — e.g. from a CI script, a payroll export tool, or another language.

**Headers required on every request:**
```
apikey: <ANON_KEY>
Authorization: Bearer <ANON_KEY>
Content-Type: application/json
```

### Read all active techs at one branch

```bash
curl "https://kcinqpwkwpzbosxtkwyl.supabase.co/rest/v1/staff?branch=eq.Sea%20Point&active=eq.true&role_type=eq.tech&select=*" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

### Read a schedule

```bash
curl "https://kcinqpwkwpzbosxtkwyl.supabase.co/rest/v1/app_state?key=eq.boa_sched_Sea%20Point_2026-05&select=value" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

### Update a single tech's start date

```bash
curl -X PATCH "https://kcinqpwkwpzbosxtkwyl.supabase.co/rest/v1/staff?employee_code=eq.B028" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2022-01-02"}'
```

### Upsert an attendance grid (full overwrite)

```bash
curl -X POST "https://kcinqpwkwpzbosxtkwyl.supabase.co/rest/v1/app_state" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d '{
    "key": "boa_att_Sea Point_2026-05",
    "value": {
      "grid": {"B028": {"25": "on", "26": "sick_n"}},
      "branch": "Sea Point",
      "ym": "2026-05",
      "savedAt": "2026-05-04T12:00:00Z"
    }
  }'
```

### List all staff who left in the last 60 days

```bash
curl "https://kcinqpwkwpzbosxtkwyl.supabase.co/rest/v1/staff?left_date=gte.2026-03-04&select=employee_code,name,branch,left_date" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

---

## 7. Common Workflows

### 7.1 Generating a payroll report for one cycle

```js
const ym = "2026-05";
const staff = await BOA_DB.loadAll();
const branches = ["Sea Point", "Bree", "Kloof", /* ... */];

const report = [];
for (const branch of branches) {
  const att = await BOA_DB.loadAttendance(branch, ym);
  for (const s of staff.staff.filter(x => x.branch === branch)) {
    const days = att?.grid?.[s.ec] || {};
    const totals = { worked: 0, sick: 0, frl: 0, unpaid: 0, ext: 0 };
    for (const code of Object.values(days)) {
      const bare = code.replace(/^~/, "");
      if (bare === "on" || bare === "late" || bare === "ext")    totals.worked++;
      if (bare === "sick" || bare === "sick_n")                  totals.sick++;
      if (bare === "frl")                                        totals.frl++;
      if (bare === "no" || bare === "unpaid" || bare === "term") totals.unpaid++;
      if (bare === "ext")                                        totals.ext++;
    }
    report.push({ ec: s.ec, name: s.name, branch, ...totals });
  }
}
console.table(report);
```

### 7.2 Bulk-importing staff start dates from a CSV

See `import-start-dates.js` in this folder for a reference implementation. The pattern:

```js
const updates = [{ ec: "B028", start_date: "2022-01-02" }, /* ... */];
for (const u of updates) {
  await BOA_DB.sb.from("staff")
    .update({ start_date: u.start_date })
    .eq("employee_code", u.ec)
    .select();
}
```

Run this from the browser console while the HR portal is open (the page is already authenticated).

### 7.3 Cascading a termination across attendance grids

```js
const ec = "B268";
const fromYmd = "2026-05-01";
const branch = "Sea Point";

for (let monthOffset = 0; monthOffset <= 2; monthOffset++) {
  const ym = BOA_DB.shiftYm("2026-05", monthOffset);
  const att = await BOA_DB.loadAttendance(branch, ym) || { grid: {} };
  const grid = att.grid || {};
  if (!grid[ec]) grid[ec] = {};
  for (const day of BOA_DB.periodDays(ym)) {
    const ymd = day.year + "-" + String(day.monthIdx+1).padStart(2,"0") + "-" + String(day.d).padStart(2,"0");
    if (ymd >= fromYmd) grid[ec][day.d] = "term";
  }
  await BOA_DB.saveAttendance(branch, ym, grid);
}
```

### 7.4 Subscribing to live attendance changes

```js
const channel = BOA_DB.sb.channel("att-watch")
  .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "app_state", filter: "key=eq.boa_att_Sea Point_2026-05" },
      payload => console.log("Attendance updated:", payload.new.value))
  .subscribe();

// Cleanup later:
BOA_DB.sb.removeChannel(channel);
```

---

## 8. Status Code Quick Reference

### Schedule status codes (used in `boa_sched_*` grids)

```
W   Working
WL  Working Late (Table Bay only)
O   Off
R   Requested off (from day-off request system)
L   Leave (annual / sick / maternity)
E   Extra day worked
X   Pre-start / post-leftDate (greyed out, no work expected)
```

### Attendance status codes (used in `boa_att_*` grids)

```
on        On Time            late      Late
off       OFF                ext       Extra Day
sick_n    Sick + note        sick      Sick NO note
frl       FRL + proof        al        Annual Leave
ph        Public Holiday     mat       Maternity
no        No-show            unpaid    Unpaid (other)
deduct:N  Hours deduction    trial     Trial Day
term      TERMINATED         swap_o    Swap (owes)
swap_i    Swap (owed)
```

A `~` prefix indicates the value was auto-mirrored from the schedule and not yet confirmed by a manager.

### Compliance / permit codes (used on `staff.permit`)

```
sa_citizen   South African citizen
asylum       Asylum seeker permit
z_na         Status risk — needs review
```

(Add additional codes here as you introduce them.)

---

## 9. Conventions & Gotchas

1. **EC codes are case-sensitive but never altered in storage.** Always trim before comparing.
2. **Branch names are the user-facing labels** (`Sea Point`, not a slug). Keep them stable — they're embedded in `app_state` keys, so renaming a branch means a manual key migration.
3. **Payroll cycles run 25th → 24th.** The `<ym>` in any key always refers to the *end* month. April 25 → May 24 = `2026-05`.
4. **Day numbers in grids are strings** (`"25"`, not `25`). The check-in app and HR portal both use string keys for grid days.
5. **Maternity records are independent of staff records.** A pregnancy is a separate row in `maternity`; the staff member stays in `staff` even while on leave.
6. **Off-boarded staff are NOT deleted from `staff`.** The off-boarding tab adds a record to `boa_offboard_v1`. The `staff.left_date` column is also set on the corresponding row when used through the modal. Removal is intentional only via the off-boarding "Restore" action.
7. **Schedule history is bounded at 5 entries per branch+ym.** Older snapshots fall off — there's no separate archive. Increase `SCHED_HISTORY_LIMIT` in `data.js` if you need more.
8. **The `app_state.value` JSONB column has Postgres' default 1MB row limit.** If a single attendance grid ever exceeds that (very unlikely with current data volume), split into multiple keys.
9. **The proof-image keys (`boa_proof_*`) wrap raw data URLs in `{ __raw: ... }`** so JSONB stays valid. Always check for this wrapper when reading.

---

## 10. Adding a new app

If you build a third app on this stack, the recipe:

1. Include the Supabase JS client: `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`
2. Either reuse one of the existing `data.js` files (copy from HR portal or check-in app) or write a thin wrapper of your own.
3. Follow the key conventions above. **Don't invent new key formats** — if your data is per-period, use `boa_<category>_<branch>_<ym>`. If it's a global list, use `boa_<category>_v1`.
4. Add status codes to a versioned dictionary if you introduce any. Don't reuse existing codes for different meanings.
5. RLS: confirm your app needs read-only or read-write access. If different from existing apps, you may need to introduce per-table policies.

---

*Last updated: 2026-05-04 — reflects HR Portal v2 (4819 lines) and Check-in App v1.*
