-- Similarity search RPC.
--
-- Design note: `match_threshold` defaults to -1.0, which disables filtering
-- entirely. That is deliberate. The function over-fetches candidates and the
-- application applies relevance rules, because an absolute threshold in the
-- database cannot distinguish "weak match among strong candidates" from
-- "nothing relevant exists" - both look like a low score.
--
-- The application-side rules (see src/lib/rag/retrieve.ts) are:
--   1. absolute floor  - catches the "nothing relevant" case
--   2. relative delta  - keeps only chunks near the best hit for this query
--
-- Both are tunable in src/lib/constants.ts without touching the schema.

create or replace function public.match_protocol_chunks (
  query_embedding vector(1536),
  match_threshold float default -1.0,
  match_count int default 30,
  filter_document_id uuid default null
)
returns table (
  id          uuid,
  document_id uuid,
  content     text,
  metadata    jsonb,
  similarity  float
)
language sql
stable
as $$
  select
    c.id,
    c.document_id,
    c.content,
    c.metadata,
    (1 - (c.embedding <=> query_embedding))::float as similarity
  from public.protocol_chunks c
  where 1 - (c.embedding <=> query_embedding) > match_threshold
    and (filter_document_id is null or c.document_id = filter_document_id)
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

comment on function public.match_protocol_chunks is
  'Cosine similarity search over protocol_chunks. Over-fetches by default; relevance filtering happens in the application layer.';

-- Convenience wrapper for deleting a document and all of its chunks.
create or replace function public.delete_protocol_document (target_document_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.protocol_documents where id = target_document_id;
end;
$$;
