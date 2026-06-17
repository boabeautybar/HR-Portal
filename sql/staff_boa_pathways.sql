-- ============================================================================
-- BOA Pathways flag on `staff` — run once in the Supabase SQL editor
-- (idempotent; safe to re-run).
--
-- BOA Pathways is the programme for unemployed South Africans that some staff
-- are recruited through. This boolean marks an employee (nail tech or manager)
-- as a BOA Pathways graduate so the badge shows next to their name on the
-- Locations overview and they're counted in the "BOA Pathways" total tile.
--
-- The staff-edit modal (and the onboarding form) write `boa_pathways`. The
-- portal already strips unknown columns and retries the save, so a deployment
-- whose `staff` table predates this column still saves everything else — but
-- the BOA Pathways flag won't persist until this runs.
-- ============================================================================

alter table staff
  add column if not exists boa_pathways boolean not null default false;

-- Tell PostgREST to pick up the new column immediately (otherwise the API's
-- schema cache can lag behind the DDL until its next reload).
notify pgrst, 'reload schema';
