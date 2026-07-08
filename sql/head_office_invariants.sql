-- ============================================================================
-- Head Office data invariants — run in the Supabase SQL editor AFTER the
-- Phase 1b HO staff seed, and any time HO rows are added/edited.
--
-- These are READ-ONLY audit SELECTs. Invariants 1–3 must each return ZERO rows.
-- Invariant 2 ships a remediation UPDATE (commented out) to run ONLY if it
-- returns rows. Query 4 is informational (eyeball the HO roster + departments).
--
-- WHY these matter (the whole feature keys on them):
--   • The portal splits staff into salon `enriched`/`managers` vs `hoStaff` by
--     BRANCH. A Head Office row misclassified as role_type 'manager' leaks into
--     Manager Coverage / manager schedules / Check-ins — the exact pollution
--     this feature exists to prevent. myboa reads role_type raw, so the DB is
--     the last line of defence (client transforms only fix rows on re-save).
--   • The kiosk finds HO staff with an EXACT `.eq("branch", "Head Office")`
--     query. A drifted branch string ("head office", trailing space) is carved
--     into hoStaff by the portal's tolerant matcher but is INVISIBLE to the
--     kiosk roster, the HO schedule grid, and the leave planner — the person
--     exists nowhere usable. The DB value must be the canonical "Head Office".
-- ============================================================================

-- ── INVARIANT 1: no Head Office row misclassified (MUST return ZERO) ─────────
-- Any staff row whose branch is Head Office (tolerant) but whose role_type is
-- not 'head_office'. role_type 'manager' is the dangerous case (Coverage /
-- mgr-schedule pollution); any non-head_office value is wrong.
select id, name, employee_code, branch, role_type, role
from staff
where lower(btrim(coalesce(branch, ''))) = 'head office'
  and coalesce(role_type, '') <> 'head_office'
order by role_type, employee_code;

-- ── INVARIANT 2: no drifted Head Office branch string (MUST return ZERO) ─────
-- Rows that normalise to "head office" but aren't stored as the exact canonical
-- "Head Office". These are invisible to the kiosk / HO scheduler / leave planner
-- (all of which compare the branch strictly).
select id, name, employee_code, branch, role_type
from staff
where lower(btrim(coalesce(branch, ''))) = 'head office'
  and branch <> 'Head Office'
order by employee_code;

-- Remediation for INVARIANT 2 — run ONLY if the query above returned rows.
-- Canonicalises every drifted variant to the exact string the app keys on.
-- (Uncomment, run, then re-run INVARIANT 2 to confirm it returns zero.)
-- update staff
--   set branch = 'Head Office'
--   where lower(btrim(coalesce(branch, ''))) = 'head office'
--     and branch <> 'Head Office';
-- notify pgrst, 'reload schema';

-- ── INVARIANT 3: no stray head_office role_type outside Head Office (ZERO) ───
-- The inverse leak: a row tagged role_type 'head_office' whose branch is NOT
-- Head Office would vanish from its salon population yet never appear on any HO
-- surface (HO surfaces filter by branch, not role_type).
select id, name, employee_code, branch, role_type
from staff
where coalesce(role_type, '') = 'head_office'
  and lower(btrim(coalesce(branch, ''))) <> 'head office'
order by branch, employee_code;

-- ── 4 (INFO): the Head Office roster + department coverage ───────────────────
-- Eyeball the seeded HO people and their `role` (department: CC / SALES / ADMIN
-- / MKT / OH …). Every department that appears here needs a routing target in
-- boa_ho_routing_v1 (CC → Feroza, everything else → Justin). A NULL/blank role
-- means the person has no department and won't route.
select
  coalesce(nullif(btrim(role), ''), '(no department)') as department,
  count(*)                                              as people,
  array_agg(name order by name)                         as names
from staff
where lower(btrim(coalesce(branch, ''))) = 'head office'
group by coalesce(nullif(btrim(role), ''), '(no department)')
order by department;

-- NOTE: cross-population employee_code uniqueness (an HO code colliding with a
-- salon manager, which flips isManagerEc portal-wide) is covered by the
-- separate sql/staff_employee_code_unique.sql — run that too.
