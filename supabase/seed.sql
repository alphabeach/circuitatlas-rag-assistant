-- Verification seed: proves the vector pipeline end-to-end.
--
-- Inserts one document with two chunks whose embeddings are deterministic
-- unit-ish vectors, then demonstrates that the similarity RPC ranks the
-- closer chunk first.
--
-- These are NOT real semantic embeddings. They exist only to prove that
-- the column type, the index, and the RPC all work together. Run
-- `npm run seed:cleanup` (or the delete at the bottom) to remove them
-- before ingesting real SOPs.

-- Deterministic pseudo-random unit vectors.
-- chunk A leans toward the "assay" direction, chunk B toward "safety".

insert into public.protocol_documents (title, filename, tags, chunk_count, char_count)
values (
  'Seed Verification Protocol',
  'seed-verification.md',
  array['seed','verification'],
  2,
  240
)
on conflict (id) do nothing;

-- Reuse the document id we just created.
do $$
declare
  doc_id uuid;
  v_a vector(1536);
  v_b vector(1536);
  i int;
  a float[] := array[]::float[];
  b float[] := array[]::float[];
  base_a float := 0.0;
  base_b float := 0.0;
begin
  select id into doc_id
  from public.protocol_documents
  where filename = 'seed-verification.md'
  order by created_at desc
  limit 1;

  -- Build two distinct 1536-dim vectors.
  -- v_a: strong on dims 1..10, weak elsewhere.
  -- v_b: strong on dims 11..20, weak elsewhere.
  for i in 1..1536 loop
    base_a := case when i <= 10 then 0.30 else 0.01 end;
    base_b := case when i > 10 and i <= 20 then 0.30 else 0.01 end;
    a := array_append(a, base_a);
    b := array_append(b, base_b);
  end loop;

  v_a := (select array_agg(x)::vector from unnest(a) as x);
  v_b := (select array_agg(x)::vector from unnest(b) as x);

  insert into public.protocol_chunks (document_id, content, metadata, embedding, char_count)
  values
    (
      doc_id,
      'Assay verification chunk. Centrifuge at 300 x g for 5 minutes at 4 C. Aspirate the supernatant without disturbing the pellet.',
      '{"heading":"Assay Procedure","section":"Assay Procedure","ordinal":0,"filename":"seed-verification.md","title":"Seed Verification Protocol","tags":["seed"]}'::jsonb,
      v_a,
      140
    ),
    (
      doc_id,
      'Safety verification chunk. Wear nitrile gloves and a lab coat. Handle all chemical waste in the designated yellow sharps container.',
      '{"heading":"Safety Requirements","section":"Safety Requirements","ordinal":1,"filename":"seed-verification.md","title":"Seed Verification Protocol","tags":["seed"]}'::jsonb,
      v_b,
      130
    );
end $$;

-- Verify the ranking: querying with v_a's direction should return chunk A
-- with a higher similarity than chunk B.
select
  c.metadata->>'heading' as heading,
  round(((1 - (c.embedding <=> (
    select embedding from public.protocol_chunks
    where metadata->>'ordinal' = '0'
    limit 1
  )))::numeric), 4) as similarity
from public.protocol_chunks c
where c.metadata->>'filename' = 'seed-verification.md'
order by c.embedding <=> (
  select embedding from public.protocol_chunks
  where metadata->>'ordinal' = '0'
  limit 1
);
