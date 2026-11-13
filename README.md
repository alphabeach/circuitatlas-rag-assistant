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
| Embeddings | Gemini `gemini-embedding-001` (768-dim) — AI Studio free tier |
| Generation | Gemini `gemini-4-hydrogen` — AI Studio free tier |
| UI | Tailwind CSS v4, Radix primitives, `next-themes` |

### Why Gemini and not OpenRouter

OpenRouter's free models work without credits, but the pool is capped at
**50 requests per day** on a zero-credit account (measured from the
`x-ratelimit-limit` response header). Ingesting one 82-chunk PDF plus a
day of queries blows through that immediately. Adding $10 of credit raises
the cap to 1000 free requests per day, which does work.

Google's AI Studio free tier needs no credit card and has far higher
quotas, so it is the default provider. OpenRouter remains available via
`AI_PROVIDER=openrouter` for anyone who wants a different model.

Two provider-specific notes that cost real debugging time:

- Gemini's `embedContent` endpoint **aggregates** multiple input parts into
  a single vector. Batching therefore requires `batchEmbedContents`, which
  returns one embedding per request.
- Gemini's SSE frames are separated by `\r\n\r\n`. Splitting the stream on
  `"\n\n"` silently yields zero frames, which produces an empty answer with
  no error. The client normalises CRLF to LF before splitting.

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

Dense embedding models produce **anisotropic** vectors. All vectors share a
dominant direction, so raw cosine similarity has a high floor: unrelated
English text still scores around 0.6. Measured on the Gemini embeddings,
an out-of-domain question ("what is the corporate holiday policy") scored
**0.637** against a chunk about cell lysis, while the weakest correct match
scored **0.715**.

So relevance is judged in two steps:

1. **Over-fetch.** The RPC pulls 30 candidates with the threshold disabled
   (`-1.0`). You cannot distinguish "the best match was weak" from "we
   truncated the good hits" if you only ever fetch 8.
2. **Absolute floor** (`0.65`). Just above the measured noise ceiling of
   0.637 and below the weakest true match of 0.715. Catches the case where
   nothing in the corpus is remotely related, so the system abstains
   instead of hallucinating.
3. **Relative delta** (`0.10`). Keeps only chunks within `0.10` of the
   best-scoring hit for *this* query. Measured average top-2 margin was
   0.084.
4. **Model abstention.** The system prompt instructs the model to reply
   `INSUFFICIENT_CONTEXT` when the provided context does not answer the
   question. This is the real safety net - it does not depend on the
   threshold being right.

All four values live in `src/lib/constants.ts`.

### Calibrating the thresholds

The thresholds above are **measured, not guessed**, but they came from six
chunks of a single SOP. Re-run the calibration against the real corpus:

```bash
npx tsx scripts/calibrate-retrieval.ts
```

It reports top-1 accuracy, the weakest true score, the strongest noise
score, and the resulting threshold window.

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

## Notes on the model choice

The spec called for Claude 3.5 Sonnet. That model has been retired by
Anthropic and is no longer in OpenRouter's catalog. The default is now
Gemini `gemini-4-hydrogen` (free tier), and OpenRouter's
`anthropic/claude-3.5-sonnet` is available by setting
`AI_PROVIDER=openrouter` with a funded key.

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
    ai.ts                        # provider dispatcher
    gemini/                      # Gemini embeddings + chat
    openrouter/                  # OpenRouter embeddings + chat
    parsers/                     # markdown, text, pdf (registry)
    rag/                         # chunk, retrieve, prompt, pipeline, ingest
    supabase/                    # client, server, admin
supabase/migrations/             # schema, RPC, RLS, storage
scripts/                         # calibration, probes, CLI ingest
```

## Scripts

```bash
npm run dev            # dev server
npm run build          # production build
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run ingest:cli -- ./sops   # bulk-ingest a folder of .md/.txt/.pdf files

npx tsx scripts/calibrate-retrieval.ts   # measure threshold windows
npx tsx scripts/probe-gemini.ts           # verify key, models, dimension
npx tsx scripts/list-gemini-models.ts     # models available to the key
```

## Supported input formats

Markdown (`.md`), plain text (`.txt`), and PDF (`.pdf`).

PDF chunks are page-aware, so a citation reads "SOP-1142 - page 7" and can
be checked against the printed protocol. Headings are detected heuristically
so a chunk maps to a named SOP section where the text layer allows it.
Scanned PDFs with no text layer are rejected with an actionable message
rather than silently producing empty chunks.
