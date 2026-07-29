-- ============================================================================
-- Cleanup: manager AUTO-OUT (out_auto) records stamped with the WRONG branch.
-- Background + root cause: docs/manager-autoout-cross-branch-investigation.md
--
-- A stray = an `out_auto` whose branch does NOT match the branch of that
-- manager's clock-IN the same day (the store they actually worked). These were
-- written by OTHER stores' kiosks running the old global sweep, at the device's
-- own branch and (usually) the legacy 18:30 fallback time.
--
-- ⚠ ORDER MATTERS — DEPLOY THE CODE FIX FIRST.
--   The kiosk fix (own-branch scope + branchOverride) must be live before you
--   run the DELETE. Otherwise the OLD kiosk code re-creates the same strays on
--   the next sweep and you're back where you started.
--
-- ⚠ Run STEP 1 (preview) and read it before STEP 2/3 (delete). Deletes are not
--   reversible. Cleaner keys "same day" on Africa/Johannesburg local time and is
--   scoped to the last 35 days to bound blast radius (widen if needed).
-- ============================================================================

-- ── shared CTEs (identical in preview + delete) ─────────────────────────────
-- rows      : recent clock rows tagged with their SA-local day
-- in_branch : the branch of each (staff, day)'s single clock-IN
-- outs      : how many out/out_auto rows exist per (staff, day)
-- strays    : out_auto rows whose branch != that day's clock-in branch

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1 — PREVIEW. Review this before deleting anything.
--   stray_branch      = the wrong branch that will be removed
--   worked_branch     = where they actually clocked in (kept)
--   outs_left_after   = out/out_auto rows remaining for that manager-day AFTER
--                       the delete. If 0, that manager will show "still clocked
--                       in" until their OWN store's kiosk next sweeps and
--                       re-creates a correct out (at the right branch + end).
-- ════════════════════════════════════════════════════════════════════════════
with rows as (
  select c.id, c.staff_id, c.branch, c.type, c.ts,
         to_char(c.ts at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') as ymd
  from clockins c
  where c.ts >= now() - interval '35 days'
),
in_branch as (
  select staff_id, ymd, max(branch) as in_branch
  from rows where type = 'in' group by staff_id, ymd
),
outs as (
  select staff_id, ymd, count(*) filter (where type in ('out','out_auto')) as n_out
  from rows group by staff_id, ymd
),
strays as (
  select r.id, r.staff_id, r.ymd, r.branch as out_branch, ib.in_branch, r.ts
  from rows r
  join in_branch ib on ib.staff_id = r.staff_id and ib.ymd = r.ymd
  where r.type = 'out_auto'
    and coalesce(trim(r.branch), '') <> coalesce(trim(ib.in_branch), '')
)
select st.employee_code                                                    as ec,
       st.name,
       s.ymd,
       s.out_branch                                                        as stray_branch,
       s.in_branch                                                         as worked_branch,
       to_char(s.ts at time zone 'Africa/Johannesburg', 'HH24:MI')         as stray_time,
       o.n_out - (select count(*) from strays s2
                  where s2.staff_id = s.staff_id and s2.ymd = s.ymd)        as outs_left_after,
       s.id                                                                as clockin_id
from strays s
join staff st on st.id = s.staff_id
join outs  o  on o.staff_id = s.staff_id and o.ymd = s.ymd
order by s.ymd desc, st.name;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2 — delete the sidecar meta for the strays (photos/flags), FK-safe first.
--   Only run after STEP 1 looks right.
-- ════════════════════════════════════════════════════════════════════════════
-- with rows as (
--   select c.id, c.staff_id, c.branch, c.type, c.ts,
--          to_char(c.ts at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') as ymd
--   from clockins c where c.ts >= now() - interval '35 days'
-- ),
-- in_branch as (
--   select staff_id, ymd, max(branch) as in_branch
--   from rows where type = 'in' group by staff_id, ymd
-- ),
-- strays as (
--   select r.id from rows r
--   join in_branch ib on ib.staff_id = r.staff_id and ib.ymd = r.ymd
--   where r.type = 'out_auto'
--     and coalesce(trim(r.branch), '') <> coalesce(trim(ib.in_branch), '')
-- )
-- delete from clockin_meta where clockin_id in (select id from strays);

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3 — delete the stray clock rows themselves.
-- ════════════════════════════════════════════════════════════════════════════
-- with rows as (
--   select c.id, c.staff_id, c.branch, c.type, c.ts,
--          to_char(c.ts at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') as ymd
--   from clockins c where c.ts >= now() - interval '35 days'
-- ),
-- in_branch as (
--   select staff_id, ymd, max(branch) as in_branch
--   from rows where type = 'in' group by staff_id, ymd
-- ),
-- strays as (
--   select r.id from rows r
--   join in_branch ib on ib.staff_id = r.staff_id and ib.ymd = r.ymd
--   where r.type = 'out_auto'
--     and coalesce(trim(r.branch), '') <> coalesce(trim(ib.in_branch), '')
-- )
-- delete from clockins where id in (select id from strays);
