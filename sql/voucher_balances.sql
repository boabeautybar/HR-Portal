-- ============================================================================
-- Voucher balances — schema + server-side recompute
-- Run this once in the Supabase SQL editor (safe to re-run; all idempotent).
--
-- Vouchers (Shopify→Fresha lookup) carry a precomputed remaining balance and a
-- snapshot of their Fresha gift-card transactions. The recompute is done in one
-- Postgres statement (the recompute_voucher_balances RPC) so it's fast and
-- finishes on the server even if the browser/laptop sleeps.
-- ============================================================================

-- ---- Raw Fresha "Gift Card Transactions" (one row per redemption) ----------
create table if not exists gift_card_transactions (
  id              text primary key,   -- the CSV "ID" (dedup key on re-upload)
  gift_card       text not null,      -- 8-char Fresha code; joins vouchers.fresha_code
  payment_date    timestamptz,
  location        text,
  amount          numeric,            -- value used (negative for refunds)
  txn_type        text,               -- "Sale" / "Refund"
  client_name     text,
  appointment_ref text                -- Fresha appointment lookup id
);
create index if not exists gct_gift_card_idx on gift_card_transactions (gift_card);

-- IMPORTANT: the whole app talks to Supabase as the **anon** role (no Supabase
-- Auth / no login). RLS policies for the `authenticated` role do NOT apply.
-- Pick ONE of the two approaches below so the anon app can use this table:
--
--   Option A — simplest, matches the vouchers/cashups/staff tables: turn RLS off.
-- alter table gift_card_transactions disable row level security;
--
--   Option B — keep RLS on, but grant the anon role the access the app needs:
--     read (count + recompute), and insert/update if you want the in-portal
--     CSV upload (upsert) to work. If you only ever import via the Supabase
--     dashboard, the SELECT policy alone is enough.
-- alter table gift_card_transactions enable row level security;
-- drop policy if exists gct_anon_read   on gift_card_transactions;
-- drop policy if exists gct_anon_write  on gift_card_transactions;
-- drop policy if exists gct_anon_update on gift_card_transactions;
-- create policy gct_anon_read   on gift_card_transactions for select to anon using (true);
-- create policy gct_anon_write  on gift_card_transactions for insert to anon with check (true);
-- create policy gct_anon_update on gift_card_transactions for update to anon using (true) with check (true);

-- ---- Precomputed rollup on the existing vouchers table ---------------------
alter table vouchers add column if not exists used_total         numeric;
alter table vouchers add column if not exists balance            numeric;
alter table vouchers add column if not exists txn_count          integer;
alter table vouchers add column if not exists last_used_at       timestamptz;
alter table vouchers add column if not exists txns               jsonb;   -- [{d,b,a,c,ap}]
alter table vouchers add column if not exists balance_updated_at timestamptz;

-- ---- Server-side recompute -------------------------------------------------
-- p_codes NULL  -> recompute every voucher.
-- p_codes [...] -> recompute only those Fresha codes (case-insensitive).
-- Returns the number of voucher rows updated.
create or replace function recompute_voucher_balances(p_codes text[] default null)
returns integer
language plpgsql
security definer            -- runs with the owner's rights, so it works regardless of RLS
set search_path = public
as $$
declare
  affected integer;
begin
  with agg as (
    select gift_card,
           sum(amount)       as used_total,
           count(*)          as txn_count,
           max(payment_date) as last_used_at,
           jsonb_agg(
             jsonb_build_object('d', payment_date, 'b', location, 'a', amount,
                                'c', client_name, 'ap', appointment_ref)
             order by payment_date desc
           ) as txns
    from gift_card_transactions
    where p_codes is null
       or gift_card = any (array(select upper(x) from unnest(p_codes) as x))
    group by gift_card
  )
  update vouchers v
  set used_total         = coalesce(a.used_total, 0),
      balance            = coalesce(nullif(regexp_replace(v.amount, '[^0-9.-]', '', 'g'), '')::numeric, 0)
                           - coalesce(a.used_total, 0),
      txn_count          = coalesce(a.txn_count, 0),
      last_used_at       = a.last_used_at,
      txns               = coalesce(a.txns, '[]'::jsonb),
      balance_updated_at = now()
  from agg a
  where upper(v.fresha_code) = a.gift_card;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Allow the kiosk/portal anon role to call it (RLS still applies to the tables).
grant execute on function recompute_voucher_balances(text[]) to anon, authenticated;
