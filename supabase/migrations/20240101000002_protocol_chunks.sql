-- Vector-backed knowledge base.
--
-- `embedding` is 1536-dimensional to match openai/text-embedding-3-small.
-- If the embedding model changes, this dimension and the RPC signature in
-- the next migration must change together.

create table if not exists public.protocol_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid        not null references public.protocol_documents(id) on delete cascade,
  content     text        not null,
  -- Free-form source metadata: { heading, section, ordinal, tags, filename }
  metadata    jsonb       not null default '{}'::jsonb,
  embedding   vector(1536) not null,
  char_count  integer     not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.protocol_chunks is
  'Chunked SOP content with pgvector embeddings for similarity search.';

-- Similarity search always filters by document, so index that column too.
create index if not exists protocol_chunks_document_id_idx
  on public.protocol_chunks (document_id);

-- HNSW over cosine distance. This is the index the <=> operator uses, and
-- it is what makes the RPC fast once the corpus grows past a few thousand
-- chunks. Requires the column to be exactly `vector` (not halfvec/vectorc).
create index if not exists protocol_chunks_embedding_hnsw_idx
  on public.protocol_chunks
  using hnsw (embedding vector_cosine_ops);

-- GIN index so metadata filters (filename, heading, tags) stay fast.
create index if not exists protocol_chunks_metadata_gin_idx
  on public.protocol_chunks using gin (metadata jsonb_path_ops);
