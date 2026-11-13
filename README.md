# CircuitAtlas Protocol Assistant

Retrieval-augmented assistant for laboratory SOPs. Natural-language questions
about protocols, assays, and safety procedures are answered strictly from an
ingested corpus of Markdown/text SOPs, with every claim traced back to the
retrieved chunk that supports it.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Hosting | Vercel (serverless) |
| Database | Supabase Postgres + `pgvector` |
| Embeddings | OpenRouter `openai/text-embedding-3-small` (1536-dim) |
| Generation | OpenRouter `anthropic/claude-sonnet-4.5` |
| UI | Tailwind CSS v4, Radix primitives, `next-themes` |

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in the keys
npm run dev
```

Then apply the migrations to your Supabase project. With the Supabase CLI:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Or paste each file in `supabase/migrations/` into the Supabase SQL editor in
filename order.

## Supported input formats

**Markdown (`.md`) and plain text (`.txt`) only.** PDF ingestion is
deliberately out of scope for the MVP.

The reason is not that PDF parsing is impossible on serverless - it is that
Markdown gives better retrieval. Headings become real chunk boundaries, so a
retrieved chunk maps to an actual SOP section rather than an arbitrary slice
of a flattened text stream. Converting an existing SOP to Markdown takes
about ten seconds and the result is permanently more searchable.

`src/lib/parsers/` is a registry, so adding a format later is one file.

## How retrieval works

The interesting problem with this system is not the vector database - it is
deciding which retrieved chunks are relevant enough to send to the model.

`text-embedding-3-small` produces **anisotropic** vectors. All vectors share a
dominant direction, so raw cosine similarity has a high floor: unrelated
English text still scores roughly 0.6-0.8. A naive `WHERE similarity > 0.5`
filter therefore either returns nothing or returns everything, and neither
outcome is stable across queries.

The fix is to make relevance **relative** rather than absolute:

1. **Over-fetch.** The RPC pulls 30 candidates with the threshold disabled
   (`-1.0`). You cannot distinguish "the best match was weak" from "we
   truncated the good hits" if you only ever fetch 8.
2. **Absolute floor** (`0.35`). Catches the case where nothing in the corpus
   is remotely related, so the system abstains instead of hallucinating. It
   has to sit above the score an unrelated pair typically gets (0.15-0.35)
   and below a genuinely related pair (0.50-0.85).
3. **Relative delta** (`0.12`). Keeps only chunks within `0.12` of the
   best-scoring hit for *this* query.
4. **Model abstention.** The system prompt instructs the model to reply
   `INSUFFICIENT_CONTEXT` when the provided context does not answer the
   question. This is the real safety net - it does not depend on the
   threshold being right.

All four values live in `src/lib/constants.ts`.

### Post-MVP improvement

Normalizing embeddings (subtracting the corpus mean vector before
re-normalizing) removes the dominant direction and makes absolute thresholds
meaningful again. That requires a re-embedding pass, so it is parked. A
cross-encoder **reranker** over the 30 candidates is the cheaper upgrade and
is likely a larger quality win - OpenRouter exposes a Rerank endpoint.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | SSE stream. Emits `citations`, then token `delta`s, then `done`. |
| `/api/ingest` | POST | Multipart upload. Parses, chunks, embeds, inserts. |
| `/api/documents` | GET / DELETE | List documents; delete one and its chunks. |

## Project layout

```
src/
  app/
    api/{chat,ingest,documents}/route.ts
    upload/page.tsx              # ingestion UI
    page.tsx                     # dashboard
  components/
    chat/                        # query input, answer panel
    citations/                   # source cards + drawer
    layout/                      # app shell, sidebar
    upload/                      # dropzone, document table
    ui/                          # shadcn-style primitives
  lib/
    openrouter/                  # embeddings + chat clients
    parsers/                     # markdown, text (registry)
    rag/                         # chunk, retrieve, prompt, pipeline
    supabase/                    # client, server, admin
supabase/migrations/             # schema, RPC, RLS, storage
```

## Scripts

```bash
npm run dev            # dev server
npm run build          # production build
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run ingest:cli -- ./sops   # bulk-ingest a folder of .md/.txt files
```

## Notes on the model choice

The spec called for Claude 3.5 Sonnet. That model has been retired by
Anthropic and is no longer in OpenRouter's catalog. The default here is
`anthropic/claude-sonnet-4.5`, the current stable Sonnet generation, and it
is overridable via `OPENROUTER_CHAT_MODEL` without a code change.

Embeddings use `openai/text-embedding-3-small` at 1536 dimensions, served
through OpenRouter's `/embeddings` endpoint. If you switch embedding models,
`EMBEDDING_DIMENSIONS` in `src/lib/constants.ts` and the `vector(N)` column
in `supabase/migrations/20240101000002_protocol_chunks.sql` must change
together.
