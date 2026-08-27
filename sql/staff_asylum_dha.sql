-- ============================================================================
-- Asylum / DHA sub-flow on `staff` — run once in the Supabase SQL editor
-- (idempotent; safe to re-run).
--
-- "Asylum on File" on its own says nothing about whether the document is
-- real, so the compliance editor now asks whether Home Affairs verified it
-- and, when they did, what the verdict was:
--
--   permit = 'asylum'
--     └─ asylum_dha_checked  'yes' | 'no' | null (not asked yet)
--          └─ (yes) asylum_dha_status  'on_file' (valid) | 'not_on_system' (invalid)
--               └─ (on_file) asylum_ref + permit_expiry
--
-- 'not_on_system' means DHA has no record of the document, so the portal
-- counts that person as NON-COMPLIANT everywhere a Z/NA is counted.
--
-- The portal strips unknown columns and retries the save, so a deployment
-- whose `staff` table predates these columns still saves everything else —
-- but the DHA answers will not persist until this runs.
-- ============================================================================

alter table staff
  add column if not exists asylum_dha_checked text,
  add column if not exists asylum_dha_status  text,
  add column if not exists asylum_ref         text;

-- Only the four values the UI can produce (null = not asked yet).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_asylum_dha_checked_chk') then
    alter table staff add constraint staff_asylum_dha_checked_chk
      check (asylum_dha_checked is null or asylum_dha_checked in ('yes','no'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_asylum_dha_status_chk') then
    alter table staff add constraint staff_asylum_dha_status_chk
      check (asylum_dha_status is null or asylum_dha_status in ('on_file','not_on_system'));
  end if;
end $$;

-- ── Legacy 'verified_dha' → asylum + DHA on file ────────────────────────────
-- 'Verified by DHA' was being used as a status of its own. That meaning is
-- now an asylum document DHA has confirmed, so those rows move across intact.
-- The reference number and expiry are left blank deliberately: we do not have
-- them, and HR must chase them. They surface in the Compliance tab as asylum
-- holders with no expiry on file.
--
-- Pre-flight — see what will change before you commit to it:
--   select employee_code, name, branch, permit from staff where permit = 'verified_dha';

update staff
   set permit             = 'asylum',
       asylum_dha_checked = 'yes',
       asylum_dha_status  = 'on_file'
 where permit = 'verified_dha';

-- Anyone left on the retired value would render as an unknown permit.
-- Expect 0 rows.
--   select count(*) from staff where permit = 'verified_dha';

-- Tell PostgREST to pick up the new columns immediately (otherwise the API's
-- schema cache can lag behind the DDL until its next reload).
notify pgrst, 'reload schema';
