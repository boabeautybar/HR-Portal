-- ============================================================================
-- Asset register: assets, asset_events, asset_allocations
-- ----------------------------------------------------------------------------
-- Operations → Assets in the HR portal. Plan: docs/assets-plan.md.
--
--   assets             one row per physical asset across the four registers
--                      (register = IT | FA | SE | VE). The row carries the
--                      asset's CURRENT state — branch, holder, status,
--                      condition, date issued — as a PROJECTION that the data
--                      layer recomputes from the two history tables after every
--                      write (assets.js project()). Manual edits to those
--                      fields are only allowed while the asset has no history.
--
--   asset_events       the timeline: transfers (MOV-0001), disposals
--                      (DISP-0001), repairs out/in and status/condition
--                      changes. Never deleted — archived (archived_at), so an
--                      undo keeps its trace and the projection simply ignores
--                      the archived row.
--
--   asset_allocations  issue-and-return records (AL-0001). date_returned null
--                      = OPEN. An asset may hold at most ONE open allocation
--                      (partial unique index below). The employee's name, job
--                      title, department and branch are SNAPSHOTS taken at
--                      issue time, so a rename, transfer or departure later
--                      never rewrites what was signed for.
--
-- IDs: IT-/FA-/SE-/VE-/MOV-/DISP-/AL- + four digits, assigned by the data
-- layer at insert from max(existing)+1 for that prefix, and NEVER reused. The
-- unique indexes make a concurrent collision fail loudly (23505) so the insert
-- can retry with the next number rather than silently duplicating.
--
-- Dropdown lists (conditions, statuses, departments, categories per register,
-- reasons, disposal methods, extra locations, useful-life months) are CONFIG
-- and live in app_state under key boa_assets_cfg_v1. Who may dispose / edit
-- the lists is app_state key boa_asset_admin_access_v1. No schema here.
--
-- Access model: same as every other portal table — RLS on with permissive
-- policies (mirrors sql/clockin_meta_table.sql). No delete policy on the two
-- history tables: they are archived, never deleted. assets may be deleted so a
-- test row can be removed by an admin in the SQL editor if ever needed.
--
-- Payload rule: assets.photo is RESERVED for a base64 data URL and must NEVER
-- appear in a list select (see the app_state OOM note in data.js). It is not
-- written by phase 1 at all.
--
-- Run once in the Supabase SQL editor. Idempotent; safe to re-run.
-- ============================================================================

-- ─── assets ────────────────────────────────────────────────────────────────
create table if not exists public.assets (
  id              uuid primary key default gen_random_uuid(),
  asset_id        text not null,                 -- IT-0001 / FA-0001 / SE-0001 / VE-0001
  register        text not null
                    check (register in ('IT', 'FA', 'SE', 'VE')),
  category        text,
  description     text not null,
  brand           text,
  model           text,
  serial_number   text,
  asset_tag       text,                          -- physical sticker / barcode, free text
  purchase_date   date,
  purchase_cost   numeric,                       -- ZAR, as invoiced
  supplier        text,
  invoice_ref     text,
  warranty_expiry date,
  -- current state (projection; see header)
  branch          text,                          -- SALONS[].name / 'Head Office' / 'Call Centre & Sales' / cfg extra
  department      text,
  assigned_ec     text,                          -- employee_code of the current holder; null = held by the branch
  assigned_name   text,
  date_issued     date,
  condition       text,
  status          text,
  details         jsonb not null default '{}'::jsonb,   -- register-specific fields
  notes           text,
  photo           text,                          -- RESERVED, never in a list select
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_by      text,
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,                   -- soft delete of a mistaken entry
  archived_by     text
);
create unique index if not exists assets_asset_id_key on public.assets (asset_id);
create index if not exists assets_register_idx on public.assets (register);
create index if not exists assets_branch_idx on public.assets (branch);
create index if not exists assets_assigned_ec_idx on public.assets (assigned_ec);

