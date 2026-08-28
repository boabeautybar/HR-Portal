-- Terminations & Resignations tracker: tell the two apart.
--
-- The tracker started life as a terminations sheet, so every row in it is an
-- involuntary termination. It now also holds resignations, and the difference
-- is not cosmetic — it changes notice pay, the UIF reason code and whether a
-- final payout carries a dismissal. So it gets its own column rather than
-- being inferred from the reason text.
--
-- Additive and idempotent. The RPC signature does not change (the record has
-- always travelled as jsonb), so nothing needs redeploying alongside it.
--
-- Run in the Supabase SQL editor.

alter table hr_tracker_records add column if not exists separation_type text;

-- Nullable on purpose: disciplinary rows have no separation type at all, and
-- a NOT NULL here would reject them.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hr_tracker_separation_type_chk') then
    alter table hr_tracker_records
      add constraint hr_tracker_separation_type_chk
      check (separation_type is null or separation_type in ('termination','resignation'));
  end if;
end $$;

create index if not exists hr_tracker_sep_idx
  on hr_tracker_records (kind, separation_type);

-- Backfill. Every row already in the tracker predates the resignation option
-- and is an involuntary termination, confirmed by HR. Only fills blanks, so a
-- resignation captured before this migration runs is left as it is.
update hr_tracker_records
   set separation_type = 'termination'
 where kind = 'termination'
   and separation_type is null;

-- ---- Upsert, now carrying separation_type ----------------------------------
-- Same signature as before, so the grant already in place still applies.
-- nullif on the way in: a blank from a disciplinary form must land as NULL,
-- not as an empty string the check constraint would reject.
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
      separation_type,
      event_date, event_date_raw, month_band, investigation_start, investigation_end,
      investigation_raw, reason, findings, action_taken, bonus, justin_to_action,
      exit_interview, filed_by, final_comments, notes, source, created_by
    ) values (
      p_rec->>'kind', p_rec->>'employee_code', p_rec->>'employee_name',
      p_rec->>'role_title', p_rec->>'location', p_rec->>'manager',
      nullif(p_rec->>'separation_type',''),
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
    -- so it is reset and payroll is asked again. Flipping termination to
    -- resignation counts: it changes what the final payout owes.
    update hr_tracker_records set
      employee_code = p_rec->>'employee_code', employee_name = p_rec->>'employee_name',
      role_title = p_rec->>'role_title', location = p_rec->>'location', manager = p_rec->>'manager',
      separation_type = nullif(p_rec->>'separation_type',''),
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
              or bonus is distinct from p_rec->>'bonus'
              or separation_type is distinct from nullif(p_rec->>'separation_type',''))
        then 'pending' else payroll_status end,
      payroll_checked_by = case
        when payroll_status = 'completed'
         and (event_date is distinct from nullif(p_rec->>'event_date','')::date
              or action_taken is distinct from p_rec->>'action_taken'
              or bonus is distinct from p_rec->>'bonus'
              or separation_type is distinct from nullif(p_rec->>'separation_type',''))
        then null else payroll_checked_by end,
      updated_at = now(), updated_by = p_actor
    where id = v_id;
  end if;
  return v_id;
end $$;

grant execute on function upsert_hr_tracker_record(text,jsonb,text) to anon;

-- Check it landed:
--   select separation_type, count(*) from hr_tracker_records
--    where kind = 'termination' group by 1 order by 1;
