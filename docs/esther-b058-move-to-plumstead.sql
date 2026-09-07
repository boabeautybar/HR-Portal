-- ============================================================================
-- Esther Makani (B058) — FULL relocation Betty → Plumstead for cycle 25 Jul–24 Aug.
-- Supersedes the earlier "clean split" (docs/esther-b058-plumstead-transfer-schedule.sql).
-- Decision: NO split. Her whole worked cycle + all attendance move to Plumstead,
-- and she is removed from Betty, so everything pulls through on the Plumstead
-- attendance sheet as if she'd been at Plumstead the whole cycle.
--
-- Key facts (verified live):
--   • Nail techs don't clock in — the schedule grid IS the worked record.
--   • Tech SCHEDULE keys use END-month ym = 2026-08 (boa_sched* / boa_schedapproved*).
--   • ATTENDANCE keys use START-month ym = 2026-07 (boa_att_*). Same cycle.
--   • Day keys 25–31 = Jul 25–31, keys 1–24 = Aug 1–24.
--   • Her B058 attendance lives in FOUR per-tech sidecars: grid, adminOverrides,
--     freshaWorked, reviewedWarnings. Plumstead already has stray grid/freshaWorked
--     B058 entries (auto-mirror from the branch flip) — merged, Betty wins.
--
-- ⚠ Read-only STEP 0 first. STEP 1 is one transaction. STEP 2 verifies.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 0 — BEFORE (read-only). Confirm what's where.
-- ════════════════════════════════════════════════════════════════════════════
-- Schedule (ym 2026-08):
select 'SCHED Betty pub'  as k, value -> 0 -> 'grid' -> 'B058' as b058 from app_state where key = 'boa_schedapproved_Betty_2026-08'
union all select 'SCHED Betty draft',    value -> 'grid' -> 'B058'       from app_state where key = 'boa_sched_Betty_2026-08'
union all select 'SCHED Plum pub',       value -> 0 -> 'grid' -> 'B058'  from app_state where key = 'boa_schedapproved_Plumstead_2026-08'
union all select 'SCHED Plum draft',     value -> 'grid' -> 'B058'       from app_state where key = 'boa_sched_Plumstead_2026-08';
-- Attendance (ym 2026-07), each sidecar:
select 'ATT Betty grid'          as k, value -> 'grid' -> 'B058'            as b058 from app_state where key = 'boa_att_Betty_2026-07'
union all select 'ATT Betty overrides',   value -> 'adminOverrides' -> 'B058'   from app_state where key = 'boa_att_Betty_2026-07'
union all select 'ATT Betty freshaWorked',value -> 'freshaWorked' -> 'B058'      from app_state where key = 'boa_att_Betty_2026-07'
union all select 'ATT Betty reviewedWarn',value -> 'reviewedWarnings' -> 'B058'  from app_state where key = 'boa_att_Betty_2026-07'
union all select 'ATT Plum grid',         value -> 'grid' -> 'B058'             from app_state where key = 'boa_att_Plumstead_2026-07'
union all select 'ATT Plum overrides',    value -> 'adminOverrides' -> 'B058'   from app_state where key = 'boa_att_Plumstead_2026-07';

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1 — APPLY (one transaction).
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── SCHEDULE ────────────────────────────────────────────────────────────────
-- Plumstead: her FULL worked cycle (verbatim original Betty pattern).
update app_state set value = jsonb_set(value, '{grid,B058}',
  '{"1":"W","2":"O","3":"E","4":"W","5":"W","6":"W","7":"W","8":"W","9":"E","10":"O","11":"W","12":"W","13":"W","14":"W","15":"W","16":"O","17":"E","18":"W","19":"W","20":"W","21":"W","22":"W","23":"O","24":"O","25":"W","26":"W","27":"E","28":"W","29":"W","30":"W","31":"W"}'::jsonb, true)
where key = 'boa_sched_Plumstead_2026-08' and value ? 'grid';

update app_state set value = jsonb_set(value, '{0,grid,B058}',
  '{"1":"W","2":"O","3":"E","4":"W","5":"W","6":"W","7":"W","8":"W","9":"E","10":"O","11":"W","12":"W","13":"W","14":"W","15":"W","16":"O","17":"E","18":"W","19":"W","20":"W","21":"W","22":"W","23":"O","24":"O","25":"W","26":"W","27":"E","28":"W","29":"W","30":"W","31":"W"}'::jsonb, true)
