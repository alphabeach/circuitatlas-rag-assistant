-- Allow PDF uploads in the protocol-files bucket.
--
-- The original bucket definition only accepted Markdown and plain text.
-- PDFs are now a supported ingestion format, so the MIME allowlist and the
-- size limit need to change.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'protocol-files',
  'protocol-files',
  false,
  4194304,
  array['text/markdown', 'text/plain', 'text/x-markdown', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
