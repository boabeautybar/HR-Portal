-- ============================================================================
-- Incident reports — tag the employees an incident is about
-- Run once in the Supabase SQL editor (idempotent; safe to re-run).
-- Requires sql/incident_reports.sql to have been run first.
--
-- Why
-- --------------------------------------------------------------------------
-- An incident report captures who was involved only as free text
-- (people_involved), which is fine for a reporter filling in a form but
-- useless for joining. The SM trial review needs the opposite: "show me every
-- report filed against THIS employee_code during THIS trial window", so HR can
-- weigh IRs when deciding whether an AM passes their Store Manager trial.
--
-- Name matching against free text is not good enough for a decision that
-- affects someone's promotion, so HR tags reports explicitly. tagged_ecs is a
-- jsonb array of employee codes (the identity key used everywhere else in the
-- stack) — deliberately nullable, because untagged is a real state meaning
-- "nobody has triaged this yet", not "nobody is involved".
--
-- Confidentiality model is unchanged: RLS stays ON with no anon policies, and
-- tagging goes through a SECURITY DEFINER RPC gated on the same HR key as the
-- rest of the portal-side incident functions (window.BOA_INCIDENT_HR_KEY).
-- list_incident_reports does `select *`, so the new column flows through to
-- the portal with no change to that function.
-- ============================================================================

-- ---- Column ----------------------------------------------------------------
alter table incident_reports
  add column if not exists tagged_ecs jsonb;

comment on column incident_reports.tagged_ecs is
  'jsonb array of employee_code strings this report is about. NULL = not yet triaged. Set via set_incident_tags().';

-- Reports are looked up by tag when reviewing one employee's trial. GIN keeps
-- that a containment check rather than a full scan as the table grows.
create index if not exists incident_reports_tagged_ecs_idx
  on incident_reports using gin (tagged_ecs);

-- ---- PORTAL: set/replace the tagged employees (HR key required) ------------
-- p_ecs is the FULL replacement list (or null / [] to clear). Every change is
-- appended to internal_notes so the audit trail shows who attributed a report
-- to whom — this matters because a tag can influence a promotion decision.
create or replace function set_incident_tags(
  p_key text, p_id uuid, p_ecs jsonb, p_actor text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clean jsonb;
  v_old   jsonb;
  v_note  text;
begin
  perform _check_incident_key(p_key);

  if p_ecs is null or jsonb_typeof(p_ecs) = 'null' then
    v_clean := null;
  elsif jsonb_typeof(p_ecs) <> 'array' then
    raise exception 'tagged_ecs must be a json array of employee codes';
  else
    -- Drop blanks/dupes and reject any non-string element.
    if exists (select 1 from jsonb_array_elements(p_ecs) e where jsonb_typeof(e) <> 'string') then
      raise exception 'tagged_ecs must contain only employee code strings';
    end if;
    select case when count(*) = 0 then null else jsonb_agg(distinct ec) end
      into v_clean
      from (select btrim(e #>> '{}') as ec from jsonb_array_elements(p_ecs) e) s
     where ec <> '';
  end if;

  select tagged_ecs into v_old from incident_reports where id = p_id;
  if not found then
    raise exception 'incident report not found';
  end if;

  -- No-op writes should not pollute the audit trail.
  if coalesce(v_old, 'null'::jsonb) is not distinct from coalesce(v_clean, 'null'::jsonb) then
    return;
  end if;

  v_note := case
    when v_clean is null then 'Cleared employee tags'
    else 'Tagged employees: ' || (
      select string_agg(e #>> '{}', ', ' order by e #>> '{}') from jsonb_array_elements(v_clean) e
    )
  end;

  update incident_reports
     set tagged_ecs = v_clean,
         internal_notes = internal_notes || jsonb_build_object(
           'at', now(), 'by', coalesce(p_actor, ''), 'note', v_note),
         updated_at = now()
   where id = p_id;
end $$;

-- ---- Grants ----------------------------------------------------------------
-- Portal-only, same as the other management RPCs: reachable by anon but
-- useless without the HR key.
grant execute on function set_incident_tags(text, uuid, jsonb, text) to anon;
