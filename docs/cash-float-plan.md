# Cash Float Ledger, Fresha Reconciliation & Cash-up Export — Plan of Action

**Date:** 2026-09-04, revised 2026-09-06 · **Status:** 🟢 **BUILT — all phases implemented; Fresha import rebuilt for the real export format; SQL needs re-running**
**Scope:** the Cash Ups feature across the HR portal (`app.jsx`, `data.js`) and the kiosk (`kiosk/staff-app.js`, `kiosk/manager-app.js`, `kiosk/data.js`), plus a Fresha sales import and CSV/PDF exports.

> **⚠ RE-RUN `sql/cash_float.sql`.** It has changed twice: first when the real Fresha export format
> turned out to differ from the assumption, then again on 2026-09-06 when the owner supplied the
> **Finance summary** export, which carries far more per day. `fresha_daily_sales` now has the
> columns that report actually has, plus an `alter table … add column if not exists` block so an
> already-created table is brought up to date. It is idempotent — re-running is safe and required.
> `cash_movements` is unchanged.
>
> **Guardrail:** `node scripts/check-cash-float.js` before deploying. 52 assertions: the two
> `cash-float.js` mirrors are identical, the ledger maths holds, and the Fresha parser is run
> against real exports — three embedded in the script, plus every file in `docs/fresha-samples/`
> when that (git-ignored, local-only) folder is present.

---

## 1 · Executive summary

Stores are not supposed to take cash, but some clients can only pay cash. Today the kiosk cash-up
records `cash` and an optional "banked today" block, and the reviewer (Jacques) ticks each day off
in the portal. **Nothing tracks whether declared cash is still in the store**, whether a later
lump-sum deposit actually covers the small daily amounts, or when Jacques collected cash himself.
Between "declared" and "deposited" there is no trail, which is exactly where cash goes missing.

The fix is three things, all inside the existing Cash Ups tab:

