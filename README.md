# CircuitAtlas Protocol Assistant

Retrieval-augmented assistant for laboratory SOPs. Natural-language questions
about protocols, assays, and safety procedures are answered strictly from an
ingested corpus of Markdown, plain-text, and PDF SOPs, with every claim
traced back to the retrieved chunk that supports it.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Hosting | Vercel (serverless) |
| Database | Supabase Postgres + `pgvector` |
| Embeddings | Gemini `gemini-embedding-001` (768-dim) — AI Studio free tier |
| Generation | Gemini `gemini-flash-lite-latest`, fallback `gemini-3.6-flash` - AI Studio free tier |
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

Markdown (`.md`), plain text (`.txt`), and PDF (`.pdf`).

PDF chunks are page-aware, so a citation reads "SOP-1142 - page 7" and can
be checked against the printed protocol. Headings are detected heuristically
so a chunk maps to a named SOP section where the text layer allows it.
Scanned PDFs with no text layer are rejected with an actionable message
rather than silently producing empty chunks.

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

## Production AWS Architecture (Scaling to Messy Lab Corpora)

The MVP runs on Vercel + Supabase because both are free and zero-ops. That
stops being true when the corpus is a shared drive of scans, duplicate
revisions, and tables. The shape below keeps the application code mostly
intact: the parser registry, RAG pipeline, and provider dispatcher are
already the seams the migration needs.

### Target stack mapping

| MVP layer | AWS target | Why |
|---|---|---|
| Vercel serverless routes | Amazon ECS Fargate in private subnets | Long-running ingest, no 60 s ceiling, VPC access to RDS and Bedrock |
| Supabase Storage | Amazon S3 with SSE-KMS and versioning | Presigned upload/download, immutable object versions, no 4 MB proxy |
| Supabase Postgres + `pgvector` | Amazon RDS for PostgreSQL with `pgvector` | Same schema and `match_protocol_chunks` RPC, private subnet, RDS Proxy for concurrency |
| AI Studio / OpenRouter | Amazon Bedrock over a PrivateLink VPC endpoint | Protocol text never leaves the VPC; no third-party API egress |
| Synchronous `/api/ingest` | S3 Event Notifications -> SQS -> Fargate/Lambda worker with DLQ | Upload returns immediately; retries and failures are observable |

`src/lib/ai.ts` already dispatches between providers, and
`src/lib/parsers/index.ts` already routes `.md`, `.txt`, and `.pdf` through a
single `parseDocument` entry point. Those are the swap points, not rewrites.

### Solving messy, unorganized lab corpora

Shared-drive drops are not clean uploads. The normalization path is:

- **Content-hash dedupe.** Hash the bytes with SHA-256 on upload and key the
  S3 object by that hash. The same SOP dropped twice becomes one object, not
  two documents. Objects move `raw/` -> `normalized/` -> `quarantine/`, so a
  failed parse is kept for inspection instead of deleted.
- **Route by format.** Native `.md`, `.txt`, and text-layer `.pdf` files go
  through `src/lib/parsers/` exactly as they do today. Scanned or image-only
  PDFs, and reagent tables where line extraction loses structure, go to
  **Amazon Textract** (`TABLES` + `LAYOUT`) for text and bounding boxes.
  Textract's per-cell coordinates are what make table citations exact; the
  existing `rects` metadata on PDF chunks is the same idea at line level.
- **Revision tracking.** `supersedes_document_id` and `effective_date` on the
  document row let retrieval filter to the current revision by default while
  keeping every superseded version auditable. A partial unique index on the
  active revision per protocol title makes "two current versions" impossible
  at the database level rather than in application code.

### Network and data isolation

- **No public ingress.** Application and database tasks run in private
  subnets. Only the load balancer is reachable from the bench network, and
  RDS accepts connections from the application security group only.
- **Least-privilege IAM.** Ingestion writers can `s3:PutObject`, call
  Textract, and write chunks. Query workers get read-only SQL, S3
  `GetObject` on one prefix, and `bedrock:InvokeModel`. Neither role can do
  the other's job, and no long-lived access keys exist.
- **Secrets rotation.** Database credentials live in AWS Secrets Manager and
  rotate on a schedule; the application reads them through RDS Proxy rather
  than a `.env` file.
- **Infrastructure as code.** The stack is provisioned with AWS CDK
  (TypeScript), or Terraform if the team prefers it, and GitHub Actions runs
  `cdk diff` / `terraform plan` on every pull request, so network and IAM
  changes are reviewed before they are applied.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | SSE stream. Emits `citations`, then token `delta`s, then `done`. |
| `/api/ingest` | POST | Multipart upload. Parses, chunks, embeds, inserts. |
| `/api/documents` | GET | List documents, or one document with its chunks (`?id=`). |
| `/api/documents` | DELETE | Delete a document and its chunks (`?id=`). |
| `/api/documents/file` | GET | The original upload, streamed back (`?id=`). |

## Reading the answer in the source

The workbench is one screen. On the left the answer arrives; on the right
the protocol it came from is open, with the cited passage marked.

One protocol at a time: the question is answered from the document selected
in the pill row, so asking about a different SOP never pulls evidence out of
the one that is already on screen. The active pill is the one being asked.

Clicking a citation - the badges under the answer, or the `[1]` markers
inside it - loads that protocol on the right at the page the claim came
from and marks the lines that answer the question.

A PDF is drawn with pdf.js: the page on a canvas, its text runs in a
transparent text layer on top. The layer is what gets highlighted, so the
mark lands on the printed lines rather than on a box drawn over them. The
page is fed by `/api/documents/file`, which streams the original upload back
from the private bucket; the address is stored on the document as `file_url`
because a signed Supabase URL would expire.

Markdown and plain text have no page to draw, so they are shown as the
indexed text with the same passage marked. The passage is found with a
whitespace-tolerant pattern, so the mark lands on the text even when the
line breaks in the stored document differ from the retrieved chunk.

## Notes on the model choice

The spec called for Claude 3.5 Sonnet. That model has been retired by
Anthropic and is no longer in OpenRouter's catalog. The default is now
Gemini `gemini-flash-lite-latest` (free tier) with `gemini-3.6-flash` as
the fallback, and OpenRouter's `anthropic/claude-3.5-sonnet` is available
by setting `AI_PROVIDER=openrouter` with a funded key.

Versioned Gemini ids get retired for new accounts and then answer 404
("no longer available to new users") - that is what happened to
`gemini-2.5-flash-lite` and `gemini-2.5-flash`. The `-latest` alias moves
with the current lite release, so the default does not rot; set
`GEMINI_CHAT_MODEL` / `GEMINI_CHAT_FALLBACK_MODEL` to pin one.

## Project layout

```
src/
  app/
    api/{chat,ingest,documents}/route.ts
    page.tsx                     # the workbench
  components/
    chat/                        # query input, answer panel
    viewer/                      # protocol viewer with the cited passage marked
    layout/                      # theme provider, theme toggle
    ui/                          # shadcn-style primitives
    workbench/                   # split-pane shell, upload strip
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
