-- ============================================================================
-- Relabel-audit DUMP — every manager working-day this cycle at the six split
-- stores, with the CURRENT published label + clock in/out + any custom hours.
-- Export the result grid as CSV and feed it to docs/relabel-audit.js.
-- READ-ONLY. Cycle 25 Jun → 24 Jul 2026  →  manager snapshot ym = 2026-06.
--
-- Change the two dates below to audit a different cycle (ym = the START month).
-- ============================================================================
with split_snaps as (
  select regexp_replace(key, '^boa_mgrschedapproved_(.*)_[0-9]{4}-[0-9]{2}$', '\1') as branch,
         value->0->'grid' as grid                              -- published[0] (live)
  from app_state
  where key like 'boa\_mgrschedapproved\_%\_2026-06' escape '\'
    and regexp_replace(key, '^boa_mgrschedapproved_(.*)_[0-9]{4}-[0-9]{2}$', '\1')
        in ('Sandown','Table Bay','Riverlands','Ballito','Mall of the South','Fourways')
),
cells as (
  select s.branch,
         upper(regexp_replace(gk.key, '[^A-Za-z0-9]', '', 'g')) as ec,
         d.key   as ymd,
         d.value as label
  from split_snaps s,
       lateral jsonb_each(s.grid) as gk(key, value),
       lateral jsonb_each_text(gk.value) as d(key, value)
  where d.value in ('WE','WM','WL','WB')                       -- working split codes only
    and d.key ~ '^\d{4}-\d{2}-\d{2}$'
    and d.key < to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM-DD')  -- elapsed
),
staff_n as (
  select id, name, role, upper(regexp_replace(employee_code, '[^A-Za-z0-9]', '', 'g')) as ec
  from staff
),
customs as (                                                   -- boa_mgr_times_v1 = {ec:{ymd:"HH:MM - HH:MM"}}
  select upper(regexp_replace(ec.key, '[^A-Za-z0-9]', '', 'g')) as ec,
         d.key as ymd, d.value as custom
  from app_state a,
       lateral jsonb_each(a.value) as ec(key, value),
       lateral jsonb_each_text(ec.value) as d(key, value)
  where a.key = 'boa_mgr_times_v1'
),
clock as (
  select sn.ec,
         to_char(c.ts at time zone 'Africa/Johannesburg', 'YYYY-MM-DD') as ymd,
         to_char((min(c.ts) filter (where c.type = 'in'))                 at time zone 'Africa/Johannesburg', 'HH24:MI') as clock_in,
         to_char((max(c.ts) filter (where c.type in ('out','out_auto')))  at time zone 'Africa/Johannesburg', 'HH24:MI') as clock_out
  from clockins c
  join staff_n sn on sn.id = c.staff_id
  group by sn.ec, to_char(c.ts at time zone 'Africa/Johannesburg', 'YYYY-MM-DD')
)
select ce.branch, ce.ec,
       coalesce(sn.name, '')  as name,
       coalesce(sn.role, '')  as role,          -- blank role → verify (hours need SM vs AM)
       ce.ymd, ce.label,
       coalesce(cu.custom, '')    as custom,
       coalesce(ck.clock_in, '')  as clock_in,
       coalesce(ck.clock_out, '') as clock_out
from cells ce
left join staff_n sn on sn.ec  = ce.ec
left join customs  cu on cu.ec = ce.ec and cu.ymd = ce.ymd
left join clock    ck on ck.ec = ce.ec and ck.ymd = ce.ymd
order by ce.branch, ce.ec, ce.ymd;
