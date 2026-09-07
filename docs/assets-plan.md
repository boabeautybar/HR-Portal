# Assets — Operations tab: Plan of Action

**Date:** 2026-09-07 · **Status:** 🟢 **BUILT 2026-09-07 — all four phases on branch `feat/assets-tab`; run `sql/assets.sql` before deploying**
**Scope:** a new **Assets** tab under Operations in the HR portal (`app.jsx`, `data.js`), a small
pure-logic module (`assets.js`) with a guard script, and one SQL file (`sql/assets.sql`).
No kiosk or My BOA changes in phase 1 (an optional kiosk acknowledgement is listed under
"Later").
**Source:** the owner's *BOA Beauty Bar Group — Asset Register Template* workbook (seven sheets:
IT register, Furniture & General register, Movement/Transfer register, Disposal register,
Employee Allocation register, Summary/Dashboard, Lists & Dropdowns, plus an Asset Control
Procedure).

---

## 1 · Executive summary

BOA has no record of who holds which laptop, chair, pedicure station or vehicle, which branch it is
in, or what happened to it when someone left. The owner's workbook is the right shape, but a
spreadsheet cannot enforce the one thing that makes an asset register useful: **that every register
agrees with every other one**. A movement typed into the Movement sheet does not change the branch
on the IT sheet; an allocation does not change the asset's status; a leaver's outstanding laptop is
found by reading five sheets.

The portal version keeps the owner's four registers and three sub-registers **as views over one
linked model**, so:

- an asset has **one current state** (branch, holder, status, condition) shown on its register row
  and in its detail drawer;
- every transfer, disposal, allocation and return is an **event** that both appears in its own
  register **and** updates the asset's current state in the same save;
- **every ID is clickable everywhere** — an asset row shows its MOV-, DISP- and AL- numbers; an
  allocation row opens its asset; a movement row opens its asset;
- the **dashboard** is computed live from the same rows, never typed in;
- the dropdown lists are **editable in-app** (owner's "Lists & Dropdowns" sheet becomes a config
  record), not hardcoded.

The tab layout the owner asked for, exactly:

```
Operations → 📦 Assets
  ├─ 📊 Asset Summary Dashboard
  ├─ 🗂 Asset Register              segments: 💻 IT [IT-0001] · 🪑 Furniture & General [FA-0001]
  │                                          · 💅 Salon Equipment [SE-0001] · 🚗 Vehicles [VE-0001]
  ├─ 🔀 Asset Movements & Disposals segments: 🔀 Movements / Transfers [MOV-0001] · 🗑 Disposals [DISP-0001]
  └─ 🧑 Employee Asset Allocation   [AL-0001]
```

> **Naming note.** The request said "Asset Movements/**Depreciations**". Confirmed 2026-09-07: the
> sub-tab is *Movements & Disposals*, **and** straight-line book value is wanted as well — it is
> shown in the asset drawer, on the register (Book value column) and totalled on the dashboard.
> See D13 for the policy.

---

## 2 · Verified current state (what the design rests on)

Everything below was checked against the working tree on 2026-09-07 (`main`, clean).

- **Tabs are registered in three places** in `app.jsx`: the label list `SETTINGS_TABS`
  (`app.jsx:11272` is the Cash Ups entry), the permission tier map `TAB_ACCESS`
  (`app.jsx:11978`), and the category map `NAV_TAB_TO_CATEGORY` (`app.jsx:27221`). The "open"
  tier means everyone sees it unless a user's `hideTabs` hides it; per-user read-only marks and
  hide/show already work for any tab key with no extra code.
- **Sub-tabs are one level deep.** `TAB_SUBS` (`app.jsx:12075` for Cash Ups) declares children;
  App holds a `useState` per parent, joined through `ACTIVE_SUB` / `SUB_SETTER`
  (`app.jsx:27046-27052`), and `currentTabIsReadOnly` (`app.jsx:27063`) lists every sub-tab state
  in its dependency array. The Settings permission grid derives child rows automatically. The
  registry has **no third level**, so the four register types and the two movement kinds are
  in-page **segment toggles** (like the Cash Ups region/branch filters), not permission-modelled
  children. Read-only and hide marks apply at the sub-tab level, which is the right granularity.
- **Pill-bar pattern** to copy: Cash Ups (`app.jsx:53989-53997`), filtered on
  `acl.subVisible(parent, k)`. Stat-card helper `statCard` at `app.jsx:53968`.
