-- ============================================================================
-- Cash float ledger + Fresha daily-sales reconciliation
-- ----------------------------------------------------------------------------
-- Two new tables that sit NEXT TO public.cashups (the daily cash-up itself is
-- unchanged):
--
--   cash_movements      one row per cash movement that is NOT part of a daily
--                       cash-up: a standalone store deposit (kiosk "Bank Cash"
--                       tile), a collection by the ops/portfolio manager, or a
--                       signed adjustment with a reason. Cash IN (cashups.cash)
--                       and "banked with the cash-up" (cashups.amount_banked
--                       when cash_banked = true) are DERIVED from cashups at
--                       read time and are deliberately NOT mirrored here, so a
--                       reopened / deleted / backdated cash-up can never drift
--                       from the ledger.
--
--   fresha_daily_sales  one row per (branch, date), parsed from a Fresha
--                       per-store export (Finance summary preferred; the older
--                       Sales summary also works). Re-importing a day replaces
--                       the row (upsert on the primary key).
--
-- Per-store opening balance, start date, the R10 000 ceiling, the match
-- tolerance and the Fresha location -> branch alias map are CONFIG and live in
-- app_state under key boa_cash_float_cfg_v1 (no schema here).
--
-- Access model: the kiosk talks to Supabase with the anon key, same as
-- cashups. RLS is enabled with permissive select/insert/update policies
-- (mirrors sql/clockin_meta_table.sql). cash_movements has NO delete policy —
-- a movement is archived (archived_at), never deleted, so the audit trail
-- survives. fresha_daily_sales may be deleted so a bad import can be cleared.
--
-- Payload rule: cash_movements.slip is a base64 data URL (a banking-slip
-- photo, ~100-200 KB). It must NEVER be included in a list select — fetch it
-- per row on demand, exactly like cashups.yoco_photo.
--
-- Run once in the Supabase SQL editor. Idempotent; safe to re-run.
-- ============================================================================

-- ─── cash_movements ────────────────────────────────────────────────────────
create table if not exists public.cash_movements (
  id              uuid primary key default gen_random_uuid(),
  branch          text not null,                -- SALONS[].name string, as on cashups.branch
  date            date not null,                -- trading day the movement belongs to
  kind            text not null
                    check (kind in ('deposit', 'collection', 'adjustment')),
  amount          numeric not null,             -- deposit/collection: positive, subtracted from on-hand
                                                -- adjustment: signed (+ raises on-hand, - lowers it)
  ref             text,                         -- bank deposit reference / slip number
  note            text,                         -- free text; REQUIRED for adjustments (reason)
  slip            text,                         -- base64 data URL of the deposit slip; never in list reads
  recorded_by     text,                         -- name typed on the kiosk, or portal user name
  source          text not null default 'portal'
                    check (source in ('kiosk', 'portal')),
  cashup_id       uuid references public.cashups (id) on delete set null,  -- optional link to the day's cash-up
  reviewed_at     timestamptz,                  -- sign-off by the cash-up reviewer (same meaning as cashups.reviewed_*)
  reviewed_by     text,
  review_comment  text,
  archived_at     timestamptz,                  -- soft delete; ledger ignores archived rows
  archived_by     text,
  created_at      timestamptz not null default now(),
  constraint cash_movements_amount_nonzero
    check (amount <> 0),
  constraint cash_movements_adjustment_needs_reason
    check (kind <> 'adjustment' or nullif(trim(note), '') is not null)
);

-- Ledger reads are "everything for this branch since its start date".
create index if not exists cash_movements_branch_date_idx
  on public.cash_movements (branch, date);

-- "What still needs sign-off" — small partial index, mirrors cashups_reviewed_at_idx.
create index if not exists cash_movements_unreviewed_idx
  on public.cash_movements (reviewed_at)
  where reviewed_at is null and archived_at is null;

alter table public.cash_movements enable row level security;

drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  for select using (true);

drop policy if exists cash_movements_insert on public.cash_movements;
create policy cash_movements_insert on public.cash_movements
  for insert with check (true);

drop policy if exists cash_movements_update on public.cash_movements;
create policy cash_movements_update on public.cash_movements
  for update using (true);

-- Intentionally no delete policy: archive, don't delete.
drop policy if exists cash_movements_delete on public.cash_movements;


