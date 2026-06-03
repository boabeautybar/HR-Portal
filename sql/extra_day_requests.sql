-- ============================================================================
-- Extra-day availability requests — staff offer to work an extra day from
-- "My BOA" (extra.html); regional managers review (approve / decline) in the
-- HR portal's "Extra-Day Requests" tab. Run once in the Supabase SQL editor
-- (idempotent; safe to re-run).
--
-- Same confidentiality pattern as sql/leave_requests.sql: RLS ON with NO anon
-- policies. All access via SECURITY DEFINER functions:
--   • submit_extra_day_request(...) — PUBLIC, insert-only, returns a ref code.
--   • list/set RPCs                 — require the shared HR key (incident_hr_key).
--
-- Depends on sql/incident_reports.sql (the app_secrets HR key) — run that once
-- first. Reuses the same _check_hr_key() helper defined by sql/leave_requests.sql.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists extra_day_requests (
  id             uuid primary key default gen_random_uuid(),
  ref_code       text unique not null,         -- e.g. EX-260603-A1B2
  created_at     timestamptz not null default now(),
  store          text,
  ec             text,
  name           text not null,
  purpose        text not null default 'extra', -- 'catch_up' | 'extra'
  work_date      date not null,                 -- the day being offered
  note           text,
  status         text not null default 'pending', -- pending | approved | declined
  reviewed       boolean not null default false,
  decision_note  text,
  decided_at     timestamptz,
  decided_by     text,
  internal_notes jsonb not null default '[]'::jsonb,
  updated_at     timestamptz
);
create index if not exists extra_day_requests_created_idx on extra_day_requests (created_at desc);
create index if not exists extra_day_requests_date_idx    on extra_day_requests (work_date);

alter table extra_day_requests enable row level security;

-- Reuse _check_hr_key() from sql/leave_requests.sql. Define a fallback here so
-- this file can run even if that one hasn't (harmless create-or-replace).
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

-- ---- PUBLIC: submit an extra-day offer (no key; insert-only) ----------------
create or replace function submit_extra_day_request(
  p_store     text,
  p_ec        text,
  p_name      text,
  p_purpose   text,
  p_work_date date,
  p_note      text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_ref text;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  if p_work_date is null then raise exception 'date required'; end if;

  v_ref := 'EX-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMMDD')
           || '-' || upper(substr(md5(random()::text), 1, 4));

  insert into extra_day_requests (ref_code, store, ec, name, purpose, work_date, note)
  values (
    v_ref,
    nullif(btrim(p_store), ''),
    nullif(btrim(p_ec), ''),
    btrim(p_name),
    case when btrim(coalesce(p_purpose, '')) = 'catch_up' then 'catch_up' else 'extra' end,
    p_work_date,
    nullif(btrim(p_note), '')
  );
  return v_ref;
end $$;

-- ---- PORTAL: read all (HR key required) ------------------------------------
create or replace function list_extra_day_requests(p_key text)
returns setof extra_day_requests
language plpgsql security definer set search_path = public as $$
begin
  perform _check_hr_key(p_key);
  return query select * from extra_day_requests order by created_at desc;
end $$;

-- ---- PORTAL: approve / decline (declining requires a note) -----------------
create or replace function set_extra_day_status(p_key text, p_id uuid, p_status text, p_note text default '', p_actor text default '')
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_hr_key(p_key);
  if p_status not in ('pending', 'approved', 'declined') then raise exception 'bad status'; end if;
  if p_status = 'declined' and coalesce(btrim(p_note), '') = '' then
    raise exception 'decline reason required';
  end if;
  update extra_day_requests
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

create or replace function mark_extra_day_reviewed(p_key text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_hr_key(p_key);
  update extra_day_requests set reviewed = true, updated_at = now() where id = p_id;
end $$;

-- ---- Grants ----------------------------------------------------------------
revoke execute on function _check_hr_key(text) from public;
grant execute on function submit_extra_day_request(text,text,text,text,date,text) to anon;
grant execute on function list_extra_day_requests(text)                          to anon;
grant execute on function set_extra_day_status(text,uuid,text,text,text)          to anon;
grant execute on function mark_extra_day_reviewed(text,uuid)                      to anon;
