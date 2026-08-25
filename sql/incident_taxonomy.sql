-- Incident taxonomy: split every report into an HR or an H&S inbox, and record
-- an optional subcategory for sharper reporting.
--
-- Additive and idempotent — safe to re-run. Nothing existing is rewritten:
-- historical rows keep domain NULL and are routed at READ time by
-- incident-taxonomy.js domainOf(), which decides the two genuinely ambiguous
-- legacy categories (Stock, Other) from the wording. Backfilling those into the
-- column would freeze a guess as though a human had made it, so we don't.
--
-- ORDER OF DEPLOY: run this BEFORE publishing the new My BOA report form. The
-- form sends p_domain / p_subcategory, and the old 12-argument function would
-- reject the call.
--
-- Run in the Supabase SQL editor.

-- ---- Columns ---------------------------------------------------------------
alter table incident_reports add column if not exists domain      text;
alter table incident_reports add column if not exists subcategory text;

comment on column incident_reports.domain is
  'hr | hs — which inbox this report belongs to. NULL on rows filed before the
   split; those are routed at read time from the category (and, for Stock/Other,
   the wording) by incident-taxonomy.js.';
comment on column incident_reports.subcategory is
  'Optional free-form-but-picked-from-a-list refinement of category. Never
   required: an urgent report must never be blocked by the taxonomy.';

-- Only ever the two known values (or NULL for legacy). Added NOT VALID so the
-- constraint applies to new writes without forcing a full-table check on a
-- large existing table; validate separately once you are happy.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'incident_reports_domain_chk'
  ) then
    alter table incident_reports
      add constraint incident_reports_domain_chk
      check (domain is null or domain in ('hr','hs')) not valid;
  end if;
end $$;

alter table incident_reports validate constraint incident_reports_domain_chk;

create index if not exists incident_reports_domain_idx
  on incident_reports (domain, created_at desc);

-- ---- Submit RPC ------------------------------------------------------------
-- The new arguments carry defaults so a stale cached copy of the form (a phone
-- with the old page still open) keeps working instead of erroring — it simply
-- files without a domain and gets routed at read time like any legacy row.
-- The old 12-argument overload is dropped so PostgREST cannot pick the wrong
-- one; recreating it below with defaults covers both call shapes.
drop function if exists submit_incident_report(
  text, text, date, text, text, text, text, boolean, boolean, text, text, text);

create or replace function submit_incident_report(
  p_store            text,
  p_category         text,
  p_incident_date    date,
  p_time_frame       text,
  p_people_involved  text,
  p_description      text,
  p_witnesses        text,
  p_urgent           boolean,
  p_about_management boolean,
  p_reporter_name    text,
  p_reporter_contact text,
  p_photo_b64        text,
  p_domain           text default null,
  p_subcategory      text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare v_ref text;
begin
  if coalesce(btrim(p_description), '') = '' then raise exception 'description required'; end if;
  if coalesce(btrim(p_people_involved), '') = '' then raise exception 'people involved required'; end if;
  if coalesce(btrim(p_store), '') = '' then raise exception 'store required'; end if;
  if p_incident_date is null then raise exception 'incident date required'; end if;
  if p_photo_b64 is not null and length(p_photo_b64) > 2800000 then
    raise exception 'photo too large';
  end if;
  -- An unrecognised domain is stored as NULL rather than rejected: never lose a
  -- real report over a classification field.
  if p_domain is not null and p_domain not in ('hr','hs') then
    p_domain := null;
  end if;

  v_ref := 'INC-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMMDD')
           || '-' || upper(substr(md5(random()::text), 1, 4));

  insert into incident_reports (
    ref_code, store, category, domain, subcategory, incident_date, time_frame,
    people_involved, description, witnesses, urgent, about_management,
    reporter_name, reporter_contact, photo_b64
  ) values (
    v_ref, p_store, coalesce(nullif(btrim(p_category), ''), 'Other'),
    p_domain, nullif(btrim(p_subcategory), ''),
    p_incident_date, p_time_frame, p_people_involved, p_description, p_witnesses,
    coalesce(p_urgent, false), coalesce(p_about_management, false),
    p_reporter_name, p_reporter_contact, p_photo_b64
  );

  return v_ref;
end $$;

-- Same grant the original carried (sql/incident_reports.sql:220). DROP resets
-- grants, so this has to be restated or the staff form loses access.
grant execute on function submit_incident_report(
  text,text,date,text,text,text,text,boolean,boolean,text,text,text,text,text) to anon;