- **Data layer conventions** (`data.js`): the read-only guard is **name-based** (`app.jsx:187`) —
  exports named `load|get|list|fetch|read|count|find|audit|probe|is[A-Z]|has[A-Z]…` are reads,
  every other name is auto-guarded as a write. Singletons in `app_state` go through
  `cachedSingleton(key)` (`data.js:45`, conditional-GET cache) and are invalidated on save with
  `_ssCacheSet(key, null, null)` (`data.js:1491`). Row tables follow `cash_movements`
  (`data.js:1440-1500`): an explicit column list constant, soft delete via `archived_at`, never a
  hard delete.
- **SQL conventions**: `sql/cash_float.sql` and `sql/clockin_meta_table.sql` — `create table if
  not exists`, RLS on with permissive `using (true)` policies, idempotent so it can be re-run,
  header comment explaining the payload rule (no base64 in list selects). The app_state OOM
  incident (2026-07) is why photos never sit in a hot row.
- **Branch identity is a name string.** `SALONS` (`app.jsx:3106`) seeds 17 WC stores; the six
  Gauteng/KZN stores (`JHB_IMPORT_BRANCHES`, `app.jsx:3456`) and custom stores such as Cobble
  Walk reach the portal via `boa_custom_salons` at boot. `HEAD_OFFICE` (`app.jsx:15737`) and
  `CALL_CENTRE` (`app.jsx:15761`) are the two office locations; CC&S is a derived department, not
  a branch. **The owner's template branch list does not match live data** (it has "Greenpoint",
  "Somerset" and omits Bree, Kloof, Riverlands, Winelands, Betty, Eastgate, Mall of the South,
  Mushroom Farm), so the location dropdown must come from the live salon list, not the sheet.
- **Staff lookup**: salon staff rows carry `ec`, `name`, `branch`, `role`, `roleType`
  (`data.js:120-135`); office staff carry `role` (label via `OFFICE_ROLE_LABEL`, `app.jsx:15812`)
  and a derived dept (HO / CC, `isCcRole`). Employee codes are globally unique and never reused,
  so **EC is the only safe key** for "assigned to".
- **Exports**: `_rowsToCsv` (`app.jsx:1907`), `_rowsToPrintWindow` (`app.jsx:1926`, the PDF path),
  `_triggerDownload`, `_safeFile`. **Imports**: SheetJS is loaded (`index.html:188`), used at
  `app.jsx:16651` for `.xlsx`/`.csv` uploads.
- **Charts**: the portal draws inline SVG with no chart library — `StaffDailyShifts`
  (`app.jsx:11054`), `ReportLostByStore` (`app.jsx:20245`), `ReportLostDonut` (`app.jsx:20344`),
  `HrStackBars` (`app.jsx:21672`). The dashboard sub-tab follows that, with two small generic
  components rather than reusing the HR-report ones (which are shaped for their data).
- **Dashboard alerts** are one `dashAlert(id, group, severity, gate && node)` call each
  (`app.jsx:33843` onward). **Activity log** is `logActivity(action, subject, detail, category)`.
- **Off-boarding** keeps records in `boa_offboard_v1` keyed by EC; the departed flag is derived
  at `app.jsx:18849`. That is the hook for "employee leaves → asset returned".
- **Guard scripts** live in `scripts/check-*.js` (no test framework); the pattern is a pure
  module loaded by `index.html` (`cash-float.js`, `shift-rules.js`) plus a node script asserting
  its maths.

---

## 3 · Decisions proposed (please confirm or change)

