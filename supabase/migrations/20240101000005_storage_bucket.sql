-- Storage bucket for the original uploaded SOP files.
--
-- Files are uploaded by the server (service role), so the bucket is private.
-- The `objects` table policies are what matter for direct client uploads;
-- we do not expose them, but the insert policy is included so a future
-- browser-side upload path does not need a schema change.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'protocol-files',
  'protocol-files',
  false,
  10485760,
  array['text/markdown', 'text/plain', 'text/x-markdown']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "protocol files are service-role managed"
  on storage.objects;

create policy "protocol files are service-role managed"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'protocol-files')
  with check (bucket_id = 'protocol-files');