where key = 'boa_schedapproved_Plumstead_2026-08' and jsonb_typeof(value) = 'array' and jsonb_typeof(value -> 0 -> 'grid') = 'object';

-- Betty: remove her row entirely (draft + published).
update app_state set value = value #- '{grid,B058}'   where key = 'boa_sched_Betty_2026-08';
update app_state set value = value #- '{0,grid,B058}'  where key = 'boa_schedapproved_Betty_2026-08' and jsonb_typeof(value) = 'array';

-- ── ATTENDANCE ──────────────────────────────────────────────────────────────
-- Merge Betty's B058 into Plumstead across all four sidecars (Betty wins on
-- conflicting days). CASE keeps it type-safe when Plumstead has no prior entry.
with betty as (select value as v from app_state where key = 'boa_att_Betty_2026-07')
update app_state p set value =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          p.value,
          '{grid,B058}',
          case when p.value->'grid'->'B058' is null
               then (select v->'grid'->'B058' from betty)
               else p.value->'grid'->'B058' || coalesce((select v->'grid'->'B058' from betty),'{}'::jsonb) end, true),
        '{adminOverrides,B058}',
        case when p.value->'adminOverrides'->'B058' is null
             then (select v->'adminOverrides'->'B058' from betty)
             else p.value->'adminOverrides'->'B058' || coalesce((select v->'adminOverrides'->'B058' from betty),'{}'::jsonb) end, true),
      '{freshaWorked,B058}',
      case when p.value->'freshaWorked'->'B058' is null
           then (select v->'freshaWorked'->'B058' from betty)
           else p.value->'freshaWorked'->'B058' || coalesce((select v->'freshaWorked'->'B058' from betty),'{}'::jsonb) end, true),
    '{reviewedWarnings,B058}',
    case when p.value->'reviewedWarnings'->'B058' is null
         then (select v->'reviewedWarnings'->'B058' from betty)
         else p.value->'reviewedWarnings'->'B058' || coalesce((select v->'reviewedWarnings'->'B058' from betty),'{}'::jsonb) end, true)
where p.key = 'boa_att_Plumstead_2026-07'
  and (select v->'grid'->'B058' from betty) is not null;

-- Remove her from Betty attendance (all four sidecars).
update app_state set value = value #- '{grid,B058}' #- '{adminOverrides,B058}' #- '{freshaWorked,B058}' #- '{reviewedWarnings,B058}'
where key = 'boa_att_Betty_2026-07';

-- ── STAFF RECORD (tidy) ─────────────────────────────────────────────────────
-- She's already branch = Plumstead; clear the stale June transfer fields so
-- nothing references Betty. (transferring already false — inert, but tidy.)
update staff set transfer_to = null, transfer_date = null, transferring = false
where id = 'ac1a7c80-661b-4364-a098-469acee69f0d';   -- Esther Makani (B058)

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2 — AFTER. Expect: Betty rows all null; Plumstead schedule = full worked;
--   Plumstead attendance carries her grid/overrides/freshaWorked/reviewedWarnings.
-- ════════════════════════════════════════════════════════════════════════════
select 'SCHED Betty pub'  as k, value -> 0 -> 'grid' -> 'B058' as b058 from app_state where key = 'boa_schedapproved_Betty_2026-08'
union all select 'SCHED Plum pub',       value -> 0 -> 'grid' -> 'B058'  from app_state where key = 'boa_schedapproved_Plumstead_2026-08'
union all select 'ATT Betty grid',        value -> 'grid' -> 'B058'             from app_state where key = 'boa_att_Betty_2026-07'
union all select 'ATT Betty overrides',   value -> 'adminOverrides' -> 'B058'   from app_state where key = 'boa_att_Betty_2026-07'
union all select 'ATT Plum grid',         value -> 'grid' -> 'B058'             from app_state where key = 'boa_att_Plumstead_2026-07'
union all select 'ATT Plum overrides',    value -> 'adminOverrides' -> 'B058'   from app_state where key = 'boa_att_Plumstead_2026-07'
union all select 'ATT Plum freshaWorked', value -> 'freshaWorked' -> 'B058'     from app_state where key = 'boa_att_Plumstead_2026-07'
union all select 'ATT Plum reviewedWarn', value -> 'reviewedWarnings' -> 'B058' from app_state where key = 'boa_att_Plumstead_2026-07';