-- ─── fresha_daily_sales ────────────────────────────────────────────────────
-- One row per store per trading day, parsed from a Fresha export. Two reports
-- can feed it and both are stored the same way:
--
--   FINANCE SUMMARY (preferred) — one file per store covering a DATE RANGE,
--   one row per day, dates inside the file. Its payment-type columns vary by
--   store (Card / Cash / EFT / SHOPIFY / Yoco Payment Link), which is why the
--   parser reads by column NAME and puts anything unfamiliar into `other`.
--
--   SALES SUMMARY (older) — one file per store per day, no date inside it, so
--   the trading day is supplied at import.
--
-- Money-in is stated identically by both and lands in `total`:
--   finance: "Total sales + other sales" = Total payments + Total redemptions
--   sales:   "Payments collected"
-- Tips are INCLUDED in `total` and in the payment line they were paid on, so
-- the figure comparable to a cash-up (which excludes tips) is `net_collected`.
--
-- Re-importing a day replaces it: the primary key is (branch, date).
create table if not exists public.fresha_daily_sales (
  branch                text not null,              -- resolved store name
  date                  date not null,              -- trading day
  report                text not null default 'finance',   -- which Fresha report produced this

  -- Sales
  gross_sales           numeric not null default 0,
  discounts             numeric not null default 0, -- stored positive (Fresha reports it negative)
  refund_amount         numeric not null default 0,
  net_sales             numeric not null default 0,
  taxes                 numeric not null default 0,
  total_sales           numeric not null default 0,
  gift_cards_sold       numeric not null default 0, -- gift cards SOLD
  service_charges       numeric not null default 0,
  tips                  numeric not null default 0,
  net_other_sales       numeric not null default 0,
  total_other_sales     numeric not null default 0,
  total                 numeric not null default 0, -- money in, tips INCLUDED
  net_collected         numeric not null default 0, -- total - tips; comparable to a cash-up total
  sales_paid            numeric not null default 0,
  unpaid_sales          numeric not null default 0,

  -- Payments
  card                  numeric not null default 0,
  cash                  numeric not null default 0,
  yoco_link             numeric not null default 0,
  eft                   numeric not null default 0,
  shopify               numeric not null default 0,
  other                 numeric not null default 0, -- unrecognised payment types
  total_payments        numeric not null default 0,
  prepayments           numeric not null default 0,

  -- Redemptions
  prepayment_redemption numeric not null default 0,
  gift_card             numeric not null default 0, -- gift cards REDEEMED as payment
  total_redemptions     numeric not null default 0,

  -- Sales-summary-only extras (0 for finance-summary rows)
  services              numeric not null default 0,
  products              numeric not null default 0,
  refunds_paid          numeric not null default 0,
  sales_qty             integer not null default 0,
  refund_qty            integer not null default 0,
  txn_count             integer not null default 0,

  breakdown             jsonb,                      -- every raw column, verbatim
  location_raw          text,                       -- store name as it appeared in the file
  source_file           text,
  imported_by           text,
  imported_at           timestamptz not null default now(),
  primary key (branch, date)
);

-- Additive upgrade for anyone who ran an earlier version of this file, which
-- modelled Fresha on the older per-day sales summary before the finance
-- summary was available. Safe on a fresh install too.
alter table public.fresha_daily_sales
  add column if not exists report                text not null default 'finance',
  add column if not exists gross_sales           numeric not null default 0,
  add column if not exists discounts             numeric not null default 0,
  add column if not exists refund_amount         numeric not null default 0,
  add column if not exists net_sales             numeric not null default 0,
  add column if not exists taxes                 numeric not null default 0,
  add column if not exists total_sales           numeric not null default 0,
  add column if not exists gift_cards_sold       numeric not null default 0,
  add column if not exists service_charges       numeric not null default 0,
  add column if not exists tips                  numeric not null default 0,
  add column if not exists net_other_sales       numeric not null default 0,
  add column if not exists total_other_sales     numeric not null default 0,
  add column if not exists net_collected         numeric not null default 0,
  add column if not exists sales_paid            numeric not null default 0,
  add column if not exists unpaid_sales          numeric not null default 0,
  add column if not exists yoco_link             numeric not null default 0,
  add column if not exists eft                   numeric not null default 0,
  add column if not exists shopify                numeric not null default 0,
  add column if not exists total_payments        numeric not null default 0,
  add column if not exists prepayments           numeric not null default 0,
  add column if not exists prepayment_redemption numeric not null default 0,
  add column if not exists gift_card             numeric not null default 0,
  add column if not exists total_redemptions     numeric not null default 0,
  add column if not exists services              numeric not null default 0,
  add column if not exists products              numeric not null default 0,
  add column if not exists refunds_paid          numeric not null default 0,
  add column if not exists sales_qty             integer not null default 0,
  add column if not exists refund_qty            integer not null default 0;

-- Daily-view reads are "every branch for one date".
create index if not exists fresha_daily_sales_date_idx
  on public.fresha_daily_sales (date);

-- "Which store-days had cash?" — the question this whole feature exists for.
create index if not exists fresha_daily_sales_cash_idx
  on public.fresha_daily_sales (date) where cash <> 0;

alter table public.fresha_daily_sales enable row level security;

drop policy if exists fresha_daily_sales_select on public.fresha_daily_sales;
create policy fresha_daily_sales_select on public.fresha_daily_sales
  for select using (true);

drop policy if exists fresha_daily_sales_insert on public.fresha_daily_sales;
create policy fresha_daily_sales_insert on public.fresha_daily_sales
  for insert with check (true);

drop policy if exists fresha_daily_sales_update on public.fresha_daily_sales;
create policy fresha_daily_sales_update on public.fresha_daily_sales
  for update using (true);

drop policy if exists fresha_daily_sales_delete on public.fresha_daily_sales;
create policy fresha_daily_sales_delete on public.fresha_daily_sales
  for delete using (true);


-- ─── Pre-flight / sanity queries (read-only, optional) ─────────────────────
-- select kind, count(*), sum(amount) from public.cash_movements
--   where archived_at is null group by kind;
-- select branch, date, cash, card, tips, total, net_collected
--   from public.fresha_daily_sales order by date desc, branch limit 20;
-- Store-days where a salon took cash:
-- select branch, date, cash, total from public.fresha_daily_sales
--   where cash <> 0 order by date desc, branch;