1. **A running cash-on-hand ledger per store** (owner's "running float") with a **R10 000 ceiling**.
   Balance starts from an opening balance + start date Jacques enters per store. Cash declared adds;
   store deposits and Jacques' collections subtract; adjustments need a reason. Every non-cash-up
   movement gets the same sign-off as a cash-up. Stores over the ceiling are flagged in the portal,
   on the dashboard and on the kiosk cash-up screen.
2. **Fresha reconciliation** — import the Fresha *Finance summary* CSVs (one file per store, each
   covering a whole date range, all dropped in together). Each file becomes one row per store per
   day and is compared with the declared cash-up line by line. Mismatches are badged for Jacques to
   investigate.
3. **Exports** — CSV and PDF of daily cash-ups for any date range (with Fresha deltas and review
   status), and of a store's ledger.

Decisions already taken with the user (2026-09-04):

| Question | Decision |
|---|---|
| Float model | **Cash on hand with a ceiling** (starts at the opening balance, grows with cash, shrinks with deposits/collections; alert when > R10 000). "Headroom" (ceiling − on hand) is shown so the owner's "10k float" reading is also visible. |
| Fresha file | **Finance summary export, one file per store covering a date range.** The dates are inside the file, so nothing is guessed. The older per-day *Sales summary* is still accepted, and only those files ask for a trading day. |
| Entry points | **Kiosk deposit tile + portal.** Stores get a standalone "Bank Cash" action; Jacques records collections/deposits/adjustments in the portal. The daily cash-up banking block stays and feeds the ledger automatically. |
| Opening balance | **Per store, entered by Jacques** with a start date; cash-ups before that date are ignored by the ledger. |

---

## 2 · Verified current state (what the design rests on)

- **Cash-ups are a Supabase table, not app_state:** `public.cashups`, one row per (branch, date),
  soft-deleted via `archived_at`, `total` is a generated column. Kiosk write `kiosk/data.js:767`
  `addCashup`; portal reads/writes `data.js:1228-1436` (`listRecentCashups`, `listCashupsForDate`,
  `addCashupManual`, `reopenCashup`, `deleteCashup`, `reviewCashup`, `unreviewCashup`).
  `CASHUP_COLS` is duplicated at `kiosk/data.js:718` and `data.js:1212` and excludes `yoco_photo`
  (~220 KB base64 per row, fetched lazily).
- **`banking_slip` is already a base64 data URL** (`kiosk/staff-app.js` compresses it), so it is
  ~100-200 KB per banked row. The comment in `data.js` calling it "a URL today" was stale and has
  been corrected. Any read spanning more than a day uses a slim column list.
- **Anon access:** the kiosk client uses the anon key (`kiosk/data.js:26`); `cashups` has RLS off.
  Newer tables use RLS on + permissive `using (true)` policies (`sql/clockin_meta_table.sql`).
- **Read-only guard is name-based** (`app.jsx:187`): `BOA_DB` exports starting
  `load|get|list|fetch|read|count|find|audit|probe|is[A-Z]|has[A-Z]` are reads; every other name is
  auto-guarded as a write. New functions must be named accordingly.
- **Sub-tabs** are registered in `TAB_SUBS` (`app.jsx:11897`), joined to React state via
  `ACTIVE_SUB` / `SUB_SETTER` (`app.jsx:25623-25631`), normalised by the effect at `app.jsx:26534`,
  and the Settings permission grid derives child rows automatically. Pill-bar pattern:
  `app.jsx:39257-39262` (HQ Trials), filtered on `acl.subVisible(parent, k)`.
- **Cash Ups tab** is an inline IIFE `app.jsx:52165-~52790` (no sub-tabs, no export). Review gate is
  `canReviewCashups = can(currentUser, "act.cashups.review", { cashupReview: cashupReviewCfg })`
  (`app.jsx:52180`). Store scope: `_hasStoreScope` + `scopedSalonNames`. Go-live constants are
  duplicated at `app.jsx:52232` and `kiosk/data.js:150`.
- **Branch identity is a name string** (`SALONS[].name`, `app.jsx:2971`; custom stores such as
  Cobble Walk are merged from `boa_custom_salons` at boot, `app.jsx:25081`).
- **The real Fresha export is the Finance summary** (24 stores, 25 Aug to 5 Sep 2026, supplied
  2026-09-06). One file per store covering a **date range**, one row per day, and **the dates are
  inside the file** — so the trading day is never guessed:

  ```
  "Date","Gross sales","Discounts","Refunds / Returns","Net sales","Taxes","Total sales",
  "Gift card sales","Service charges","Tips","Net other sales","Tax on other sales",
  "Total other sales","Total sales + other sales","Sales paid in period","Unpaid sales in period",
  "Card","Cash","SHOPIFY","Total payments",…,"Gift card redemption","Total redemptions",…
  "05 Sep 2026","23629.43","-1852.15","0","21777.28","3157.72","24935",…
  ```

  Three facts drive the parser:

  1. **The payment columns vary by store.** Across the 24 real files there are **seven different
     column layouts** (26 to 28 columns): Card, Cash, EFT, SHOPIFY and Yoco Payment Link appear only
     where that store used them. So columns are read by **name**, never by position, and the payment
     block is identified as everything between "Unpaid sales in period" and "Total payments". A
     payment type we do not recognise is summed into `other` and raised as a warning in the import
     preview, rather than silently missing from the totals.
  2. **Money in is `Total sales + other sales`**, and it equals `Total payments + Total redemptions`.
     That identity holds on **all 288 store-days** and is asserted by the check script. Gift-card
     redemptions sit in their own Redemptions section here, whereas the older Sales summary folded
     them into "Payments collected" — both land in the same `total` column.
  3. **Tips are included** in `total` and in the payment line they were paid on. The cash-up total
     excludes tips, so the comparable figure is `net_collected` = total − tips.

  Dates read as `"05 Sep 2026"` and are converted by string parts, never through a `Date`, so no
  timezone can shift a day.

- **Every store takes cash, so every store is in scope.** Cash is scarce outside the Western Cape
  but it does happen (the owner confirmed 2026-09-06 after checking earlier months; Fourways shows
  R106 across two days even in this twelve-day sample). So no location is excluded.

- **The six non-Western-Cape stores reach the portal through an existing path, not a new one.**
  Fourways, Eastgate, Mall of the South, Mushroom Farm, Verdi and Ballito are exactly
  `JHB_IMPORT_BRANCHES` (`app.jsx`), and the **Locations tab** has an importer that writes them to
  `boa_custom_salons`. The custom-salon effect then pushes them into `SALONS` at runtime with their
  `gauteng` / `kzn` regions — the same door Cobble Walk came through. Once that import has been run,
  Cash Ups, the float balance sheet, the Fresha picker and the dashboard alert all include them
  with **no code change at all**. The portal reports whether it is still needed via
  `jhbImportNeeded`.

- **Store-name matching now needs exactly one alias.** Names are compared normalised, then against
  saved aliases, then with spaces squashed out, then by unique substring. That resolves 23 of the
  24 files on its own, including the three that used to need help:

  | Fresha location | Our store | How it resolves |
  |---|---|---|
  | `Bree Street` | Bree | substring |
  | `Kloof Street` | Kloof | substring |
  | `RIverlands Mall` | Riverlands | substring |
  | `cape gate` | Cape Gate | normalising |
  | `Kuilsriver` | Kuils River | spaces squashed |
  | `East Gate` | Eastgate | spaces squashed |
  | `buiten` | **Betty** | **saved alias — the only one** |

  Betty trades as Buitengracht in Fresha and nothing in the name hints at it, so it can only come
  from an alias. The data corroborates the mapping: the `buiten` file is zero on Sunday 30 and
  Monday 31 August, exactly matching Betty's `closedDow: [0, 1]`.

- **Coverage is complete.** After that one answer, an import of all 24 files writes **288
  store-days across all 24 stores** and asks nothing, with no duplicate keys.

- **Fresha emits a row for a closed day**, with every figure zero. Those parse as real zero days
  rather than missing data, and the "Fresha shows sales but no cash-up" panel ignores them because
  it requires a total above zero.

- **Cash is rare, which is the point.** Across 24 stores × 12 days = 288 store-days, only **nine**
  had any cash at all, totalling **R3,401**:

  | Day | Store | Cash |
  |---|---|---|
  | 26 Aug | Green Point | 695.00 |
  | 27 Aug | Cape Gate | 195.00 |
  | 28 Aug | Green Point | 840.00 |
  | 2 Sep | Rondebosch | 375.00 |
  | 2 Sep | Sandown | 295.00 |
  | 2 Sep | Sea Point | 295.00 |
  | 5 Sep | Bree | 600.00 |
  | 28 Aug | Fourways | 6.00 |
  | 3 Sep | Fourways | 100.00 |

  Those nine store-days are exactly what the float ledger has to account for. Five of the six
  non-Western-Cape stores have no Cash column in their export at all, which is why cash there is so
  rare — but Fourways does, and it used it twice.

- **Reusable helpers:** `parseCsvObjects` (`app.jsx:9830`), XLSX `sheet_to_json` pattern
  (`app.jsx:16498-16510`, SheetJS loaded at `index.html:188`), `findCol` header matcher
  (`app.jsx:42544`), `_csvEscape` / `_safeFile` / `_triggerDownload` (`app.jsx:601-615`),
  print-window PDF `exportSchedulePdf` (`app.jsx:1681`, no jsPDF anywhere), chunked upsert
  (`data.js:2816`), `cachedSingleton` (`data.js:45`), `persistOfficeTrial` save pattern
  (`app.jsx:26628`), `dashAlert` registry (`app.jsx:32301`), `cashTotalOf` (`app.jsx:29744`),
  review modal (`app.jsx:52592`), kiosk `compressImage`. Shared portal↔kiosk JS is mirrored as
  byte-identical copies verified by a script (`shift-rules.js` + `scripts/check-shift-rules.js`).

---

## 3 · Design decisions

| Concern | Decision | Why |
|---|---|---|
| Movements storage | New table **`public.cash_movements`** (kinds `deposit` / `collection` / `adjustment`). | Transactional rows with photos do not belong in one `app_state` blob (the hottest table). |
| Cash-in & cash-up-block deposits | **Derived from `cashups` at read time, never mirrored.** | Cash-ups are reopened, hard-deleted, manually added and backdated through 5 write paths; a mirror row would drift. One truth. The cash-up's own `reviewed_at` is the sign-off for its banking block. |
| Fresha aggregates | New table **`public.fresha_daily_sales`**, primary key (branch, date), chunked `upsert(..., { onConflict: "branch,date" })`. | Unbounded growth (stores × days); upsert gives "re-upload replaces" for free; per-date reads are indexed. |
| Opening balance, ceiling, tolerance, aliases | One app_state key **`boa_cash_float_cfg_v1`** (config). Opening balance is config, **not** a ledger row. | Set by one person, editable, exactly one per store; avoids "which opening row wins". `setBy/setAt` is the audit. |
| Ledger compute | Client-side pure helper **`computeCashFloat(cfg, cashups, movements, branchNames)`** in a new `cash-float.js` mirrored to `kiosk/cash-float.js` + `scripts/check-cash-float.js`. | ~30 stores × ~100 days of slim rows is tiny; one function feeds the balance sheet, the dashboard alert and the kiosk on-hand card, so they can never disagree. |
| Match tolerance | `cfg.matchTolerance`, default **R1.00**, on both cash and total deltas. | Configurable without code. |
| Permissions | Viewing follows the `cashups` tab + the two new sub-tab rows in the Settings grid. Recording, sign-off, opening balance, Fresha import and settings all gate on the existing **`canReviewCashups`**. Store-scoped users see only `scopedSalonNames`. | No new capability key; the person who reviews cash-ups is the person who controls cash. |
| RLS | RLS on + `select/insert/update using (true)` on both tables. **No `delete` policy on `cash_movements`** (archive only); delete allowed on `fresha_daily_sales`. | Mirrors `clockin_meta`; the missing delete policy is a cheap audit guardrail. |

### 3.1 `boa_cash_float_cfg_v1`

```js
{
  ceiling: 10000,               // R
  matchTolerance: 1,            // R, Fresha vs declared
  stores: {                     // keyed by SALONS[].name
    "Rondebosch": { openingBalance: 2500, startDate: "2026-09-01", setBy: "Jacques", setAt: "2026-09-04T09:12:00Z" }
  },
  freshaAliases: {              // normalised Fresha location -> SALONS[].name
    "cobble walk durbanville": "Cobble Walk"
  }
}
```

### 3.2 Table shapes

See `sql/cash_float.sql` (already written). Summary:

- `cash_movements(id, branch, date, kind, amount, ref, note, slip, recorded_by, source,
  cashup_id, reviewed_at, reviewed_by, review_comment, archived_at, archived_by, created_at)`.
  `amount` is positive for deposit/collection (subtracted from on-hand) and signed for adjustment.
  DB checks: `amount <> 0`; adjustment requires a non-blank `note`. **`slip` is never in a list
  select** (same rule as `yoco_photo`).
- `fresha_daily_sales(branch, date, cash, card, other, total, txn_count, breakdown, location_raw,
  source_file, imported_by, imported_at)`, PK (branch, date).

### 3.3 Ledger rules (`computeCashFloat`)

- A store is **configured** only if `cfg.stores[branch].startDate` exists; otherwise the balance
  sheet shows "Set opening balance" and no figure.
- From `cashups` where `!archived_at && date >= startDate`: `+cash`; if `cash_banked === true`,
  also a synthetic row **"Deposit (with cash-up)"** `−amount_banked` whose sign-off state is the
  cash-up's own `reviewed_at`.
- From `cash_movements` where `!archived_at && date >= startDate`: deposit / collection `−amount`;
  adjustment `+amount` (signed).
- Sort by `date`, then kind rank (cash-in, cash-up deposit, deposit, collection, adjustment), then
  `created_at`. Running balance starts at `openingBalance`.
- Output per branch: `{ configured, onHand, headroom, over, unreviewed, rows, lastDate,
  ignoredBeforeStart }`.

### 3.4 Fresha import and matching rules

All of this lives in `cash-float.js` and is covered by `scripts/check-cash-float.js`.

- **Which report is it?** Decided from the first cell: `Date` means a Finance summary, otherwise the
  older Sales summary. Only a Sales summary asks for a trading day, and the picker stays hidden
  until such a file is actually chosen.
- **Store name → branch:** normalise (lowercase, strip "boa beauty bar" / "boa", punctuation,
  collapse spaces) → exact match on the in-scope store names → saved `cfg.freshaAliases` → a unique
  substring match → otherwise **unknown**, and the dialog asks. The answer is remembered either way:
  as an alias, or in `cfg.freshaIgnore` for a location that is not a cash-up store at all.
- **Payment columns → fields:** `Card` → `card`, `Cash` → `cash`, `Yoco Payment Link` → `yoco_link`,
  `EFT` → `eft`, `SHOPIFY` → `shopify`, `Gift card redemption` → `gift_card`. Anything else in the
  payment block is summed into `other`, raised as a warning, and kept verbatim in `breakdown`.
- **Validation before commit, per day:** `Total payments + Total redemptions` must equal
  `Total sales + other sales`, and the payment columns must add up to `Total payments`. A file that
  fails either says so rather than reconciling against a figure we cannot explain. A file with no
  `Total payments` column is rejected outright.
- **Re-importing replaces** (primary key is branch + date). The preview counts how many store-days
  would be replaced, and refuses two files that map to the same store.
- **The preview leads with cash.** Before anything is written it lists every store-day with cash and
  the total, because that is the number this feature exists to chase.

**Matching is line by line, not total against total.** Fresha counts a gift card once, when it is
sold; the cash-up counts both the card payment that bought it and the voucher itself, so a single
grand-total comparison would cry wolf every day. Lines compared: cash, Yoco card, Yoco link, gift
cards redeemed, gift cards sold, card tips, any EFT/Shopify/other money with no cash-up field, and a
"total collected" line.

**The card line is the one real unknown.** Fresha's `Card` includes tips, but whether a store reads
its Yoco figure gross or net of tips is a habit, not a setting. Both readings are accepted and the
matching one is named in the tooltip — self-calibrating, rather than hard-coding a convention that
would be wrong for half the stores.

**Verdicts:** `Match` (green, every line within tolerance) · `Cash off` (red, the cash line is out —
the only money that can leave the building, so it is graded on its own) · `Check` (amber, cash
agrees but something else does not) · `No Fresha data`.

---

## 4 · Phases

### Phase A — SQL ✅ written
`sql/cash_float.sql`: both tables, indexes, RLS + policies, idempotent. Not yet run in prod.

### Phase B — data layer
**`data.js`** (after `unreviewCashup`, ~line 1436; export in the `BOA_DB` literal after ~3067):
- `CASHUP_FLOAT_COLS` (`id,branch,date,cash,cash_banked,amount_banked,banking_ref,banked_by,signed_by,archived_at,reviewed_at,reviewed_by,created_at`), `CASHUP_EXPORT_COLS` (= `CASHUP_COLS` minus `banking_slip`, with a `has_banking_slip` id-only side query), `CASH_MOVE_COLS` (no `slip`).
- `loadCashFloatCfg()` (via `cachedSingleton`, normalised defaults) · `saveCashFloatCfg(cfg)`.
- `listCashupsForFloat(sinceYmd)` · `listCashupsForRange(from, to)` · `getCashupSlip(id)`.
- `listCashMovements(sinceYmd)` (+ `has_slip`) · `getCashMovementSlip(id)` · `addCashMovement(p)` (`source:'portal'`; validates kind, amount ≠ 0, adjustment needs note) · `reviewCashMovement(id, reviewer, comment)` · `unreviewCashMovement(id)` · `archiveCashMovement(id, actor)`.
- `listFreshaDailySalesForDate(date)` · `listFreshaDailySalesForRange(from, to)` · `upsertFreshaDailySales(rows)` (chunks of 500) · `deleteFreshaDailySales(branch, date)`.
- Fix the stale `banking_slip` comment at line 1210.

**`kiosk/data.js`** (after `listRecentCashups` ~804; export in `APP_DATA` ~2043):
`loadCashFloatCfg()` · `addCashDeposit(payload)` (`kind:'deposit'`, `source:'kiosk'`, `branch: branch()`) · `listRecentCashMovements(limit)` · `cashOnHand()` → `{configured:false}` or `{configured, onHand, ceiling, headroom, over, startDate}`.

**`cash-float.js`** (root) + **`kiosk/cash-float.js`** (byte-identical) exposing
`window.BOA_CASH_FLOAT = { computeCashFloat, normalizeFreshaLocation, classifyPaymentMethod, freshaYmd }`;
loaded before `data.js` in both `index.html` files; `scripts/check-cash-float.js` cloned from the shift-rules checker.

### Phase C — portal state + sub-tab wiring (`app.jsx`)
1. `TAB_SUBS` after `officeTrials` (11938): `cashups: { state: "cashupSubTab", subs: [{ k: "daily", l: "Daily cash-ups", icon: "📅" }, { k: "float", l: "Cash float / balance sheet", icon: "🏦" }] }`.
2. `const [cashupSubTab, setCashupSubTab] = useState("daily")` (~25608); `cashups:` entries in `ACTIVE_SUB` and `SUB_SETTER`; append to the dep arrays at 25647 and 26543.
3. `DASH_CARDS` after `storeOpenings` (11082): `{ id: "cashFloatOver", key: "dashCashFloatOver", l: "Cash float · over ceiling", icon: "🏦" }`.
4. State next to the cash-ups block (26255-26289): `cashFloatCfg` + `persistCashFloatCfg`, `cashFloatData {cashups, movements}`, `cashFloatLoading`, `reloadCashFloat()` (since = min `startDate` in cfg, else `CASHUP_GO_LIVE`), `cashFloatStore`, `cashMoveModal`, `cashOpeningModal`, `cashMoveReviewModal`, `freshaDaily`, `freshaImport`, `cashupExport`.
5. Effect: `reloadCashFloat()` when `(tab==="cashups" && cashupSubTab==="float") || tab==="dashboard"`, and on cfg change. Extend the day loader (26281) to also fetch `listFreshaDailySalesForDate(cashupDate)`.
6. Boot: append `loadCashFloatCfg` to the `Promise.all` in `reloadCoreData` (~28134-28160), destructure → `setCashFloatCfg`.
7. Hoist `cashTotalOf` (29744) to module scope.
8. In the IIFE (52165): pill bar after `renderScopeBar` (52288), filtered by `acl.subVisible("cashups", k)`; existing body becomes `renderDaily()`, new `renderFloat()`.

### Phase D — Daily sub-tab: Fresha import, match column, export
- `FreshaImportModal` (own component): multi-file picker, per-store preview showing each file's day
  count and date range, its cash/card/link/gift-card/tips totals, REPLACES counts, unknown-store
  pickers (store / skip once / never import), duplicate-store guard, parse warnings, and a
  cash-days banner. Commit upserts every store-day and saves anything newly learned. Opened by the
  **⇪ Fresha** button, gated on `canReviewCashups && !currentTabIsReadOnly`.
- The table gains a **Fresha cash** column (value plus the signed difference) and a **Match** badge
  whose tooltip is the full line-by-line breakdown. A "Fresha Match x / n" stat card, and a red
  panel listing stores that Fresha shows trading with no cash-up submitted.
- `CashupExportModal` (own component): from/to range → `listCashupsForRange` +
  `listFreshaDailySalesForRange`, same scope/region/branch filters as the table, then CSV via
  `_rowsToCsv` or a print window via `_rowsToPrintWindow`. 27 columns including the Fresha figures,
  the match verdict and the review sign-off, with a totals row.

### Phase E — Cash float / balance sheet sub-tab
- Settings card (reviewers): ceiling, tolerance, alias editor.
- Balance table, one row per in-scope store: Opening (date), Cash in, Deposits, Collections, Adjustments, On hand, Headroom (red when over), Unreviewed, Last movement; buttons *Ledger* / *Set opening* / *Record*. Stat cards: stores over ceiling, total on hand, unreviewed movements.
- Ledger drill-in: running-balance rows (Date, Kind, Detail, In, Out, Balance, Slip (lazy), Sign-off, Archive), footnote for movements ignored before start date, CSV/PDF export.
- Record modal (kind, date within [startDate, today], amount, ref, note required for adjustment) and Set-opening modal (opening balance, start date defaulting to the store's cash-up go-live, warning if existing movements predate it).
- All write buttons use `roStyle/roTitle` + `disabled={currentTabIsReadOnly}`.

### Phase F — kiosk
- `kiosk/staff-app.js`: landing gets `#cashfloat-nag-slot` + a `#tile-bankcash` tile ("🏦 Bank Cash / DEPOSIT CASH ON HAND"); new `renderBankCash()` (on-hand card, amount, bank ref, banked by, slip photo via `compressImage`, note, name → `addCashDeposit`, then recent deposits with sign-off state); new `refreshCashFloatCard(slotId)` rendering "Cash on hand R x · Headroom R y" and a red "OVER CEILING — bank cash today" nag when over; `<div id="cu-float-slot">` at the top of `#cashup-body` in both branches of `renderCashup` (3480, 3532). Export `renderBankCash`, `refreshCashFloatNag` on `window.BOA_FLOWS`.
- `kiosk/manager-app.js`: `#tile-bankcash` after `#tile-cashup` (671); nav `data-action="bankcash"` (90) + route (142); landing calls `refreshCashFloatNag()`; `renderCashups` (2823) gains a "Deposits & collections" table.
- `kiosk/index.html`: `<script src="cash-float.js">` before `data.js`.

### Phase G — dashboard alert
`dashAlert("cashFloatOver", "operations", "warning", ...)` next to the store-openings alert: runs `computeCashFloat` on `cashFloatData` for `scopedSalonNames`, lists stores over the ceiling with on-hand and amount over, button jumps to Cash Ups → float sub-tab → that store. Severity `critical` if any store is > 150 % of the ceiling.

### Phase H — docs
Update this file's status; `kiosk/README.md` (new tile, `cash-float.js` mirror + checker in the pre-deploy list); fix the `data.js:1210` comment.

---

## 5 · Edge cases

- **Archived / reopened cash-ups** are excluded (`archived_at`); the replacement row counts. Hard-deleted cash-ups: FK `on delete set null`.
- **Backdated cash-ups** re-sort by `date` and rewrite history; the balance table shows last `created_at` so a late entry is noticeable; unreviewed count catches manual adds.
- **Movements before `startDate`** are ignored, with a warning in the opening modal and a ledger footnote.
- **Fresha timezone:** parse date parts locally; after-midnight payments land on the next Fresha day and are flagged, not hidden. Tolerance never masks this.
- **Refunds / voids** reduce the day; net negative is shown, not clamped. Gift cards / vouchers are "other" and in both totals; card tips excluded from both.
- **Cobble Walk** arrives via `boa_custom_salons`; its Fresha location needs one alias, captured by the preview.
- **Betty closed days:** no cash-up expected; Fresha sales on a closed day flag "no cash-up" only if total > 0.
- **Store-scoped users:** balance table, ledger, export, alert and import all filter by `scopedSalonNames`.
- **Payload size:** `slip`, `banking_slip`, `yoco_photo` never in list selects; `has_*` flags via id-only side queries; single-row fetch on click.
- **Kiosk with cfg unset:** on-hand card hidden; the deposit tile still records.

---

## 6 · Verification

### Automated (green as of 2026-09-06)

`node scripts/check-cash-float.js` — 52 assertions, run before every deploy:

- the two `cash-float.js` mirrors are byte-identical;
- ledger maths: opening 1 000 → cash-up cash 500 banked 300 → deposit 200 → collection 400 →
  adjustment −50 = **550**, with the running balance in event order, not input order;
- an archived (reopened) cash-up does not count; an out-of-scope branch never appears; entries
  dated before the store's start date are ignored and counted separately;
- an unconfigured store returns a blank, not a zero;
- over-ceiling is flagged with negative headroom;
- Betty resolves from the `buiten` alias and is never guessed without it; a spacing difference
  (`East Gate` / `Eastgate`) resolves without one, while Cape Gate is not confused with it; and a
  closed day parses as a real zero next to a trading day;
- three real Finance summary exports parse with no warnings, and on every one of their days
  `payments + redemptions = money in` and `net collected = money in − tips`;
- Sea Point's R295 lands on 2 September and Green Point's R840 on 28 August, so a figure cannot
  drift onto the wrong day;
- `"05 Sep 2026"`, `"5 Sep 2026"` and an ISO date all parse, and `"Total"` is rejected;
- renaming a payment column to one we have never seen produces a warning naming it;
- the older Sales summary still parses and reports that it needs a trading day;
- every export in `docs/fresha-samples/` parses when the folder is present: **24 files, 288
  store-days, R3,401 of cash, zero warnings**;
- store-name resolution: exact, "BOA Beauty Bar" prefix stripped, saved alias, and an unknown name
  that must *not* be guessed;
- matching: a Yoco figure read gross of tips reconciles, so does one read net of tips, R295 of cash
  Fresha saw but the store never declared is flagged as a cash discrepancy, and 50c stays inside
  the R1 tolerance.

Also run: `node scripts/check-shift-rules.js`, `node scripts/check-store-lists.js`. Every touched
file passes a syntax check, and the three new React components are rendered with React 18 to
confirm the balance sheet, the ledger drill-in, the over-ceiling state, the non-reviewer view, the
unconfigured state and both modals all build without error.

### Still to do by hand, with live data

- Re-run `sql/cash_float.sql` (see the note at the top), then confirm an anon insert into
  `cash_movements` succeeds and an anon delete is refused, and that an adjustment with no reason is
  rejected by the database as well as by the form.
- Set one store's opening balance, then check the balance sheet, the kiosk on-hand card and the
  dashboard alert all show the same figure.
- **First check the Locations tab** for the Gauteng / KZN import. If it is still offered, run it —
  otherwise those six stores will not be in the Fresha picker or on the balance sheet.
- Import all 24 files at once and confirm: 23 stores resolve silently and only `buiten` is asked
  about. Answer it once with Betty. A second import then asks nothing and writes **288 store-days
  across all 24 stores**. The preview's cash banner should show nine cash days totalling R3,401.
  Re-importing must change no row count.
- Then open 2 September and check Sea Point, Sandown and Rondebosch: Fresha says they took cash,
  so the Match column should be red wherever the cash-up did not declare it.
- Record a deposit from a kiosk, then sign it off in the portal ledger.
- Export a week as CSV and as PDF; confirm a store-scoped user's export contains only their stores.
- Watch the network tab on the float sub-tab: no base64 columns should come down, and a slip should
  only load when clicked.
- Kiosk regression: cash-up submit, the outstanding-cash-up nag, and manager Cash History unchanged.

## 7 · Open items for review

- **Ceiling default** is R10 000 as discussed; it is config, so it can change per rollout without
  code.
- **The Gauteng / KZN stores depend on the Locations-tab import having been run.** They are not in
  the seeded `SALONS` array; they arrive via `boa_custom_salons`. This could not be verified against
  production (the Supabase management token in `.env` returns Unauthorized and needs refreshing), so
  confirm it in the portal before the first Fresha import.
- **The "never import" list is still there** for any Fresha location that genuinely is not a store,
  but nothing needs it today.
- **EFT and SHOPIFY have no cash-up field.** They appear in the exports and currently land in the
  "EFT / Shopify / other" line, which the matcher flags whenever it carries money. If either starts
  being used regularly, add a field to the kiosk cash-up form.
- **Discounts are captured but not matched.** Fresha's `Discounts` is every discount; the cash-up's
  `manual_discounts` is only those applied by hand at the till. They are stored side by side but not
  compared, because they are not the same thing.
- **Who records collections** — gated on `canReviewCashups` (Jacques plus whoever Settings grants).
  If collections should be a separate permission from review, that is one new capability key.
