-- fix_clockins_type_check.sql
-- -----------------------------------------------------------------------------
-- URGENT: the kiosk auto-clock-out path inserts type = 'out_auto'
-- (kiosk/manager-app.js ensureAutoOuts → addManagerClockinWithMeta), but the
-- clockins_type_check constraint only allows 'in'/'out'. Every attempt 400s,
-- nothing is recorded, so the SAME open shifts are retried on every kiosk
-- refresh cycle — an ever-growing loop of failed POSTs (visible in the API
-- logs as repeating `new row for relation "clockins" violates check
-- constraint "clockins_type_check"`).
--
-- Zero out_auto rows have ever landed (verified 2026-07-22), so widening the
-- constraint is purely additive.
--
-- Run in Supabase SQL editor. Step 1 is a pre-flight look; step 2 applies.
-- -----------------------------------------------------------------------------

-- 1) Pre-flight: see the current definition before touching it.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.clockins'::regclass
  and conname  = 'clockins_type_check';

-- 2) Widen to include the auto-clock-out type.
alter table public.clockins drop constraint clockins_type_check;
alter table public.clockins add constraint clockins_type_check
  check (type in ('in', 'out', 'out_auto'));
