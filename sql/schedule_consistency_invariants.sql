-- ============================================================================
-- Schedule-consistency invariants — Phase 3.2 of docs/schedule-consistency-plan.md
--
-- READ-ONLY audit SELECTs for the Supabase SQL editor. Run any time; run before
-- a schedule PR and after a publish. Each query targets ONE of the recurring
-- incident families from the plan's §4 history so a regression is visible before
-- staff see it.
--
--   Q1  override EC-key hygiene   → Case A (custom hours / pins silently dropped)
--   Q2  draft vs published drift  → INFORMATIONAL (the badge's DB twin)
--   Q3  loan_out without a record → ec55083 family (phantom "AWAY → store")
--   Q4  working cell in EL/ML/leave range → G4 (published grid says work)
--   Q5  kiosk "absent/no" in EL/ML/leave  → Case B (Kimberley: ABSENT while on EL)
--
-- Q1/Q3/Q4/Q5 SHOULD return ZERO rows. Q2 is expected to have rows (it lists the
-- same divergence the Coverage "Unpublished changes" badge shows) — eyeball it.
--
-- STORE SHAPES (app_state.value), all verified against data.js/kiosk/data.js:
--   boa_(mgr)schedapproved_<branch>_<ym>  ARRAY, [0]=live, [0].grid={ec:{cell:code}}
--   boa_(mgr)sched_<branch>_<ym>          OBJECT {grid:{ec:{cell:code}}, ...}
--   boa_mgr_times_v1 / boa_mgr_shift_pins_v1  OBJECT {ec:{"YYYY-MM-DD":val}}
--   boa_unpaid_legal_v1  ARRAY {ec,status,startDate,endDate}  (status 'on_leave')
--   boa_leave_v1         ARRAY {ec,startDate,endDate,type}
--   boa_mgr_loans_v1 / boa_tech_loans_v1  ARRAY {ec,date,fromBranch,toBranch}
--   boa_kiosk_log_<branch>_<ym>  ARRAY {ec,dayKey,ymd,status,ts}
--   maternity  = TABLE (employee_code, mat_start, mat_end, ...)
-- Manager grid cell keys are full dates "YYYY-MM-DD"; tech cell keys are the
-- day-of-month string. Queries that compare to a calendar range use only the
-- full-date cells (managers) — the kiosk log (Q5) carries a full `ymd`, so it
-- covers the tech/nail-tech side that Q4 can't reconstruct from a bare dom.
-- ============================================================================


-- ── Q1: override EC-key hygiene (Case A mechanism) — SHOULD return ZERO ──────
-- Every top-level key in boa_mgr_times_v1 / boa_mgr_shift_pins_v1 is an employee
-- code. Two failure modes, both of which silently DROP the override on a staff
-- surface (→ shiftTimes fallback = the wrong hours, exactly Case A):
--   orphan       — no staff row matches the key at all.
--   non_canonical — the key isn't stored as trim().UPPER(); the kiosk readers
--                   match raw + trimmed only, so a case/space difference misses.
select store, ec_key,
       case when st.employee_code is null then 'orphan (no staff match)'
            else 'non_canonical (kiosk raw/trim match may miss)' end as problem
from (
  select 'boa_mgr_times_v1'      as store, k.ec_key from app_state, lateral jsonb_object_keys(value) as k(ec_key) where key = 'boa_mgr_times_v1'      and jsonb_typeof(value) = 'object'
  union all
  select 'boa_mgr_shift_pins_v1' as store, k.ec_key from app_state, lateral jsonb_object_keys(value) as k(ec_key) where key = 'boa_mgr_shift_pins_v1' and jsonb_typeof(value) = 'object'
) ov
left join staff st on upper(btrim(st.employee_code)) = upper(btrim(ov.ec_key))
where st.employee_code is null                 -- orphan
   or ov.ec_key <> upper(btrim(ov.ec_key))     -- not canonical
order by problem, store, ec_key;


-- ── Q2: draft vs published[0] cell drift per open cycle (INFORMATIONAL) ──────
-- The DB twin of the Coverage "Unpublished changes" badge: for every (branch,
-- ym) that has BOTH a draft and a published snapshot, list cells whose code
-- differs. WE/WM/WL/WB are normalised to W (those are re-derived at publish, not
-- real divergence), so a row here is a substantive draft edit not yet published.
-- Rows are EXPECTED whenever a draft has been edited since the last publish.
with draft as (
  select (key ~ '^boa_mgrsched_')                                          as is_mgr,
         (regexp_match(key, '^boa_(?:mgr)?sched_(.+)_(\d{4}-\d{2})$'))[1]   as branch,
         (regexp_match(key, '^boa_(?:mgr)?sched_(.+)_(\d{4}-\d{2})$'))[2]   as ym,
         value->'grid'                                                      as grid
  from app_state
  where key ~ '^boa_mgrsched_' or key ~ '^boa_sched_'
),
pub as (
  select (key ~ '^boa_mgrschedapproved_')                                                 as is_mgr,
         (regexp_match(key, '^boa_(?:mgr)?schedapproved_(.+)_(\d{4}-\d{2})$'))[1]          as branch,
         (regexp_match(key, '^boa_(?:mgr)?schedapproved_(.+)_(\d{4}-\d{2})$'))[2]          as ym,
         value->0->'grid'                                                                  as grid
  from app_state
  where (key ~ '^boa_mgrschedapproved_' or key ~ '^boa_schedapproved_')
    and jsonb_typeof(value) = 'array' and jsonb_array_length(value) > 0
),
dcells as (
  select d.is_mgr, d.branch, d.ym, upper(regexp_replace(ec.key, '[^A-Za-z0-9]', '', 'g')) as ec, cell.key as cell_key,
         case when (cell.value #>> '{}') in ('WE','WM','WL','WB') then 'W' else (cell.value #>> '{}') end as code
  from draft d, lateral jsonb_each(d.grid) ec(key, val), lateral jsonb_each(ec.val) cell(key, value)
  -- Manager grids: full-date cells only (match the badge — a Coverage edit writes
  -- BOTH "2026-07-15" and "15", and the mirror keeps only the full date, so dom
  -- keys would read as phantom drift). Tech grids are day-of-month by design, so
  -- keep all their keys. (A rare all-dom-keyed legacy manager cycle is skipped.)
  where d.grid is not null and (not d.is_mgr or cell.key ~ '^\d{4}-\d{2}-\d{2}$')
),
pcells as (
  select p.is_mgr, p.branch, p.ym, upper(regexp_replace(ec.key, '[^A-Za-z0-9]', '', 'g')) as ec, cell.key as cell_key,
         case when (cell.value #>> '{}') in ('WE','WM','WL','WB') then 'W' else (cell.value #>> '{}') end as code
  from pub p, lateral jsonb_each(p.grid) ec(key, val), lateral jsonb_each(ec.val) cell(key, value)
  where p.grid is not null and (not p.is_mgr or cell.key ~ '^\d{4}-\d{2}-\d{2}$')
),
both_cycles as (
  select is_mgr, branch, ym from dcells
  intersect
  select is_mgr, branch, ym from pcells
)
select coalesce(d.is_mgr, p.is_mgr) as is_mgr,
       coalesce(d.branch, p.branch) as branch,
       coalesce(d.ym, p.ym)         as ym,
       coalesce(d.ec, p.ec)         as ec,
       coalesce(d.cell_key, p.cell_key) as cell_key,
       coalesce(d.code, '(blank)')  as draft_code,
       coalesce(p.code, '(blank)')  as published_code
from dcells d
full join pcells p
  on d.is_mgr = p.is_mgr and d.branch = p.branch and d.ym = p.ym
 and d.ec = p.ec and d.cell_key = p.cell_key
-- Restrict to cycles that have BOTH a draft and a published snapshot (else a
-- one-sided cycle reads as drift). Computed once via intersect instead of two
-- correlated EXISTS that re-scan every cell per row.
join both_cycles bc
  on bc.is_mgr = coalesce(d.is_mgr, p.is_mgr)
 and bc.branch = coalesce(d.branch, p.branch)
 and bc.ym     = coalesce(d.ym, p.ym)
where coalesce(d.code, '') <> coalesce(p.code, '')
order by is_mgr, branch, ym, ec, cell_key;


-- ── Q3: loan_out grid cell without a durable loan record — SHOULD return ZERO ─
-- A home cell reading "loan_out" that has no matching (ec, date) row in the loan
-- store is a phantom: it renders "AWAY → other store" forever (ec55083 family).
-- loan_out is written under a full-date cell key, so it joins to loans.date.
with pub as (
  select (key ~ '^boa_mgrschedapproved_')                                          as is_mgr,
         (regexp_match(key, '^boa_(?:mgr)?schedapproved_(.+)_(\d{4}-\d{2})$'))[1]   as branch,
         value->0->'grid'                                                           as grid
  from app_state
  where (key ~ '^boa_mgrschedapproved_' or key ~ '^boa_schedapproved_')
    and jsonb_typeof(value) = 'array' and jsonb_array_length(value) > 0
),
loan_cells as (
  select p.is_mgr, p.branch, upper(regexp_replace(ec.key, '[^A-Za-z0-9]', '', 'g')) as ec, cell.key as cell_date
  from pub p, lateral jsonb_each(p.grid) ec(key, val), lateral jsonb_each(ec.val) cell(key, value)
  where p.grid is not null
    and (cell.value #>> '{}') = 'loan_out'
    and cell.key ~ '^\d{4}-\d{2}-\d{2}$'
),
loans as (
  select upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, r->>'date' as date
  from app_state, lateral jsonb_array_elements(value) r
  where key in ('boa_mgr_loans_v1', 'boa_tech_loans_v1')
)
select lc.branch, lc.ec, lc.cell_date, (lc.is_mgr) as is_mgr
from loan_cells lc
where not exists (select 1 from loans l where l.ec = lc.ec and l.date = lc.cell_date)
order by lc.branch, lc.ec, lc.cell_date;


-- ============================================================================
-- REMEDIATION for Q3 — revert orphan loan_out cells to "W"
--
-- Q3 above IS the preview: every row it returns is a cell this reverts. Under
-- the system's truth model the loan RECORD is durable truth, so a loan_out grid
-- cell with NO record is invalid — no record = no loan = the manager worked
-- their home branch. This sets each orphan loan_out cell in the published
-- manager snapshot back to "W" (the shift variant is re-derived at render).
--
-- CAVEATS:
--   • If a cell is a REAL loan whose record was merely lost, "W" wrongly places
--     the manager at home and the destination is unrecoverable from the grid —
--     re-create those in Manager Coverage instead. Cross-store cases (e.g.
--     B829M Plumstead<->Westlake) are the likeliest real-loans.
--   • MOST orphans are the CLOSED 25-May→24-Jun cycle (payroll already ran).
--     But THREE fall in the OPEN cycle and WILL change the live attendance
--     sheet: B798M Bree 2026-06-26 & 2026-07-04, B926M Fourways 2026-06-29.
--     To skip those and clear only the closed cycle, uncomment the two date
--     ceilings marked  <<CEILING>>  below.
--   • This is the only place that rewrites a published snapshot. BACK UP FIRST:
--       select key, value from app_state
--       where key ~ '^boa_mgrschedapproved_'
--         and value #>> '{0,grid}' like '%loan_out%';
--
-- HOW TO RUN: run Q3 (preview), take the backup above, uncomment the UPDATE,
-- run it, then re-run Q3 — it must return zero (or only the 3 open-cycle cells
-- if you kept the ceilings).
-- ============================================================================

-- with loans as (
--   select upper(regexp_replace(r->>'ec','[^A-Za-z0-9]','','g')) as ec, r->>'date' as date
--   from app_state, lateral jsonb_array_elements(app_state.value) r
--   where key in ('boa_mgr_loans_v1','boa_tech_loans_v1')
-- )
-- update app_state s
-- set value = jsonb_set(
--   s.value, '{0,grid}',
--   coalesce((
--     select jsonb_object_agg(g.ec_key, coalesce((
--       select jsonb_object_agg(c.cell_key,
--         case when c.cell_val = '"loan_out"'::jsonb
--               and c.cell_key ~ '^\d{4}-\d{2}-\d{2}$'
--               -- and c.cell_key < '2026-06-25'                 -- <<CEILING>> keep the 3 open-cycle cells
--               and not exists (select 1 from loans l
--                     where l.ec = upper(regexp_replace(g.ec_key,'[^A-Za-z0-9]','','g'))
--                       and l.date = c.cell_key)
--              then '"W"'::jsonb else c.cell_val end)
--       from jsonb_each(g.ec_val) c(cell_key, cell_val)
--     ), '{}'::jsonb))
--     from jsonb_each(s.value->0->'grid') g(ec_key, ec_val)
--   ), '{}'::jsonb)
-- )
-- where s.key ~ '^boa_mgrschedapproved_'
--   and jsonb_typeof(s.value) = 'array' and jsonb_array_length(s.value) > 0
--   and s.value->0->'grid' is not null
--   and exists (
--     select 1 from jsonb_each(s.value->0->'grid') g2(ec_key, ec_val),
--                   lateral jsonb_each(g2.ec_val) c2(cell_key, cell_val)
--     where c2.cell_val = '"loan_out"'::jsonb
--       and c2.cell_key ~ '^\d{4}-\d{2}-\d{2}$'
--       -- and c2.cell_key < '2026-06-25'                        -- <<CEILING>> match the ceiling above
--       and not exists (select 1 from loans l
--             where l.ec = upper(regexp_replace(g2.ec_key,'[^A-Za-z0-9]','','g'))
--               and l.date = c2.cell_key)
--   );


-- ── Q4: working PUBLISHED cell inside an EL / ML / leave range — ZERO (G4) ────
-- Anyone with a working cell (W/WE/WM/WL/WB/E) in the live published snapshot on
-- a day they are on Unpaid Legal, Maternity, or approved Leave. The staff grid
-- says "work" while the truth stores say "away" — the exact G4 contradiction.
-- Manager grids only (full-date keys); the tech/nail-tech side is caught by Q5.
with pub as (
  select (regexp_match(key, '^boa_(?:mgr)?schedapproved_(.+)_(\d{4}-\d{2})$'))[1] as branch,
         value->0->'grid'                                                         as grid
  from app_state
  where key ~ '^boa_mgrschedapproved_'
    and jsonb_typeof(value) = 'array' and jsonb_array_length(value) > 0
),
work_cells as (
  select p.branch, upper(regexp_replace(ec.key, '[^A-Za-z0-9]', '', 'g')) as ec, to_date(cell.key,'YYYY-MM-DD') as d, (cell.value #>> '{}') as code
  from pub p, lateral jsonb_each(p.grid) ec(key, val), lateral jsonb_each(ec.val) cell(key, value)
  where p.grid is not null
    and cell.key ~ '^\d{4}-\d{2}-\d{2}$'
    and (cell.value #>> '{}') in ('W','WE','WM','WL','WB','E')
),
el as (
  select upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, to_date(nullif(r->>'startDate',''),'YYYY-MM-DD') as s, to_date(nullif(r->>'endDate',''),'YYYY-MM-DD') as e
  from app_state, lateral jsonb_array_elements(value) r
  where key = 'boa_unpaid_legal_v1' and coalesce(r->>'status','') = 'on_leave'
    and (nullif(r->>'startDate','') is null or r->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$')   -- skip malformed hand-edited dates (no abort)
    and (nullif(r->>'endDate','')   is null or r->>'endDate'   ~ '^\d{4}-\d{2}-\d{2}$')
),
lv as (
  select upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, to_date(nullif(r->>'startDate',''),'YYYY-MM-DD') as s, to_date(nullif(r->>'endDate',''),'YYYY-MM-DD') as e
  from app_state, lateral jsonb_array_elements(value) r
  where key = 'boa_leave_v1'
    and (nullif(r->>'startDate','') is null or r->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$')   -- skip malformed hand-edited dates (no abort)
    and (nullif(r->>'endDate','')   is null or r->>'endDate'   ~ '^\d{4}-\d{2}-\d{2}$')
)
select w.branch, w.ec, w.d, w.code,
       case
         when exists (select 1 from el where el.ec = w.ec and (el.s is null or w.d >= el.s::date) and (el.e is null or w.d <= el.e::date)) then 'unpaid_legal'
         when exists (select 1 from maternity m where upper(regexp_replace(m.employee_code, '[^A-Za-z0-9]', '', 'g')) = w.ec and m.mat_start is not null and w.d >= m.mat_start and (m.mat_end is null or w.d <= m.mat_end)) then 'maternity'
         else 'leave'
       end as conflict
from work_cells w
where exists (select 1 from el where el.ec = w.ec and (el.s is null or w.d >= el.s::date) and (el.e is null or w.d <= el.e::date))
   or exists (select 1 from maternity m where upper(regexp_replace(m.employee_code, '[^A-Za-z0-9]', '', 'g')) = w.ec and m.mat_start is not null and w.d >= m.mat_start and (m.mat_end is null or w.d <= m.mat_end))
   or exists (select 1 from lv where lv.ec = w.ec and lv.s is not null and lv.e is not null and w.d >= lv.s::date and w.d <= lv.e::date)
order by w.branch, w.ec, w.d;


-- ── Q5: kiosk "absent/no" tag inside an EL / ML / leave range — ZERO (Case B) ─
-- The Kimberley detector: a manager tagged someone absent/no-show on the kiosk
-- for a day the person was on Unpaid Legal, Maternity, or Leave. Fix at the
-- SOURCE (the tag roster should never have listed them). Uses the log's full
-- `ymd`, so it covers nail techs too.
with klog as (
  select (regexp_match(key, '^boa_kiosk_log_(.+)_(\d{4}-\d{2})$'))[1] as branch,
         upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec,
         to_date(r->>'ymd','YYYY-MM-DD') as d,
         r->>'status'           as status
  from app_state, lateral jsonb_array_elements(value) r
  where key ~ '^boa_kiosk_log_'
    and jsonb_typeof(app_state.value) = 'array'   -- qualify: jsonb_array_elements(value) r also exposes a "value" column
    and coalesce(r->>'status','') in ('absent','no')
    and (r->>'ymd') ~ '^\d{4}-\d{2}-\d{2}$'
),
el as (
  select upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, to_date(nullif(r->>'startDate',''),'YYYY-MM-DD') as s, to_date(nullif(r->>'endDate',''),'YYYY-MM-DD') as e
  from app_state, lateral jsonb_array_elements(value) r
  where key = 'boa_unpaid_legal_v1' and coalesce(r->>'status','') = 'on_leave'
    and (nullif(r->>'startDate','') is null or r->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$')   -- skip malformed hand-edited dates (no abort)
    and (nullif(r->>'endDate','')   is null or r->>'endDate'   ~ '^\d{4}-\d{2}-\d{2}$')
),
lv as (
  select upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, to_date(nullif(r->>'startDate',''),'YYYY-MM-DD') as s, to_date(nullif(r->>'endDate',''),'YYYY-MM-DD') as e
  from app_state, lateral jsonb_array_elements(value) r
  where key = 'boa_leave_v1'
    and (nullif(r->>'startDate','') is null or r->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$')   -- skip malformed hand-edited dates (no abort)
    and (nullif(r->>'endDate','')   is null or r->>'endDate'   ~ '^\d{4}-\d{2}-\d{2}$')
)
select k.branch, k.ec, k.d, k.status,
       case
         when exists (select 1 from el where el.ec = k.ec and (el.s is null or k.d >= el.s::date) and (el.e is null or k.d <= el.e::date)) then 'unpaid_legal'
         when exists (select 1 from maternity m where upper(regexp_replace(m.employee_code, '[^A-Za-z0-9]', '', 'g')) = k.ec and m.mat_start is not null and k.d >= m.mat_start and (m.mat_end is null or k.d <= m.mat_end)) then 'maternity'
         else 'leave'
       end as conflict
from klog k
where exists (select 1 from el where el.ec = k.ec and (el.s is null or k.d >= el.s::date) and (el.e is null or k.d <= el.e::date))
   or exists (select 1 from maternity m where upper(regexp_replace(m.employee_code, '[^A-Za-z0-9]', '', 'g')) = k.ec and m.mat_start is not null and k.d >= m.mat_start and (m.mat_end is null or k.d <= m.mat_end))
   or exists (select 1 from lv where lv.ec = k.ec and lv.s is not null and lv.e is not null and k.d >= lv.s::date and k.d <= lv.e::date)
order by k.branch, k.ec, k.d;


-- ============================================================================
-- REMEDIATION for Q5 — clear the erroneous kiosk "absent"/"no" tags
--
-- Q5 above IS the preview: every row it returns is a tag this repairs. The
-- UPDATE below sets those tags' status to "(cleared)" (the kiosk's own cleared
-- marker) — NON-destructive: the log entry stays for audit, and the real
-- leave / unpaid-legal / maternity status already lives in its own store and
-- overlays on every surface. Nothing here invents a "leave" status (the kiosk
-- status vocabulary has none).
--
-- HOW TO RUN (deliberate, one-time — this is the ONLY mutating statement in
-- this file, and it stays commented out until you uncomment it):
--   1. Run Q5. Eyeball the rows; spot-check >=1 name against its leave record
--      (as done for B858's 19 Jun–19 Oct maternity) so a wrong / too-wide leave
--      record can't clear a genuine absence.
--   2. Run the PREVIEW select below — it counts, per kiosk-log key, exactly how
--      many tags the UPDATE will change. Confirm the total matches Q5.
--   3. Uncomment the UPDATE block and run it.
--   4. Re-run Q5 — it MUST now return zero rows.
--
-- SCOPE: this clears ALL flagged tags, including closed past cycles (it corrects
-- the record even where past pay already ran). To limit to the current + recent
-- cycles, add   and r->>'ymd' >= '2026-06-25'   to the `bad` CTE in BOTH blocks.
-- ============================================================================

-- PREVIEW (safe SELECT) — tags that would be cleared, grouped by kiosk-log key.
with el as (
  select upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, to_date(nullif(r->>'startDate',''),'YYYY-MM-DD') as s, to_date(nullif(r->>'endDate',''),'YYYY-MM-DD') as e
  from app_state, lateral jsonb_array_elements(app_state.value) r
  where key = 'boa_unpaid_legal_v1' and coalesce(r->>'status','') = 'on_leave'
    and (nullif(r->>'startDate','') is null or r->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$')
    and (nullif(r->>'endDate','')   is null or r->>'endDate'   ~ '^\d{4}-\d{2}-\d{2}$')
),
lv as (
  select upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, to_date(nullif(r->>'startDate',''),'YYYY-MM-DD') as s, to_date(nullif(r->>'endDate',''),'YYYY-MM-DD') as e
  from app_state, lateral jsonb_array_elements(app_state.value) r
  where key = 'boa_leave_v1'
    and (nullif(r->>'startDate','') is null or r->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$')
    and (nullif(r->>'endDate','')   is null or r->>'endDate'   ~ '^\d{4}-\d{2}-\d{2}$')
),
bad as (   -- distinct (ec, ymd) that carry an absent/no tag while on EL/ML/leave
  select distinct upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, r->>'ymd' as ymd
  from app_state, lateral jsonb_array_elements(app_state.value) r
  where key ~ '^boa_kiosk_log_' and jsonb_typeof(app_state.value) = 'array'
    and coalesce(r->>'status','') in ('absent','no')
    and r->>'ymd' ~ '^\d{4}-\d{2}-\d{2}$'
    and ( exists (select 1 from el where el.ec = upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) and (el.s is null or to_date(r->>'ymd','YYYY-MM-DD') >= el.s) and (el.e is null or to_date(r->>'ymd','YYYY-MM-DD') <= el.e))
       or exists (select 1 from maternity m where upper(regexp_replace(m.employee_code, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) and m.mat_start is not null and to_date(r->>'ymd','YYYY-MM-DD') >= m.mat_start and (m.mat_end is null or to_date(r->>'ymd','YYYY-MM-DD') <= m.mat_end))
       or exists (select 1 from lv where lv.ec = upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) and lv.s is not null and lv.e is not null and to_date(r->>'ymd','YYYY-MM-DD') >= lv.s and to_date(r->>'ymd','YYYY-MM-DD') <= lv.e) )
)
select s.key, count(*) as tags_to_clear
from app_state s, lateral jsonb_array_elements(s.value) x
where s.key ~ '^boa_kiosk_log_' and jsonb_typeof(s.value) = 'array'
  and x->>'status' in ('absent','no')
  and exists (select 1 from bad b where b.ec = upper(regexp_replace(x->>'ec', '[^A-Za-z0-9]', '', 'g')) and b.ymd = x->>'ymd')
group by s.key
order by s.key;

-- THE FIX — uncomment the whole block, run it, then re-run Q5 (must be zero).
-- with el as (
--   select upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, to_date(nullif(r->>'startDate',''),'YYYY-MM-DD') as s, to_date(nullif(r->>'endDate',''),'YYYY-MM-DD') as e
--   from app_state, lateral jsonb_array_elements(app_state.value) r
--   where key = 'boa_unpaid_legal_v1' and coalesce(r->>'status','') = 'on_leave'
--     and (nullif(r->>'startDate','') is null or r->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$')
--     and (nullif(r->>'endDate','')   is null or r->>'endDate'   ~ '^\d{4}-\d{2}-\d{2}$')
-- ),
-- lv as (
--   select upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, to_date(nullif(r->>'startDate',''),'YYYY-MM-DD') as s, to_date(nullif(r->>'endDate',''),'YYYY-MM-DD') as e
--   from app_state, lateral jsonb_array_elements(app_state.value) r
--   where key = 'boa_leave_v1'
--     and (nullif(r->>'startDate','') is null or r->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$')
--     and (nullif(r->>'endDate','')   is null or r->>'endDate'   ~ '^\d{4}-\d{2}-\d{2}$')
-- ),
-- bad as (
--   select distinct upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) as ec, r->>'ymd' as ymd
--   from app_state, lateral jsonb_array_elements(app_state.value) r
--   where key ~ '^boa_kiosk_log_' and jsonb_typeof(app_state.value) = 'array'
--     and coalesce(r->>'status','') in ('absent','no')
--     and r->>'ymd' ~ '^\d{4}-\d{2}-\d{2}$'
--     and ( exists (select 1 from el where el.ec = upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) and (el.s is null or to_date(r->>'ymd','YYYY-MM-DD') >= el.s) and (el.e is null or to_date(r->>'ymd','YYYY-MM-DD') <= el.e))
--        or exists (select 1 from maternity m where upper(regexp_replace(m.employee_code, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) and m.mat_start is not null and to_date(r->>'ymd','YYYY-MM-DD') >= m.mat_start and (m.mat_end is null or to_date(r->>'ymd','YYYY-MM-DD') <= m.mat_end))
--        or exists (select 1 from lv where lv.ec = upper(regexp_replace(r->>'ec', '[^A-Za-z0-9]', '', 'g')) and lv.s is not null and lv.e is not null and to_date(r->>'ymd','YYYY-MM-DD') >= lv.s and to_date(r->>'ymd','YYYY-MM-DD') <= lv.e) )
-- )
-- update app_state s
-- set value = coalesce((
--   select jsonb_agg(
--            case when e.elem->>'status' in ('absent','no')
--                  and exists (select 1 from bad b where b.ec = upper(regexp_replace(e.elem->>'ec', '[^A-Za-z0-9]', '', 'g')) and b.ymd = e.elem->>'ymd')
--                 then jsonb_set(e.elem, '{status}', '"(cleared)"'::jsonb)
--                 else e.elem end
--            order by e.ord)
--   from jsonb_array_elements(s.value) with ordinality as e(elem, ord)
-- ), '[]'::jsonb)
-- where s.key ~ '^boa_kiosk_log_' and jsonb_typeof(s.value) = 'array'
--   and exists (
--     select 1 from jsonb_array_elements(s.value) x
--     where x->>'status' in ('absent','no')
--       and exists (select 1 from bad b where b.ec = upper(regexp_replace(x->>'ec', '[^A-Za-z0-9]', '', 'g')) and b.ymd = x->>'ymd')
--   );