| # | Question | Proposal | Why |
|---|---|---|---|
| D1 | Where do the rows live? | **Three Supabase tables** (`assets`, `asset_events`, `asset_allocations`) + one `app_state` config key (`boa_assets_cfg_v1`) for the dropdown lists. | Several HR/ops users will edit at once; a single JSON singleton is last-writer-wins and one lost save silently drops someone's allocation. Rows also give unique-ID enforcement in the DB, cheap per-register queries, and a home for a lazily-fetched photo column if photos are ever wanted. Cost: one SQL file to run in the editor, same as Cash Float. |
| D2 | One asset table or four? | **One table, `register` column** ∈ `IT / FA / SE / VE`. Register-specific fields (warranty, vehicle registration, licence-disc expiry, service due) sit in a `details jsonb` column. | The four registers share 15 of their columns. Four tables would mean four copies of every query, export and drawer. The asset ID prefix is derived from `register`. |
| D3 | Movements and disposals: one table or two? | **One `asset_events` table with `kind` ∈ `transfer / disposal`** (and `repair`, `return_to_storage`, `status_change` for the audit trail). MOV- numbers are given to transfers, DISP- numbers to disposals. | The owner groups them under one sub-tab and both are "something happened to this asset on a date, approved by X". One timeline per asset is what the drawer shows. |
| D4 | Is status typed or derived? | **Both, with rules.** Events *set* the status automatically (allocate → Assigned; return → In Storage; dispose → Disposed; transfer keeps status, moves branch). The user may still pick the manual states (Under Repair, Lost, Stolen, Damaged, Awaiting Disposal) on the asset. **Disposed is terminal**: a disposed asset cannot be allocated or moved. | This is the "connected registers" requirement. Typing a status that contradicts the events is what makes spreadsheets lie. |
| D5 | Current holder/branch on the asset row? | **Yes — a projection**, updated in the same save as the event. `assets.branch`, `assets.assigned_ec`, `assets.status`, `assets.condition` are the current state; events and allocations are the history. A `rebuildAssetProjection(assetId)` helper recomputes the row from history if they ever disagree. | Register views must render without joining every event. The rebuild helper is the safety net. |
| D6 | ID numbering | `IT-0001`, `FA-0001`, `SE-0001`, `VE-0001`, `MOV-0001`, `DISP-0001`, `AL-0001`, four digits, **never reused**. Next number = max existing + 1 per prefix, read at save time; a **unique index** makes a race fail loudly and the save retries once. The **Asset Tag** field stays separate and free-text (physical sticker / barcode). | Exactly the owner's scheme. Reuse is forbidden for the same reason employee codes are never reused. |
| D7 | Employee acknowledgement | **Confirmed.** Phase 1: **Yes / No + acknowledged date + "recorded by"** on the allocation, typed in by HR when the paper form is signed. `acknowledged_via` is stored (`portal` now) so a later kiosk PIN sign-off (`kiosk`) drops in without a schema change. | Matches the template ("Yes / No"). The kiosk route is real work across two more code bases and can wait until the register exists. |
| D8 | Who may do what | **Confirmed, narrowed.** The Assets tab is **"normal" tier, default Owner + Developer only**; anyone else is granted it per user in Settings → Users (the tab grid), where read-only marks work as on every tab. **Dispose, un-dispose, edit the dropdown lists, archive** = the new access list **"Asset admin"** (`act.assets.admin`: Owner and Developer implicit, plus the PINs ticked in the Settings access matrix). | Owner's instruction: only the dev and owner get it out of the box; asset admins are assigned under the permission settings. |
| D9 | Where the dropdown lists live | `boa_assets_cfg_v1`, seeded with the template's lists on first load, editable under a ⚙ button on the Assets tab (Asset admin only). Lists: conditions, statuses, departments, categories per register, movement reasons, disposal methods, extra locations (Storage, Warehouse…). | The owner called this the "master list" and will want to add a category without a deploy. |
| D10 | Locations | Live salon names (`SALONS` at runtime, incl. custom/JHB stores) + `Head Office` + `Call Centre & Sales` + cfg extras (`Storage`, `Other`). | See §2 — the template's own list is already out of date. |
| D11 | Seeding / bulk upload | **No existing list — they will key it in.** For bulk entry every table gets a **⬇ Download CSV template** (exact column headers, one example row) and an **⬆ Upload** that accepts that CSV or an .xlsx (SheetJS). The upload previews every row with validation, and **repeated codes go to a review list**: an uploaded asset whose Asset ID, serial number or asset tag already exists (or repeats inside the file) is listed with the existing record beside it, and the user picks per row **Skip — entered in error** or **Replace — update the existing asset**. Movements, disposals and allocations upload by Asset ID; a repeat (same asset, kind and date) goes through the same review. | Owner's instruction 2026-09-07. |
| D12 | Photos | **Not in phase 1.** Schema reserves `assets.photo` (base64, **never in a list select**), with a `has_photo` flag via the id-only side query, if wanted later. | The app_state OOM was caused by exactly this. Reserve the column, follow the rule. |
| D13 | Depreciation / book value | **Build it.** Straight-line to zero, monthly, from `purchase_date` over a useful life in months set **per register default and per category** in the cfg (defaults: IT 36, Furniture 72, Salon equipment 60, Vehicles 60). Book value = cost × (1 − months elapsed / life), floored at 0; a disposed asset's book value is 0 and its `disposal_value` is shown instead. Cost is taken **as entered** (VAT treatment is whatever the invoice figure was). Shown in the drawer, as a register column, and totalled by register/branch on the dashboard. | Owner's answer 2026-09-07. Policy assumptions are the simplest defensible ones and are editable in the cfg. |

---

## 4 · Data model

