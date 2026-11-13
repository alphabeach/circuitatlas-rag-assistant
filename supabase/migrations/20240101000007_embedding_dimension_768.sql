-- Change the vector dimension from 1536 to 768.
--
-- The embedding provider changed from OpenAI's text-embedding-3-small
-- (1536 dims) to Gemini's gemini-embedding-001 with
-- output_dimensionality=768. Gemini's models are trained with Matryoshka
-- representation learning, so 768 loses almost no retrieval quality
-- (MTEB 67.99 vs 68.17 at 3072) while shrinking the column by half.
--
-- IMPORTANT: the embedding spaces of different models are not comparable.
-- Every chunk must be re-embedded with the new model after this migration.
-- The existing rows are cleared here rather than left as silently-wrong
-- vectors that would score near-random against new queries.

-- Drop the HNSW index first; it depends on the column type.
drop index if exists public.protocol_chunks_embedding_hnsw_idx;

-- Clear existing chunks: they were embedded with a different model and
-- their vectors are meaningless in the new space.
truncate table public.protocol_chunks;

-- Widen or narrow the column. pgvector zero-pads when widening, so this
-- is safe, but the rows are gone anyway.
alter table public.protocol_chunks
  alter column embedding type vector(768);

-- Recreate the index at the new dimension.
create index if not exists protocol_chunks_embedding_hnsw_idx
  on public.protocol_chunks
  using hnsw (embedding vector_cosine_ops);

-- The RPC signature carries the dimension, so it must be replaced.
drop function if exists public.match_protocol_chunks(vector, float, int, uuid);

create or replace function public.match_protocol_chunks (
  query_embedding vector(768),
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
