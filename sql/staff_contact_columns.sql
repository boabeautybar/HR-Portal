-- ============================================================================
-- Contact & identity columns on `staff` — run once in the Supabase SQL editor
-- (idempotent; safe to re-run).
--
-- The onboarding flow ("Convert Trial Candidate" / "Direct Hire Registration")
-- carries the phone, email, address and ID number typed during onboarding onto
-- the staff record, and the staff-edit modal can store a tax number and gender.
-- Deployments whose `staff` table predates these columns reject the whole
-- write with: "Could not find the 'cell_number' column of 'staff' in the
-- schema cache" — which blocked onboarding entirely whenever any of those
-- fields was filled in.
-- ============================================================================

alter table staff
  add column if not exists cell_number text,
  add column if not exists email       text,
  add column if not exists address     text,
  add column if not exists id_number   text,
  add column if not exists tax_number  text,
  add column if not exists gender      text;

-- Tell PostgREST to pick up the new columns immediately (otherwise the API's
-- schema cache can lag behind the DDL until its next reload).
notify pgrst, 'reload schema';