### 4.1 `public.assets` — one row per physical asset

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `asset_id` | text **unique** | `IT-0001` … prefix from `register` |
| `register` | text check in (`IT`,`FA`,`SE`,`VE`) | which register it shows on |
| `category` | text | from the cfg list for that register |
| `description` | text not null | |
| `brand`, `model`, `serial_number` | text | |
| `asset_tag` | text | physical sticker / barcode; free text |
| `purchase_date` | date | |
| `purchase_cost` | numeric | ZAR |
| `supplier`, `invoice_ref` | text | not in the template; cheap and useful for warranty claims |
| `warranty_expiry` | date | template page 6 shows it on the IT sheet; kept for all registers |
| `branch` | text | **current** location (projection) |
| `department` | text | from cfg list |
| `assigned_ec` | text | **current** holder's employee code (projection); null = held by the branch |
| `assigned_name` | text | snapshot of the name at allocation time (survives renames/leavers) |
| `date_issued` | date | when the current holder got it (projection) |
| `condition` | text | from cfg list |
| `status` | text | from cfg list; see D4 |
| `details` | jsonb | register-specific: vehicles `{registration, licence_disc_expiry, insurance_expiry, odometer}`; salon equipment `{service_due, install_date}`; IT `{os, login_user}` … |
| `notes` | text | |
| `photo` | text | reserved; base64; never in a list select (D12) |
| `created_by`, `created_at`, `updated_by`, `updated_at` | | |
| `archived_at`, `archived_by` | | soft delete (a mistaken entry). Disposed assets are **not** archived; they stay visible with status Disposed |

### 4.2 `public.asset_events` — transfers, disposals, and the rest of the timeline

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `event_no` | text unique | `MOV-0001` for transfers, `DISP-0001` for disposals, null for the minor kinds |
| `asset_id` | uuid FK → assets | |
| `kind` | text check in (`transfer`,`disposal`,`repair`,`return_to_storage`,`status_change`) | |
| `date` | date | date moved / disposed |
| `from_branch`, `to_branch` | text | transfer |
| `from_ec`, `to_ec` | text | previous / new assignee (transfer) |
| `reason` | text | cfg list: New Purchase, Employee Allocation, Branch Transfer, Replacement, Repair, Return, Other |
| `disposal_method` | text | cfg list: Sold, Donated, Scrapped, Returned to Supplier, Recycled, Written Off, Other |
| `disposal_value` | numeric | |
| `condition` | text | condition on transfer / at disposal |
| `approved_by`, `received_by` | text | free text names (the approver is often not a portal user) |
| `recorded_by` | text | portal user |
| `notes` | text | |
| `created_at`, `archived_at`, `archived_by` | | |

### 4.3 `public.asset_allocations` — issue and return

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `allocation_no` | text unique | `AL-0001` |
| `asset_id` | uuid FK → assets | |
| `ec` | text not null | employee code, **or** null with `branch` set for a branch-held allocation |
| `employee_name`, `job_title`, `department`, `branch` | text | **snapshots** taken from the staff record at issue time |
| `date_issued` | date not null | |
| `condition_issued` | text | |
| `acknowledged` | boolean default false | Employee Acknowledgement Yes/No |
| `acknowledged_at` | date | |
| `acknowledged_via` | text | `portal` (HR ticked it) / later `kiosk` |
| `date_returned` | date | null = **open** allocation |
| `condition_returned` | text | |
| `returned_to` | text | branch / Storage |
| `outstanding_notes` | text | template's "Outstanding / Notes" |
| `recorded_by`, `created_at`, `archived_at`, `archived_by` | | |

**Invariants** (enforced in the data layer and asserted by the guard script):

1. An asset has **at most one open allocation** (partial unique index on `asset_id where
   date_returned is null and archived_at is null`).
2. `assets.assigned_ec` **equals** the open allocation's `ec`, or is null when there is none.
3. A `disposal` event sets `status = Disposed` and closes any open allocation on the same date;
   after it, no new allocation or transfer is accepted (the button is hidden and the save refuses).
4. A `transfer` sets `assets.branch = to_branch`; if `to_ec` is set it also closes the open
   allocation and opens a new one (so an employee move produces MOV- **and** AL- numbers, both
   shown on the asset).
5. IDs are assigned only at insert, from the DB, never from the UI.

### 4.4 `app_state.boa_assets_cfg_v1` — the "Lists & Dropdowns" sheet

