-- ============================================================================
-- Public, read-only list of who called in SICK or ABSENT for TODAY via My BOA.
-- Used by the in-store kiosk (which holds only the anon key) to show who won't
-- be in today. Run once in the Supabase SQL editor (idempotent).
--
-- Returns names only — NO reason, contact or proof — so the kiosk can display
-- "who's out" without exposing the confidential request details (those stay in
-- the HR portal behind the HR key). "Today" is evaluated in SAST.
-- Depends on sql/leave_requests.sql (the leave_requests table).
-- ============================================================================

create or replace function list_called_in_today()
returns table(name text, store text, ec text, leave_type text, start_date date, end_date date)
language sql security definer set search_path = public as $$
  select name, store, ec, leave_type, start_date, end_date
  from leave_requests
  where leave_type in ('Sick', 'Absent')
    and start_date <= ((now() at time zone 'Africa/Johannesburg')::date)
    and end_date   >= ((now() at time zone 'Africa/Johannesburg')::date);
$$;

grant execute on function list_called_in_today() to anon;
