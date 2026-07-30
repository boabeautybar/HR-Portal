-- ============================================================================
-- Cleanup: manager AUTO-OUT (out_auto) rows stamped BEFORE the clock-in they
-- were meant to close — the "runaway" signature (B782M, 22 Jul: ~88 rows @ 06:00).
-- Background: docs/manager-autoout-cross-branch-investigation.md (§ B782M).
--
-- Mechanism: a bad resolved shift-end (e.g. a 22-Jul custom time ending 06:00)
-- lands the auto-out BEFORE the morning clock-in. The old sweep's "already
-- closed?" test keyed on the LATEST-by-ts row being an "in", so the in stayed
-- latest and every sweep (on every kiosk) re-created the auto-out. A before-in
-- out_auto is ALWAYS junk — a clock-out can't precede its clock-in — and it also
-- manufactures a phantom ~12h early-leave deduction. Safe to remove; leave the "in".
--
-- ⚠ Code fix ships first (commit adds an existence-based de-dup + a before-in
--   skip to ensureAutoOuts) so this can't recur. Then run the steps below.
-- ⚠ Preview (STEP 0/1) before deleting. Deletes are not reversible.
-- ⚠ This can reach the PREVIOUS pay cycle (22 Jul). That's intended here and was
--   cleared with payroll; the delete removes a phantom deduction (a correction the
--   reconciliation wants). Window is capped to 120 days.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 0 — DETECTION (read-only). Every (manager, day) with an out_auto stamped
--   before that day's FIRST clock-in. Surfaces B782M/22-Jul + any other latent
--   runaway. `bad_autoouts` is how many junk rows that day carries.
-- ════════════════════════════════════════════════════════════════════════════
with rows as (
  select c.id, c.staff_id, c.type, c.ts,
         to_char(c.ts at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') as ymd
  from clockins c
  where c.ts >= now() - interval '120 days'
),
ins as (
  select staff_id, ymd, min(ts) as first_in_ts
  from rows where type = 'in' group by staff_id, ymd
)
select st.employee_code as ec, st.name, r.ymd,
       count(*)                                                              as bad_autoouts,
       to_char(min(r.ts) at time zone 'Africa/Johannesburg','HH24:MI')       as earliest_autoout_sast,
       to_char(i.first_in_ts at time zone 'Africa/Johannesburg','HH24:MI')   as first_in_sast
from rows r
join ins i on i.staff_id = r.staff_id and i.ymd = r.ymd
join staff st on st.id = r.staff_id
where r.type = 'out_auto' and r.ts < i.first_in_ts
group by st.employee_code, st.name, r.ymd, i.first_in_ts
order by bad_autoouts desc, r.ymd desc;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1 — PREVIEW the exact rows STEP 2/3 will delete (before-in out_auto).
-- ════════════════════════════════════════════════════════════════════════════
with rows as (
  select c.id, c.staff_id, c.branch, c.type, c.ts,
         to_char(c.ts at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') as ymd
  from clockins c
  where c.ts >= now() - interval '120 days'
),
ins as (
  select staff_id, ymd, min(ts) as first_in_ts
  from rows where type = 'in' group by staff_id, ymd
)
select st.employee_code as ec, st.name, r.ymd, r.branch as stray_branch,
       to_char(r.ts at time zone 'Africa/Johannesburg','HH24:MI')            as autoout_sast,
       to_char(i.first_in_ts at time zone 'Africa/Johannesburg','HH24:MI')   as first_in_sast,
       r.id as clockin_id
from rows r
join ins i on i.staff_id = r.staff_id and i.ymd = r.ymd
join staff st on st.id = r.staff_id
where r.type = 'out_auto' and r.ts < i.first_in_ts
order by r.ymd desc, st.name, r.ts;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2 — delete sidecar meta (FK-safe first). Run after STEP 0/1 look right.
-- ════════════════════════════════════════════════════════════════════════════
-- with rows as (
--   select c.id, c.staff_id, c.type, c.ts,
--          to_char(c.ts at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') as ymd
--   from clockins c where c.ts >= now() - interval '120 days'
-- ),
-- ins as (
--   select staff_id, ymd, min(ts) as first_in_ts from rows where type='in' group by staff_id, ymd
-- ),
-- junk as (
--   select r.id from rows r
--   join ins i on i.staff_id = r.staff_id and i.ymd = r.ymd
--   where r.type = 'out_auto' and r.ts < i.first_in_ts
-- )
-- delete from clockin_meta where clockin_id in (select id from junk);

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3 — delete the junk out_auto rows (leaves the clock-IN untouched).
-- ════════════════════════════════════════════════════════════════════════════
-- with rows as (
--   select c.id, c.staff_id, c.type, c.ts,
--          to_char(c.ts at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') as ymd
--   from clockins c where c.ts >= now() - interval '120 days'
-- ),
-- ins as (
--   select staff_id, ymd, min(ts) as first_in_ts from rows where type='in' group by staff_id, ymd
-- ),
-- junk as (
--   select r.id from rows r
--   join ins i on i.staff_id = r.staff_id and i.ymd = r.ymd
--   where r.type = 'out_auto' and r.ts < i.first_in_ts
-- )
-- delete from clockins where id in (select id from junk);

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 4 — INSPECT the trigger: B782M's per-day custom shift times. Look for a
--   "2026-07-22" entry whose range ENDS in "06:00" (the bad end). If the key
--   isn't "B782M" (dash/case variant), widen the select.
-- ════════════════════════════════════════════════════════════════════════════
select value -> 'B782M'                         as b782m_all_custom,
       value -> 'B782M' -> '2026-07-22'         as b782m_22jul
from app_state
where key = 'boa_mgr_times_v1';

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 5 — CLEAR the bad 22-Jul custom time (only after STEP 4 confirms it).
--   Hygiene: 22 Jul is now outside the sweep's 2-day window so it can't re-fire,
--   but removing the bad entry prevents any future re-read. Adjust the EC key if
--   STEP 4 showed a different form.
-- ════════════════════════════════════════════════════════════════════════════
-- update app_state
-- set value = value #- '{B782M,2026-07-22}'
-- where key = 'boa_mgr_times_v1'
--   and value #> '{B782M,2026-07-22}' is not null;