```js
{
  conditions: ["New","Excellent","Good","Fair","Poor","Damaged","Unserviceable"],
  statuses:   ["In Use","In Storage","Assigned","Under Repair","Lost","Stolen","Damaged",
               "Awaiting Disposal","Disposed","Transferred","Returned"],
  departments:["HR","Finance","Operations","IT","Marketing","Training","Call Centre",
               "Management","Administration","Salon","Other"],
  categories: {
    IT: ["Laptop","Desktop","Monitor","Tablet","Cell Phone","Printer","Scanner","Keyboard","Mouse",
         "Headset","Router","Wi-Fi Equipment","UPS","Projector","Server/Network Equipment","Other"],
    FA: ["Desk","Office Chair","Table","Filing Cabinet","Storage Cabinet","Shelving","Sofa",
         "Reception Furniture","Mirror","Trolley","Safe","Fridge","Microwave","Television",
         "Air Conditioner","Other"],
    SE: ["Manicure Station","Pedicure Chair","Treatment Bed","UV/LED Lamp","Steriliser/Autoclave",
         "Dust Collector","Wax Heater","Steamer","Massage Chair","Salon Trolley","Other"],
    VE: ["Car","Bakkie","Van","Scooter/Motorbike","Trailer","Other"]
  },
  moveReasons:     ["New Purchase","Employee Allocation","Branch Transfer","Replacement","Repair","Return","Other"],
  disposalMethods: ["Sold","Donated","Scrapped","Returned to Supplier","Recycled","Written Off","Other"],
  extraLocations:  ["Storage","Other"],
  usefulLifeDefault: { IT: 36, FA: 72, SE: 60, VE: 60 },   // months, per register (D13)
  usefulLifeMonths: {}          // optional per-category override, key "IT:Laptop" → months
}
```

Salon Equipment and Treatment Bed are **moved out** of the template's Furniture list into the new
SE register. "Salon" is added to departments so store assets have a department. Status values
`Transferred` and `Returned` are kept because the owner listed them; the event logic never sets
them (a transfer leaves the asset In Use / In Storage at its new branch) but they stay available
as manual picks and can be removed from the list in-app.

---

## 5 · Screens

Every sub-tab shares: the Assets page header, the pill bar (4 sub-tabs, ACL-filtered), the
existing **scope bar** (`renderScopeBar`) so a regional manager sees their region's branches, a
search box (asset ID / tag / serial / description / holder name / EC), and **CSV + PDF export** of
the current filtered table via the existing helpers.

### 5.1 📊 Asset Summary Dashboard (default landing)

Top row — the owner's metric table as stat cards, grouped:

| IT | Furniture & General | Salon Equipment | Vehicles | Across all |
|---|---|---|---|---|
| Total · In Use · In Storage · Under Repair · Lost/Stolen · Awaiting Disposal | same | same | same | Total transfers · Total disposed · Open allocations · Unacknowledged allocations · **Leavers with outstanding assets** |

Charts (inline SVG, one small `AssetBars` horizontal-bar component and one `AssetStack`
stacked-bar component; colours per the dataviz guidance, one hue per status family):

1. **Assets by register and status** — stacked bar, four bars.
2. **Assets by branch** — horizontal bars, all locations, sorted; click a bar → the register
   filtered to that branch.
3. **Movements per month** — last 12 months, transfers vs disposals.
4. **Purchase value by register** and **by branch** — two small horizontal bars (ZAR).
5. **Disposals by method** — small table (a bar chart of seven values is worse than a table).

Attention lists (tables, each row clickable into the asset drawer):

- **Outstanding for leavers** — open allocations whose EC is departed/off-boarded.
- **Unacknowledged allocations** older than 7 days.
- **Under repair** longer than 30 days.
- **Expiring in 60 days** — warranty, vehicle licence disc, insurance.

### 5.2 🗂 Asset Register

Segment toggle: **IT · Furniture & General · Salon Equipment · Vehicles** (remembered per user
in localStorage like other in-tab toggles). Filters: branch (scope-aware), status, condition,
category, holder, "show disposed" (off by default), "show archived" (Asset admin).

Table columns = the template's, in its order, with the register-specific extras on the right:
Asset ID · Category · Description · Brand · Model · Serial · Tag · Purchase date · Cost ·
Assigned to (name + EC) · Branch · Department · Date issued · Condition · Status · *(IT)* Warranty ·
*(VE)* Registration · Licence disc · *(SE)* Service due. Sortable; disposed rows greyed.

Buttons: **➕ Add asset** (form; the ID is shown as "will be IT-0048" and confirmed on save),
**⬆ Import from spreadsheet** (D11), **Export CSV / PDF**, **⚙ Lists** (Asset admin).

**Asset drawer** (click any row or any asset ID anywhere in the tab): a right-hand panel with
four sections —
*Details* (editable), *Current holder* (open allocation with its AL- number, or "Held by branch"),
*Timeline* (every event and allocation, newest first, with MOV-/DISP-/AL- numbers), and the
**action buttons** that write events: **Allocate to employee**, **Return to storage**,
**Transfer to branch**, **Send for repair / Back from repair**, **Change status/condition**,
**Dispose** (Asset admin), **Archive** (Asset admin). Every action is one modal, and the save
writes the event **and** the asset projection together.

### 5.3 🔀 Asset Movements & Disposals

Segment toggle: **Movements / Transfers · Disposals**.