-- keep updated_at honest without trusting the client
create or replace function public.assets_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists assets_touch on public.assets;
create trigger assets_touch before update on public.assets
  for each row execute function public.assets_touch();

alter table public.assets enable row level security;
drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets for select using (true);
drop policy if exists assets_insert on public.assets;
create policy assets_insert on public.assets for insert with check (true);
drop policy if exists assets_update on public.assets;
create policy assets_update on public.assets for update using (true);
drop policy if exists assets_delete on public.assets;
create policy assets_delete on public.assets for delete using (true);

-- ─── asset_events ──────────────────────────────────────────────────────────
create table if not exists public.asset_events (
  id              uuid primary key default gen_random_uuid(),
  event_no        text,                          -- MOV-0001 (transfer) / DISP-0001 (disposal); null for the minor kinds
  asset_id        uuid not null references public.assets (id) on delete cascade,
  kind            text not null
                    check (kind in ('transfer', 'disposal', 'repair_out', 'repair_in', 'status_change')),
  date            date not null,
  from_branch     text,
  to_branch       text,
  from_ec         text,
  to_ec           text,
  to_name         text,
  reason          text,                          -- cfg moveReasons
  disposal_method text,                          -- cfg disposalMethods
  disposal_value  numeric,
  condition       text,                          -- condition on transfer / at disposal / after repair
  to_status       text,                          -- status_change only
  approved_by     text,
  received_by     text,
  recorded_by     text,
  notes           text,
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     text,
  archive_reason  text
);
create unique index if not exists asset_events_event_no_key on public.asset_events (event_no) where event_no is not null;
create index if not exists asset_events_asset_idx on public.asset_events (asset_id);
create index if not exists asset_events_date_idx on public.asset_events (date);

alter table public.asset_events enable row level security;
drop policy if exists asset_events_select on public.asset_events;
create policy asset_events_select on public.asset_events for select using (true);
drop policy if exists asset_events_insert on public.asset_events;
create policy asset_events_insert on public.asset_events for insert with check (true);
drop policy if exists asset_events_update on public.asset_events;
create policy asset_events_update on public.asset_events for update using (true);
-- no delete policy: events are archived, never deleted

-- ─── asset_allocations ─────────────────────────────────────────────────────
create table if not exists public.asset_allocations (
  id                  uuid primary key default gen_random_uuid(),
  allocation_no       text not null,             -- AL-0001
  asset_id            uuid not null references public.assets (id) on delete cascade,
  ec                  text,                      -- employee_code; null = allocated to a branch, not a person
  employee_name       text,                      -- snapshots at issue time
  job_title           text,
  department          text,
  branch              text,
  date_issued         date not null,
  condition_issued    text,
  acknowledged        boolean not null default false,
  acknowledged_at     date,
  acknowledged_via    text,                      -- 'portal' | 'kiosk'
  date_returned       date,                      -- null = OPEN
  condition_returned  text,
  returned_to         text,                      -- branch / Storage
  outstanding_notes   text,
  recorded_by         text,
  created_at          timestamptz not null default now(),
  archived_at         timestamptz,
  archived_by         text
);
create unique index if not exists asset_allocations_no_key on public.asset_allocations (allocation_no);
create index if not exists asset_allocations_asset_idx on public.asset_allocations (asset_id);
create index if not exists asset_allocations_ec_idx on public.asset_allocations (ec);
-- invariant 1: at most one OPEN allocation per asset
create unique index if not exists asset_allocations_one_open
  on public.asset_allocations (asset_id) where date_returned is null and archived_at is null;

alter table public.asset_allocations enable row level security;
drop policy if exists asset_allocations_select on public.asset_allocations;
create policy asset_allocations_select on public.asset_allocations for select using (true);
drop policy if exists asset_allocations_insert on public.asset_allocations;
create policy asset_allocations_insert on public.asset_allocations for insert with check (true);
drop policy if exists asset_allocations_update on public.asset_allocations;
create policy asset_allocations_update on public.asset_allocations for update using (true);
-- no delete policy: allocations are archived, never deleted
