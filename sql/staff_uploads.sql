-- ============================================================================
-- Staff uploads bucket — sick notes (sick.html) and absence proof
-- (absence.html) from "My BOA". Run once in the Supabase SQL editor
-- (idempotent; safe to re-run).
--
-- The "My BOA" pages use only the public anon key, so we use a PUBLIC bucket
-- with long, unguessable file paths (timestamp + random + filename). Staff can
-- upload but cannot list or browse others' files; HR opens a file via the link
-- saved on the leave/absence request in the portal.
--
-- NOTE on privacy: a public bucket means anyone who has the exact link can open
-- the file. Links are unguessable and only stored on the (HR-only) request, but
-- if you want notes fully locked down, switch to a private bucket + signed URLs
-- (needs a service-role step the static pages don't have today).
-- ============================================================================

-- 10 MB cap; images + PDF only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-uploads', 'staff-uploads', true, 10485760,
  array['image/png','image/jpeg','image/jpg','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Allow the public (anon) to upload into this bucket only. No select/update/
-- delete policies → anon cannot list, overwrite or remove files. Public read is
-- served by the bucket being public (via the unguessable getPublicUrl link).
drop policy if exists "staff_uploads_anon_insert" on storage.objects;
create policy "staff_uploads_anon_insert"
  on storage.objects for insert to anon
  with check (bucket_id = 'staff-uploads');