*Movements* table = template columns: Movement No. · Asset ID · Description · From branch ·
To branch · Previous assignee · New assignee · Reason · Date moved · Approved by · Received by ·
Condition on transfer · Notes. **➕ Record movement** opens the same Transfer modal as the drawer
but starts with an asset picker (search by ID/serial/description). From-branch and previous
assignee are **filled from the asset and locked**; only the destination is typed.

*Disposals* table = template columns: Disposal No. · Asset ID · Description · Category · Branch ·
Assigned to · Reason · Condition · Disposal date · Method · Approved by · Disposal value · Notes.
**➕ Record disposal** (Asset admin) — asset picker, then the Dispose modal. Un-dispose exists
for mistakes (Asset admin, reason required, logged).

Filters: date range (default: last 90 days), branch, kind. Export CSV / PDF.

### 5.4 🧑 Employee Asset Allocation

Table = template columns: Allocation No. · Employee No. · Employee name · Job title ·
Department · Branch · Asset ID · Description · Category · Date issued · Condition issued ·
Acknowledged (✔/✘, with date) · Date returned · Condition returned · Outstanding / Notes.

Views: **Open** (default) · **Returned** · **All**. Group-by-employee toggle so HR can print
"everything B1014 holds" for an exit interview. Filters: branch, department, employee (typeahead
over salon + office staff by EC/name), acknowledged yes/no, **leavers only**.

**➕ Allocate**: pick employee (typeahead; name, job title, department and branch snapshot in
from the staff record, editable if the record is stale) → pick asset (only assets with no open
allocation and not disposed) → date issued, condition, acknowledged Y/N (+date) → save. Creates
the AL- row, sets the asset's holder/branch/status = Assigned, and writes an `Employee Allocation`
movement only if the branch changed.

Row actions: **Mark acknowledged**, **Record return** (date, condition, returned to; closes the
allocation, sets asset status In Storage / condition), **Print acknowledgement form** (a
one-page PDF via `_rowsToPrintWindow` — asset details + a signature line, so the paper form the
employee signs matches the record).

### 5.5 Dashboard (home page) and Activity Log

- One `dashAlert("assetsOutstanding", "operations", "warning", …)`: leavers (departed or in
  off-boarding) with open allocations, listing name, EC, asset IDs, days since departure. Hidden
  when empty. Gate: user can see the Assets tab.
- `logActivity` on every write: "Added asset IT-0048", "Transferred FA-0012 Sea Point → Kloof",
  "Allocated VE-0002 to B1014", "Returned …", "Disposed …", "Edited asset lists". Category
  `"Assets"`.

---

## 6 · Code shape

| File | Change |
|---|---|
| `sql/assets.sql` | **New.** Three tables, indexes (unique on `asset_id`, `event_no`, `allocation_no`; partial unique on open allocations; btree on `assets.branch`, `assets.assigned_ec`, `asset_events.asset_id`), RLS on + permissive policies (mirrors `clockin_meta_table.sql`), header comment with the payload rule. Idempotent. **Run once in the SQL editor before deploy.** |
| `assets.js` | **New** pure module (loaded by `index.html` next to `cash-float.js`). `nextId(prefix, existing)`, `applyEvent(asset, event)` → new projection, `deriveStatus(asset, openAlloc, lastEvent)`, `summarise(assets, events, allocs, staffIndex)` → every dashboard number, `bookValue(asset, cfg, today)` (only if D13). No DOM, no Supabase. |
| `scripts/check-assets.js` | **New** guard. Asserts invariants 1–5 on synthetic histories, ID formatting/non-reuse, a disposed asset refusing further events, the summary totals adding up, and that `assets.js` parses under node. Runs in a second; add to the pre-deploy habit next to `check-cash-float.js`. |
| `data.js` | `ASSET_COLS` (everything except `photo`), `ASSET_EVENT_COLS`, `ASSET_ALLOC_COLS`. Reads: `listAssets({register, branch, includeDisposed, includeArchived})`, `listAssetEvents({from, to, kind, assetId})`, `listAssetAllocations({open, ec, assetId})`, `getAssetPhoto(id)` (reserved), `loadAssetsCfg()`. Writes: `saveAsset`, `addAssetEvent` (one function: writes the event, recomputes and saves the projection, opens/closes allocations per §4.3), `addAssetAllocation`, `returnAssetAllocation`, `acknowledgeAssetAllocation`, `undoAssetDisposal`, `archiveAsset`, `importAssets(rows)`, `saveAssetsCfg`, `rebuildAssetProjection`. All writes take `who`. |
| `app.jsx` | (1) `SETTINGS_TABS` entry `{ t: "assets", l: "Assets", cat: "Operations", icon: "📦" }` after Cash Ups; (2) `TAB_ACCESS.assets = { tier: "normal", cat: "Operations", allow: g => g.isOwnerOrMaster || g.isDev }` (grantable per user in the grid); (3) `NAV_TAB_TO_CATEGORY.assets = "Operations"`; (4) `TAB_SUBS.assets` with the four children `dashboard / register / movements / allocation`; (5) `assetSubTab` state + `ACTIVE_SUB` / `SUB_SETTER` entries + the `currentTabIsReadOnly` dependency + the sub-tab normaliser effect; (6) `ACCESS_LISTS` entry `assetAdmin` (PIN ticks only; Owner + Developer implicit) and capability `act.assets.admin`; (7) Settings plumbing for the new cfg (`assetAdminCfg` prop pair on `SettingsAdmin`, same as `cashupReview`); (8) the tab body as a separate top-level component **`AssetsTab`** (props: staff, officeStaff, salons, currentUser, acl, scope, logActivity) rather than another inline IIFE — the file is 55,881 lines and the Cash Ups IIFE is already ~1,800; (9) the `dashAlert` entry; (10) a lazy loader effect: rows are fetched only when `tab === "assets"` or the dashboard alert needs the open-allocation count (same `want` pattern as `app.jsx:27783`). |
| `index.html` | `<script src="assets.js">` after `cash-float.js`. |
| `docs/assets-plan.md` | this file, updated as decisions land. |

