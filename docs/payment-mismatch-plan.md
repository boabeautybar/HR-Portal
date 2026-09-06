# Other payment mismatches — plan (built)

> **Shipped 2026-09-06.** Everything below is implemented. `sql/payment_mismatch.sql`
> must be run in the Supabase SQL editor before the tab will save a sign-off.
> Read *What changed during the build* at the foot of this file for the three
> places the finished code differs from the plan.


A third sub-tab under **Cash Ups**, next to *Daily cash-ups* and *Cash float /
balance sheet*. Daily asks "did the store declare the right takings today";
Float asks "is the cash they declared still there". This one asks the question
neither covers: **of the payments that aren't cash — card, Yoco link, gift
cards, vouchers, tips, EFT — which ones don't balance against Fresha, and what
kind of mistake is each one?**

Cash is deliberately **not** in this tab. It has its own grading on Daily and
its own ledger on Float, and it is the only line that can walk out of the
building. Mixing it in here would bury it.

## Why this is worth building — measured, not assumed

Run against the 24 real Fresha Finance-summary exports (25 Aug – 5 Sep 2026)
and the 287 live cash-ups for the same days. Every cash-up paired with a Fresha
day; nothing was unmatched.

| Line | Days off | Field blank | Both differ | Money off |
|---|---:|---:|---:|---:|
| Yoco (card) | 39 | 3 (R61,885) | 36 (R19,888) | **R81,773** |
| Vouchers / gift cards sold | 33 | 29 (R16,470) | 4 (R2,372) | R18,842 |
| Card tips | 27 | 6 (R1,415) | 21 (R5,445) | R6,860 |
| Gift card redeemed | 16 | 12 (R8,975) | 3 (R1,955) | R11,225 |
| Yoco payment link | 4 | 3 (R1,703) | 1 (R10) | R1,713 |
| EFT / Shopify | 3 | 3 (R1,355) | — | R1,355 |
| *(Cash, for contrast)* | *3* | | | *R226* |

122 mismatching lines across 12 days and 24 stores — about ten a day, a
workable queue rather than a wall. Of the 56 blank-field rows, none is under
R20 and only two are under R50, so there is no penny-noise to floor out.

Four real problems it surfaces immediately:

- **Plumstead, 5 Sep** — Yoco left blank while Fresha shows **R24,325.50**. The
  store filled in tips, vouchers and gift cards and skipped the big one.
- **Green Point, 1 Sep** — declared `1432.25` against Fresha's `14323.25`. One
  digit dropped, **R12,891** adrift.
- **Somerset West, 28 Aug** — card tips declared **R5,050** against Fresha's
  **R505**. Ten times over.
- **Somerset West 29 Aug, Claremont 31 Aug, Mushroom Farm 1 Sep** — vouchers
  sold and gift cards redeemed entered the wrong way round.

One standing habit worth knowing: **every store reads its Yoco figure gross of
tips except Ballito**, which reads it net on all twelve days. The convention is
a store habit, not a setting, and the design below treats it as one.

Fresha's **Prepayments** and **Prepayment redemption** columns are present in
every export and **zero in all 288 store-days**. Deposits are plumbed but
dormant — and, as it turns out, not yet handled (see the matcher fix below).

## Reason tags — each one implies a different action

Verified against the real data. Counts are for the 122 rows above.

| Tag | Rule | Rows | What to do |
|---|---|---:|---|
| **Field left blank** | declared 0, Fresha non-zero | 52 | Chase the store — the cash-up is incomplete |
| **Figures differ** | both non-zero, outside tolerance | 59 | Investigate |
| **Swapped** | two failing lines cross-match within tolerance | 6 | One correction fixes both |
| **Not on the form** | EFT / Shopify / other / prepayment redemption | 3 | The cash-up has nowhere to put it — a form gap, not a store error |
| **Digit slip** | deleting one character from the larger figure's `toFixed(2)` yields the smaller | 2 | Correct the keying error |
| **Declared, no Fresha sale** | Fresha 0, declared non-zero | 0 | Money recorded against no sale — investigate first |

The digit-slip test is a single-character deletion on the two-decimal string,
which is why `1432.25` / `14323.25` and `505.00` / `5050.00` are caught while
ordinary near-misses like `11690.50` / `11635.50` are not. **No false
positives** across all 122 rows.

Swap detection tests every pair of failing lines on the day, not just
vouchers ↔ gift card. Only that pair has been seen so far, but Yoco ↔ Yoco link
is the obvious next candidate and the test is identical: A's declared matches
B's Fresha and B's declared matches A's Fresha, both within tolerance, and at
least one side non-zero.

Separately from the tag, every row carries a **direction**. Declaring *more*
than Fresha means money recorded against no sale and reads red; declaring
*less* means takings not accounted for and reads amber. Betty on 27 Aug
declared R3,255 against Fresha's R2,115 — "Figures differ", but the direction
is the interesting part.

