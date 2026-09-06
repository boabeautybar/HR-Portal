-- ============================================================================
-- Other payment mismatches — sign-off notes
-- ----------------------------------------------------------------------------
-- One new table next to public.cashups and public.fresha_daily_sales. The
-- mismatches themselves are NOT stored: they are recomputed at read time by
-- cash-float.js from the live cash-up and the live Fresha row, exactly like
-- every other figure in Cash Ups. A stored mismatch would drift the moment a
-- cash-up was reopened or a Fresha file re-imported.
--
--   cashup_mismatch_notes   one row per (branch, date, payment line) that a
--                           reviewer has looked at — resolved with an
--                           explanation, or escalated because it is being
--                           chased. Absence of a row means "nobody has looked
--                           at this yet", which is what the dashboard alert
--                           counts.
--
-- WHY THE THREE *_at_note COLUMNS EXIST
-- A note records the figures it was written against. On read, the live
-- declared / Fresha / difference are each compared with them; if any moved by
-- more than the match tolerance the row reopens, tagged "changed since
-- sign-off", showing both. Comparing only the difference would miss a store
-- re-submitting +R100 against a Fresha re-import of +R100 — same gap, a
-- different day's trading, and the old explanation may no longer hold.
-- Same instinct as deriving cash-in from cashups rather than mirroring it:
-- never let a stored number speak for a live one.
--
-- The note text is required BY THE DATABASE, not just by the form. A sign-off
-- with no reason is worth nothing to the next person who reads it.
--
-- Delete IS allowed here (unlike cash_movements, which archives): reopening a
-- row a reviewer signed off in error is a normal correction, not the loss of a
-- financial audit trail. The mismatch itself cannot be destroyed by deleting a
-- note — it is recomputed from the cash-up and the Fresha row either way.
--
-- Thresholds, the trailing alert window and per-line alert mutes are CONFIG
-- and live in app_state under key boa_cash_float_cfg_v1 (no schema here).
--
-- Run once in the Supabase SQL editor. Idempotent; safe to re-run.
-- ============================================================================

create table if not exists public.cashup_mismatch_notes (
  branch            text not null,
  date              date not null,
  -- Which payment line: card | yoco_link | gift_card | vouchers | tips | extra
  -- Deliberately NOT a check constraint — cash-float.js owns the line list,
  -- and a new Fresha payment type must not need a migration to be signed off.
  line              text not null,
  status            text not null check (status in ('resolved', 'escalated')),
  note              text not null,
  -- The figures this note was written against (see the header).
  declared_at_note  numeric not null,
  fresha_at_note    numeric not null,
  delta_at_note     numeric not null,
  actor             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (branch, date, line),
  constraint cashup_mismatch_notes_reason
    check (nullif(trim(note), '') is not null)
);

-- The tab and the dashboard both read a date window across every store.
create index if not exists cashup_mismatch_notes_date_idx
  on public.cashup_mismatch_notes (date);

-- Re-runnable on a table created by an earlier version of this file.
do $$
begin
  alter table public.cashup_mismatch_notes
    add column if not exists declared_at_note numeric,
    add column if not exists fresha_at_note   numeric,
    add column if not exists delta_at_note    numeric,
    add column if not exists updated_at       timestamptz not null default now();
end $$;

alter table public.cashup_mismatch_notes enable row level security;

drop policy if exists cashup_mismatch_notes_select on public.cashup_mismatch_notes;
create policy cashup_mismatch_notes_select on public.cashup_mismatch_notes
  for select using (true);

drop policy if exists cashup_mismatch_notes_insert on public.cashup_mismatch_notes;
create policy cashup_mismatch_notes_insert on public.cashup_mismatch_notes
  for insert with check (true);

drop policy if exists cashup_mismatch_notes_update on public.cashup_mismatch_notes;
create policy cashup_mismatch_notes_update on public.cashup_mismatch_notes
  for update using (true);

-- Reopening a row signed off in error is a correction, not a deletion of
-- history — the mismatch itself is recomputed from live data regardless.
drop policy if exists cashup_mismatch_notes_delete on public.cashup_mismatch_notes;
create policy cashup_mismatch_notes_delete on public.cashup_mismatch_notes
  for delete using (true);


-- ─── Pre-flight / sanity queries (read-only, optional) ─────────────────────
-- select status, count(*) from public.cashup_mismatch_notes group by status;
-- select branch, date, line, status, delta_at_note, actor, note
--   from public.cashup_mismatch_notes order by date desc, branch limit 20;
-- Notes whose cash-up has since been archived (they attach to the replacement):
-- select n.* from public.cashup_mismatch_notes n
--   join public.cashups c on c.branch = n.branch and c.date = n.date
--   where c.archived_at is not null;