Estimated size: `AssetsTab` ≈ 1,600–2,000 lines of JSX, `assets.js` ≈ 250, `data.js` ≈ 300,
SQL ≈ 120, guard ≈ 200.

### Read cost

Assets are small text rows (no photos in phase 1). Even 2,000 assets + 5,000 events + 3,000
allocations is well under 3 MB per full load, fetched **only** when the tab is opened (plus one
count query for the dashboard alert). Nothing polls. This is far below the per-branch schedule
reads that already dominate app_state traffic.

---

## 7 · Asset Control Procedure → how the portal enforces it

| Owner's step | Portal |
|---|---|
| Purchased → gets Asset ID / Tag | **Add asset**: ID assigned on save; tag typed from the sticker. Status defaults to In Storage at the chosen branch. |
| Entered into relevant register | `register` picks the table segment; category list is per register. |
| Issued to employee / branch | **Allocate** (AL-) or **Transfer** (MOV-). Asset status → Assigned / In Use. |
| Employee signs acknowledgement | Print form → tick **Acknowledged** with date. Dashboard lists unacknowledged > 7 days. |
| Any movement recorded | Every branch change is an event; the register's branch column cannot be edited directly once the asset has any event (change it through Transfer so the history is kept). |
| Any repair recorded | **Send for repair** / **Back from repair** events; status Under Repair; dashboard lists > 30 days. |
| Employee leaves → asset returned | Dashboard alert + allocation "leavers only" filter; **Record return** closes the AL- row. |
| Condition checked | Condition captured on return; asset condition updated. |
| Storage / reallocated / disposed | Return → In Storage; Allocate again → new AL-; Dispose → DISP-, terminal. |

---

## 8 · Build phases

| Phase | Delivers | Depends on |
|---|---|---|
| **0 · Foundations** | `sql/assets.sql`, `assets.js` + guard, `data.js` reads/writes, cfg seed, tab shell (registry entries, pill bar, empty sub-tabs), Settings access list. | Decisions D1–D10 |
| **1 · Register** | Register sub-tab with the four segments, add/edit form, asset drawer (details + timeline, read-only actions), CSV/PDF export, spreadsheet import. | 0 |
| **2 · Movements & Disposals** | Transfer / repair / status / dispose modals from the drawer and from the sub-tab; projection updates; un-dispose. | 1 |
| **3 · Allocation** | Allocation sub-tab, allocate / acknowledge / return flows, printable acknowledgement form, leavers filter. | 2 |
| **4 · Dashboard + alerts** | Dashboard sub-tab (cards, charts, attention lists), home-page `dashAlert`, activity-log entries throughout. | 3 |
| **Later (optional)** | Kiosk PIN acknowledgement (D7); photos (D12); depreciation (D13); barcode/QR label print for the Asset Tag (the portal already loads `qrcodejs`). | any |

Each phase ends with: Babel-parse `app.jsx` (a syntax error blanks the whole app), run
`node scripts/check-assets.js`, commit, push, PR to `main`.

---

## 9 · Open questions — answered 2026-09-07

