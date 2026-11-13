-- Row Level Security.
--
-- The ingestion path uses the service role key and therefore bypasses RLS.
-- These policies cover reads through the anon/authenticated keys, which is
-- what a signed-in dashboard session would use.

alter table public.protocol_documents enable row level security;
alter table public.protocol_chunks enable row level security;

-- Read access for dashboard sessions.
drop policy if exists "protocol_documents are viewable" on public.protocol_documents;
create policy "protocol_documents are viewable"
  on public.protocol_documents
  for select
  to anon, authenticated
  using (true);

drop policy if exists "protocol_chunks are viewable" on public.protocol_chunks;
create policy "protocol_chunks are viewable"
  on public.protocol_chunks
  for select
  to anon, authenticated
  using (true);

-- Writes are deliberately not granted to anon/authenticated. Ingestion and
-- deletion run through the service role key on the server only.
