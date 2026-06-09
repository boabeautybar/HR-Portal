-- ============================================================================
-- Mirror each kiosk CLOCK-IN into the HR-portal attendance grid.
--
-- An AFTER INSERT trigger on public.clockins copies every check-in ("in")
-- into the attendance row app_state."boa_att_<branch>_<ym>" as an "On Time"
-- cell, deep-merging the grid so it never clobbers another staff member's day.
--
-- CYCLE KEYING (the important bit):
--   The attendance grid is keyed by the START-month of the 25th -> 24th
--   payroll cycle (same convention as the HR portal's currentAttYm() /
--   attGridYmFor()):
--       * days 25..31 belong to the cycle that STARTED this calendar month
--       * days 1..24  belong to the cycle that started the PREVIOUS month
--   The day-of-month is the cell key within that cycle.
--
--   The OLD version keyed by the plain calendar month (to_char(.., 'YYYY-MM'))
--   for every day. That filed e.g. a 9 June check-in under the 25 Jun -> 24 Jul
--   grid at day-of-month 9, which the portal then rendered as a phantom
--   "On Time" on 9 July (same day-of-month, one cycle forward). Fixed below by
--   subtracting a month for days 1..24.
--
-- Run once in the Supabase SQL editor (idempotent — CREATE OR REPLACE).
-- The trigger itself already exists; replacing the function is enough.
-- ============================================================================

create or replace function public.sync_clockin_to_attendance()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ec       text;
  v_local    timestamp;
  v_ym       text;
  v_day_key  text;
  v_branch   text;
  v_key      text;
  v_status   text := 'on';
begin
  -- Only react to check-ins, not check-outs.
  if NEW.type <> 'in' then
    return NEW;
  end if;

  -- Look up the employee code; if the staff member has none we
  -- silently skip (no way to map them to the HR portal's `ec`).
  select employee_code into v_ec
  from public.staff
  where id = NEW.staff_id;

  if v_ec is null or length(trim(v_ec)) = 0 then
    return NEW;
  end if;

  -- Compute the local date (Cape Town time) so a check-in late at
  -- night doesn't roll into the next UTC day.
  v_local   := (NEW.ts at time zone 'Africa/Johannesburg')::timestamp;

  -- Key the cell under the cycle's START-month, not the calendar month:
  -- days 25..31 stay in this month; days 1..24 belong to the cycle that
  -- started in the PREVIOUS month. (Old code used the calendar month for all
  -- days, which pushed days 1..24 one cycle forward -> phantom "On Time".)
  if extract(day from v_local) >= 25 then
    v_ym := to_char(v_local, 'YYYY-MM');
  else
    v_ym := to_char(v_local - interval '1 month', 'YYYY-MM');
  end if;

  v_day_key := extract(day from v_local)::text;
  v_branch  := NEW.branch;
  v_key     := 'boa_att_' || v_branch || '_' || v_ym;

  -- Upsert the row, deeply merging the grid so we never overwrite
  -- another staff member's entries on the same day.
  insert into public.app_state (key, value)
  values (
    v_key,
    jsonb_build_object(
      'grid',    jsonb_build_object(v_ec, jsonb_build_object(v_day_key, v_status)),
      'branch',  v_branch,
      'ym',      v_ym,
      'savedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  on conflict (key) do update
  set value = jsonb_set(
                jsonb_set(
                  app_state.value,
                  '{grid}',
                  jsonb_set(
                    coalesce(app_state.value -> 'grid', '{}'::jsonb),
                    array[v_ec],
                    jsonb_set(
                      coalesce(app_state.value -> 'grid' -> v_ec, '{}'::jsonb),
                      array[v_day_key],
                      to_jsonb(v_status),
                      true
                    ),
                    true
                  ),
                  true
                ),
                '{savedAt}',
                to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
                true
              ),
      updated_at = now();

  return NEW;
end;
$function$;
