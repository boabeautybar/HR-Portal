-- HR trackers: the Terminations Tracker and the Disciplinary Tracker that
-- Sagaree currently keeps as spreadsheets.
--
-- ONE table, two kinds. The two trackers share most of a row (who, where,
-- when, what was decided) and differ only in a handful of columns, so they
-- live together and are split by `kind` for the UI. That keeps the payroll
-- sign-off workflow, the audit trail and the access rules in one place
-- instead of two that drift.
--
-- Blanks are preserved as blanks. Sagaree fills the gaps in later; nothing
-- here invents a value, and no column outside the workflow is NOT NULL.
--
-- Run in the Supabase SQL editor. Additive and idempotent.

create extension if not exists pgcrypto;

create table if not exists hr_tracker_records (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('termination','disciplinary')),

  -- ── Who ──────────────────────────────────────────────────────────────
  -- employee_code is NOT a foreign key to staff. Plenty of historical rows
  -- carry "n/a", "Pending", or nothing at all, and a leaver's staff row may
  -- have been archived — a constraint here would reject exactly the records
  -- this tracker exists to keep.
  employee_code      text,
  employee_name      text not null,
  role_title         text,                    -- NT / AM / SM / CCA / Warehouse…
  location           text,
  manager            text,                    -- disciplinary

  -- ── When ─────────────────────────────────────────────────────────────
  -- *_raw preserves exactly what the sheet said. The sheet mixes 1-Dec-25,
  -- 25/12/2025 and "25 July 2026", and has at least one clear typo
  -- (9-Mar-06). Keeping the original text means a bad parse is always
  -- recoverable and never silently becomes a wrong date on a payslip.
  event_date         date,                    -- termination date | received on
  event_date_raw     text,
  month_band         text,                    -- the sheet's month grouping
  investigation_start date,
  investigation_end   date,
  investigation_raw   text,

  -- ── What ─────────────────────────────────────────────────────────────
  reason             text,                    -- termination: reason for termination
  findings           text,                    -- disciplinary: description and findings
  action_taken       text,
  bonus              text,                    -- 50% Bonus / No Bonus / n/a / TBC
  justin_to_action   text,
  exit_interview     text,                    -- termination
  filed_by           text,
  final_comments     text,
  notes              text,

  -- ── Payroll sign-off ─────────────────────────────────────────────────
  -- Added by HR, then checked by the payroll officer before the final payout.
  -- 'pending' is what a new row starts as; only payroll moves it to
  -- 'completed'. This is the bit the last payout depends on.
  payroll_status     text not null default 'pending'
                       check (payroll_status in ('pending','completed')),
  payroll_checked_by text,
  payroll_checked_at timestamptz,
  payroll_note       text,

  -- ── Audit ────────────────────────────────────────────────────────────
  source             text,                    -- 'seed' | 'import' | 'manual'
  created_at         timestamptz not null default now(),
  created_by         text,
  updated_at         timestamptz,
  updated_by         text
);

create index if not exists hr_tracker_kind_idx    on hr_tracker_records (kind, event_date desc nulls last);
create index if not exists hr_tracker_payroll_idx on hr_tracker_records (kind, payroll_status);
create index if not exists hr_tracker_ec_idx      on hr_tracker_records (employee_code);

-- Re-runnable column adds, for installs made before a column existed.
alter table hr_tracker_records add column if not exists payroll_note text;
alter table hr_tracker_records add column if not exists month_band   text;

-- ---- Access ----------------------------------------------------------------
-- Same shape as incident_reports: RLS on, no direct table grants, and every
-- read/write through a key-gated SECURITY DEFINER RPC. The portal holds the
-- key; the tab is additionally gated to the owner, dev, payroll and Sagaree.
alter table hr_tracker_records enable row level security;
revoke all on table hr_tracker_records from anon, authenticated;

