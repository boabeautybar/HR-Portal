-- ============================================================================
-- Unique employee_code on `staff` — run once in the Supabase SQL editor.
--
-- The whole employee model keys on the employee code (EC): the portal derives
-- role_type from the EC suffix, dedupes onboarding against it, generates the
-- next EC from the max of every existing one, and the Head Office classification
-- tracks HO people by EC in HEAD_OFFICE_ECS. All of that silently breaks if two
-- rows share a code. The app compares codes case-insensitively (upper + trim),
-- so the constraint must too.
--
-- ⚠ NOT idempotent-safe to blind-run: if duplicates already exist the CREATE
-- will fail. Run the PRE-FLIGHT block first and resolve any rows it returns
-- (merge/retire the duplicate) BEFORE creating the index.
-- ============================================================================

-- ── PRE-FLIGHT: must return ZERO rows before creating the index ─────────────
-- Lists any employee codes that collide once normalised the way the app does.
select
  upper(btrim(employee_code)) as normalised_code,
  count(*)                    as n,
  array_agg(id order by id)   as row_ids,
  array_agg(name order by id) as names
from staff
where employee_code is not null
  and btrim(employee_code) <> ''
group by upper(btrim(employee_code))
having count(*) > 1;

-- ── CREATE (run only after the pre-flight returns nothing) ──────────────────
-- Partial + expression index: enforces uniqueness on the normalised code and
-- ignores rows with no code (NULL/blank), which are legitimately un-keyed.
create unique index if not exists staff_employee_code_norm_uidx
  on staff (upper(btrim(employee_code)))
  where employee_code is not null and btrim(employee_code) <> '';

-- Tell PostgREST to refresh its schema cache.
notify pgrst, 'reload schema';
