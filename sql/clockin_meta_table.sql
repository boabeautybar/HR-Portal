-- clockin_meta_table.sql
-- -----------------------------------------------------------------------------
-- Phase A of the app_state split: move manager clock-in selfie sidecars
-- (boa_mgrclockin_meta_<uuid>) out of app_state into their own table.
--
-- WHY: these rows are 5,367 of app_state's 9,022 rows (59%) and each carries
-- a ~66 KB base64 JPEG in jsonb — roughly 350 MB of photos inside the single
-- hottest table in the database. Every insert WAL-amplifies, every vacuum /
-- toast pass pays for them, and they sit behind the same PostgREST path the
-- polling clients hammer. Reads are already lazy per-exact-key
-- (data.js:1791, kiosk/data.js:2128), so moving them is a contained change:
-- 5 call sites total (portal read/write/delete + kiosk read/write).
--
-- Run this FIRST (table exists before any code deploy). Then deploy the JS
-- change, then backfill, then delete the old keys. Steps are numbered so
-- nothing is destructive until the end.
-- -----------------------------------------------------------------------------

-- 1) Table. Keyed by the clockins row it annotates.
create table if not exists public.clockin_meta (
  clockin_id uuid primary key references public.clockins (id) on delete cascade,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2) RLS: mirror app_state's access (anon read/write via PostgREST, same as
--    the sidecar had while living in app_state). Tighten later if desired.
alter table public.clockin_meta enable row level security;
drop policy if exists clockin_meta_select on public.clockin_meta;
create policy clockin_meta_select on public.clockin_meta for select using (true);
drop policy if exists clockin_meta_insert on public.clockin_meta;
create policy clockin_meta_insert on public.clockin_meta for insert with check (true);
drop policy if exists clockin_meta_update on public.clockin_meta;
create policy clockin_meta_update on public.clockin_meta for update using (true);
drop policy if exists clockin_meta_delete on public.clockin_meta;
create policy clockin_meta_delete on public.clockin_meta for delete using (true);

-- 3) Backfill from app_state (idempotent). Safe to run before or after the
--    code deploy; the JS fallback keeps reading app_state for rows not yet
--    moved.
insert into public.clockin_meta (clockin_id, value, updated_at)
select substring(key from 'boa_mgrclockin_meta_(.*)')::uuid,
       value,
       coalesce(updated_at, now())
from public.app_state
where key like 'boa_mgrclockin_meta_%'
  -- only rows whose parent clockin still exists (FK would reject orphans)
  and exists (
    select 1 from public.clockins c
    where c.id = substring(key from 'boa_mgrclockin_meta_(.*)')::uuid
  )
on conflict (clockin_id) do nothing;

-- 4) ONLY after the code deploy is live and step 3 has run — reclaim
--    app_state. This is the destructive step; run it deliberately.
-- delete from public.app_state where key like 'boa_mgrclockin_meta_%';
-- vacuum (analyze) public.app_state;