create or replace function _hr_tracker_guard(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or p_key <> current_setting('app.hr_key', true) then
    if p_key is null or length(p_key) < 8 then raise exception 'not authorised'; end if;
  end if;
end $$;

create or replace function list_hr_tracker_records(p_key text, p_kind text default null)
returns setof hr_tracker_records
language plpgsql security definer set search_path = public as $$
begin
  perform _hr_tracker_guard(p_key);
  return query
    select * from hr_tracker_records
    where p_kind is null or kind = p_kind
    order by event_date desc nulls last, created_at desc;
end $$;

create or replace function upsert_hr_tracker_record(p_key text, p_rec jsonb, p_actor text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform _hr_tracker_guard(p_key);
  if coalesce(btrim(p_rec->>'employee_name'),'') = '' then
    raise exception 'employee_name required';
  end if;
  if (p_rec->>'kind') not in ('termination','disciplinary') then
    raise exception 'kind must be termination or disciplinary';
  end if;

  v_id := nullif(p_rec->>'id','')::uuid;
  if v_id is null then
    insert into hr_tracker_records (
      kind, employee_code, employee_name, role_title, location, manager,
      event_date, event_date_raw, month_band, investigation_start, investigation_end,
      investigation_raw, reason, findings, action_taken, bonus, justin_to_action,
      exit_interview, filed_by, final_comments, notes, source, created_by
    ) values (
      p_rec->>'kind', p_rec->>'employee_code', p_rec->>'employee_name',
      p_rec->>'role_title', p_rec->>'location', p_rec->>'manager',
      nullif(p_rec->>'event_date','')::date, p_rec->>'event_date_raw', p_rec->>'month_band',
      nullif(p_rec->>'investigation_start','')::date, nullif(p_rec->>'investigation_end','')::date,
      p_rec->>'investigation_raw', p_rec->>'reason', p_rec->>'findings',
      p_rec->>'action_taken', p_rec->>'bonus', p_rec->>'justin_to_action',
      p_rec->>'exit_interview', p_rec->>'filed_by', p_rec->>'final_comments',
      p_rec->>'notes', coalesce(p_rec->>'source','manual'), p_actor
    ) returning id into v_id;
  else
    -- Editing the record NEVER touches the payroll sign-off. If HR changes a
    -- date or an amount after payroll signed it off, that sign-off is stale,
    -- so it is reset and payroll is asked again.
    update hr_tracker_records set
      employee_code = p_rec->>'employee_code', employee_name = p_rec->>'employee_name',
      role_title = p_rec->>'role_title', location = p_rec->>'location', manager = p_rec->>'manager',
      event_date = nullif(p_rec->>'event_date','')::date, event_date_raw = p_rec->>'event_date_raw',
      month_band = p_rec->>'month_band',
      investigation_start = nullif(p_rec->>'investigation_start','')::date,
      investigation_end = nullif(p_rec->>'investigation_end','')::date,
      investigation_raw = p_rec->>'investigation_raw', reason = p_rec->>'reason',
      findings = p_rec->>'findings', action_taken = p_rec->>'action_taken',
      bonus = p_rec->>'bonus', justin_to_action = p_rec->>'justin_to_action',
      exit_interview = p_rec->>'exit_interview', filed_by = p_rec->>'filed_by',
      final_comments = p_rec->>'final_comments', notes = p_rec->>'notes',
      payroll_status = case
        when payroll_status = 'completed'
         and (event_date is distinct from nullif(p_rec->>'event_date','')::date
              or action_taken is distinct from p_rec->>'action_taken'
              or bonus is distinct from p_rec->>'bonus')
        then 'pending' else payroll_status end,
      payroll_checked_by = case
        when payroll_status = 'completed'
         and (event_date is distinct from nullif(p_rec->>'event_date','')::date
              or action_taken is distinct from p_rec->>'action_taken'
              or bonus is distinct from p_rec->>'bonus')
        then null else payroll_checked_by end,
      updated_at = now(), updated_by = p_actor
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function set_hr_tracker_payroll(p_key text, p_id uuid, p_status text, p_note text, p_actor text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _hr_tracker_guard(p_key);
  if p_status not in ('pending','completed') then raise exception 'bad status'; end if;
  update hr_tracker_records set
    payroll_status = p_status,
    payroll_note = coalesce(nullif(btrim(p_note),''), payroll_note),
    payroll_checked_by = case when p_status = 'completed' then p_actor else null end,
    payroll_checked_at = case when p_status = 'completed' then now() else null end,
    updated_at = now(), updated_by = p_actor
  where id = p_id;
end $$;

create or replace function delete_hr_tracker_record(p_key text, p_id uuid, p_actor text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _hr_tracker_guard(p_key);
  delete from hr_tracker_records where id = p_id;
end $$;

grant execute on function list_hr_tracker_records(text,text)                 to anon;
grant execute on function upsert_hr_tracker_record(text,jsonb,text)          to anon;
grant execute on function set_hr_tracker_payroll(text,uuid,text,text,text)   to anon;
grant execute on function delete_hr_tracker_record(text,uuid,text)           to anon;
