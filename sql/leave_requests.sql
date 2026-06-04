-- ============================================================================
-- Staff leave requests — submitted from "My BOA" (leave.html), reviewed in the
-- HR portal's Leave Requests tab. Run once in the Supabase SQL editor
-- (idempotent; safe to re-run).
--
-- Same confidentiality pattern as sql/incident_reports.sql: RLS is ON with NO
-- anon policies, so the table is unreadable through the normal REST API. All
-- access is via SECURITY DEFINER functions:
--   • submit_leave_request(...) — PUBLIC, insert-only, returns a ref code.
--   • list/update RPCs          — require the SAME HR access key as incidents
--     (app_secrets 'incident_hr_key', held only by the portal).
--
-- NOTE: run sql/incident_reports.sql first (or at least once) so the
-- app_secrets table + key exist; this file reuses that key.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists leave_requests (
  id             uuid primary key default gen_random_uuid(),
  ref_code       text unique not null,        -- e.g. LV-260602-A1B2
  created_at     timestamptz not null default now(),
  store          text,
  ec             text,                          -- employee code (optional, helps HR match)
  name           text not null,                 -- who is requesting
  contact        text,                          -- optional phone/email
  leave_type     text not null default 'Annual',-- Annual / Sick / Family / Unpaid / Other
  start_date     date not null,
  end_date       date not null,
  reason         text,
  status         text not null default 'pending', -- pending | approved | declined
  reviewed       boolean not null default false,  -- HR has opened it
  decision_note  text,
  decided_at     timestamptz,
  decided_by     text,
  internal_notes jsonb not null default '[]'::jsonb,
  updated_at     timestamptz
);
create index if not exists leave_requests_created_idx on leave_requests (created_at desc);

-- Reuse the incident HR key. RLS ON / no policies → unreadable via anon REST.
alter table leave_requests enable row level security;

-- Key check that reads the shared 'incident_hr_key' secret (same key the portal
-- already holds). Self-contained so this file can run independently.
create or replace function _check_hr_key(p_key text)
returns void
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  select secret into s from app_secrets where name = 'incident_hr_key';
  if s is null or p_key is null or p_key <> s then
    raise exception 'unauthorized';
  end if;
end $$;

-- ---- PUBLIC: submit a leave request (no key; insert-only) -------------------
create or replace function submit_leave_request(
  p_store      text,
  p_ec         text,
  p_name       text,
  p_contact    text,
  p_leave_type text,
  p_start_date date,
  p_end_date   date,
  p_reason     text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_ref text;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'dates required'; end if;
  if p_end_date < p_start_date then raise exception 'end before start'; end if;

  -- Block double sick/absent marks: you can only call in once for a given day.
  -- Only applies to Sick/Absent marks (not planned Annual leave). Rejects when
  -- the same person (employee code, or name when no code) already has a
  -- Sick/Absent mark whose dates overlap these ones, regardless of status. The
  -- absence form turns the 'duplicate_request' message into a friendly notice.
  if btrim(coalesce(p_leave_type, '')) in ('Sick', 'Absent') then
    if exists (
      select 1 from leave_requests
      where leave_type in ('Sick', 'Absent')
        and start_date <= p_end_date
        and end_date   >= p_start_date
        and case
          when nullif(btrim(p_ec), '') is not null then ec = nullif(btrim(p_ec), '')
          else lower(btrim(name)) = lower(btrim(p_name))
        end
    ) then
      raise exception 'duplicate_request';
    end if;
  end if;

  v_ref := 'LV-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMMDD')
           || '-' || upper(substr(md5(random()::text), 1, 4));

  insert into leave_requests (
    ref_code, store, ec, name, contact, leave_type, start_date, end_date, reason
  ) values (
    v_ref,
    nullif(btrim(p_store), ''),
    nullif(btrim(p_ec), ''),
    btrim(p_name),
    nullif(btrim(p_contact), ''),
    coalesce(nullif(btrim(p_leave_type), ''), 'Annual'),
    p_start_date,
    p_end_date,
    nullif(btrim(p_reason), '')
  );
  return v_ref;
end $$;

-- ---- PORTAL: read all requests (HR key required) ---------------------------
create or replace function list_leave_requests(p_key text)
returns setof leave_requests
language plpgsql security definer set search_path = public as $$
begin
  perform _check_hr_key(p_key);
  return query select * from leave_requests order by created_at desc;
end $$;

-- ---- PORTAL: approve / decline (declining requires a note) -----------------
create or replace function set_leave_status(p_key text, p_id uuid, p_status text, p_note text default '', p_actor text default '')
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_hr_key(p_key);
  if p_status not in ('pending', 'approved', 'declined') then raise exception 'bad status'; end if;
  if p_status = 'declined' and coalesce(btrim(p_note), '') = '' then
    raise exception 'decline reason required';
  end if;
  update leave_requests
     set status = p_status,
         reviewed = true,
         decision_note = case when p_status = 'pending' then decision_note else nullif(btrim(p_note), '') end,
         decided_at = case when p_status = 'pending' then null else now() end,
         decided_by = case when p_status = 'pending' then null else coalesce(p_actor, '') end,
         internal_notes = case when coalesce(btrim(p_note), '') = '' then internal_notes
           else internal_notes || jsonb_build_object('at', now(), 'by', coalesce(p_actor, ''),
                'note', upper(p_status) || ': ' || btrim(p_note)) end,
         updated_at = now()
   where id = p_id;
end $$;

-- ---- PORTAL: mark seen / add internal note ---------------------------------
create or replace function mark_leave_reviewed(p_key text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_hr_key(p_key);
  update leave_requests set reviewed = true, updated_at = now() where id = p_id;
end $$;

create or replace function add_leave_note(p_key text, p_id uuid, p_note text, p_author text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_hr_key(p_key);
  if coalesce(btrim(p_note), '') = '' then return; end if;
  update leave_requests
     set internal_notes = internal_notes || jsonb_build_object('at', now(), 'by', coalesce(p_author, ''), 'note', btrim(p_note)),
         updated_at = now()
   where id = p_id;
end $$;

-- ---- PORTAL: owner delete (remove a test / erroneous request) --------------
create or replace function delete_leave_request(p_key text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_hr_key(p_key);
  delete from leave_requests where id = p_id;
end $$;

-- ---- Grants ----------------------------------------------------------------
revoke execute on function _check_hr_key(text) from public;
grant execute on function submit_leave_request(text,text,text,text,text,date,date,text) to anon;
grant execute on function list_leave_requests(text)                  to anon;
grant execute on function set_leave_status(text,uuid,text,text,text)  to anon;
grant execute on function mark_leave_reviewed(text,uuid)              to anon;
grant execute on function add_leave_note(text,uuid,text,text)         to anon;
grant execute on function delete_leave_request(text,uuid)             to anon;