## The card line and a store's reading habit

`matchFreshaToCashup` already accepts a Yoco figure either gross or net of tips
and names which one reconciled. When *neither* matches it shows the gross
figure. For Ballito, which reads net, a R100 slip would then be reported as
R100 plus the day's tips.

So the tab infers each store's convention from the window it has loaded — the
majority of its matched days, gross or net — and grades an unmatched day
against that, naming the convention on the row ("Fresha card net of tips,
this store's usual reading"). A store with no matched days in the window falls
back to whichever reading is closer. `inferCardConventions(cashups, fresha,
cfg)` returns `{ [branch]: "gross" | "net" | null }` and is passed through as
an option, so `matchFreshaToCashup`'s behaviour on Daily is unchanged.

## A fix to the matcher itself, independent of the tab

`prepayment_redemption` is parsed, stored and counted in **no line**. Fresha's
collected total includes it, so the day a store starts taking deposits the
"Total collected" line on Daily goes off with nothing explaining it. Fold it
into the `extra` line alongside EFT / Shopify / other, labelled. This ships
with the tab but is a correction to existing code.

## Storage — `sql/payment_mismatch.sql`

One new table. Nothing else changes.

```sql
create table if not exists public.cashup_mismatch_notes (
  branch            text not null,
  date              date not null,
  line              text not null,        -- card | yoco_link | gift_card | vouchers | tips | extra
  status            text not null check (status in ('resolved','escalated')),
  note              text not null,
  -- The figures the note was written against. A cash-up can be reopened and
  -- a Fresha file re-imported, and a sign-off from when the gap was R500 must
  -- not silently absolve a new R5,000 gap.
  declared_at_note  numeric not null,
  fresha_at_note    numeric not null,
  delta_at_note     numeric not null,
  actor             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (branch, date, line),
  constraint cashup_mismatch_notes_reason check (nullif(trim(note), '') is not null)
);
```

RLS on, permissive `select / insert / update / delete using (true)`, matching
`fresha_daily_sales`. Delete is allowed because reopening a row is a normal
action, not a destructive one — unlike `cash_movements`, which archives rather
than deletes because it is a financial ledger. The note is required at the
database, not just in the form: a sign-off with no reason is worth nothing.

**The staleness rule.** On read, a row's current declared, Fresha and
difference are each compared with the figures stored on its note. If any of
the three moved by more than the match tolerance, the row comes back **open
again**, tagged *changed since sign-off*, showing both the figures that were
signed off and the figures now. Comparing only the difference would miss a
store re-submitting +R100 against a Fresha re-import of +R100 — same gap,
different day, and the explanation may no longer hold. This is the same
instinct as deriving cash-in from `cashups` rather than mirroring it: never let
a stored number speak for a live one.

## Row states

The tab's row set is the **union** of current mismatches and notes in range,
joined on store + date + line. That gives five states rather than three, and
answers what happens to a note whose line the store has since corrected:

| State | Means | Where it shows |
|---|---|---|
| **Open** | Mismatch, no note | Default view, and the alert |
| **Changed since sign-off** | Mismatch, note, figures moved | Default view, and the alert |
| **Escalated** | Mismatch, note, being chased | Own filter — seen, so not in the alert |
| **Resolved** | Mismatch, note, explained | Own filter |
| **Now balances** | Note, but the line balances today | Own filter — the store fixed it |

The alert counts only the first two: what nobody has looked at. Escalated rows
have been seen and are somebody's job already.

## Comparison logic — `cash-float.js` (+ the kiosk mirror)

A layer over `matchFreshaToCashup`, not a second implementation.

```js
paymentMismatches(cashup, fresha, cfg, { cardConvention })
  -> [{ key, label, declared, fresha, delta, direction, reason, certain,
        note, swappedWith, cardReading }]
inferCardConventions(cashups, freshaByKey, cfg) -> { [branch]: "gross"|"net"|null }
```

- Keeps only failing lines; drops `cash` and the `collected` total.
- Tags each line per the table above. Swap detection is cross-line, so it runs
  once per store-day.
- `certain: true` for swaps, digit slips, blanks and not-on-the-form — errors
  whose nature is not in doubt. `false` for "figures differ".
- Does **not** filter on muted lines. Muting is the alert's concern, below.

Mirrored byte-identically into `kiosk/cash-float.js` as the existing rule
requires, and covered by `scripts/check-cash-float.js`. The kiosk itself gains
nothing and needs no change — a tablet has no business grading its own store.

New config under the existing `boa_cash_float_cfg_v1` key, normalised by
`normalizeCfg` so an old config keeps working:

```js
mismatch: {
  alertThreshold: 500,    // rand, a single line's difference
  blankFloor: 0,          // a blank field alerts at any size
  alertWindowDays: 14,    // trailing window the dashboard reads
  alertMuteLines: []      // e.g. ["vouchers"] while stores are being trained
}
```

`alertMuteLines` silences a line on the **dashboard only**. The tab keeps
showing it, with a *muted* chip. 29 of the 52 blank rows are the voucher field
— a training problem the alert would otherwise shout about daily until it is
fixed, but one Jacques still needs to see to fix it. Muting the alert beats
losing the line.

## Data layer — `data.js` only

- `MISMATCH_NOTE_COLS`
- `listMismatchNotes(fromYmd, toYmd)`
- `saveMismatchNote(p)` — upsert on `branch,date,line`, stamps the three figures
- `deleteMismatchNote(branch, date, line)` — reopen

`listCashupsForRange` (already on `CASHUP_EXPORT_COLS`, which excludes both
base64 columns) and `listFreshaDailySalesForRange` are reused unchanged.
A 12-day range is roughly 120 KB; a month about 300 KB.

The two writes are auto-guarded by the name-based read-only guard; the three
`list*` reads are not. Nothing to do to make that so.

## Portal wiring — `app.jsx`

1. `TAB_SUBS.cashups.subs` gains `{ k: "mismatch", l: "Other payment mismatches", icon: "⚖️" }`. The Settings permission grid derives the child row on its own.
2. `DASH_CARDS` gains `{ id: "paymentMismatch", key: "dashPaymentMismatch", l: "Payments · not balancing", icon: "⚖️" }`.
3. State: `mismatchRange` (default: the last `alertWindowDays`), `mismatchData` `{cashups, fresha, notes}`, `mismatchLoading`, `mismatchFilters` `{store, line, reason, status, minAmount}`, `mismatchModal`.
4. **One loader, one state.** `reloadMismatches()` fetches from `min(alertFrom, mismatchRange.from)` to today. The dashboard alert filters that to its trailing window client-side; the tab filters to the range the user picked. One fetch, and a note written on the tab is reflected in the alert with nothing to invalidate. Runs when the tab is open or the dashboard is showing, and after any note write.
5. Render `{cashupSubTab === "mismatch" && <PaymentMismatchTab … />}` alongside the two existing branches.
6. New components `PaymentMismatchTab` and `MismatchResolveModal`.

## The tab

**One row per mismatch**, sorted by size of difference descending, so the
queue is worked top-down.

| Date | Store | Payment type | Declared | Fresha | Difference | Reason | Status | |

- Difference is signed and coloured by direction: red when the store declared
  more than Fresha recorded a sale for, amber when less.
- Reason is a chip. A swapped pair shows *"swapped with Gift card redeemed"* on
  both rows so it reads as one problem. A muted line carries a *muted* chip.
- A card row names the reading it was graded against.
- The date links through to that store-day on Daily (`setCashupDate`,
  `setCashupRegion`, `setCashupBranchFilter`), so the whole cash-up and the
  Yoco photo are one click away.
- **Resolve** / **Escalate** open the modal; the note is required. Resolved and
  escalated rows show the note, who and when, and a **Reopen** button.
- A *changed since sign-off* row shows both sets of figures.

Filters: store, payment type, reason, status (open · escalated · resolved ·
now balances · all), minimum amount. Stat cards: open · total unexplained ·
fields left blank · certain errors · stores affected.

CSV and PDF export of the filtered list, reusing `_rowsToCsv` and
`_rowsToPrintWindow`.

Empty states that say which of two things is true: *"No Fresha data for these
dates"* with a button straight into the import modal, rather than a misleading
all-clear; and a genuine green all-clear when everything balances.

Permissions follow the existing model exactly — visibility from
`acl.subVisible("cashups", "mismatch")`, resolving gated on `canReviewCashups`
and disabled under `currentTabIsReadOnly`, and store-scoped users see only
their own stores through the same `scopeFilter` the export modal uses.

## Dashboard alert

`dashAlert("paymentMismatch", "operations", "warning", …)` — fires on an
**open** or **changed** row in the trailing window, not on a muted line, where
the difference is at or above `alertThreshold` **or** the field was left blank
against a Fresha figure at or above `blankFloor`. On the sample data a R500
threshold surfaces 34 of the 122 rows, roughly three a day, plus the blanks.

It summarises rather than lists: *"9 stores have payments that don't balance ·
R43,200 unexplained · last 14 days"*, with the worst five and a button that
opens the tab filtered to that store. Severity scales from the one threshold:
`critical` when a single line is ten times it or the window's unexplained total
is twenty times it. Plumstead's blank R24,325 would have tripped it on the day.

## Checks — added to `scripts/check-cash-float.js`

- Each of the six reason tags from a purpose-built fixture.
- Swap detection on the three real cases, plus a yoco ↔ yoco-link fixture.
- Digit slip on the two real cases. **Negative**: `11690.50` vs `11635.50` is
  *not* a digit slip, and a 50c difference produces no row at all.
- Cash and the collected total never appear in the mismatch list.
- Ballito's twelve net-of-tips days produce **no** card rows, and
  `inferCardConventions` returns `net` for Ballito and `gross` for every other
  store in the sample.
- A net-reading store off by R100 reports R100, not R100 plus tips.
- A note reopens when declared, Fresha or the difference moved; stays resolved
  when none did; shows *Now balances* when the line no longer mismatches.
- `alertMuteLines` removes a line from the alert count and nothing else.
- `prepayment_redemption` lands in the `extra` line.
- An old config with no `mismatch` block normalises to the defaults.

## Order of work

1. `sql/payment_mismatch.sql` in the Supabase SQL editor.
2. Matcher fix (`prepayment_redemption`), `paymentMismatches`,
   `inferCardConventions`, `normalizeCfg` config, mirror, check script.
3. `data.js` reads and writes.
4. Sub-tab registration, state, loader, `PaymentMismatchTab`, resolve modal.
5. Settings fields on the existing cash-float settings card.
6. Dashboard alert.
7. This doc updated with anything the build changed.

## Edge cases

- **No Fresha for a day** — not a mismatch. Silence, and the empty state says
  the data is missing rather than implying agreement.
- **Archived / reopened cash-ups** — excluded, exactly as on Daily and Float.
  A note against a since-archived cash-up shows as *Now balances* only if the
  replacement cash-up balances; otherwise it attaches to the replacement.
- **Fresha re-imported with different figures** — the staleness rule reopens
  the affected rows.
- **A payment type Fresha adds later** — already lands in `other` and shows as
  *Not on the form* rather than vanishing, because the parser reads the payment
  block by position between two known columns rather than by a fixed list.
- **Closed days** — Fresha writes a zero row, which balances against no cash-up
  and produces nothing.
- **Deposits** — once `prepayment_redemption` carries money it surfaces in the
  `extra` line as *Not on the form*, which is the truth until the cash-up form
  grows a field for it.

## Considered and rejected

- **Per-store mutes.** One observed problem, one line. A per-line alert mute
  covers it; per-store is a second dimension nobody has asked for.
- **Persisting computed mismatches.** Every other figure in Cash Ups is derived
  at read time from the live tables; a stored mismatch would drift the moment a
  cash-up was reopened.
- **Per-line tolerances.** R1 is right on the data — Cape Gate's R5 and Table
  Bay's R5 are real differences, not rounding.
- **Two fetches, one for the tab and one for the dashboard.** Replaced by a
  single window fetch; the cross-invalidation it would have needed is exactly
  the kind of thing that goes stale.

## What changed during the build

Three things the plan did not anticipate.

**Swap detection had to see through the card reading.** Grading the card line
against a store's own convention (gross or net of tips) means the figure the
row reports is not always Fresha's raw `card`. That broke cross-matching: a
store typing its card total into the Yoco-link box was compared against the
net-of-tips figure and missed by exactly the day's tips. The card line now
also carries `freshaAlt`, the reading it did *not* use, and the swap test
accepts either. Caught by the yoco ↔ link fixture, which failed on the first
run.

**Write buttons are hidden from a non-reviewer, not disabled.** The plan said
"gated on `canReviewCashups`"; the first implementation rendered them disabled.
`CashFloatTab` hides them outright, so this now does too. Read-only still
disables rather than hides, so the action stays discoverable to someone who
could be given the permission.

**`blankFloor` is config but has no settings field.** It normalises, it is
honoured, and it can be set by editing the config — but no dial was added,
because across 56 real blank-field rows none was under R20 and only two were
under R50. There is nothing to floor out yet, and an unused dial is a dial
somebody eventually turns by accident.

## What it finds on the current data

Run against the 24 Fresha exports and the 287 live cash-ups for 25 Aug – 5 Sep:

- **122 rows on the tab**, none yet signed off.
- **The dashboard reads critical**: 61 payments across 18 stores, R114,533
  unexplained, at the default R500 threshold.
- Muting vouchers takes the dashboard to 31 payments / R96,413 while the tab
  still lists all 122.
- The worst five, in order: Plumstead's blank Yoco field on **5 Sep
  (R24,325.50), 2 Sep (R19,144.20) and 1 Sep (R18,415.00)** — three separate
  days, not a one-off; Green Point's dropped digit on **1 Sep (R12,891)**; and
  Somerset West's **R5,050 of card tips against Fresha's R505 on 28 Aug**,
  which is the only one of the five where the store declared *more* than
  Fresha recorded a sale for.
