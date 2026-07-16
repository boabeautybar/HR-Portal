-- ============================================================================
-- Trainer store check-in — file Head Office attendance under the HOME branch.
--
-- Supersedes sql/clockin_to_attendance_sync.sql (same function, one guard added).
-- Run this INSTEAD of that file from now on; it is the newer of the two.
--
-- WHY:
--   Trainers (staff.role = 'T', branch = 'Head Office') rotate between stores
--   and clock in on whichever STORE kiosk they're visiting. The kiosk stamps
--   clockins.branch with its OWN store (kiosk/data.js addManagerClockinWithMeta
--   hardcodes `branch: branch()`), which is exactly what the HR portal's
--   Head Office schedule overlay derives the "→ Plum" cell from — so that stamp
--   must stay.
--
--   But this trigger used to key attendance off NEW.branch unconditionally:
--       v_branch := NEW.branch;                  -- old
--   so a trainer clocking in at Plumstead wrote boa_att_Plumstead_<ym> with
--   grid["B013-M"][day] = 'on'. That put a Head Office trainer on Plumstead's
--   Daily Check-ins (data.js listRecentAttendanceCheckins flattens every
--   boa_att_% grid with no roster filter) and left their real
--   boa_att_Head Office_<ym> cell blank — a payroll discrepancy.
--
--   A Head Office person's attendance always belongs to their HOME branch,
--   never the kiosk they happened to visit. Guard added below.
--
-- BLAST RADIUS — provably zero for existing rows:
--   No Head Office person can clock in at a store kiosk today: the kiosk's
--   roster gate isManagerRow() (kiosk/data.js) starts with
--       if (isHeadOfficeBranch(s.branch)) return false;
--   and the HO staff path only runs when cfg.headOffice. So every clock-in that
--   already exists for an HO person carries NEW.branch = 'Head Office', and the
--   CASE below is a literal no-op for them. It only diverges for the NEW
--   trainer-at-a-store rows this feature introduces.
--
-- NOT IN SCOPE: Call Centre & Sales people are also role_type 'head_office', so
--   this keys them to boa_att_Head Office_<ym>. That matches what the trigger
--   already does today (their clock-ins carry branch 'Head Office'); the client
--   keys CC&S attendance to boa_att_Call Centre & Sales_<ym> via personBranch().
--   That mismatch pre-dates this change and is deliberately left alone here.
--
-- CYCLE KEYING (unchanged, repeated for context):
--   The attendance grid is keyed by the START-month of the 25th -> 24th payroll
--   cycle (same convention as the portal's currentAttYm() / attGridYmFor()):
--       * days 25..31 belong to the cycle that STARTED this calendar month
--       * days 1..24  belong to the cycle that started the PREVIOUS month
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
  v_ec           text;
  v_staff_branch text;
  v_role_type    text;
  v_local        timestamp;
  v_ym           text;
  v_day_key      text;
  v_branch       text;
  v_key          text;
  v_status       text := 'on';
begin
  -- Only react to check-ins, not check-outs.
  if NEW.type <> 'in' then
    return NEW;
  end if;

  -- Look up the employee code; if the staff member has none we
  -- silently skip (no way to map them to the HR portal's `ec`).
  -- branch + role_type come along for the home-branch guard below.
  select employee_code, branch, role_type
    into v_ec, v_staff_branch, v_role_type
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

  -- A Head Office person's attendance always belongs to their HOME branch,
  -- never the kiosk they happened to visit. Trainers (role 'T') rotate through
  -- store kiosks; without this their cell would land on the visited store's
  -- grid and pollute its Daily Check-ins. Everyone else files where they
  -- physically clocked in, exactly as before.
  v_branch  := case
                 when coalesce(v_role_type, '') = 'head_office'
                      and v_staff_branch is not null
                      and length(trim(v_staff_branch)) > 0
                   then v_staff_branch
                 else NEW.branch
               end;

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

-- ── Deploy-order interlock ──────────────────────────────────────────────────
-- The kiosk's trainer check-in card (kiosk/data.js listTrainers) only renders
-- when this marker exists. Without it, deploying the kiosk bundle BEFORE this
-- file has been run would let a trainer clock in at a store while the OLD
-- trigger is still live — writing their attendance into the visited store's
-- grid (the exact payroll bug the guard above fixes). Stamping the marker here
-- makes the ordering self-enforcing: no SQL, no trainer card.
insert into public.app_state (key, value)
values (
  'boa_trainer_trigger_v1',
  jsonb_build_object(
    'applied', true,
    'appliedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
)
on conflict (key) do update
set value = excluded.value, updated_at = now();
