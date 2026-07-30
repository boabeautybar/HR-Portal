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
--   The kiosk fix (own-branch scope + branchOverride, commit 335cf9a) must be
--   live — and open kiosks reloaded — before you run the DELETE. Otherwise the
--   OLD kiosk code re-creates the same strays on the next sweep.
--
-- ⚠ Run STEP 1 (preview) and read it before STEP 2/3 (delete). Deletes are not
--   reversible.
--
-- ── SCOPE: current pay cycle only (ymd >= 2026-07-25) ────────────────────────
-- All three steps are scoped to the OPEN cycle (opened 25 Jul 2026). This is
-- deliberate and excludes two things you must NOT sweep blindly:
--   1. PREVIOUS cycle (20–24 Jul, i.e. 25 Jun→24 Jul): under active payroll
--      correction (the 17 wrong-deduction reversals). Deleting a clock-out there
--      can shift the "latest out" the deduction reads and change already-computed
--      hours. Leave it until that reconciliation is closed.
--   2. B782M (Robin Lee Pharo) 22 Jul: a separate anomaly — ~80 out_auto rows at
--      06:00 across every branch (NOT the 18:30 cross-branch bug), still under
--      investigation. The date scope skips it (22 Jul < 25 Jul).
-- To clean a different/older window later, change _CYCLE_START below in each step
-- (and only after confirming that cycle's payroll is settled).
--
-- Note: rows with outs_left_after = 0 have ONLY stray outs — deleting them leaves
-- that manager with no clock-out for the day (0 payroll impact; managers fall back
-- to 0). 28 Jul self-heals on the next own-branch sweep after deploy; 25–27 Jul
-- leaves an honest "forgot to clock out" gap.
--
-- Cleaner keys "same day" on Africa/Johannesburg local time and reads the last
-- 35 days, then the ymd scope narrows to the current cycle.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1 — PREVIEW (scoped to the current cycle). Review before deleting.
--   stray_branch    = the wrong branch that will be removed
--   worked_branch   = where they actually clocked in (kept)
--   outs_left_after = out/out_auto rows remaining for that manager-day AFTER the
--                     delete (0 = manager will show "still clocked in" until the
--                     next own-branch sweep re-creates one, for the last ~2 days).
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
    and r.ymd >= '2026-07-25'          -- _CYCLE_START: current cycle only (skips prev cycle + B782M 22-Jul anomaly)
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
--   Only run after STEP 1 looks right. Same scope as STEP 1.
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
--     and r.ymd >= '2026-07-25'          -- _CYCLE_START: keep identical to STEP 1
-- )
-- delete from clockin_meta where clockin_id in (select id from strays);

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3 — delete the stray clock rows themselves. Same scope as STEP 1/2.
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
--     and r.ymd >= '2026-07-25'          -- _CYCLE_START: keep identical to STEP 1
-- )
-- delete from clockins where id in (select id from strays);
