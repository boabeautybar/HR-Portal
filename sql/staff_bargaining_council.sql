-- ============================================================================
-- Bargaining council flag on `staff` — run once in the Supabase SQL editor
-- (idempotent; safe to re-run).
--
-- Staff who are signed up with the bargaining council have a sick-pay fund, so
-- the company does NOT pay their sick days — not even when a doctor's note is
-- brought (the fund covers it). This boolean marks an employee (nail tech or
-- manager) as a council member so:
--   • the staff-edit / manager-edit modal can tick them,
--   • the Payroll → Bargaining Council tab can match them off the council
--     statement and tick them in bulk,
--   • a council member's "Sick + note" day is treated as UNPAID on the
--     attendance/payroll totals (instead of paid sick leave).
--
-- The staff-edit modal writes `bargaining_council`. The portal already strips
-- unknown columns and retries the save, so a deployment whose `staff` table
-- predates this column still saves everything else — but the bargaining-council
-- flag won't persist until this runs.
-- ============================================================================

alter table staff
  add column if not exists bargaining_council boolean not null default false;

-- Tell PostgREST to pick up the new column immediately (otherwise the API's
-- schema cache can lag behind the DDL until its next reload).
notify pgrst, 'reload schema';
