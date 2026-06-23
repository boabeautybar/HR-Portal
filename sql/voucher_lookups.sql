-- ============================================================================
-- Voucher lookups — audit log for the kiosk gift-card lookup
-- Run this once in the Supabase SQL editor (safe to re-run; all idempotent).
--
-- Every time a manager looks up a Shopify→Fresha voucher on the kiosk we write
-- one row here: WHO looked it up (manager PIN identity), WHEN, the full code
-- they typed, and whether it looked like a "shortcut" entry (the digits before
-- the last 4 are all one repeated character — the 000000000000XXXX bypass).
--
-- The HR-portal Voucher Admin → Audit tab reads this table and joins it to
-- gift_card_transactions (by fresha_code) to answer two questions on demand:
--   A) was a looked-up voucher redeemed, and on the SAME day?  (day mismatch)
--   B) which looked-up vouchers were never redeemed?           (cash-skim risk)
-- ============================================================================

create table if not exists voucher_lookups (
  id             text primary key,        -- client-generated (ts + random)
  looked_up_at   timestamptz not null,    -- exact moment of the lookup
  looked_up_ymd  date,                     -- branch-local calendar day (day-match)
  branch         text,
  manager_ec     text,                     -- who (employee code, from kiosk PIN)
  manager_name   text,
  typed_code     text,                     -- full code as typed (alnum, upper)
  last4          text,
  amount         text,
  found          boolean,
  fresha_code    text,                     -- the single match (null if 0/▸1 matches)
  match_count    integer,
  balance_at     numeric,                  -- balance shown at lookup time
  suspicious_pad boolean default false,    -- prefix-before-last4 is a repeated char
  created_at     timestamptz default now()
);
create index if not exists vl_ymd_idx         on voucher_lookups (looked_up_ymd);
create index if not exists vl_fresha_code_idx on voucher_lookups (fresha_code);

-- IMPORTANT: the whole app (kiosk + portal) talks to Supabase as the **anon**
-- role (no Supabase Auth / no login). The kiosk INSERTs here; the portal
-- SELECTs. Pick ONE of the two approaches below, matching how you set up
-- gift_card_transactions / vouchers.
--
--   Option A — simplest, matches the vouchers/cashups/staff tables: RLS off.
-- alter table voucher_lookups disable row level security;
--
--   Option B — keep RLS on, grant the anon role select + insert.
-- alter table voucher_lookups enable row level security;
-- drop policy if exists vl_anon_read  on voucher_lookups;
-- drop policy if exists vl_anon_write on voucher_lookups;
-- create policy vl_anon_read  on voucher_lookups for select to anon using (true);
-- create policy vl_anon_write on voucher_lookups for insert to anon with check (true);