| # | Question | Answer |
|---|---|---|
| 1 | "Depreciations"? | Disposals **and** book value. Built per D13. |
| 2 | Storage | Three Supabase tables (D1). |
| 3 | Acknowledgement | Yes/No by HR now; kiosk PIN sign-off left open (`acknowledged_via`). |
| 4 | Asset admin | Default Owner + Developer only; others assigned in Settings. Tab itself likewise (D8). |
| 5 | Vehicle / Salon Equipment fields and categories | Accepted as proposed. |
| 6 | Existing data | None — keyed in by hand. CSV template + bulk upload with duplicate review per table (D11). |
| 7–10 | Statuses, approvers, visibility, categories | Taken as proposed: `Transferred`/`Returned` kept as manual picks; Approved by / Received by are free-text names; portal-only; category lists as in §4.4. |

## 10 · Build log

- 2026-09-07 — plan approved; phases 0–4 built the same day on branch `feat/assets-tab`.

> **⚠ Before deploy: run `sql/assets.sql` once in the Supabase SQL editor.** It creates
> `assets`, `asset_events` and `asset_allocations` with their unique indexes (the numbering and
> the one-open-allocation rule depend on them). Idempotent; safe to re-run. Until it has run the
> tab loads empty and every save fails with a "relation does not exist" error.

**What shipped**

| File | What |
|---|---|
| `sql/assets.sql` | the three tables, indexes, `updated_at` trigger, RLS policies |
| `assets.js` | pure rules: `project`, `canAct`, `timeline`, `nextId`, `bookValue`, `summarise`, `parseImport`, `templateCsv` (loaded by `index.html` before `data.js`) |
| `scripts/check-assets.js` | 70 assertions over the invariants in §4.3, dates, book value, the summary and the upload parser — `node scripts/check-assets.js` |
| `data.js` | `ASSET_*_COLS`; reads `listAssets` / `listAssetEvents` / `listAssetAllocations` / `loadAssetBundle` / `getAsset` / `loadAssetsCfg` / `loadAssetAdminAccess`; writes `saveAsset`, `addAssetEvent`, `addAssetAllocation`, `returnAssetAllocation`, `acknowledgeAssetAllocation`, `undoAssetDisposal`, `archiveAsset*`, `restoreAsset`, `rebuildAssetProjection`, `importAssetRows`, `saveAssetsCfg`, `saveAssetAdminAccess`. Every history write ends in `_refreshAssetProjection`. |
| `app.jsx` | `AssetsTab` component (module level, above `App`) with the four sub-tabs, drawer, 12 modals, bulk upload with duplicate review, CSV/PDF export, printable acknowledgement form; registry entries (`SETTINGS_TABS`, `TAB_ACCESS` normal tier Owner+Dev, `NAV_TAB_TO_CATEGORY`, `TAB_SUBS.assets`, `assetSubTab` state and ACL wiring, nav item); `act.assets.admin` capability + `assetAdmin` access list + Settings plumbing; `dashAssetsOutstanding` card + `assetsOutstanding` dashboard alert; `assetPeople` / `assetLeavers` memos; lazy loader (`reloadAssets`, runs on the Assets tab and the dashboard only). |

**Verification done** (no browser session against prod was possible from the build environment):
Babel parse of the whole `app.jsx`; `node scripts/check-assets.js` (70 pass); a node render harness
that server-renders every sub-tab, the drawer (live / disposed / archived), all modals and the
upload preview against fixture data — 40 renders, no undefined references. Remaining to confirm
in the browser after the SQL has run: the first real add / transfer / allocate / return round trip,
and the Settings grid showing the Assets row and the Asset admin column.

**Look & feel (2026-09-07, after review):** the tab wears the same frosted-glass treatment as
off-boarding. It reuses that tab's kit rather than copying it — `GLASS_SURFACE`, `glassCard`,
`glassTile`, `GLASS_INPUT`, `GLASS_LABEL`, `glassHeading`, `BTN_PRIMARY` / `BTN_GHOST` are all
defined once in `app.jsx` above both components. The scoped CSS in `index.html` (box-sizing,
focus rings, button lift, row hover, slim scrollbars, the aurora wash the panels blur) is shared
by rewriting its selectors as `:is(.boa-off,.boa-glass)`, so the two surfaces cannot drift; the
Assets root, the drawer overlay and the modal overlay carry `className="boa-glass"`. Editing
either tab's glass CSS now moves both — that is the point, but it is worth knowing before you
touch it. The printable acknowledgement form keeps its flat, opaque styling: it is for paper.

**Deviations from the plan worth knowing**
- Manual edits to branch / status / condition are allowed only while the asset has no history
  (§4 D5); afterwards the form shows them read-only and the drawer actions change them.
- Allocating to a person at another branch also writes a MOV- transfer with reason
  "Employee Allocation" (§5.4), and a transfer *to a person* closes the previous allocation and
  opens the next AL- in the same save.
- "Remove" of an event or allocation (Asset admin) is an archive with a reason, never a delete.
- The kiosk acknowledgement, photos and QR labels remain in "Later".
