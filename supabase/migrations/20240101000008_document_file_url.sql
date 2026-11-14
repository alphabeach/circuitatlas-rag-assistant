-- The address the browser can open the original upload at.
--
-- The file itself is already in the private protocol-files bucket
-- (storage_path). file_url points at our own streaming route instead of a
-- signed Supabase URL, because a signed URL expires and a URL stored in
-- the table would go stale.
--
-- Existing documents are backfilled: the route takes the document id, so
-- the URL can be derived for every row that has a stored file.

alter table public.protocol_documents
  add column if not exists file_url text;

update public.protocol_documents
   set file_url = '/api/documents/file?id=' || id::text
 where file_url is null
   and storage_path is not null;

comment on column public.protocol_documents.file_url is
  'Address the original upload is served from; null for documents whose file was not stored.';
