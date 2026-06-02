-- ============================================================================
-- Staff incident reports — confidential reporting channel
-- Run once in the Supabase SQL editor (idempotent; safe to re-run).
--
-- Goal: let any nail tech file an incident report from their OWN phone (via a
-- QR/link to /report.html) without going through the shared kiosk iPad or the
-- store manager. Reports land in the HR portal only.
--
-- Confidentiality model — IMPORTANT
-- --------------------------------------------------------------------------
-- The whole BOA stack talks to Supabase with a single public "anon" key, and
-- that key is embedded in the kiosk app a store manager uses. So we CANNOT
-- protect these reports with ordinary row-level policies — anyone holding the
-- anon key (incl. a manager) could otherwise read the table.
--
-- Instead we copy the kiosk_device_lock.sql pattern: RLS is ON with NO anon
-- policies, so the table is unreadable/unwritable through the normal REST API.
-- All access goes through SECURITY DEFINER functions:
--   • submit_incident_report(...)  — PUBLIC. Inserts one report, returns a ref
--     code. Cannot read anything back. This is what /report.html calls.
--   • list/update RPCs             — require an HR access key checked against a
--     private app_secrets row. The HR portal holds that key (window.
--     BOA_INCIDENT_HR_KEY in its index.html); the kiosk does NOT. So a manager
--     with the kiosk's anon key still cannot read or alter reports.
--
-- ⚠️  After running this, change the seeded key below to your own secret and
--     put the SAME value in the HR portal's index.html (BOA_INCIDENT_HR_KEY).
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid / md5(random())

-- ---- Tables ----------------------------------------------------------------
create table if not exists incident_reports (
  id               uuid primary key default gen_random_uuid(),
  ref_code         text unique not null,        -- e.g. INC-260602-A1B2 (shown to reporter)
  created_at       timestamptz not null default now(),
  store            text,                         -- which salon
  category         text not null default 'Other',-- Safety / Harassment / Management / Theft / Hygiene / Other
  incident_date    date,                         -- when it happened
  people_involved  text,                         -- who was involved
  description      text not null,                -- what happened
  witnesses        text,                         -- optional — anyone who saw it
  urgent           boolean not null default false,
  about_management boolean not null default false,
  reporter_name    text,                         -- NULL = anonymous (the default)
  reporter_contact text,                         -- NULL unless they opted in to follow-up
  photo_b64        text,                         -- optional, client-downscaled JPEG data URL
  status           text not null default 'new',  -- new | reviewing | resolved
  reviewed         boolean not null default false,-- HR has seen it (clears the pop-up)
  internal_notes   jsonb not null default '[]'::jsonb,  -- [{at,by,note}] — HR-only
  updated_at       timestamptz
);

create index if not exists incident_reports_created_idx on incident_reports (created_at desc);

-- Tiny private secret store. RLS ON / no policies → unreadable via anon REST.
-- Only the SECURITY DEFINER functions below can read it.
create table if not exists app_secrets (
  name   text primary key,
  secret text not null
);

-- RLS ON with NO policies → neither table is reachable through the anon REST
-- API. The functions below are the only access path.
alter table incident_reports enable row level security;
alter table app_secrets      enable row level security;

-- Seed the HR access key. CHANGE THIS, then mirror it in the portal's
-- index.html (window.BOA_INCIDENT_HR_KEY). Re-running won't overwrite it.
insert into app_secrets (name, secret)
values ('incident_hr_key', 'CHANGE-ME-boa-hr-incident-key')
on conflict (name) do nothing;

-- ---- Key check (internal) --------------------------------------------------
create or replace function _check_incident_key(p_key text)
returns void
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  select secret into s from app_secrets where name = 'incident_hr_key';
  if s is null or p_key is null or p_key <> s then
    raise exception 'unauthorized';
  end if;
end $$;

-- ---- PUBLIC: submit a report (no key; insert-only, cannot read) ------------
create or replace function submit_incident_report(
  p_store            text,
  p_category         text,
  p_incident_date    date,
  p_people_involved  text,
  p_description      text,
  p_witnesses        text,
  p_urgent           boolean,
  p_about_management boolean,
  p_reporter_name    text,
  p_reporter_contact text,
  p_photo_b64        text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_ref text;
begin
  -- Required fields (the form enforces these too; this is the backstop).
  if coalesce(btrim(p_description), '') = '' then raise exception 'description required'; end if;
  if coalesce(btrim(p_people_involved), '') = '' then raise exception 'people involved required'; end if;
  if coalesce(btrim(p_store), '') = '' then raise exception 'store required'; end if;
  if p_incident_date is null then raise exception 'incident date required'; end if;
  -- Reject oversized photos (~2.7MB base64 ≈ 2MB binary). The form downscales
  -- before upload; this is just a backstop.
  if p_photo_b64 is not null and length(p_photo_b64) > 2800000 then
    raise exception 'photo too large';
  end if;

  v_ref := 'INC-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMMDD')
           || '-' || upper(substr(md5(random()::text), 1, 4));

  insert into incident_reports (
    ref_code, store, category, incident_date, people_involved, description, witnesses,
    urgent, about_management, reporter_name, reporter_contact, photo_b64
  ) values (
    v_ref,
    btrim(p_store),
    coalesce(nullif(btrim(p_category), ''), 'Other'),
    p_incident_date,
    btrim(p_people_involved),
    btrim(p_description),
    nullif(btrim(p_witnesses), ''),
    coalesce(p_urgent, false),
    coalesce(p_about_management, false),
    nullif(btrim(p_reporter_name), ''),
    nullif(btrim(p_reporter_contact), ''),
    nullif(p_photo_b64, '')
  );
  return v_ref;
end $$;

-- ---- PORTAL: read all reports (HR key required) ----------------------------
create or replace function list_incident_reports(p_key text)
returns setof incident_reports
language plpgsql security definer set search_path = public as $$
begin
  perform _check_incident_key(p_key);
  return query select * from incident_reports order by created_at desc;
end $$;

-- ---- PORTAL: change status (also marks reviewed) ---------------------------
create or replace function set_incident_status(p_key text, p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_incident_key(p_key);
  if p_status not in ('new', 'reviewing', 'resolved') then
    raise exception 'bad status';
  end if;
  update incident_reports
     set status = p_status, reviewed = true, updated_at = now()
   where id = p_id;
end $$;

-- ---- PORTAL: mark a report as seen (clears the pop-up) ----------------------
create or replace function mark_incident_reviewed(p_key text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_incident_key(p_key);
  update incident_reports set reviewed = true, updated_at = now() where id = p_id;
end $$;

-- ---- PORTAL: append an internal (HR-only) note -----------------------------
create or replace function add_incident_note(p_key text, p_id uuid, p_note text, p_author text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_incident_key(p_key);
  if coalesce(btrim(p_note), '') = '' then return; end if;
  update incident_reports
     set internal_notes = internal_notes || jsonb_build_object(
           'at', now(), 'by', coalesce(p_author, ''), 'note', btrim(p_note)),
         updated_at = now()
   where id = p_id;
end $$;

-- ---- Grants ----------------------------------------------------------------
-- The reporting form (public) only needs submit. The portal uses the rest with
-- the HR key. _check_incident_key stays internal.
revoke execute on function _check_incident_key(text) from public;
grant execute on function submit_incident_report(text,text,date,text,text,text,boolean,boolean,text,text,text) to anon;
grant execute on function list_incident_reports(text)              to anon;
grant execute on function set_incident_status(text,uuid,text)      to anon;
grant execute on function mark_incident_reviewed(text,uuid)        to anon;
grant execute on function add_incident_note(text,uuid,text,text)   to anon;
